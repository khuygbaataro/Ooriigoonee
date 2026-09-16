import OpenAI from 'openai';
import { config } from './config.js';
import { chatSystem } from './prompts.js';
import { HISTORY_LIMIT } from './memory.js';

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

// ⚠️ Ойрын түүх нь lib/memory.js дотор тодорхойлогдоно — урт хугацааны
//    тэмдэглэлтэй нягт холбоотой тул нэг газар байх ёстой.

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
    // Хүн шиг сонсогдоход чухал хоёр тохиргоо:
    //   temperature — хариулт бүр өөр өнгөтэй байна
    //   frequency_penalty — «Ойлголоо», «Сайхан асуулт» гэх мэт хэвшмэл
    //     эхлэлийг яриа үргэлжлэх тусам давтахгүй болгоно
    params.temperature = 0.85;
    params.frequency_penalty = 0.3;
    params.presence_penalty = 0.2;
  }

  return params;
}

/**
 * @param {object} session хэрэглэгчийн session (profile, chatHistory)
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
export async function chat(session, userMessage) {
  // ⚠️ HISTORY_LIMIT нь ХАРИЛЦААны тоо, бичлэгийн тоо биш. Харилцаа бүр
  //    хоёр бичлэг (хүн + бот) тул хоёр дахин авна. Өмнө нь хагасыг нь л
  //    дамжуулдаг байсан — яриа санамсаргүй богиносдог байв.
  const history = (session.chatHistory ?? []).slice(-HISTORY_LIMIT * 2);

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
