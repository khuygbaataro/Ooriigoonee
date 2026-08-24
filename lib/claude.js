import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { FREE_ANALYST_SYSTEM, FULL_REPORT_SYSTEM, DEEPDIVE_SYSTEM } from './prompts.js';
import { answersToText } from './quiz.js';

/**
 * Claude — БОЛОВСРУУЛАЛТ / ТООЦООЛОЛ.
 *
 * ⚠️ Vercel функцийн хугацааны хязгаар 60 секунд. Тиймээс ажлыг хуваасан:
 *   analyzeFree()        → ЖИЖИГ, ХУРДАН (~5-15с). Бүх хэрэглэгчид ажиллана.
 *   generateFullReport() → УРТ. Зөвхөн төлбөр төлсний дараа, streaming-тэй.
 *
 * Хоёуланг нэг дуудлагад хийвэл 60с хэтэрч функц алагдаж, хэрэглэгч
 * "боловсруулж байна…" дээр мөнхөд гацдаг.
 */

let client;
function anthropic() {
  if (!client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY тохируулаагүй байна');
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1 });
  }
  return client;
}

/**
 * Татгалзсан хариултыг сервер талд өөр загвар руу шилжүүлэх (fallbacks).
 * beta flag дэмжигдэхгүй бол энгийн хүсэлт рүү нэг удаа буцна.
 */
async function createMessage(params, options = {}) {
  try {
    return await anthropic().beta.messages.create(
      { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      options,
    );
  } catch (err) {
    const message = String(err?.message ?? '');
    if (!/beta|fallback|unsupported|unknown|invalid_request/i.test(message)) throw err;
    console.warn('[claude] fallbacks дэмжигдсэнгүй, энгийн хүсэлтээр үргэлжлүүлж байна:', message);
    return anthropic().messages.create(params, options);
  }
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Загвар JSON-ийг код блокт ороосон ч найдвартай задлах. */
function parseJson(raw) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON олдсонгүй');
  return JSON.parse(text.slice(start, end + 1));
}

// ── 1. ҮНЭГҮЙ ҮР ДҮН — жижиг, хурдан ────────────────────────────────────

/**
 * 10 хариултаас товч профайл гаргана.
 * Хугацаа: max_tokens бага + effort low тул ихэвчлэн 5-15 секунд.
 */
export async function analyzeFree(answers, meta = {}) {
  const response = await createMessage(
    {
      model: config.anthropicModel,
      max_tokens: 2000,
      system: FREE_ANALYST_SYSTEM,
      output_config: { effort: 'low' },
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
    { timeout: 35_000 },
  );

  if (response.stop_reason === 'refusal') throw new Error('Claude хүсэлтээс татгалзлаа');

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

/**
 * Дэлгэрэнгүй 10 бүлэгтэй тайлан. Streaming ашиглана — урт гаралт үүсгэхэд
 * HTTP timeout-д унахгүй.
 */
export async function generateFullReport(answers, profile) {
  const stream = anthropic().messages.stream(
    {
      model: config.anthropicModel,
      max_tokens: 16000,
      system: FULL_REPORT_SYSTEM,
      output_config: { effort: config.anthropicEffort },
      messages: [
        {
          role: 'user',
          content: `Хэрэглэгчийн 10 асуултын хариулт:

${answersToText(answers)}

Аль хэдийн гаргасан товч дүгнэлт:
- Төрөл: ${profile.type_name}
- Тодорхойлолт: ${profile.summary}
- Давуу тал: ${profile.strength}
- Анзаардаггүй тал: ${profile.blind_spot}

Заасан JSON схемийн дагуу ДЭЛГЭРЭНГҮЙ тайлан буцаа.`,
        },
      ],
    },
    { timeout: 240_000 },
  );

  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('Claude хүсэлтээс татгалзлаа');

  const r = parseJson(textOf(response));
  return {
    personality: r.personality || '',
    strengths: Array.isArray(r.strengths) ? r.strengths : [],
    weaknesses: r.weaknesses || '',
    relationship_style: r.relationship_style || '',
    communication: r.communication || '',
    career: r.career || '',
    stress: r.stress || '',
    hidden_potential: r.hidden_potential || '',
    growth_tips: Array.isArray(r.growth_tips) ? r.growth_tips : [],
    relationship_advice: r.relationship_advice || '',
  };
}

// ── 3. Гүнзгий асуулт (төлсөн хэрэглэгч) ────────────────────────────────

export async function deepDive(profile, question) {
  const response = await createMessage(
    {
      model: config.anthropicModel,
      max_tokens: 4000,
      system: DEEPDIVE_SYSTEM,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: `ПРОФАЙЛ:\n${JSON.stringify(profile, null, 2)}\n\nАСУУЛТ:\n${question}`,
        },
      ],
    },
    { timeout: 35_000 },
  );

  if (response.stop_reason === 'refusal') {
    return 'Уучлаарай, энэ асуултад хариулж чадсангүй. Өөрөөр асууж үзэх үү?';
  }
  return textOf(response);
}

// ── 4. Тайланг Messenger-т бэлдэх ───────────────────────────────────────

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
