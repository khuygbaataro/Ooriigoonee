import { config } from './config.js';

/**
 * Хэрэглэгчийн төлөв хадгалах давхарга.
 *
 * Vercel serverless функц бүр "дахин эхэлдэг" тул санах ойд хадгалж болохгүй.
 * Тиймээс Upstash Redis (REST) ашиглана. Тохируулаагүй үед local dev-д
 * ажиллуулах зорилгоор Map руу унана (production-д хэрэглэж болохгүй).
 */

const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 хоног
const memory = new Map();
let warned = false;

const hasRedis = () => Boolean(config.redisUrl && config.redisToken);

async function redis(command) {
  const res = await fetch(config.redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.result;
}

function memoryWarn() {
  if (!warned) {
    warned = true;
    console.warn('[store] Redis тохируулаагүй байна — санах ой ашиглаж байна. Production-д KV_REST_API_URL / KV_REST_API_TOKEN тохируулна уу.');
  }
}

export async function get(key) {
  if (!hasRedis()) {
    memoryWarn();
    const row = memory.get(key);
    if (!row) return null;
    if (row.expires && row.expires < Date.now()) {
      memory.delete(key);
      return null;
    }
    return row.value;
  }
  const raw = await redis(['GET', key]);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function set(key, value, ttl = TTL_SECONDS) {
  if (!hasRedis()) {
    memoryWarn();
    memory.set(key, { value, expires: Date.now() + ttl * 1000 });
    return;
  }
  await redis(['SET', key, JSON.stringify(value), 'EX', String(ttl)]);
}

export async function del(key) {
  if (!hasRedis()) {
    memory.delete(key);
    return;
  }
  await redis(['DEL', key]);
}

/**
 * Атомик "нэг л удаа" тэмдэглэгээ.
 * Facebook нэг л мессежийг хэд дахин илгээж мэднэ (retry) — давхардлаас хамгаална.
 * true = анх удаа, false = өмнө нь боловсруулсан.
 */
export async function claimOnce(key, ttl = 600) {
  if (!hasRedis()) {
    memoryWarn();
    const row = memory.get(key);
    if (row && (!row.expires || row.expires > Date.now())) return false;
    memory.set(key, { value: 1, expires: Date.now() + ttl * 1000 });
    return true;
  }
  const result = await redis(['SET', key, '1', 'NX', 'EX', String(ttl)]);
  return result === 'OK';
}

/** Тоолуур нэмэгдүүлээд шинэ утгыг буцаана. */
export async function incr(key, ttl = TTL_SECONDS) {
  if (!hasRedis()) {
    memoryWarn();
    const row = memory.get(key);
    const next = (row?.value ?? 0) + 1;
    memory.set(key, { value: next, expires: Date.now() + ttl * 1000 });
    return next;
  }
  const value = await redis(['INCR', key]);
  if (value === 1) await redis(['EXPIRE', key, String(ttl)]);
  return value;
}

// ── Хэрэглэгчийн session ────────────────────────────────────────────────

const userKey = (psid) => `u:${psid}`;

export const emptySession = () => ({
  state: 'idle',        // idle | quiz | analyzing | error | result | paid_pending | chat
  questionIndex: 0,
  answers: [],          // [{ q: 1, key: 'А', label: '...' }]
  profile: null,        // Claude-аас гарсан үнэгүй үр дүн
  fullReport: null,     // Claude-аас гарсан төлбөртэй бүрэн тайлан
  paid: false,
  chatHistory: [],      // OpenAI-д дамжуулах сүүлийн харилцаа
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export async function getSession(psid) {
  return (await get(userKey(psid))) ?? emptySession();
}

export async function saveSession(psid, session) {
  session.updatedAt = Date.now();
  await set(userKey(psid), session);
  return session;
}

export async function deleteSession(psid) {
  await del(userKey(psid));
  await del(`chat:${psid}`);
}
