import OpenAI from 'openai';
import { config } from './config.js';
import { chatSystem } from './prompts.js';

/**
 * OpenAI — ТҮГЭЭЖ ХАРИЛЦАХ давхарга.
 * Хэрэглэгчтэй чөлөөтэй ярилцах, асуултад хариулах, зөөлөн санал болгох.
 */

let client;
function openai() {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY тохируулаагүй байна');
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

const HISTORY_LIMIT = 10; // сүүлийн 10 мессежийг л санана (токен хэмнэнэ)

/**
 * @param {object} session хэрэглэгчийн session (profile, paid, chatHistory)
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
export async function chat(session, userMessage) {
  const history = (session.chatHistory ?? []).slice(-HISTORY_LIMIT);

  const params = {
    model: config.openaiModel,
    max_completion_tokens: 500,
    messages: [
      { role: 'system', content: chatSystem(session) },
      ...history,
      { role: 'user', content: userMessage },
    ],
  };

  // gpt-5 / o-цуврал загварууд temperature-г өөрчлөхийг зөвшөөрдөггүй
  if (!/^(gpt-5|o\d)/.test(config.openaiModel)) {
    params.temperature = 0.8;
  }

  const response = await openai().chat.completions.create(params);
  const reply = response.choices?.[0]?.message?.content?.trim();

  if (!reply) throw new Error('OpenAI хоосон хариулт буцаалаа');
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
