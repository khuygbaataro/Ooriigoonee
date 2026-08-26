import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import {
  FREE_ANALYST_SYSTEM,
  REPORT_CORE_SYSTEM,
  REPORT_APPLIED_SYSTEM,
  DEEPDIVE_SYSTEM,
  PAYMENT_PROOF_SYSTEM,
  chatSystem,
} from './prompts.js';
import { answersToText } from './quiz.js';

/**
 * Claude — БОЛОВСРУУЛАЛТ / ТООЦООЛОЛ.
 *
 * ⚠️ Vercel функцийн хугацааны хязгаар 60 секунд (vercel.json → maxDuration).
 * Тиймээс ЭНЭ ФАЙЛЫН БҮХ ДУУДЛАГА дараах 3 дүрмийг чанд баримтална:
 *
 *   1. STREAMING — урт гаралт HTTP timeout-д унахгүй.
 *   2. maxRetries: 0 — SDK автоматаар дахин оролдвол 2×timeout болж 60с хэтэрнэ.
 *      (Өмнө нь timeout 35с × 2 оролдлого = 70с → функц алагдаж, хэрэглэгч
 *       "боловсруулж байна…" дээр мөнхөд гацдаг байсан.)
 *   3. Хугацааны төсөв 50с-ээс хэтрэхгүй — үлдсэн нь Messenger рүү мессеж
 *      илгээхэд хэрэгтэй.
 *
 * Мөн: claude-opus-5 / claude-sonnet-5 дээр thinking АНХНААСАА АСААЛТТАЙ бөгөөд
 * thinking token нь max_tokens-оос иддэг. max_tokens=2000 байхад бодолт нь
 * бүх төсвийг барьж, JSON тасарч ирдэг байсан — тиймээс max_tokens-ийг өсгөв.
 */

// ── Хугацааны төсөв ─────────────────────────────────────────────────────
const FAST_TIMEOUT = 40_000; // үнэгүй анализ, чат, гүнзгий асуулт
const REPORT_TIMEOUT = 50_000; // бүрэн тайлангийн нэг хэсэг
const RECEIPT_TIMEOUT = 25_000; // төлбөрийн баримт унших (дараа нь тайлан үүснэ)

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
 * Beta дэмжигдэхгүй бол НЭГ УДАА л мэдээд, тэр цагаас хойш энгийн замаар явна
 * (өмнө нь дуудлага бүрт дэмий нэмэлт round-trip хийж хугацаа иддэг байсан).
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

// ── 1. ҮНЭГҮЙ ҮР ДҮН — жижиг, хурдан ────────────────────────────────────

const FREE_FORMAT = jsonFormat({
  type_name: str,
  emoji: str,
  summary: str,
  strength: str,
  blind_spot: str,
  teaser: strList,
});

/**
 * 10 хариултаас товч профайл гаргана.
 * Structured output тул JSON нь ҮРГЭЛЖ хүчинтэй — задлахад унахгүй.
 */
export async function analyzeFree(answers, meta = {}) {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
      max_tokens: 4000,
      system: FREE_ANALYST_SYSTEM,
      output_config: { effort: 'low', format: FREE_FORMAT },
      messages: [
        {
          role: 'user',
          content: `Хэрэглэгчийн 10 асуултын хариулт:

${answersToText(answers)}
${meta.firstName ? `\nНэр: ${meta.firstName}` : ''}

Заасан JSON схемийн дагуу ТОВЧ анализ буцаа.`,
        },
      ],
    },
    { timeout: FAST_TIMEOUT, maxRetries: 0 },
  );

  guard(response, 'analyzeFree');

  const data = parseJson(textOf(response));
  return {
    type_name: data.type_name || 'Онцгой хослол',
    emoji: data.emoji || '🔎',
    summary: data.summary || '',
    strength: data.strength || '',
    blind_spot: data.blind_spot || '',
    teaser: Array.isArray(data.teaser) ? data.teaser.slice(0, 3) : [],
  };
}

// ── 2. БҮРЭН ТАЙЛАН — зөвхөн төлбөр төлсний дараа ───────────────────────

const CORE_FORMAT = jsonFormat({
  personality: str,
  strengths: strList,
  weaknesses: str,
  hidden_potential: str,
});

const APPLIED_FORMAT = jsonFormat({
  relationship_style: str,
  communication: str,
  career: str,
  stress: str,
  growth_tips: strList,
  relationship_advice: str,
});

/**
 * Дэлгэрэнгүй тайлан.
 *
 * ⚠️ Нэг дуудлагаар 10 бүлэг бичихэд 60с-д БАГТАХГҮЙ. Тиймээс тайланг
 * хоёр хэсэгт хувааж ЗЭРЭГ (Promise.all) явуулна — нийт хугацаа нь хоёрын
 * уртынх нь хэрээр л болно, нийлбэрээр нь биш.
 */
export async function generateFullReport(answers, profile, { timeoutMs = REPORT_TIMEOUT } = {}) {
  const context = `Хэрэглэгчийн 10 асуултын хариулт:

${answersToText(answers)}

Аль хэдийн гаргасан товч дүгнэлт:
- Төрөл: ${profile.type_name}
- Тодорхойлолт: ${profile.summary}
- Давуу тал: ${profile.strength}
- Анзаардаггүй тал: ${profile.blind_spot}`;

  const part = (system, format) =>
    streamMessage(
      {
        model: config.anthropicModel,
        max_tokens: 8000,
        system,
        output_config: { effort: config.anthropicEffort, format },
        messages: [{ role: 'user', content: `${context}\n\nЗаасан JSON схемийн дагуу буцаа.` }],
      },
      { timeout: timeoutMs, maxRetries: 0 },
    );

  const [coreRes, appliedRes] = await Promise.all([
    part(REPORT_CORE_SYSTEM, CORE_FORMAT),
    part(REPORT_APPLIED_SYSTEM, APPLIED_FORMAT),
  ]);

  guard(coreRes, 'fullReport.core');
  guard(appliedRes, 'fullReport.applied');

  const core = parseJson(textOf(coreRes));
  const applied = parseJson(textOf(appliedRes));

  return {
    personality: core.personality || '',
    strengths: Array.isArray(core.strengths) ? core.strengths : [],
    weaknesses: core.weaknesses || '',
    hidden_potential: core.hidden_potential || '',
    relationship_style: applied.relationship_style || '',
    communication: applied.communication || '',
    career: applied.career || '',
    stress: applied.stress || '',
    growth_tips: Array.isArray(applied.growth_tips) ? applied.growth_tips : [],
    relationship_advice: applied.relationship_advice || '',
  };
}

// ── 3. Гүнзгий асуулт (төлсөн хэрэглэгч) ────────────────────────────────

export async function deepDive(profile, question) {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
      max_tokens: 3000,
      system: DEEPDIVE_SYSTEM,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `ПРОФАЙЛ:\n${JSON.stringify(profile, null, 2)}\n\nАСУУЛТ:\n${question}`,
        },
      ],
    },
    { timeout: FAST_TIMEOUT, maxRetries: 0 },
  );

  if (response.stop_reason === 'refusal') {
    return 'Уучлаарай, энэ асуултад хариулж чадсангүй. Өөрөөр асууж үзэх үү?';
  }
  return textOf(response);
}

// ── 4. Төлбөрийн баримтын зургийг унших ─────────────────────────────────

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
 * Баримтын зургаас мэдээлэл ГАРГАЖ АВНА — хүчинтэй эсэхийг ШИЙДЭХГҮЙ.
 * Шийдвэрийг lib/flow.js доторх код тодорхой дүрмээр гаргана.
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

// ── 5. Чөлөөт яриа — OpenAI унасан үеийн НӨӨЦ ───────────────────────────

/**
 * Anthropic-ийн messages массив ЗААВАЛ user-ээр эхэлнэ.
 * chatHistory-г тайрахад assistant-аар эхэлж магадгүй тул урдаас нь цэвэрлэнэ.
 */
function normalizeHistory(history) {
  const rows = (history ?? []).slice(-10);
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows;
}

/** OpenAI ажиллахгүй бол бот дуугүй болохгүйн тулд Claude-аар ярина. */
export async function freeChat(session, userMessage) {
  const response = await streamMessage(
    {
      model: config.anthropicModel,
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
    return 'Уучлаарай, энэ талаар ярихад хэцүү байна. Өөр юу асуух вэ?';
  }
  const text = textOf(response);
  if (!text) throw new Error('Claude хоосон хариулт буцаалаа');
  return text;
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

// ── 6. Тайланг Messenger-т бэлдэх ───────────────────────────────────────

export function formatFullReport(profile, report) {
  const list = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

  return [
    `${profile.emoji} ТАНЫ ХУВИЙН ПРОФАЙЛ\n«${profile.type_name}»`,
    `🧬 ЗАН ЧАНАРЫН АНАЛИЗ\n${report.personality}`,
    `💪 ТАНЫ 5 ГОЛ ДАВУУ ТАЛ\n${list(report.strengths)}`,
    `⚠️ СУЛ ТАЛ БА АНЗААРДАГГҮЙ ХЭВ МАЯГ\n${report.weaknesses}`,
    `❤️ ХАРИЛЦААНЫ ХЭВ МАЯГ\n${report.relationship_style}`,
    `🗣️ ХҮМҮҮСТЭЙ ХАРИЛЦАХ АРГА\n${report.communication}`,
    `💼 АЖИЛ, КАРЬЕР\n${report.career}`,
    `🧠 СТРЕССИЙН ҮЕИЙН ЗАН ТӨЛӨВ\n${report.stress}`,
    `🔥 ТАНЫ ДАЛД ПОТЕНЦИАЛ\n${report.hidden_potential}`,
    `📈 ӨӨРИЙГӨӨ ХӨГЖҮҮЛЭХ 5 ЗӨВЛӨМЖ\n${list(report.growth_tips)}`,
    `💬 ХАРИЛЦААНЫ ЗӨВЛӨГӨӨ\n${report.relationship_advice}`,
  ].join('\n\n━━━━━━━━━━━━━━\n\n');
}
