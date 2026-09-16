import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import {
  FREE_ANALYST_SYSTEM,
  guideSystem,
  MEMORY_UPDATE_SYSTEM,
  PAYMENT_PROOF_SYSTEM,
  chatSystem,
} from './prompts.js';
import { answersToText } from './quiz.js';
import {
  emptyMemory,
  normalizeMemory,
  historyToText,
  HISTORY_LIMIT,
} from './memory.js';

/**
 * Claude — БОЛОВСРУУЛАЛТ / ТООЦООЛОЛ.
 *
 * ⚠️ Vercel функцийн хугацааны хязгаар 60 секунд (vercel.json → maxDuration).
 * Тиймээс ЭНЭ ФАЙЛЫН БҮХ ДУУДЛАГА дараах 3 дүрмийг чанд баримтална:
 *
 *   1. STREAMING — урт гаралт HTTP timeout-д унахгүй.
 *   2. maxRetries: 0 — SDK автоматаар дахин оролдвол 2×timeout болж 60с хэтэрнэ.
 *   3. Хугацааны төсөв 50с-ээс хэтрэхгүй — үлдсэн нь Messenger рүү мессеж
 *      илгээхэд хэрэгтэй.
 *
 * Мөн: claude-opus-5 / claude-sonnet-5 дээр thinking АНХНААСАА АСААЛТТАЙ бөгөөд
 * thinking token нь max_tokens-оос иддэг. max_tokens=2000 байхад бодолт нь
 * бүх төсвийг барьж, JSON тасарч ирдэг байсан — тиймээс max_tokens-ийг өсгөв.
 */

// ── Хугацааны төсөв ─────────────────────────────────────────────────────
const FAST_TIMEOUT = 40_000; // товч анализ, чат, хөтөчийн хариулт
const MEMORY_TIMEOUT = 18_000; // хариулт илгээсний ДАРАА ажиллана
const RECEIPT_TIMEOUT = 25_000; // бэлгийн баримт унших

let client;
function anthropic() {
  if (!client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY тохируулаагүй байна');
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  }
  return client;
}

/**
 * Татгалзсан хариултыг сервер талд өөр загвар руу шилжүүлэх (fallbacks).
 * Beta дэмжигдэхгүй бол НЭГ УДАА л мэдээд, тэр цагаас хойш энгийн замаар явна.
 */
let betaFallbacksSupported = true;

function isBetaUnsupported(err) {
  const message = String(err?.message ?? '');
  return err?.status === 400 && /beta|fallback/i.test(message);
}

/** Бүх дуудлага энэ дундаж давхаргаар — үргэлж streaming. */
async function streamMessage(params, options) {
  if (betaFallbacksSupported) {
    try {
      const stream = anthropic().beta.messages.stream(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        options,
      );
      return await stream.finalMessage();
    } catch (err) {
      if (!isBetaUnsupported(err)) throw err;
      betaFallbacksSupported = false;
      console.warn(
        '[claude] server-side fallback дэмжигдсэнгүй, энгийн горимоор үргэлжлүүлнэ:',
        err.message,
      );
    }
  }
  const stream = anthropic().messages.stream(params, options);
  return stream.finalMessage();
}

/** Хариу бүтэн ирсэн эсэхийг шалгах — чимээгүй тасарсан JSON-оос сэргийлнэ. */
function guard(response, where) {
  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'тодорхойгүй';
    throw new Error(`Claude хүсэлтээс татгалзлаа (${where}, ангилал: ${category})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Claude-ийн хариу max_tokens-д тултаж тасарлаа (${where})`);
  }
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Загвар JSON-ийг код блокт ороосон ч найдвартай задлах (нөөц хамгаалалт). */
function parseJson(raw) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON олдсонгүй');
  return JSON.parse(text.slice(start, end + 1));
}

/** JSON схемийг API-д өгөх хэлбэрт оруулах. */
const jsonFormat = (properties) => ({
  type: 'json_schema',
  schema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});

const str = { type: 'string' };
const strList = { type: 'array', items: { type: 'string' } };

/**
 * Anthropic-ийн messages массив ЗААВАЛ user-ээр эхэлнэ.
 * chatHistory-г тайрахад assistant-аар эхэлж магадгүй тул урдаас нь цэвэрлэнэ.
 */
function normalizeHistory(history) {
  // ⚠️ HISTORY_LIMIT нь ХАРИЛЦААны тоо — харилцаа бүр хоёр бичлэгтэй.
  const rows = (history ?? []).slice(-HISTORY_LIMIT * 2);
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows;
}

// ── 1. ТОВЧ ТУСГАЛ — эхний үр дүн, хурдан байх ёстой ────────────────────

const QUICK_FORMAT = jsonFormat({
  type_name: str,
  emoji: str,
  summary: str,
  strength: str,
  blind_spot: str,
  noticed: strList,
});

/**
 * 10 хариултаас товч тусгал гаргана.
 * Structured output тул JSON нь ҮРГЭЛЖ хүчинтэй — задлахад унахгүй.
 */
export async function analyzeQuick(answers, meta = {}) {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
      max_tokens: 4000,
      system: FREE_ANALYST_SYSTEM,
      output_config: { effort: 'low', format: QUICK_FORMAT },
      messages: [
        {
          role: 'user',
          content: `Хэрэглэгчийн 10 асуултын хариулт:

${answersToText(answers)}
${meta.firstName ? `\nНэр: ${meta.firstName}` : ''}

Заасан JSON схемийн дагуу ТОВЧ тусгал буцаа.`,
        },
      ],
    },
    { timeout: FAST_TIMEOUT, maxRetries: 0 },
  );

  guard(response, 'analyzeQuick');

  const data = parseJson(textOf(response));
  return {
    type_name: data.type_name || 'Онцгой хослол',
    emoji: data.emoji || '🔎',
    summary: data.summary || '',
    strength: data.strength || '',
    blind_spot: data.blind_spot || '',
    noticed: Array.isArray(data.noticed) ? data.noticed.slice(0, 3) : [],
  };
}

// ── 2. ХӨТӨЧИЙН ХАРИУЛТ (профайлтай хүн) ────────────────────────────────

/**
 * Профайлтай хүнтэй хийх гүн яриа.
 * Ярианы түүхийг дамжуулна — «өмнө нь юу ярьсныг санадаг» нь хүн шиг
 * мэдрэгдэх хамгийн том хүчин зүйлүүдийн нэг.
 */
export async function guideReply(session, question) {
  const response = await streamMessage(
    {
      model: config.anthropicChatModel,
      max_tokens: 3000,
      system: guideSystem(session),
      output_config: { effort: 'low' },
      messages: [
        ...normalizeHistory(session.chatHistory),
        { role: 'user', content: question },
      ],
    },
    { timeout: FAST_TIMEOUT, maxRetries: 0 },
  );

  if (response.stop_reason === 'refusal') {
    return 'Энэ талаар ярихад хэцүү байна, уучлаарай. Өөрөөр асууж үзэх үү?';
  }
  const text = textOf(response);
  if (!text) throw new Error('Claude хоосон хариулт буцаалаа');
  return text;
}

// ── 3. УРТ ХУГАЦААНЫ САНАХ ОЙГ ШИНЭЧЛЭХ ───────────────────────────────

const MEMORY_FORMAT = jsonFormat({
  about: str,
  direction: str,
  threads: strList,
  milestones: strList,
  avoid: strList,
  covered: strList,
});

/**
 * Сүүлийн ярианаас хүний тухай тэмдэглэлээ шинэчилнэ.
 *
 * ⚠️ Хариултыг ИЛГЭЭСНИЙ ДАРАА ажиллана — хэрэглэгч үүнийг хүлээхгүй.
 *    Тиймээс хугацааны төсөв бага (Vercel-ийн 60с-д багтах ёстой).
 *
 * ⚠️ Алдаа гарвал ШИДНЭ — lib/flow.js түүнийг залгиж, яриа хэвийн
 *    үргэлжилнэ. Тоолуур тэглэгдэхгүй тул дараагийн удаа дахин оролдоно.
 */
export async function updateMemory(session, { timeoutMs = MEMORY_TIMEOUT } = {}) {
  const current = session.memory ?? emptyMemory();

  const response = await streamMessage(
    {
      model: config.anthropicChatModel,
      max_tokens: 4000,
      system: MEMORY_UPDATE_SYSTEM,
      output_config: { effort: 'low', format: MEMORY_FORMAT },
      messages: [
        {
          role: 'user',
          content: `ӨМНӨХ ТЭМДЭГЛЭЛ:
${JSON.stringify(
  {
    about: current.about,
    direction: current.direction,
    threads: current.threads,
    milestones: current.milestones,
    avoid: current.avoid,
    covered: current.covered,
  },
  null,
  2,
)}

${session.profile ? `ТЕСТЭЭР ГАРСАН ДҮР ЗУРАГ:\n${session.profile.type_name} — ${session.profile.summary}\n\n` : ''}СҮҮЛИЙН ЯРИА:
${historyToText(session.chatHistory)}

Шинэчилсэн тэмдэглэлийг заасан JSON схемийн дагуу буцаа.`,
        },
      ],
    },
    { timeout: timeoutMs, maxRetries: 0 },
  );

  guard(response, 'updateMemory');
  return normalizeMemory(parseJson(textOf(response)));
}

/** Профайлгүй хүнтэй энгийн яриа (эсвэл OpenAI унасан үеийн нөөц). */
export async function chat(session, userMessage) {
  const response = await streamMessage(
    {
      model: config.anthropicChatModel,
      max_tokens: 1500,
      system: chatSystem(session),
      output_config: { effort: 'low' },
      messages: [
        ...normalizeHistory(session.chatHistory),
        { role: 'user', content: userMessage },
      ],
    },
    { timeout: FAST_TIMEOUT, maxRetries: 0 },
  );

  if (response.stop_reason === 'refusal') {
    return 'Энэ талаар ярихад хэцүү байна. Өөр юу ярилцах вэ?';
  }
  const text = textOf(response);
  if (!text) throw new Error('Claude хоосон хариулт буцаалаа');
  return text;
}

// ── 4. Бэлгийн баримтын зургийг унших ───────────────────────────────────

const RECEIPT_FORMAT = jsonFormat({
  is_receipt: { type: 'boolean' },
  status: { type: 'string', enum: ['success', 'failed', 'pending', 'unknown'] },
  amount: str,
  destination_account: str,
  destination_name: str,
  transaction_id: str,
  description: str,
  date: str,
  notes: str,
});

/**
 * Баримтын зургаас мэдээлэл ГАРГАЖ АВНА — шийдвэрийг lib/flow.js гаргана.
 *
 * ⚠️ Энэ нь «төлбөр хүчинтэй эсэхийг» шалгахгүй. Зарах юм байхгүй тул
 *    шалгах ч зүйл алга — зөвхөн хүнд зөв үгээр талархахын тулд уншина.
 *
 * @param {{mediaType: string, data: string}[]} images base64 зургууд
 */
export async function readPaymentProof(images) {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
      max_tokens: 2000,
      system: PAYMENT_PROOF_SYSTEM,
      output_config: { effort: 'low', format: RECEIPT_FORMAT },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((image) => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            })),
            {
              type: 'text',
              text: 'Энэ зураг дээр юу бичээтэй байгааг заасан JSON схемийн дагуу уншиж өг.',
            },
          ],
        },
      ],
    },
    { timeout: RECEIPT_TIMEOUT, maxRetries: 0 },
  );

  guard(response, 'readPaymentProof');

  const d = parseJson(textOf(response));
  const status = ['success', 'failed', 'pending'].includes(d.status) ? d.status : 'unknown';
  return {
    is_receipt: Boolean(d.is_receipt),
    status,
    amount: String(d.amount ?? ''),
    destination_account: String(d.destination_account ?? ''),
    destination_name: String(d.destination_name ?? ''),
    transaction_id: String(d.transaction_id ?? ''),
    description: String(d.description ?? ''),
    date: String(d.date ?? ''),
    notes: String(d.notes ?? ''),
  };
}

/** Тохиргоог амьдаар нь шалгах — /api/health?deep=1 дээр ашиглана. */
export async function ping() {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
      max_tokens: 64,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Хариуд нь зөвхөн OK гэж бич.' }],
    },
    { timeout: 20_000, maxRetries: 0 },
  );
  return { model: response.model, stop_reason: response.stop_reason, text: textOf(response) };
}
