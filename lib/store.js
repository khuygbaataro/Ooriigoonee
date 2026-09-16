import { config } from './config.js';
import { emptyMemory } from './memory.js';

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
  state: 'idle',        // idle | quiz | analyzing | error | mirror | report_pending | chat
  questionIndex: 0,
  answers: [],          // [{ key: 'А', label: '...' }]
  profile: null,        // товч тусгал
  fullReport: null,     // бүрэн тайлан — БҮГДЭД НЬ ҮНЭГҮЙ
  fbName: null,         // Facebook дээрх нэр

  // ── Санах ой (lib/memory.js) ──────────────────────────────────────────
  chatHistory: [],        // ОЙРЫН яриа — сүүлийн 10 харилцаа
  memory: emptyMemory(),  // УРТ ХУГАЦААНЫ тэмдэглэл — хүн хэн бэ, хаашаа явж байна
  messagesSinceMemory: 0, // тэмдэглэлээ хэзээ шинэчлэхийг мэдэх тоолуур

  // ── Бэлгийн урсгал (lib/gift.js) ──────────────────────────────────────
  // ⚠️ Эдгээр нь ЮУГ Ч ТҮГЖИХГҮЙ. Бүх зүйл эхнээсээ нээлттэй.
  //    Зөвхөн «хэзээ нэг удаа зөөлөн сануулж болох вэ» гэдгийг мэдэхэд л
  //    хэрэгтэй. Мөнгө өгсөн эсэх нь хэрэглэгчийн юунд ч нөлөөлөхгүй.
  activeDays: [],       // ямар өдрүүдэд эргэж ирсэн бэ (YYYY-MM-DD)
  messageCount: 0,      // нийт солилцсон мессеж
  shareNudgedAt: null,  // хуваалцахыг санал болгосон — АМЬДРАЛД ГАНЦ УДАА
  giftShownAt: null,    // данс харуулсан үе (зөвхөн хүн өөрөө асуусны дараа)
  gifted: false,        // бэлэг илгээсэн эсэх — ЗӨВХӨН талархахад
  giftedAt: null,
  giftProof: null,      // баримт дээр уншигдсан мэдээлэл (эзэмшигчийн бүртгэл)

  createdAt: Date.now(),
  updatedAt: Date.now(),
});

/**
 * Хуучин (төлбөртэй үеийн) session-ийг шинэ бүтэцтэй нийцүүлнэ.
 * Ингэснээр аль хэдийн тест өгсөн хүмүүс дахин эхлэх шаардлагагүй болно.
 */
function migrate(session) {
  const base = emptySession();
  const merged = { ...base, ...session };

  // Хуучин «paid» төлөв нь одоо ЮУГ Ч ТҮГЖИХГҮЙ — бүгд үнэгүй.
  // Төлбөр төлж байсан хүмүүсийг бэлэг өгсөнд тооцно.
  if (session.paid && !merged.gifted) {
    merged.gifted = true;
    merged.giftedAt = session.paidAt ?? null;
    merged.giftProof = session.paymentProof ?? null;
  }
  // Хуучин «teaser» талбар нь зарах зорилготой байсан — «noticed» болов.
  if (merged.profile && !merged.profile.noticed && merged.profile.teaser) {
    merged.profile = { ...merged.profile, noticed: merged.profile.teaser };
  }
  // Гацсан хуучин төлөвүүдийг сэргээнэ.
  if (merged.state === 'paid_pending') merged.state = 'report_pending';

  // Санах ой нь хожим нэмэгдсэн — хуучин session-д байхгүй эсвэл дутуу байж
  // болно. Байгаа талбаруудыг нь хадгалж, дутууг нь нөхнө.
  merged.memory = { ...emptyMemory(), ...(session.memory ?? {}) };

  delete merged.paid;
  delete merged.paidAt;
  delete merged.paymentProof;
  return merged;
}

export async function getSession(psid) {
  const stored = await get(userKey(psid));
  return stored ? migrate(stored) : emptySession();
}

/**
 * Хэрэглэгч идэвхтэй байсныг тэмдэглэнэ.
 * activeDays нь «хэдэн ӨӨР өдөр эргэж ирсэн» гэдгийг хэмжинэ — зөөлөн
 * сануулгыг зөвхөн удаан хугацаанд хамт явсан хүнд л хийхэд хэрэгтэй.
 */
export function touchActivity(session) {
  const today = new Date().toISOString().slice(0, 10);
  const days = session.activeDays ?? [];
  if (days[days.length - 1] !== today) {
    session.activeDays = [...days, today].slice(-60); // 60 хоногийн цонх
  }
  session.messageCount = (session.messageCount ?? 0) + 1;
  return session;
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
