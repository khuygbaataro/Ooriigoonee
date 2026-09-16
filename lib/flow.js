import { config } from './config.js';
import {
  getSession,
  saveSession,
  deleteSession,
  set,
  incr,
  claimOnce,
  emptySession,
  touchActivity,
} from './store.js';
import * as fb from './messenger.js';
import { QUESTIONS, TOTAL, renderQuestion, matchAnswer } from './quiz.js';
import {
  analyzeQuick,
  generateFullReport,
  guideReply as claudeGuide,
  chat as claudeChat,
  readPaymentProof,
  updateMemory as claudeUpdateMemory,
} from './claude.js';
import { formatFullReport } from './report.js';
import {
  chat as openaiChat,
  guide as openaiGuide,
  updateMemory as openaiUpdateMemory,
} from './openai.js';
import { pushHistory, shouldUpdate } from './memory.js';
import {
  asksAboutGift,
  asksAboutShare,
  isHeavyMoment,
  canSuggestShare,
  giftAnswer,
  shareAnswer,
  shareNudge,
  giftThanks,
  giftUnclear,
} from './gift.js';

/**
 * Ярианы бүх логик — төлөвт суурилсан машин.
 *
 * ⚠️ ГОЛ ЗАРЧИМ: ЭНД ТҮГЖЭЭ БАЙХГҮЙ.
 *    Бүх зүйл — товч тусгал, бүрэн тайлан, хязгааргүй яриа — эхнээсээ
 *    бүгдэд нээлттэй. Мөнгөний тухай мессеж ЗӨВХӨН хоёр газраас гарна:
 *      1. handleGiftAsk() — хүн ӨӨРӨӨ асуусан үед
 *      2. handleReceipt() — хүн өөрөө бэлэг илгээсэн үед талархах
 *    Өөр ямар ч зам байхгүй бөгөөд байх ч ёсгүй.
 */

/**
 * "analyzing" төлөвт хамгийн ихдээ хэдэн миллисекунд байж болох вэ.
 * Vercel функц дундаа алагдвал (60с хязгаар) session нь энэ төлөвт үүрд
 * гацна. Энэ хугацаа өнгөрвөл гацсан гэж үзээд сэргээнэ.
 */
const ANALYZING_MAX_MS = 90_000;

const analyzingStalled = (session) =>
  session.state === 'analyzing' && Date.now() - (session.updatedAt ?? 0) > ANALYZING_MAX_MS;

const START_WORDS = ['1', 'эхлэх', 'эхлэе', 'эхэлье', 'бэлэн', 'тийм', 'start', 'ok', 'okay', 'за'];
const YES_WORDS = [
  ...START_WORDS, 'үзье', 'харья', 'уншья', 'болно', 'тэгье', 'мэдмээр байна',
  'сонирхолтой', 'үргэлжлүүл', 'цааш', 'yes', 'тиймээ', 'аан тийм',
];
const DELETE_WORDS = ['устгах', 'устга', 'delete', 'өгөгдөл устгах', 'мэдээлэл устгах'];
const STOP_WORDS = ['зогсоо', 'больё', 'болъё', 'stop'];

// ── Текстүүд ───────────────────────────────────────────────────────────

/**
 * ⚠️ БҮХ ТЕКСТ АЛЬ БОЛОХ БОГИНО БАЙХ ЁСТОЙ.
 *
 * Messenger бол чат. Дэлгэц дүүрэн текст ирэх нь (а) уншихгүй өнгөрөх,
 * (б) «энэ бол робот» гэж шууд мэдрүүлэх хоёуланг нь үүсгэдэг.
 * Хүн хүнтэй ярихдаа догол мөр бичдэггүй.
 *
 * Дүрэм: шинэ өгүүлбэр нэмэх гэж байвал эхлээд «үүнгүйгээр утга нь
 * бүрэн үлдэх үү?» гэж асуу. Үлдэх бол бүү нэм.
 */

/**
 * ⚠️ «Үнэгүй», «төлбөргүй» гэж ЗОРИУД хэлэхгүй.
 *
 * Мөнгөний тухай ярихгүй гэж хэлэх нь ч гэсэн мөнгийг яриан дунд оруулна.
 * Хүн шинэ хүнтэй танилцахдаа «энэ үнэгүй шүү» гэж эхэлдэггүй.
 * Хэн нэгэн асуувал lib/gift.js тусад нь барьж аваад хариулна.
 */
const WELCOME = `Сайн байна уу 👋

10 асуулт асууя, нэг минут ч болохгүй. Дараа нь юу харснаа хэлье — зөв эсэхийг нь чи шийднэ.`;

const QUIZ_INTRO = `Зөв, буруу хариулт байхгүй шүү. Эхэнд санаанд орсноо л сонго — удаан бодох тусам «байх ёстой» хариулт руу шилждэг юм билээ.`;

const ANALYZING = `Баярлалаа 🙏 Уншиж байна… 20-30 секунд.`;

/** Товч тусгал. «Үр дүн» биш, «эхний харц» гэж нэрлэсэн нь санаатай. */
function mirrorText(profile) {
  return `${profile.emoji} «${profile.type_name}»

${profile.summary}

Хүч чинь:
${profile.strength}

Анзаардаггүй тал:
${profile.blind_spot}`;
}

function noticedText(profile) {
  const items = (profile.noticed ?? []).map((t) => `• ${t}`).join('\n');
  if (!items) return null;
  return `Өөр гурван зүйл анзаарагдлаа:\n\n${items}`;
}

const DEEPER_OFFER = `Энэ бол эхний харц. Хариултад чинь үүнээс хамаагүй их зүйл байна.

Бүтнээр нь үзэх үү?`;

const REPORT_INTRO = `Бэлдье 📝 Жаахан удна шүү.`;

/** Тайлангийн дараа — энэ мессеж хамгийн чухал. Яриаг ЭНД эхлүүлнэ. */
const AFTER_REPORT = `Нэг зүйл хэлээч: хамгийн их «аан, үнэн шүү» гэж бодогдсон нь юу байв?

Таарахгүй зүйл байсан ч хэлээрэй — тэр нь бүр сонирхолтой.`;

const DAILY_LIMIT = `Өнөөдөр нэлээд ярилаа 🙂 Маргааш үргэлжлүүлье — би энд байна.`;

// ── Туслах функцууд ────────────────────────────────────────────────────

/**
 * Хэрэглэгчийн Facebook нэр. Нэг л удаа татаад session-д хадгална.
 * ⚠️ Одоо зөвхөн дулаан мэндчилгээнд ашиглана — юу ч шалгахгүй.
 */
async function facebookName(psid, session) {
  if (session.fbName) return session.fbName;
  const person = await fb.getProfile(psid).catch(() => null);
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  if (name) {
    session.fbName = name;
    await saveSession(psid, session);
  }
  return name;
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

/** Товч тусгалыг харуулаад, гүнзгийрүүлэхийг САНАЛ БОЛГОНО (шахахгүй). */
async function sendMirror(psid, session) {
  const profile = session.profile;
  await fb.sendText(psid, mirrorText(profile));

  const noticed = noticedText(profile);
  if (noticed) await fb.sendText(psid, noticed);

  session.state = 'mirror';
  await saveSession(psid, session);

  await fb.sendQuickReplies(psid, DEEPER_OFFER, [
    { title: '✨ Тийм, үзье', payload: 'FULL_REPORT' },
    { title: 'Дараа', payload: 'LATER' },
  ]);
}

/** 10 дахь хариултын дараа — товч тусгал гаргана. */
async function runAnalysis(psid, session) {
  session.state = 'analyzing';
  await saveSession(psid, session);
  await fb.sendText(psid, ANALYZING);
  await fb.senderAction(psid, 'typing_on');

  try {
    const fbName = await facebookName(psid, session);
    session.profile = await analyzeQuick(session.answers, { firstName: fbName.split(' ')[0] });
    await saveSession(psid, session);
    await sendMirror(psid, session);
  } catch (err) {
    console.error('[flow] анализ амжилтгүй', err?.status ?? '', err?.message ?? err);
    // Хариултуудыг ХАДГАЛНА — хэрэглэгчийг 10 асуултыг дахин өгөхөд хүргэхгүй.
    session.state = 'error';
    await saveSession(psid, session);
    await fb.sendQuickReplies(
      psid,
      'Ямар нэг зүйл буруу болчихлоо 😔 Хариултууд чинь хадгалагдсан — дахин оролдох уу?',
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

/**
 * Бүрэн тайланг илгээх — БҮГДЭД НЬ, ҮНЭГҮЙ.
 *
 * Тайланг зөвхөн ОДОО үүсгэнэ (урьдчилж биш) — хүсээгүй хүн дээр дэмий
 * токен зарцуулахгүйн тулд.
 *
 * @param {object} options.timeoutMs Тайлан үүсгэхэд үлдсэн хугацааны төсөв.
 */
export async function deliverFullReport(psid, session, { timeoutMs } = {}) {
  if (!session.profile) {
    return fb.sendQuickReplies(psid, 'Эхлээд 10 асуултаа асууя 🙂', [
      { title: '✨ Эхлэх', payload: 'START_QUIZ' },
    ]);
  }

  if (!session.fullReport) {
    await fb.sendText(psid, REPORT_INTRO);
    await fb.senderAction(psid, 'typing_on');
    try {
      session.fullReport = await generateFullReport(session.answers, session.profile, {
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      await saveSession(psid, session);
    } catch (err) {
      console.error('[flow] бүрэн тайлан үүсгэхэд алдаа', err?.status ?? '', err?.message ?? err);
      session.state = 'report_pending';
      await saveSession(psid, session);
      await fb.sendQuickReplies(
        psid,
        'Алдаа гарлаа 😔 Дахин оролдоход л хангалттай.',
        [{ title: '📄 Дахин оролдох', payload: 'MY_RESULT' }],
      );
      return false;
    }
  }

  // Хэсэг бүрийг тусад нь илгээнэ — нэг урт блок биш.
  for (const message of formatFullReport(session.profile, session.fullReport)) {
    await fb.sendText(psid, message);
  }

  // Тайлан бол төгсгөл биш — ЭНДЭЭС л жинхэнэ яриа эхэлнэ.
  session.state = 'chat';
  await saveSession(psid, session);
  await fb.sendText(psid, AFTER_REPORT);
  return true;
}

// ── Бэлэг («өгөө авъяа») ───────────────────────────────────────────────

/**
 * Хүн ӨӨРӨӨ төлбөр / дэмжлэгийн тухай асуусан.
 *
 * ⚠️ Дансны мэдээлэл ЗӨВХӨН эндээс гарна. Текст нь бүхэлдээ гараар
 *    бичигдсэн (lib/gift.js) — загвар мөнгөний тухай өгүүлбэр зохиохгүй.
 */
async function handleGiftAsk(psid, session) {
  await fb.sendText(psid, giftAnswer());
  session.giftShownAt = Date.now();
  session.state = 'chat';
  await saveSession(psid, session);

  // Тестээ өгөөгүй хүн байвал — асуултад нь хариулчихаад аялалд нь эргүүлнэ.
  if (!session.profile) {
    await fb.sendQuickReplies(psid, 'Тэгээд… эхлэх үү? 🙂', [
      { title: '✨ Тийм, эхлэе', payload: 'START_QUIZ' },
    ]);
  }
}

/** Нэг баримтыг хоёр удаа бүртгэхээс хамгаалах хугацаа. */
const RECEIPT_TTL = 60 * 60 * 24 * 180; // 180 хоног

/** Шалгалт бүрийг Redis-д үлдээнэ — эзэмшигчийн бүртгэлд хэрэгтэй. */
async function recordGift(psid, proof, image) {
  const row = { psid, proof, sha256: image?.sha256, at: Date.now() };
  console.log('[flow] бэлэг', JSON.stringify(row));
  await set(`gift:${psid}:${Date.now()}`, row, RECEIPT_TTL).catch((err) =>
    console.error('[flow] бэлэг хадгалахад алдаа', err?.message ?? err),
  );
}

/**
 * Зураг ирсэн — бэлгийн баримт эсэхийг харна.
 *
 * ⚠️ ЭНД ШАЛГАЛТ БАЙХГҮЙ гэдгийг сайн ойлгох хэрэгтэй:
 *    · Дүнг шалгахгүй. Доод хэмжээ гэж байхгүй.
 *    · Гүйлгээний утга дээрх нэрийг шалгахгүй. Таних шаардлагагүй.
 *    · Баримт таарахгүй байсан ч хүнийг буруутгахгүй, юу ч татгалзахгүй.
 *    Учир нь нээгдэх зүйл байхгүй — бүх зүйл аль хэдийн нээлттэй.
 *    Баримтыг зөвхөн ЗӨВ ҮГЭЭР ТАЛАРХАХЫН ТУЛД уншиж байна.
 */
async function handleReceipt(psid, session, imageUrl) {
  await fb.senderAction(psid, 'typing_on');

  let image;
  let proof;
  try {
    image = await fb.downloadImage(imageUrl);
    proof = await readPaymentProof([image]);
  } catch (err) {
    console.error('[flow] баримт унших алдаа', err?.status ?? '', err?.message ?? err);
    return fb.sendText(psid, giftUnclear());
  }

  const toUs = digitsMatch(proof.destination_account);
  if (!proof.is_receipt || proof.status !== 'success' || !toUs) {
    console.log('[flow] баримт тодорхойгүй', JSON.stringify({ psid, proof }));
    return fb.sendText(psid, giftUnclear());
  }

  // Нэг баримтыг хоёр удаа талархахаас сэргийлнэ (Facebook retry г.м.).
  // ⚠️ Бүртгэхийн ӨМНӨ шалгана — эс тэгвээс давхардсан бүртгэл үлдэнэ.
  const txId = proof.transaction_id.trim().toLowerCase();
  const key = txId ? `giftseen:tx:${txId}` : `giftseen:img:${image.sha256}`;
  if (!(await claimOnce(key, RECEIPT_TTL))) {
    return; // чимээгүй өнгөрнө — дахин талархвал хачин болно
  }

  await recordGift(psid, proof, image);

  session.gifted = true;
  session.giftedAt = Date.now();
  session.giftProof = proof;
  session.state = 'chat';
  await saveSession(psid, session);

  await fb.sendText(psid, giftThanks());
}

/** Баримт дээрх данс манайх мөн үү (IBAN эсвэл дансны дугаар). */
function digitsMatch(seenRaw) {
  const seen = String(seenRaw ?? '').replace(/\D/g, '');
  const want = String(config.bankAccount ?? '').replace(/\D/g, '');
  const wantIban = String(config.bankIban ?? '').replace(/\D/g, '');
  if (!seen || !want) return false;
  return seen.includes(want) || (wantIban && seen.includes(wantIban));
}

// ── Яриа ───────────────────────────────────────────────────────────────

/**
 * Хариултыг гаргаж авах.
 *
 * Профайлтай хүн → хөтөчийн гүнзгий хариулт.
 * Профайлгүй хүн → энгийн яриа.
 * Сонгосон давхарга унавал (түлхүүр байхгүй, эрх дууссан г.м.) бот
 * ДУУГҮЙ БОЛОХГҮЙН тулд нөгөө рүү нь шилжинэ.
 */
async function generateReply(session, text) {
  /**
   * ⚠️ ЗАРДЛЫН ГОЛ ШИЙДВЭР ЭНД БАЙНА.
   *
   * Яриа бол хамгийн олон давтагддаг ажил (хүн тутамд хэдэн арав, өдөрт
   * хэдэн мянга). Тиймээс анхдагчаар ХЯМД давхарга хөтөлнө.
   *
   * Чанар нь prompt-оос ирдэг болохоос загвараас БИШ: хоёр давхарга
   * ижил VOICE, ижил профайл, ижил урт хугацааны тэмдэглэлийг хүлээж авна
   * (lib/prompts.js → guideSystem / chatSystem). Хэрэглэгч ялгааг мэдэхгүй.
   *
   * Гүнзгий яриаг Claude-аар хөтлүүлэхийг хүсвэл: CHAT_PROVIDER=claude
   */
  const useClaude = config.chatProvider === 'claude';

  // Тестээ өгсөн хүнд ХӨТӨЧИЙН prompt (профайл + тэмдэглэлтэй),
  // өгөөгүй хүнд энгийн ярианы prompt. Давхаргаас үл хамааран ижил.
  const claude = () => (session.profile ? claudeGuide(session, text) : claudeChat(session, text));
  const openai = () => (session.profile ? openaiGuide(session, text) : openaiChat(session, text));

  const [primary, backup] = useClaude ? [claude, openai] : [openai, claude];

  try {
    return await primary();
  } catch (err) {
    console.error(
      '[flow] үндсэн чат давхарга унасан — нөөц рүү шилжиж байна:',
      err?.status ?? '',
      err?.message ?? err,
    );
    return backup();
  }
}

/**
 * Санах ойг шинэчлэх давхарга.
 * Яриатай ижил зарчим: давтагддаг ажил тул хямд давхарга анхдагч.
 * Унавал нөгөө рүү нь шилжинэ — тэмдэглэл алдагдахгүй.
 */
async function runMemoryUpdate(session, timeoutMs) {
  const claude = () => claudeUpdateMemory(session, { timeoutMs });
  const openai = () => openaiUpdateMemory(session);

  const [primary, backup] =
    config.chatProvider === 'claude' ? [claude, openai] : [openai, claude];

  try {
    return await primary();
  } catch (err) {
    console.warn(
      '[flow] тэмдэглэлийн үндсэн давхарга унасан — нөөц рүү:',
      err?.status ?? '',
      err?.message ?? err,
    );
    return backup();
  }
}

/**
 * Нэг event боловсруулахад зарцуулж болох НИЙТ хугацаа.
 * Vercel-ийн хязгаар 60с (vercel.json) — үлдсэн нь нөөц.
 */
const EVENT_BUDGET_MS = 52_000;

/** Тэмдэглэл шинэчлэхэд хамгийн багадаа ийм хугацаа үлдсэн байх ёстой. */
const MEMORY_MIN_MS = 8_000;

/** Чөлөөт яриа. */
async function handleChat(psid, session, text) {
  const startedAt = Date.now();
  await fb.senderAction(psid, 'typing_on');

  /**
   * Өдрийн хязгаар — анхдагчаар ХЯЗГААРГҮЙ (config.dailyChatLimit === 0).
   *
   * Хязгаар тавиагүй үед Redis рүү нэмэлт дуудлага ч хийхгүй: хариулт
   * тэр хэмжээгээр хурдан ирнэ. Яриа бол энэ бүтээгдэхүүний гол үнэ цэн
   * тул түүнийг тасалдаг зүйл маш сайн шалтгаангүйгээр байх ёсгүй.
   */
  if (config.dailyChatLimit > 0) {
    const used = await incr(`chatcount:${psid}`, 60 * 60 * 24);
    if (used > config.dailyChatLimit) {
      return fb.sendText(psid, DAILY_LIMIT);
    }
  }

  try {
    const reply = await generateReply(session, text);

    pushHistory(session, text, reply);
    session.state = 'chat';
    await saveSession(psid, session);
    await fb.sendText(psid, reply);

    // ⚠️ Урт хугацааны дараа, бодит ахиц гарсан үед, АМЬДРАЛД ГАНЦ УДАА.
    //    Энэ нь мөнгө гуйхгүй — зөвхөн «тустай байсан бол нэг хүнд хэлээрэй».
    if (canSuggestShare(session, text)) {
      session.shareNudgedAt = Date.now();
      await saveSession(psid, session);
      await fb.sendText(psid, shareNudge());
    }
  } catch (err) {
    console.error('[flow] чат алдаа', err?.status ?? '', err?.message ?? err);
    await fb.sendText(psid, 'Түр зуурын алдаа гарлаа 😔 Дахин бичээд үзээрэй.');
    return;
  }

  // Хариулт аль хэдийн хүрсэн — үүнээс цааш юу ч болсон хүн хүлээхгүй.
  await refreshMemory(psid, session, startedAt);
}

/**
 * Урт хугацааны тэмдэглэлээ шинэчлэх.
 *
 * ⚠️ ХАРИУЛТЫГ ИЛГЭЭСНИЙ ДАРАА л дуудна — хэрэглэгч үүнийг хүлээхгүй.
 *
 * ⚠️ Алдаа гарвал ЧИМЭЭГҮЙ өнгөрнө. Тэмдэглэл шинэчлэгдээгүй нь хэрэглэгчийн
 *    асуудал биш — тоолуур тэглэгдэхгүй тул дараагийн мессежээр дахин
 *    оролдоно (өөрөө эдгэрнэ).
 */
async function refreshMemory(psid, session, startedAt = Date.now()) {
  if (!shouldUpdate(session)) return;

  /**
   * Үлдсэн хугацаа. Чатын хариулт удаан ирсэн бол тэмдэглэлээ ЭНЭ УДАА
   * алгасна — функц дундаа алагдвал юу ч хадгалагдахгүй, харин алгасвал
   * тоолуур хэвээр үлдэж дараагийн мессежээр дахин оролдоно.
   */
  const remaining = EVENT_BUDGET_MS - (Date.now() - startedAt);
  if (remaining < MEMORY_MIN_MS) {
    console.warn('[flow] хугацаа хүрэлцэхгүй — тэмдэглэлийг дараагийн удаа шинэчилнэ');
    return;
  }

  try {
    // Үлдсэн хугацаанаас хэтрэхгүй, гэхдээ өөрийнхөө анхдагчаас ч уртсахгүй.
    session.memory = await runMemoryUpdate(session, Math.min(remaining, 18_000));
    session.messagesSinceMemory = 0;
    await saveSession(psid, session);
    console.log('[flow] тэмдэглэл шинэчлэгдлээ', psid);
  } catch (err) {
    console.error('[flow] тэмдэглэл шинэчлэхэд алдаа', err?.status ?? '', err?.message ?? err);
  }
}

// ── Гол оролт ──────────────────────────────────────────────────────────

async function handlePayload(psid, session, payload) {
  if (payload === 'GET_STARTED' || payload === 'RESTART') {
    const fresh =
      payload === 'RESTART'
        ? {
            ...emptySession(),

            /**
             * ⚠️ ЗӨВХӨН тестийн хариулт, профайл, тайлан шинэчлэгдэнэ.
             *    Хүн бол ижил хүн — түүний тухай мэдэх бүхнээ АЛДАХГҮЙ.
             *
             *    Урт хугацааны тэмдэглэлээ энд алдвал сар ярилцсан хүн
             *    тестээ дахин өгөхөд танихгүй хүн болж хувирна. Энэ бол
             *    хамгийн өвдөлттэй алдаа байх байсан.
             */
            memory: session.memory,
            chatHistory: session.chatHistory,
            messagesSinceMemory: session.messagesSinceMemory,

            createdAt: session.createdAt,
            activeDays: session.activeDays,
            messageCount: session.messageCount,
            shareNudgedAt: session.shareNudgedAt,
            giftShownAt: session.giftShownAt,
            gifted: session.gifted,
            giftedAt: session.giftedAt,
            fbName: session.fbName,
          }
        : session;
    return sendWelcome(psid, fresh);
  }

  if (payload === 'START_QUIZ') return startQuiz(psid, session);
  if (payload === 'RETRY_ANALYSIS') return resume(psid, session);

  if (payload === 'FULL_REPORT') return deliverFullReport(psid, session);

  if (payload === 'LATER') {
    session.state = 'chat';
    await saveSession(psid, session);
    return fb.sendText(
      psid,
      'За 🙂 Хүссэн үедээ «үр дүн» гэж бичээрэй. Эсвэл зүгээр л ярилцъя.',
    );
  }

  if (payload === 'MY_RESULT') {
    if (!session.profile) {
      return fb.sendQuickReplies(psid, 'Та тестээ хараахан өгөөгүй байна 🙂', [
        { title: '✨ Эхлэх', payload: 'START_QUIZ' },
      ]);
    }
    if (session.fullReport) return deliverFullReport(psid, session);
    await fb.sendText(psid, mirrorText(session.profile));
    return deliverFullReport(psid, session);
  }

  if (payload === 'CHAT') {
    session.state = 'chat';
    await saveSession(psid, session);
    return fb.sendText(psid, 'Сонсож байна 👂');
  }

  if (payload === 'DELETE_DATA') {
    return fb.sendQuickReplies(
      psid,
      'Бүх өгөгдөл чинь бүрмөсөн устана. Сэргээх боломжгүй.\n\nҮнэхээр устгах уу?',
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
      '✅ Бүх өгөгдөл чинь устлаа.\n\nMessenger доторх түүхийг Facebook хадгалдаг тул түүнийг чатнаасаа өөрөө устгаарай.\n\nДахин эхлэх бол «1».',
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
      'За 🙏 Хүссэн үедээ «1» гэж бичээрэй.\n\nӨгөгдлөө устгах бол «устгах».',
    );
  }

  if (session.state === 'analyzing') {
    if (!analyzingStalled(session)) {
      return fb.sendText(psid, 'Уншиж дуусаж байна… ⏳');
    }
    console.warn('[flow] analyzing төлөв гацсан — сэргээж байна');
    return resume(psid, session);
  }

  // Өмнөх анализ амжилтгүй болсон — ямар ч мессежээр дахин оролдоно.
  if (session.state === 'error') return resume(psid, session);

  // Тайлан үүсэхгүй тасарсан — ямар ч мессежээр дахин оролдоно.
  if (session.state === 'report_pending') return deliverFullReport(psid, session);

  if (session.state === 'quiz') {
    const option = matchAnswer(session.questionIndex, text);
    if (option) return recordAnswer(psid, session, option);
    await fb.sendText(psid, 'Доорхоос сонгоорой 👇 (эсвэл А / Б / В гэж бичээрэй)');
    return askQuestion(psid, session);
  }

  /**
   * ⚠️ БЭЛГИЙН ЦОРЫН ГАНЦ ХААЛГА.
   *
   * Хоёр хамгаалалт:
   *   1. Хүн ӨӨРӨӨ асуусан байх ёстой (asksAboutGift).
   *   2. Хүнд мөчид ХЭЗЭЭ Ч үгүй — хэн нэгэн санхүүгийн хүндрэл, гашуудлаа
   *      ярьж байхад бот дансаа сунгах нь хамгийн муу зүйл. Тэр үед энгийн
   *      яриагаар үргэлжилнэ.
   */
  if (asksAboutGift(text) && !isHeavyMoment(text)) {
    return handleGiftAsk(psid, session);
  }
  if (asksAboutShare(text) && session.profile) {
    session.state = 'chat';
    await saveSession(psid, session);
    return fb.sendText(psid, shareAnswer());
  }

  if (session.state === 'idle') {
    if (START_WORDS.includes(normalized)) return startQuiz(psid, session);
    return sendWelcome(psid, session);
  }

  // Тайлангаа хүссэн — аль ч төлөвөөс
  const REPORT_WORDS = ['үр дүн', 'үр дүнгээ', 'тайлан', 'тайлангаа', 'бүрэн', 'бүрэн анализ'];
  if (session.profile && REPORT_WORDS.includes(normalized)) {
    return deliverFullReport(psid, session);
  }

  // Товч тусгалын дараа — «үзье» гэвэл бүрэн тайлан руу, үгүй бол энгийн яриа
  if (session.state === 'mirror' && YES_WORDS.includes(normalized)) {
    return deliverFullReport(psid, session);
  }

  return handleChat(psid, session, text);
}

/** Зураг ирвэл. */
async function handleAttachments(psid, session, attachments) {
  const image = attachments.find((a) => a.type === 'image' && a.payload?.url);
  if (!image) {
    return fb.sendText(psid, 'Одоогоор зөвхөн үг ойлгодог юм байна 🙈');
  }

  /**
   * Зургийг бэлгийн баримт гэж үзэх үү?
   *
   * ⚠️ Зөвхөн бид дансаа ӨМНӨ НЬ харуулсан бол. Өөрөөр хэлбэл хүн өөрөө
   *    асуусан байх ёстой. Үгүй бол хүн зүгээр л зураг явуулсан байна —
   *    түүнийг «төлбөр» гэж ойлговол эвгүй болно.
   */
  if (session.giftShownAt) {
    return handleReceipt(psid, session, image.payload.url);
  }

  return fb.sendText(
    psid,
    'Зургийг чинь харлаа, гэхдээ одоогоор зөвхөн үг уншиж чаддаг юм байна 🙈 Бичиж хэлэх үү?',
  );
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
  touchActivity(session);
  await fb.senderAction(psid, 'mark_seen');

  const payload = event.postback?.payload ?? event.message?.quick_reply?.payload;
  if (payload) return handlePayload(psid, session, payload);

  const text = event.message?.text;
  if (text) return handleText(psid, session, text);

  const attachments = event.message?.attachments;
  if (attachments) return handleAttachments(psid, session, attachments);
}
