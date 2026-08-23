import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { config as env } from '../lib/config.js';
import { claimOnce } from '../lib/store.js';
import { handleEvent } from '../lib/flow.js';

/**
 * Facebook Messenger Webhook.
 *
 *  GET  — Facebook-ийн баталгаажуулалт (hub.challenge)
 *  POST — Бодит мессежүүд
 *
 * Facebook 20 секундэд 200 хариу авахгүй бол дахин дахин илгээдэг.
 * Тиймээс AI боловсруулалтыг ард нь (waitUntil) явуулж, 200-г шууд буцаана.
 */

/** Гарын үсгийг шалгах — өөр хэн нэгэн webhook руу хүсэлт илгээхээс хамгаална. */
function verifySignature(rawBody, header) {
  if (!env.appSecret) {
    // Production дээр APP_SECRET байхгүй бол хаалттай байна (fail closed).
    // Үгүй бол хэн ч хуурамч event илгээх боломжтой болно.
    if (process.env.VERCEL) {
      console.error('[webhook] ❌ APP_SECRET тохируулаагүй — хүсэлтийг татгалзлаа. Vercel → Settings → Environment Variables дээр APP_SECRET нэмнэ үү.');
      return false;
    }
    console.warn('[webhook] APP_SECRET алга — гарын үсэг шалгахгүй байна (зөвхөн локал dev)');
    return true;
  }
  if (!header) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', env.appSecret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Ажлыг хариу буцаасны дараа үргэлжлүүлнэ.
 * Vercel дээр waitUntil ажиллана; локал орчинд promise-г буцааж caller хүлээнэ.
 */
function runInBackground(promise) {
  const guarded = promise.catch((err) => console.error('[webhook] background алдаа', err));
  if (process.env.VERCEL) {
    try {
      waitUntil(guarded);
      return null; // Vercel ажлыг дуустал функцийг амьд байлгана
    } catch (err) {
      console.warn('[webhook] waitUntil боломжгүй, хүлээж байна:', err?.message);
    }
  }
  return guarded; // Локал орчинд caller хүлээнэ
}

/** Нэг event-ийн давтагдашгүй түлхүүр — Facebook-ийн retry-аас хамгаална. */
function eventKey(event) {
  if (event.message?.mid) return `mid:${event.message.mid}`;
  if (event.postback) return `pb:${event.sender?.id}:${event.timestamp}:${event.postback.payload}`;
  return null;
}

async function processBody(body) {
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const key = eventKey(event);
      if (key && !(await claimOnce(key))) {
        console.log('[webhook] давхардсан event алгасав', key);
        continue;
      }
      try {
        await handleEvent(event);
      } catch (err) {
        console.error('[webhook] event боловсруулахад алдаа', err);
      }
    }
  }
}

/**
 * ⚠️ Vercel нь `export default`-ыг хуучин (req, res) хэлбэр гэж үздэг.
 * Web стандарт Request/Response ашиглахын тулд ЗААВАЛ нэрлэсэн
 * GET / POST экспорт байх ёстой (@vercel/node → createWebHandler).
 */

/** Facebook-ийн webhook баталгаажуулалт. */
export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && token === env.verifyToken) {
    console.log('[webhook] баталгаажлаа ✅');
    return new Response(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('[webhook] баталгаажуулалт амжилтгүй — verify_token таарахгүй');
  return new Response('Forbidden', { status: 403 });
}

/** Бодит messaging event-үүд. */
export async function POST(request) {
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    console.warn('[webhook] буруу гарын үсэг');
    return new Response('Invalid signature', { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (body.object !== 'page') {
    return new Response('Not Found', { status: 404 });
  }

  const pending = runInBackground(processBody(body));
  if (pending) await pending;

  return new Response('EVENT_RECEIVED', { status: 200 });
}
