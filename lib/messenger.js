import { config } from './config.js';

/** Facebook Send API-тай харилцах бүх зүйл энд. */

const GRAPH = () => `https://graph.facebook.com/${config.graphVersion}`;
const TEXT_LIMIT = 1900;      // FB хязгаар 2000 — жаахан нөөцтэй
const TITLE_LIMIT = 20;       // quick reply / товчны гарчиг

async function call(path, body) {
  if (!config.pageAccessToken) {
    console.error('[messenger] PAGE_ACCESS_TOKEN алга байна');
    return null;
  }
  const res = await fetch(
    `${GRAPH()}/${path}?access_token=${encodeURIComponent(config.pageAccessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[messenger] алдаа', res.status, JSON.stringify(data));
    return null;
  }
  return data;
}

const send = (psid, message) =>
  call('me/messages', {
    messaging_type: 'RESPONSE',
    recipient: { id: psid },
    message,
  });

/** Урт текстийг мөрөөр таслаж 1900 тэмдэгтийн хэсгүүд болгоно. */
export function chunk(text, limit = TEXT_LIMIT) {
  const parts = [];
  let buffer = '';
  for (const line of String(text).split('\n')) {
    if (buffer.length + line.length + 1 > limit) {
      if (buffer) parts.push(buffer.trimEnd());
      buffer = '';
      // Ганц мөр өөрөө хэтэрхий урт бол хүчээр хуваана
      let rest = line;
      while (rest.length > limit) {
        parts.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      buffer = rest + '\n';
    } else {
      buffer += line + '\n';
    }
  }
  if (buffer.trim()) parts.push(buffer.trimEnd());
  return parts.length ? parts : [''];
}

export async function sendText(psid, text) {
  for (const part of chunk(text)) {
    await send(psid, { text: part });
  }
}

export async function senderAction(psid, action = 'typing_on') {
  return call('me/messages', { recipient: { id: psid }, sender_action: action });
}

export async function sendQuickReplies(psid, text, replies) {
  const parts = chunk(text);
  const last = parts.pop();
  for (const part of parts) await send(psid, { text: part });
  return send(psid, {
    text: last,
    quick_replies: replies.slice(0, 13).map((r) => ({
      content_type: 'text',
      title: r.title.slice(0, TITLE_LIMIT),
      payload: r.payload,
    })),
  });
}

/**
 * Товчтой мессеж. buttons = [{type:'postback',title,payload}] эсвэл
 * [{type:'web_url',title,url}] — хамгийн ихдээ 3.
 */
export async function sendButtons(psid, text, buttons) {
  return send(psid, {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: text.slice(0, 640),
        buttons: buttons.slice(0, 3).map((b) => ({
          ...b,
          title: b.title.slice(0, TITLE_LIMIT),
        })),
      },
    },
  });
}

/** Хэрэглэгчийн нэрийг авах (мэндчилгээнд ашиглана). Алдаа гарвал null. */
export async function getProfile(psid) {
  if (!config.pageAccessToken) return null;
  try {
    const res = await fetch(
      `${GRAPH()}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(config.pageAccessToken)}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Messenger-ийн "Get Started" товч, мэндчилгээ, доод цэсийг суулгана.
 * Deploy хийсний дараа /api/setup?secret=... гэж нэг удаа дуудна.
 */
export async function installMenu() {
  return call('me/messenger_profile', {
    get_started: { payload: 'GET_STARTED' },
    greeting: [
      {
        locale: 'default',
        text: 'Өөрийгөө хэр сайн мэддэг вэ? 👀 10 асуултад хариулаад өөрийнхөө нэг далд талыг нээгээрэй ✨',
      },
    ],
    persistent_menu: [
      {
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'postback', title: '🔄 Тестийг дахин өгөх', payload: 'RESTART' },
          { type: 'postback', title: '📄 Миний үр дүн', payload: 'MY_RESULT' },
          { type: 'postback', title: '💬 AI-тай ярих', payload: 'CHAT' },
        ],
      },
    ],
  });
}
