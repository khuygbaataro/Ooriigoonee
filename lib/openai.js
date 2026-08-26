import OpenAI from 'openai';
import { config } from './config.js';
import { chatSystem } from './prompts.js';

/**
 * OpenAI — ТҮГЭЭЖ ХАРИЛЦАХ давхарга.
 * Хэрэглэгчтэй чөлөөтэй ярилцах, асуултад хариулах, зөөлөн санал болгох.
 *
 * ⚠️ Энэ давхарга унасан ч бот дуугүй болохгүй — lib/flow.js нь Claude руу
 * шилжиж яриаг үргэлжлүүлнэ.
 */

let client;
function openai() {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY тохируулаагүй байна');
    client = new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 1, timeout: 30_000 });
  }
  return client;
}

const HISTORY_LIMIT = 10; // сүүлийн 10 мессежийг л санана (токен хэмнэнэ)

/** gpt-5 / o-цуврал нь "бодох" загварууд — өөр параметртэй. */
const isReasoningModel = () => /^(gpt-5|o\d)/.test(config.openaiModel);

/** Хүсэлтийн биеийг загвараас нь хамааруулж угсарна. */
function buildParams(messages) {
  const params = { model: config.openaiModel, messages };

  if (isReasoningModel()) {
    // ⚠️ Бодох загварт reasoning token нь max_completion_tokens-оос иддэг.
    // 500 байхад бүх төсөв бодолтод зарцуулагдаж, content ХООСОН ирдэг.
    params.max_completion_tokens = 3000;
    params.reasoning_effort = 'low';
  } else {
    params.max_completion_tokens = 800;
    params.temperature = 0.8;
  }

  return params;
}

/**
 * @param {object} session хэрэглэгчийн session (profile, paid, chatHistory)
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
export async function chat(session, userMessage) {
  const history = (session.chatHistory ?? []).slice(-HISTORY_LIMIT);

  const response = await openai().chat.completions.create(
    buildParams([
      { role: 'system', content: chatSystem(session) },
      ...history,
      { role: 'user', content: userMessage },
    ]),
  );

  const choice = response.choices?.[0];
  const reply = choice?.message?.content?.trim();

  if (!reply) {
    // Шалтгааныг логт үлдээнэ — "хоосон хариулт" нь ихэвчлэн token дууссаны шинж.
    throw new Error(
      `OpenAI хоосон хариулт буцаалаа (model=${config.openaiModel}, finish_reason=${choice?.finish_reason ?? 'үл мэдэгдэх'})`,
    );
  }
  return reply;
}

/** Session дэх ярианы түүхийг шинэчилнэ. */
export function pushHistory(session, userMessage, assistantReply) {
  session.chatHistory = [
    ...(session.chatHistory ?? []),
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantReply },
  ].slice(-HISTORY_LIMIT * 2);
  return session;
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
