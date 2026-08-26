import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getSession, saveSession, deleteSession, set, incr, emptySession } from './store.js';
import * as fb from './messenger.js';
import { QUESTIONS, TOTAL, renderQuestion, matchAnswer } from './quiz.js';
import {
  analyzeFree,
  generateFullReport,
  deepDive,
  freeChat as claudeChat,
  formatFullReport,
} from './claude.js';
import { chat as openaiChat, pushHistory } from './openai.js';

/** Ярианы бүх логик — төлөвт суурилсан машин. */

/**
 * "analyzing" төлөвт хамгийн ихдээ хэдэн миллисекунд байж болох вэ.
 * Vercel функц дундаа алагдвал (60с хязгаар) session нь "analyzing" дээр
 * үүрд гацаж, хэрэглэгч ямар мессеж бичсэн ч «түр хүлээгээрэй» гэсэн хариу
 * авдаг байсан. Энэ хугацаа өнгөрвөл гацсан гэж үзээд сэргээнэ.
 */
const ANALYZING_MAX_MS = 90_000;

const analyzingStalled = (session) =>
  session.state === 'analyzing' && Date.now() - (session.updatedAt ?? 0) > ANALYZING_MAX_MS;

const START_WORDS = ['1', 'эхлэх', 'эхлэе', 'бэлэн', 'тийм', 'start', 'ok', 'okay', 'за'];
const DELETE_WORDS = ['устгах', 'устга', 'delete', 'өгөгдөл устгах', 'мэдээлэл устгах'];
const STOP_WORDS = ['зогсоо', 'больё', 'болъё', 'stop'];

// ── Текстүүд ───────────────────────────────────────────────────────────

const WELCOME = `Чи өөрийгөө хэр сайн мэддэг вэ? 👀

Заримдаа бид өөрсдийнхөө тухай хамгийн чухал зүйлсийг ч анзаардаггүй. Харин зан чанар, харилцааны хэв маяг, бусдад тэр бүр харагддаггүй талууд чинь чиний тухай маш ихийг хэлдэг.

Өөрийнхөө мэддэггүй нэг талыг нээхэд бэлэн үү? ✨
Бэлэн бол 1 гэж бичээрэй. 👇`;

const QUIZ_INTRO = `Гоё 🙌 10 асуулт асууна — 1 минут ч болохгүй.

Зөв, буруу хариулт байхгүй. Хамгийн эхэнд санаанд орж ирсэн хариултаа сонго — тэр нь хамгийн үнэн.`;

const ANALYZING = `Баярлалаа 🙏 Хариултуудыг чинь боловсруулж байна…

AI дүн шинжилгээ хийхэд 10-30 секунд орно. Хүлээгээрэй ✨`;

function freeResultText(profile) {
  return `🔎 ТАНЫ ҮР ДҮН

${profile.emoji} «${profile.type_name}»

${profile.summary}

✨ Таны давуу тал
${profile.strength}

⚠️ Анзаардаггүй тал
${profile.blind_spot}`;
}

function upsellText(profile) {
  const teaser = (profile.teaser ?? []).map((t) => `• ${t}`).join('\n');
  return `Гэхдээ энэ бол зөвхөн мөсөн уулын оройн хэсэг 🧊

Таны хариултаас өөр сонирхолтой зүйлс харагдсан:
${teaser}

🧠 «Таны Хувийн Профайл» — бүрэн анализ
🧬 Зан чанарын дэлгэрэнгүй
💪 Таны 5 гол давуу тал
⚠️ Сул тал ба далд хэв маяг
❤️ Харилцааны хэв маяг
💼 Ажил, карьерын орчин
🧠 Стрессийн үеийн зан төлөв
🔥 Далд потенциал
📈 Хөгжүүлэх 5 зөвлөмж

Үнэ: ${config.priceLabel}`;
}

// ── Туслах функцууд ────────────────────────────────────────────────────

/** Төлбөрийн холбоос — PSID-г URL-д тавихгүй, түр захиалгын код үүсгэнэ. */
async function paymentLink(psid) {
  const order = randomUUID().split('-')[0];
  await set(`order:${order}`, { psid, createdAt: Date.now() }, 60 * 60 * 24 * 7);
  const base = config.paymentUrl || `${config.siteUrl}/payment`;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}order=${order}`;
}

async function sendUpsell(psid, profile) {
  const url = await paymentLink(psid);
  await fb.sendText(psid, upsellText(profile));
  await fb.sendButtons(psid, 'Бүрэн анализаа аваад өөрийгөө бүрэн нээгээрэй 👇', [
    { type: 'web_url', title: '💳 Бүрэн анализ', url },
    { type: 'postback', title: '💬 AI-тай ярих', payload: 'CHAT' },
  ]);
}

async function askQuestion(psid, session) {
  const { text, quickReplies } = renderQuestion(session.questionIndex);
  await fb.sendQuickReplies(psid, text, quickReplies);
}

async function startQuiz(psid, session) {
  session.state = 'quiz';
  session.questionIndex = 0;
  session.answers = [];
  session.profile = null;
  session.fullReport = null;
  await saveSession(psid, session);
  await fb.sendText(psid, QUIZ_INTRO);
  await askQuestion(psid, session);
}

async function sendWelcome(psid, session) {
  session.state = 'idle';
  await saveSession(psid, session);
  await fb.sendQuickReplies(psid, WELCOME, [
    { title: '1 — Бэлэн ✨', payload: 'START_QUIZ' },
  ]);
}

/** 10 дахь хариултын дараа — Claude-аар анализ хийж үр дүнг илгээнэ. */
async function runAnalysis(psid, session) {
  session.state = 'analyzing';
  await saveSession(psid, session);
  await fb.sendText(psid, ANALYZING);
  await fb.senderAction(psid, 'typing_on');

  try {
    const person = await fb.getProfile(psid).catch(() => null);
    const profile = await analyzeFree(session.answers, { firstName: person?.first_name });

    session.profile = profile;
    session.state = 'result';
    await saveSession(psid, session);

    await fb.sendText(psid, freeResultText(profile));
    await sendUpsell(psid, profile);
  } catch (err) {
    console.error('[flow] анализ амжилтгүй', err?.status ?? '', err?.message ?? err);
    // Хариултуудыг ХАДГАЛНА — хэрэглэгчийг 10 асуултыг дахин өгөхөд хүргэхгүй.
    session.state = 'error';
    await saveSession(psid, session);
    await fb.sendQuickReplies(
      psid,
      'Уучлаарай, дүн шинжилгээ хийх үед алдаа гарлаа 😔 Хариултууд чинь хадгалагдсан — дахин оролдох уу?',
      [{ title: '🔄 Дахин оролдох', payload: 'RETRY_ANALYSIS' }],
    );
  }
}

/** Алдаа / гацаанаас сэргээх — хариулт бүрэн бол анализыг давтана. */
async function resume(psid, session) {
  if (session.answers.length >= TOTAL) return runAnalysis(psid, session);
  session.state = 'quiz';
  session.questionIndex = Math.min(session.answers.length, TOTAL - 1);
  await saveSession(psid, session);
  return askQuestion(psid, session);
}

async function recordAnswer(psid, session, option) {
  session.answers.push({ key: option.key, label: option.label });
  session.questionIndex += 1;
  await saveSession(psid, session);

  if (session.questionIndex >= TOTAL) {
    await runAnalysis(psid, session);
  } else {
    await askQuestion(psid, session);
  }
}

/** Бүрэн тайланг илгээх (төлбөр төлсний дараа эсвэл дахин хүсэхэд). */
export async function deliverFullReport(psid, session) {
  if (!session.profile) {
    await fb.sendText(psid, 'Эхлээд 10 асуултын тестээ өгөөрэй 🙂');
    return false;
  }

  // Бүрэн тайланг зөвхөн ОДОО үүсгэнэ — үнэгүй хэрэглэгчид дээр
  // дэмий токен зарцуулахгүй, үнэгүй хэсэг нь хурдан хүрнэ.
  if (!session.fullReport) {
    await fb.sendText(
      psid,
      '🎉 Төлбөр баталгаажлаа! Таны бүрэн анализыг бэлдэж байна — 1-2 минут орно ✨',
    );
    await fb.senderAction(psid, 'typing_on');
    try {
      session.fullReport = await generateFullReport(session.answers, session.profile);
      await saveSession(psid, session);
    } catch (err) {
      console.error('[flow] бүрэн тайлан үүсгэхэд алдаа', err);
      await fb.sendText(
        psid,
        'Уучлаарай, тайлан бэлдэх үед алдаа гарлаа 😔 Бид шалгаж байна — та «миний үр дүн» гэж бичээд дахин оролдож үзээрэй.',
      );
      return false;
    }
  } else {
    await fb.sendText(psid, '📄 Таны бүрэн анализ 👇');
  }

  await fb.sendText(psid, formatFullReport(session.profile, session.fullReport));
  await fb.sendButtons(
    psid,
    'Тайлангийнхаа талаар асуух зүйл байвал шууд бичээрэй — AI хариулна 💬',
    [{ type: 'postback', title: '💬 Асуулт асуух', payload: 'CHAT' }],
  );
  return true;
}

/**
 * Хариултыг гаргаж авах.
 *
 * Төлсөн хэрэглэгч → Claude-ийн гүнзгий хариулт.
 * Үнэгүй хэрэглэгч → OpenAI. Хэрэв OpenAI унасан бол (түлхүүр байхгүй, эрх
 * дууссан, загварын нэр буруу гэх мэт) бот ДУУГҮЙ БОЛОХГҮЙН тулд Claude руу
 * шилжинэ. Жинхэнэ шалтгаан нь логт үлдэнэ.
 */
async function generateReply(session, text) {
  if (session.paid && session.profile) return deepDive(session.profile, text);

  try {
    return await openaiChat(session, text);
  } catch (err) {
    console.error(
      '[flow] OpenAI чат амжилтгүй — Claude руу шилжиж байна:',
      err?.status ?? '',
      err?.message ?? err,
    );
    return claudeChat(session, text);
  }
}

/** Чөлөөт чат — төлсөн бол Claude гүнзгий, үгүй бол OpenAI (нөөц нь Claude). */
async function handleChat(psid, session, text) {
  await fb.senderAction(psid, 'typing_on');

  if (!session.paid) {
    const used = await incr(`chatcount:${psid}`, 60 * 60 * 24);
    if (used > config.freeChatLimit) {
      await fb.sendText(
        psid,
        `Өнөөдрийн үнэгүй ${config.freeChatLimit} мессеж дууслаа 🙏 Маргааш дахин ярилцъя, эсвэл бүрэн анализаа аваарай.`,
      );
      if (session.profile) await sendUpsell(psid, session.profile);
      return;
    }
  }

  try {
    const reply = await generateReply(session, text);

    pushHistory(session, text, reply);
    session.state = 'chat';
    await saveSession(psid, session);
    await fb.sendText(psid, reply);
  } catch (err) {
    console.error('[flow] чат алдаа', err?.status ?? '', err?.message ?? err);
    await fb.sendText(psid, 'Уучлаарай, түр зуурын алдаа гарлаа 😔 Дахин бичээд үзээрэй.');
  }
}

// ── Гол оролт ──────────────────────────────────────────────────────────

async function handlePayload(psid, session, payload) {
  if (payload === 'GET_STARTED' || payload === 'RESTART') {
    const fresh =
      payload === 'RESTART'
        ? { ...emptySession(), paid: session.paid, profile: session.profile }
        : session;
    return sendWelcome(psid, fresh);
  }

  if (payload === 'START_QUIZ') return startQuiz(psid, session);

  if (payload === 'RETRY_ANALYSIS') return resume(psid, session);

  if (payload === 'BUY') {
    if (!session.profile) return sendWelcome(psid, session);
    return sendUpsell(psid, session.profile);
  }

  if (payload === 'MY_RESULT') {
    if (!session.profile) {
      return fb.sendQuickReplies(psid, 'Та тестээ хараахан өгөөгүй байна 🙂', [
        { title: '✨ Тест эхлэх', payload: 'START_QUIZ' },
      ]);
    }
    if (session.paid) return deliverFullReport(psid, session);
    await fb.sendText(psid, freeResultText(session.profile));
    return sendUpsell(psid, session.profile);
  }

  if (payload === 'CHAT') {
    session.state = 'chat';
    await saveSession(psid, session);
    return fb.sendText(psid, 'Сонсож байна 👂 Юуны талаар ярилцах вэ?');
  }

  if (payload === 'DELETE_DATA') {
    return fb.sendQuickReplies(
      psid,
      'Таны бүх өгөгдөл (хариултууд, анализ, ярианы түүх) бүрмөсөн устана. Сэргээх боломжгүй.\n\nҮнэхээр устгах уу?',
      [
        { title: '🗑 Тийм, устга', payload: 'DELETE_CONFIRM' },
        { title: '↩️ Болих', payload: 'CHAT' },
      ],
    );
  }

  if (payload === 'DELETE_CONFIRM') {
    await deleteSession(psid);
    return fb.sendText(
      psid,
      '✅ Таны бүх өгөгдөл устгагдлаа.\n\nMessenger доторх ярианы түүхийг Facebook хадгалдаг тул түүнийг чатнаасаа өөрөө устгана уу.\n\nДахин эхлэхийг хүсвэл «1» гэж бичээрэй.',
    );
  }

  // ANS_{index}_{key}
  const match = /^ANS_(\d+)_(.+)$/.exec(payload);
  if (match) {
    const index = Number(match[1]);
    if (session.state !== 'quiz') return;
    if (index !== session.questionIndex) {
      // Хуучин товч дарсан — одоогийн асуултыг давтана
      return askQuestion(psid, session);
    }
    const option = QUESTIONS[index].options.find((o) => o.key === match[2]);
    if (option) return recordAnswer(psid, session, option);
  }

  return sendWelcome(psid, session);
}

async function handleText(psid, session, text) {
  const normalized = text.trim().toLowerCase();

  // Нууцлалын шаардлага — хэрэглэгч хүссэн үедээ өгөгдлөө устгуулж чадна
  if (DELETE_WORDS.includes(normalized)) {
    return handlePayload(psid, session, 'DELETE_DATA');
  }

  if (STOP_WORDS.includes(normalized)) {
    session.state = 'idle';
    await saveSession(psid, session);
    return fb.sendText(
      psid,
      'За, ойлголоо 🙏 Хүссэн үедээ «1» гэж бичээд эргэж ирээрэй.\n\nӨгөгдлөө бүрмөсөн устгахыг хүсвэл «устгах» гэж бичээрэй.',
    );
  }

  if (session.state === 'analyzing') {
    if (!analyzingStalled(session)) {
      return fb.sendText(psid, 'Анализ хийж дуусаж байна… түр хүлээгээрэй ⏳');
    }
    // Функц дундаа тасарсан байна — «хүлээгээрэй» дээр үүрд гацахаас сэргийлнэ.
    console.warn('[flow] analyzing төлөв гацсан — сэргээж байна');
    return resume(psid, session);
  }

  // Өмнөх анализ амжилтгүй болсон — ямар ч мессежээр дахин оролдоно.
  if (session.state === 'error') return resume(psid, session);

  if (session.state === 'quiz') {
    const option = matchAnswer(session.questionIndex, text);
    if (option) return recordAnswer(psid, session, option);
    await fb.sendText(psid, 'Доорх товчнуудаас сонгоно уу 👇 (эсвэл А / Б / В гэж бичээрэй)');
    return askQuestion(psid, session);
  }

  if (session.state === 'idle') {
    if (START_WORDS.includes(normalized)) return startQuiz(psid, session);
    return sendWelcome(psid, session);
  }

  if (session.state === 'result' && START_WORDS.includes(normalized)) {
    return startQuiz(psid, session);
  }

  // result / chat төлөвт — чөлөөт яриа
  return handleChat(psid, session, text);
}

/**
 * Facebook-оос ирсэн нэг messaging event-ийг боловсруулна.
 */
export async function handleEvent(event) {
  const psid = event.sender?.id;
  if (!psid) return;
  if (event.message?.is_echo) return; // өөрийн илгээсэн мессеж
  if (event.read || event.delivery) return; // уншсан / хүргэгдсэн мэдэгдэл

  const session = await getSession(psid);
  await fb.senderAction(psid, 'mark_seen');

  const payload = event.postback?.payload ?? event.message?.quick_reply?.payload;
  if (payload) return handlePayload(psid, session, payload);

  const text = event.message?.text;
  if (text) return handleText(psid, session, text);

  if (event.message?.attachments) {
    return fb.sendText(psid, 'Одоогоор зөвхөн текст ойлгодог юм байна 🙈 Бичээд илгээгээрэй.');
  }
}
