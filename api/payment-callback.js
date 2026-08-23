import { get, getSession, saveSession, claimOnce } from '../lib/store.js';
import { deliverFullReport } from '../lib/flow.js';
import { isAuthorized, unauthorized, json } from '../lib/auth.js';

/**
 * Төлбөрийн системээс ирэх сервер-сервер мэдэгдэл (QPay / Stripe / банк).
 *
 *   POST /api/payment-callback
 *   Header: x-admin-secret: <ADMIN_SECRET>
 *   Body:   { "order": "ab12cd34", "status": "paid" }
 *
 * ⚠️ Энэ URL-ийг хэрэглэгчийн browser рүү redirect болгож болохгүй —
 *    нууц түлхүүр задарна. Хэрэглэгчийг /payment-success рүү буцаана.
 */
async function handler(request) {
  const url = new URL(request.url);

  if (!isAuthorized(request, url)) return unauthorized();

  let order = url.searchParams.get('order');
  let status = url.searchParams.get('status') ?? 'paid';

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    order = body.order ?? order;
    status = body.status ?? status;
  }

  if (!order) return json({ ok: false, error: 'order шаардлагатай' }, 400);
  if (status !== 'paid') return json({ ok: true, ignored: true, status });

  const record = await get(`order:${order}`);
  if (!record?.psid) return json({ ok: false, error: 'order олдсонгүй' }, 404);

  // Нэг захиалгыг хоёр удаа боловсруулахаас сэргийлнэ
  if (!(await claimOnce(`paid:${order}`, 60 * 60 * 24 * 30))) {
    return json({ ok: true, alreadyProcessed: true, order });
  }

  const session = await getSession(record.psid);
  session.paid = true;
  await saveSession(record.psid, session);
  const delivered = await deliverFullReport(record.psid, session);

  return json({ ok: true, order, delivered });
}

// GET (гараар тест) болон POST (төлбөрийн систем) хоёуланг дэмжинэ
export { handler as GET, handler as POST };
