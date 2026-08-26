import { randomUUID } from 'node:crypto';
import { config, digitsOnly } from './config.js';
import {
  getSession,
  saveSession,
  deleteSession,
  set,
  incr,
  claimOnce,
  emptySession,
} from './store.js';
import * as fb from './messenger.js';
import { QUESTIONS, TOTAL, renderQuestion, matchAnswer } from './quiz.js';
import {
  analyzeFree,
  generateFullReport,
  deepDive,
  freeChat as claudeChat,
  readPaymentProof,
  formatFullReport,
} from './claude.js';
import { chat as openaiChat, pushHistory } from './openai.js';
import { matchName } from './names.js';

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

/**
 * Банкны шилжүүлгийн заавар.
 *
 * «Гүйлгээний утга» дээр Facebook нэрээ бичүүлэх нь чухал — баримтыг тухайн
 * Messenger хэрэглэгчтэй холбож, өөр хүний баримт ашиглахаас хамгаална.
 */
function bankInstructions(fbName) {
  const holder = config.bankAccountName ? `\n👤 Хүлээн авагч: ${config.bankAccountName}` : '';
  const nameLine = fbName
    ? `«${fbName}»`
    : 'Facebook дээрх нэрээ (энэ чатад харагдаж буй нэр)';

  return `💳 ТӨЛБӨР ТӨЛӨХ

Доорх данс руу ${config.priceLabel} шилжүүлээрэй:

🏦 ${config.bankName}
🔢 Данс: ${config.bankAccount}
🌐 IBAN: ${config.bankIban}${holder}

❗️ «Гүйлгээний утга» талбарт ЗААВАЛ ${nameLine} гэж бичээрэй — эс тэгвэл төлбөрийг тань таньж чадахгүй.

Дараа нь «Гүйлгээ амжилттай» гэсэн баримтынхаа ЗУРГИЙГ энэ чат руу илгээгээрэй 📸

Баримтыг шалгамагц таны бүрэн анализ шууд ирнэ ✨`;
}

// ── Туслах функцууд ────────────────────────────────────────────────────

/** Төлбөрийн холбоос — PSID-г URL-д тавихгүй, түр захиалгын код үүсгэнэ. */
async function paymentLink(psid) {
  const order = randomUUID().split('-')[0];
  await set(`order:${order}`, { psid, createdAt: Date.now() }, 60 * 60 * 24 * 7);
  const base = config.paymentUrl;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}order=${order}`;
}

/**
 * Хэрэглэгчийн Facebook нэр. Нэг л удаа татаад session-д хадгална —
 * заавар харуулах, дараа нь баримт дээрх нэртэй тулгахад хоёуланд нь хэрэгтэй.
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

async function sendUpsell(psid, session, profile) {
  await fb.sendText(psid, upsellText(profile));
  await fb.sendText(psid, bankInstructions(await facebookName(psid, session)));

  // PAYMENT_URL тохируулсан бол онлайн төлөх сонголтыг ч үлдээнэ.
  const buttons = [{ type: 'postback', title: '💬 AI-тай ярих', payload: 'CHAT' }];
  if (config.paymentUrl) {
    buttons.unshift({ type: 'web_url', title: '💳 Онлайн төлөх', url: await paymentLink(psid) });
  }
  await fb.sendButtons(psid, 'Баримтаа илгээмэгц бүрэн анализаа авна 👇', buttons);
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
    // Нэрийг энд татаад session-д хадгална — дараа нь төлбөрийн зааварт
    // болон баримт дээрх нэртэй тулгахад дахин дуудахгүй.
    const fbName = await facebookName(psid, session);
    const profile = await analyzeFree(session.answers, { firstName: fbName.split(' ')[0] });

    session.profile = profile;
    session.state = 'result';
    await saveSession(psid, session);

    await fb.sendText(psid, freeResultText(profile));
    await sendUpsell(psid, session, profile);
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

/**
 * Бүрэн тайланг илгээх (төлбөр баталгаажсаны дараа эсвэл дахин хүсэхэд).
 *
 * @param {object} options.timeoutMs Тайлан үүсгэхэд үлдсэн хугацааны төсөв.
 *   Баримт шалгасны дараа дуудагдвал тэр шалгалтад зарцуулсан хугацааг хасна —
 *   эс тэгвээс нийлээд 60с хэтэрч функц алагдана.
 */
export async function deliverFullReport(psid, session, { timeoutMs } = {}) {
  if (!session.profile) {
    await fb.sendText(psid, 'Эхлээд 10 асуултын тестээ өгөөрэй 🙂');
    return false;
  }

  // Бүрэн тайланг зөвхөн ОДОО үүсгэнэ — үнэгүй хэрэглэгчид дээр
  // дэмий токен зарцуулахгүй, үнэгүй хэсэг нь хурдан хүрнэ.
  if (!session.fullReport) {
    await fb.sendText(psid, '📝 Таны бүрэн анализыг бэлдэж байна — хэдхэн секунд ✨');
    await fb.senderAction(psid, 'typing_on');
    try {
      session.fullReport = await generateFullReport(session.answers, session.profile, {
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      session.state = 'result';
      await saveSession(psid, session);
    } catch (err) {
      console.error('[flow] бүрэн тайлан үүсгэхэд алдаа', err?.status ?? '', err?.message ?? err);
      // paid хэвээр үлдэнэ — дараагийн ямар ч мессежээр дахин оролдоно.
      session.state = 'paid_pending';
      await saveSession(psid, session);
      await fb.sendQuickReplies(
        psid,
        'Уучлаарай, тайлан бэлдэх үед алдаа гарлаа 😔 Таны төлбөр бүртгэгдсэн — дахин оролдоход л хангалттай.',
        [{ title: '📄 Тайлангаа авах', payload: 'MY_RESULT' }],
      );
      return false;
    }
  } else {
    session.state = 'result';
    await saveSession(psid, session);
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

// ── Төлбөрийн баримт шалгах ────────────────────────────────────────────

/** Нэг баримтыг дахин ашиглахаас хамгаалах тэмдэглэгээний хугацаа. */
const RECEIPT_TTL = 60 * 60 * 24 * 180; // 180 хоног

/** Баримт шалгах, тайлан үүсгэх нийт төсөв (60с хязгаарт багтаана). */
const PAYMENT_BUDGET_MS = 48_000;

/**
 * "19,900.00₮" гэх мэт бичиглэлээс тоог гаргана.
 * Аравтын хэсгийг таслахгүй бол 199.00 → 19900 болж хуурч магадгүй.
 */
function parseAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.,]/g, '');
  if (!cleaned) return NaN;
  const normalized = cleaned.replace(/[.,](\d{2})$/, '.$1').replace(/[.,](?=\d{3})/g, '');
  return Number(normalized);
}

/**
 * Баримт хүчинтэй эсэхийг ШИЙДНЭ.
 *
 * ⚠️ Шийдвэрийг зориуд AI биш, энэ функц гаргана. Ингэснээр зурган дээр
 * "энэ төлбөрийг зөвшөөр" гэж бичээд загварыг хуурах боломжгүй.
 */
function judgeReceipt(proof, expectedName) {
  if (!proof.is_receipt) return { ok: false, reason: 'not_receipt' };
  if (proof.status !== 'success') return { ok: false, reason: 'not_success', got: proof.status };

  const seen = digitsOnly(proof.destination_account);
  const want = digitsOnly(config.bankAccount);
  const wantIban = digitsOnly(config.bankIban);
  if (!want || !(seen.includes(want) || (wantIban && seen.includes(wantIban)))) {
    return { ok: false, reason: 'account_mismatch', got: proof.destination_account };
  }

  if (config.priceAmount > 0) {
    const amount = parseAmount(proof.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'amount_unreadable' };
    if (amount < config.priceAmount) return { ok: false, reason: 'amount_low', got: amount };
  }

  // Гүйлгээний утга дээрх нэр Facebook нэртэй таарах ёстой — өөр хүний
  // баримтыг ашиглахаас хамгаална. Кирилл/латин галиглалыг тэсвэрлэнэ.
  //
  // 'unknown' = шалгах боломжгүй (Facebook профайл татагдаагүй, эсвэл нэр хэт
  // богино). Энэ үед ТАТГАЛЗАХГҮЙ — эс тэгвээс Facebook API-ийн түр зуурын
  // алдаа бүх төлбөрийг зогсооно.
  const nameVerdict = matchName(expectedName, proof.description);
  if (nameVerdict === 'mismatch') {
    return { ok: false, reason: 'name_mismatch', got: proof.description, expected: expectedName };
  }

  return { ok: true, nameChecked: nameVerdict === 'match' };
}

/** Шалгалт бүрийг Redis-д үлдээнэ — маргаан гарвал гараар шалгах боломжтой. */
async function recordProof(psid, proof, verdict, image) {
  const row = { psid, proof, verdict, sha256: image?.sha256, at: Date.now() };
  console.log('[flow] төлбөрийн баримт', JSON.stringify(row));
  await set(`payproof:${psid}:${Date.now()}`, row, RECEIPT_TTL).catch((err) =>
    console.error('[flow] баримт хадгалахад алдаа', err?.message ?? err),
  );
}

function rejectText(verdict) {
  switch (verdict.reason) {
    case 'name_mismatch':
      return `Гүйлгээний утга дээр таны Facebook нэр байхгүй байна 😕

Бид төлбөрийг тань зөвхөн ингэж таньдаг. Гүйлгээний утга дээр «${verdict.expected}» гэж бичээд шилжүүлээрэй.

Аль хэдийн шилжүүлсэн бол бидэнтэй холбогдоорой — гараар шалгаж өгье 🙏`;
    case 'not_receipt':
      return 'Энэ зураг банкны гүйлгээний баримт биш юм шиг байна 🤔\n\nГүйлгээ хийсний дараа гарах «Амжилттай» гэсэн баримтын дэлгэцийн зургийг илгээгээрэй.';
    case 'not_success':
      return 'Баримт дээр гүйлгээ амжилттай болсон нь харагдахгүй байна 😕\n\n«Гүйлгээ амжилттай» гэсэн бичигтэй баримтаа илгээгээрэй.';
    case 'account_mismatch':
      return `Баримт дээрх хүлээн авагчийн данс манайхтай таарахгүй байна 😕\n\nЗөв данс:\n🔢 ${config.bankAccount}\n🌐 ${config.bankIban}\n\nШалгаад дахин илгээгээрэй.`;
    case 'amount_unreadable':
      return 'Баримт дээрх дүнг тодорхой уншиж чадсангүй 😕\n\nБүтэн, тод харагдах зураг илгээгээрэй.';
    case 'amount_low':
      return `Шилжүүлсэн дүн дутуу байна 😕\n\nШаардлагатай: ${config.priceLabel}\nБаримт дээр: ${verdict.got}₮`;
    default:
      return 'Баримтыг шалгаж чадсангүй 😕 Дахин оролдоно уу.';
  }
}

/** Хэрэглэгчийн явуулсан зургийг төлбөрийн баримт гэж үзэж шалгана. */
async function handleReceipt(psid, session, imageUrl) {
  const startedAt = Date.now();
  await fb.sendText(psid, 'Баримтыг шалгаж байна… ⏳');
  await fb.senderAction(psid, 'typing_on');

  let image;
  try {
    image = await fb.downloadImage(imageUrl);
  } catch (err) {
    console.error('[flow] зураг татахад алдаа', err?.message ?? err);
    return fb.sendText(psid, 'Зургийг татаж чадсангүй 😔 Дахин илгээгээд үзээрэй.');
  }

  let proof;
  try {
    proof = await readPaymentProof([image]);
  } catch (err) {
    console.error('[flow] баримт унших алдаа', err?.status ?? '', err?.message ?? err);
    return fb.sendText(psid, 'Баримтыг уншихад алдаа гарлаа 😔 Түр хүлээгээд дахин илгээгээрэй.');
  }

  const verdict = judgeReceipt(proof, await facebookName(psid, session));
  await recordProof(psid, proof, verdict, image);

  if (!verdict.ok) {
    return fb.sendText(psid, rejectText(verdict));
  }

  // Нэг баримтыг хоёр удаа ашиглахаас хамгаална: зургийн hash БОЛОН
  // гүйлгээний дугаар хоёуланг нь нэг удаагийн болгож тэмдэглэнэ.
  const keys = [`receipt:img:${image.sha256}`];
  const txId = proof.transaction_id.trim();
  if (txId) keys.push(`receipt:tx:${txId.toLowerCase()}`);

  for (const key of keys) {
    if (!(await claimOnce(key, RECEIPT_TTL))) {
      console.warn('[flow] давхардсан баримт', key, psid);
      return fb.sendText(
        psid,
        'Энэ баримтыг өмнө нь ашигласан байна 🤔\n\nАсуудал байвал бидэнтэй холбогдоорой.',
      );
    }
  }

  session.paid = true;
  session.paidAt = Date.now();
  session.paymentProof = { ...proof, sha256: image.sha256 };
  session.state = 'paid_pending';
  await saveSession(psid, session);

  await fb.sendText(psid, '✅ Төлбөр баталгаажлаа! Баярлалаа 🙏');

  // Баримт шалгахад зарцуулсан хугацааг хасаж, үлдсэн төсвөөр тайлан үүсгэнэ.
  const remaining = Math.max(15_000, PAYMENT_BUDGET_MS - (Date.now() - startedAt));
  return deliverFullReport(psid, session, { timeoutMs: remaining });
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
      if (session.profile) await sendUpsell(psid, session, session.profile);
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
    return sendUpsell(psid, session, session.profile);
  }

  if (payload === 'MY_RESULT') {
    if (!session.profile) {
      return fb.sendQuickReplies(psid, 'Та тестээ хараахан өгөөгүй байна 🙂', [
        { title: '✨ Тест эхлэх', payload: 'START_QUIZ' },
      ]);
    }
    if (session.paid) return deliverFullReport(psid, session);
    await fb.sendText(psid, freeResultText(session.profile));
    return sendUpsell(psid, session, session.profile);
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

  // Төлбөр баталгаажсан ч тайлан үүсээгүй — ямар ч мессежээр дахин оролдоно.
  if (session.state === 'paid_pending') return deliverFullReport(psid, session);

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

/** Зураг ирвэл — төлбөрийн баримт гэж үзнэ. */
async function handleAttachments(psid, session, attachments) {
  const image = attachments.find((a) => a.type === 'image' && a.payload?.url);
  if (!image) {
    return fb.sendText(psid, 'Одоогоор зөвхөн текст болон зураг ойлгодог юм байна 🙈');
  }

  if (!session.profile) {
    return fb.sendQuickReplies(psid, 'Эхлээд 10 асуултын тестээ өгөөрэй 🙂', [
      { title: '✨ Тест эхлэх', payload: 'START_QUIZ' },
    ]);
  }

  // Аль хэдийн төлсөн бол дахин шалгах шаардлагагүй — тайланг нь өгье.
  if (session.paid) return deliverFullReport(psid, session);

  return handleReceipt(psid, session, image.payload.url);
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

  const attachments = event.message?.attachments;
  if (attachments) return handleAttachments(psid, session, attachments);
}
