import crypto from 'node:crypto';
import { config } from '../lib/config.js';
import { deleteSession, set } from '../lib/store.js';

/**
 * Facebook-ийн "Data Deletion Request Callback".
 * App Review-д ЗААВАЛ шаардагдана.
 *
 * App Dashboard → Settings → Basic → User Data Deletion →
 *   Data Deletion Request URL:  https://<domain>/api/data-deletion
 *
 * Facebook signed_request илгээнэ, бид өгөгдлийг устгаад
 * { url, confirmation_code } буцаана.
 */

const b64urlDecode = (input) =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function parseSignedRequest(signedRequest) {
  const [encodedSig, payload] = String(signedRequest).split('.', 2);
  if (!encodedSig || !payload) throw new Error('signed_request буруу форматтай');

  const expected = crypto
    .createHmac('sha256', config.appSecret)
    .update(payload)
    .digest();
  const provided = b64urlDecode(encodedSig);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new Error('signed_request гарын үсэг таарахгүй байна');
  }

  return JSON.parse(b64urlDecode(payload).toString('utf8'));
}

export async function POST(request) {
  if (!config.appSecret) {
    return new Response(JSON.stringify({ error: 'APP_SECRET тохируулаагүй' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let signedRequest;
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    signedRequest = (await request.json().catch(() => ({}))).signed_request;
  } else {
    const form = new URLSearchParams(await request.text());
    signedRequest = form.get('signed_request');
  }

  if (!signedRequest) {
    return new Response(JSON.stringify({ error: 'signed_request алга' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let data;
  try {
    data = parseSignedRequest(signedRequest);
  } catch (err) {
    console.error('[data-deletion]', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const psid = data.user_id;
  const confirmationCode = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  if (psid) {
    await deleteSession(psid);
    await set(
      `deletion:${confirmationCode}`,
      { psid, deletedAt: new Date().toISOString() },
      60 * 60 * 24 * 90,
    );
    console.log('[data-deletion] өгөгдөл устгав', confirmationCode);
  }

  const base = config.siteUrl || 'https://example.com';
  return new Response(
    JSON.stringify({
      url: `${base}/data-deletion?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
