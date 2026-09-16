import OpenAI from 'openai';
import { config } from './config.js';
import { chatSystem, guideSystem, MEMORY_UPDATE_SYSTEM } from './prompts.js';
import {
  HISTORY_LIMIT,
  emptyMemory,
  normalizeMemory,
  historyToText,
} from './memory.js';

/**
 * OpenAI — ӨНДӨР ДАВТАМЖИЙН давхарга.
 *
 * ⚠️ ЗАРДЛЫН БҮТЭЦ — энэ файлын оршин байгаа шалтгаан.
 *
 *    Ажил бүр хэр олон удаа давтагдахаас нь хамаарч давхаргаа сонгоно:
 *
 *      Нэг хүнд НЭГ УДАА  → Claude (чанар чухал, тоо цөөн)
 *        · 10 асуултын анализ          — хүн тутамд 1
 *        · бүрэн тайлан                — хүн тутамд 2
 *
 *      Хүн бүрт ОЛОН ЗУУ  → OpenAI (тоо их, хямд байх ёстой)
 *        · яриа бүр                    — хүн тутамд хэдэн арав
 *        · санах ойн тэмдэглэл         — 6 харилцаа тутамд
 *
 *    Өдөрт 500 хүн × 20 мессеж = 10,000 ярианы дуудлага. Үүнийг үнэтэй
 *    загвар дээр тавьбал зардал ХҮНЭЭС биш, МЕССЕЖЭЭС хамаарч өснө —
 *    яриа чөлөөтэй байх тусам зардал өснө гэсэн үг, энэ нь бүтээгдэхүүний
 *    зорилготой шууд зөрчилдөнө.
 *
 * ⚠️ Энэ давхарга унасан ч бот дуугүй болохгүй — lib/flow.js нь Claude руу
 *    шилжиж яриаг үргэлжлүүлнэ (мөн эсрэгээрээ).
 */

let client;
function openai() {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY тохируулаагүй байна');
    client = new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 1, timeout: 30_000 });
  }
  return client;
}

// ⚠️ Ойрын түүх нь lib/memory.js дотор тодорхойлогдоно — урт хугацааны
//    тэмдэглэлтэй нягт холбоотой тул нэг газар байх ёстой.

/** gpt-5 / o-цуврал нь "бодох" загварууд — өөр параметртэй. */
const isReasoningModel = () => /^(gpt-5|o\d)/.test(config.openaiModel);

/**
 * Хүсэлтийн биеийг загвараас нь хамааруулж угсарна.
 *
 * @param {object[]} messages
 * @param {object}   [options]
 * @param {object}   [options.responseFormat] бүтэцтэй JSON шаардах бол
 * @param {number}   [options.maxTokens]
 */
function buildParams(messages, { responseFormat, maxTokens } = {}) {
  const params = { model: config.openaiModel, messages };

  if (isReasoningModel()) {
    // ⚠️ Бодох загварт reasoning token нь max_completion_tokens-оос иддэг.
    // 500 байхад бүх төсөв бодолтод зарцуулагдаж, content ХООСОН ирдэг.
    params.max_completion_tokens = maxTokens ?? 3000;
    params.reasoning_effort = 'low';
    // ⚠️ temperature / penalty-г бодох загварууд дэмждэггүй — бүү нэм.
    //    Хүн шиг сонсогдох ачааг VOICE prompt үүрнэ, тоон тохиргоо биш.
  } else {
    params.max_completion_tokens = maxTokens ?? 800;
    // Хүн шиг сонсогдоход чухал хоёр тохиргоо:
    //   temperature — хариулт бүр өөр өнгөтэй байна
    //   frequency_penalty — «Ойлголоо», «Сайхан асуулт» гэх мэт хэвшмэл
    //     эхлэлийг яриа үргэлжлэх тусам давтахгүй болгоно
    params.temperature = 0.85;
    params.frequency_penalty = 0.3;
    params.presence_penalty = 0.2;
  }

  if (responseFormat) params.response_format = responseFormat;

  return params;
}

/** Хариултыг гаргаж авах, хоосон бол ойлгомжтой алдаа шидэх. */
function replyOf(response, where) {
  const choice = response.choices?.[0];
  const reply = choice?.message?.content?.trim();
  if (!reply) {
    // «Хоосон хариулт» нь ихэвчлэн token дууссаны шинж — шалтгааныг логт үлдээнэ.
    throw new Error(
      `OpenAI хоосон хариулт буцаалаа (${where}, model=${config.openaiModel}, ` +
        `finish_reason=${choice?.finish_reason ?? 'үл мэдэгдэх'})`,
    );
  }
  return reply;
}

/**
 * Ойрын ярианы цонх.
 * ⚠️ HISTORY_LIMIT нь ХАРИЛЦААны тоо, бичлэгийн тоо биш. Харилцаа бүр
 *    хоёр бичлэг (хүн + бот) тул хоёр дахин авна.
 */
const recent = (session) => (session.chatHistory ?? []).slice(-HISTORY_LIMIT * 2);

// ── 1. Яриа ─────────────────────────────────────────────────────────────

/**
 * Тестээ өгөөгүй хүнтэй энгийн яриа.
 * @param {object} session хэрэглэгчийн session (profile, memory, chatHistory)
 */
export async function chat(session, userMessage) {
  const response = await openai().chat.completions.create(
    buildParams([
      { role: 'system', content: chatSystem(session) },
      ...recent(session),
      { role: 'user', content: userMessage },
    ]),
  );
  return replyOf(response, 'chat');
}

/**
 * Тестээ өгсөн хүнтэй хийх ХӨТӨЧИЙН яриа.
 *
 * ⚠️ Claude-ийн guideReply-тэй ЯГ ИЖИЛ системийн prompt ашиглана
 *    (VOICE + профайл + урт хугацааны тэмдэглэл). Тиймээс хэрэглэгч аль
 *    давхарга хариулсныг мэдэхгүй — хоёулаа нэг хүн шиг сонсогдоно.
 */
export async function guide(session, userMessage) {
  const response = await openai().chat.completions.create(
    buildParams(
      [
        { role: 'system', content: guideSystem(session) },
        ...recent(session),
        { role: 'user', content: userMessage },
      ],
      { maxTokens: isReasoningModel() ? 4000 : 1000 },
    ),
  );
  return replyOf(response, 'guide');
}

// ── 2. Урт хугацааны санах ой ───────────────────────────────────────────

const MEMORY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'memory',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        about: { type: 'string' },
        direction: { type: 'string' },
        threads: { type: 'array', items: { type: 'string' } },
        milestones: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'array', items: { type: 'string' } },
        covered: { type: 'array', items: { type: 'string' } },
      },
      required: ['about', 'direction', 'threads', 'milestones', 'avoid', 'covered'],
      additionalProperties: false,
    },
  },
};

/**
 * Сүүлийн ярианаас хүний тухай тэмдэглэлээ шинэчилнэ.
 *
 * ⚠️ Хариултыг ИЛГЭЭСНИЙ ДАРАА ажиллана — хэрэглэгч үүнийг хүлээхгүй.
 * ⚠️ Алдаа гарвал ШИДНЭ — lib/flow.js түүнийг залгиж, яриа хэвийн үргэлжилнэ.
 */
export async function updateMemory(session) {
  const current = session.memory ?? emptyMemory();

  const response = await openai().chat.completions.create(
    buildParams(
      [
        { role: 'system', content: MEMORY_UPDATE_SYSTEM },
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
      { responseFormat: MEMORY_SCHEMA, maxTokens: isReasoningModel() ? 5000 : 2000 },
    ),
  );

  return normalizeMemory(JSON.parse(replyOf(response, 'updateMemory')));
}

/** Тохиргоог амьдаар нь шалгах — /api/health?deep=1 дээр ашиглана. */
export async function ping() {
  const response = await openai().chat.completions.create(
    buildParams([{ role: 'user', content: 'Хариуд нь зөвхөн OK гэж бич.' }]),
  );
  const choice = response.choices?.[0];
  return {
    model: response.model,
    finish_reason: choice?.finish_reason ?? null,
    text: choice?.message?.content?.trim() ?? '',
  };
}
