import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { ANALYST_SYSTEM, DEEPDIVE_SYSTEM } from './prompts.js';
import { answersToText } from './quiz.js';

/**
 * Claude — БОЛОВСРУУЛАЛТ / ТООЦООЛОЛ.
 * Тестийн хариултыг анализлаж, үнэгүй үр дүн ба төлбөртэй бүрэн тайланг
 * НЭГ дуудлагаар үүсгэнэ (хямд, хурдан, төлбөр хиймэгц тайлан бэлэн болно).
 */

let client;
function anthropic() {
  if (!client) {
    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY тохируулаагүй байна');
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

/**
 * Татгалзсан хариултыг сервер талд өөр загвар руу шилжүүлэх (fallbacks).
 * Хэрэв beta flag дэмжигдэхгүй бол энгийн хүсэлт рүү нэг удаа буцна.
 */
async function createMessage(params) {
  try {
    return await anthropic().beta.messages.create({
      ...params,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    const message = String(err?.message ?? '');
    const betaIssue = /beta|fallback|unsupported|unknown|invalid_request/i.test(message);
    if (!betaIssue) throw err;
    console.warn('[claude] fallbacks дэмжигдсэнгүй, энгийн хүсэлтээр үргэлжлүүлж байна:', message);
    return anthropic().messages.create(params);
  }
}

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Загвар JSON-ийг код блокт ороосон ч гэсэн найдвартай задлах. */
function parseJson(raw) {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON олдсонгүй');
  return JSON.parse(text.slice(start, end + 1));
}

/** Заавал байх талбаруудыг шалгаж, дутууг нь нөхнө. */
function normalize(data) {
  const full = data.full_report ?? {};
  return {
    type_name: data.type_name || 'Онцгой хослол',
    emoji: data.emoji || '🔎',
    summary: data.summary || '',
    strength: data.strength || '',
    blind_spot: data.blind_spot || '',
    teaser: Array.isArray(data.teaser) ? data.teaser.slice(0, 3) : [],
    full_report: {
      personality: full.personality || '',
      strengths: Array.isArray(full.strengths) ? full.strengths : [],
      weaknesses: full.weaknesses || '',
      relationship_style: full.relationship_style || '',
      communication: full.communication || '',
      career: full.career || '',
      stress: full.stress || '',
      hidden_potential: full.hidden_potential || '',
      growth_tips: Array.isArray(full.growth_tips) ? full.growth_tips : [],
      relationship_advice: full.relationship_advice || '',
    },
  };
}

/**
 * 10 хариултыг анализлана.
 * @returns {Promise<object>} үнэгүй үр дүн + full_report
 */
export async function analyze(answers, meta = {}) {
  const userBlock = `Хэрэглэгчийн 10 асуултын хариулт:

${answersToText(answers)}

${meta.firstName ? `Нэр: ${meta.firstName}` : ''}

Дээрх хариултад тулгуурлан заасан JSON схемийн дагуу анализ буцаа.`;

  const response = await createMessage({
    model: config.anthropicModel,
    max_tokens: 16000,
    system: ANALYST_SYSTEM,
    output_config: { effort: config.anthropicEffort },
    messages: [{ role: 'user', content: userBlock }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude хүсэлтээс татгалзлаа');
  }

  return normalize(parseJson(textOf(response)));
}

/**
 * Төлбөртэй хэрэглэгчийн гүнзгий асуултад профайл дээрээ тулгуурлан хариулна.
 */
export async function deepDive(profile, question) {
  const response = await createMessage({
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
  });

  if (response.stop_reason === 'refusal') {
    return 'Уучлаарай, энэ асуултад хариулж чадсангүй. Өөрөөр асууж үзэх үү?';
  }
  return textOf(response);
}

/** Бүрэн тайланг Messenger-т илгээхэд бэлэн текст болгоно. */
export function formatFullReport(profile) {
  const r = profile.full_report;
  const list = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

  return [
    `${profile.emoji} ТАНЫ ХУВИЙН ПРОФАЙЛ\n«${profile.type_name}»`,
    `🧬 ЗАН ЧАНАРЫН АНАЛИЗ\n${r.personality}`,
    `💪 ТАНЫ 5 ГОЛ ДАВУУ ТАЛ\n${list(r.strengths)}`,
    `⚠️ СУЛ ТАЛ БА АНЗААРДАГГҮЙ ХЭВ МАЯГ\n${r.weaknesses}`,
    `❤️ ХАРИЛЦААНЫ ХЭВ МАЯГ\n${r.relationship_style}`,
    `🗣️ ХҮМҮҮСТЭЙ ХАРИЛЦАХ АРГА\n${r.communication}`,
    `💼 АЖИЛ, КАРЬЕР\n${r.career}`,
    `🧠 СТРЕССИЙН ҮЕИЙН ЗАН ТӨЛӨВ\n${r.stress}`,
    `🔥 ТАНЫ ДАЛД ПОТЕНЦИАЛ\n${r.hidden_potential}`,
    `📈 ӨӨРИЙГӨӨ ХӨГЖҮҮЛЭХ 5 ЗӨВЛӨМЖ\n${list(r.growth_tips)}`,
    `💬 ХАРИЛЦААНЫ ЗӨВЛӨГӨӨ\n${r.relationship_advice}`,
  ].join('\n\n━━━━━━━━━━━━━━\n\n');
}
