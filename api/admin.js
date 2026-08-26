import { getSession, saveSession, deleteSession, get } from '../lib/store.js';
import { deliverFullReport } from '../lib/flow.js';
import { formatFullReport } from '../lib/claude.js';
import { isAuthorized, unauthorized, json } from '../lib/auth.js';

/**
 * Админ хэрэгсэл. ADMIN_SECRET шаардана.
 *
 *   /api/admin?secret=X&action=grant&psid=123     → төлбөр төлсөнд тооцож тайлан илгээх
 *   /api/admin?secret=X&action=grant&order=ab12   → захиалгын кодоор нь тооцох
 *   /api/admin?secret=X&action=view&psid=123      → session-ийг харах
 *   /api/admin?secret=X&action=report&psid=123    → бүрэн тайланг текстээр харах
 *   /api/admin?secret=X&action=reset&psid=123     → хэрэглэгчийн өгөгдлийг устгах
 */
export async function GET(request) {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) return unauthorized();

  const action = url.searchParams.get('action') ?? 'view';
  let psid = url.searchParams.get('psid');
  const order = url.searchParams.get('order');

  if (!psid && order) {
    const record = await get(`order:${order}`);
    if (!record) return json({ ok: false, error: 'order олдсонгүй' }, 404);
    psid = record.psid;
  }

  if (!psid) return json({ ok: false, error: 'psid эсвэл order шаардлагатай' }, 400);

  if (action === 'reset') {
    await deleteSession(psid);
    return json({ ok: true, action, psid });
  }

  const session = await getSession(psid);

  if (action === 'view') {
    return json({
      ok: true,
      psid,
      state: session.state,
      paid: session.paid,
      paidAt: session.paidAt ? new Date(session.paidAt).toISOString() : null,
      // Маргаан гарвал баримт дээр юу уншигдсаныг эндээс харна
      paymentProof: session.paymentProof ?? null,
      answered: session.answers.length,
      type: session.profile?.type_name ?? null,
      updatedAt: new Date(session.updatedAt).toISOString(),
    });
  }

  if (action === 'report') {
    if (!session.profile || !session.fullReport) {
      return json({ ok: false, error: 'бүрэн тайлан хараахан үүсээгүй (төлбөр төлөгдөөгүй)' }, 404);
    }
    return new Response(formatFullReport(session.profile, session.fullReport), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (action === 'grant') {
    if (!session.profile) return json({ ok: false, error: 'хэрэглэгч тест өгөөгүй' }, 400);
    session.paid = true;
    await saveSession(psid, session);
    const delivered = await deliverFullReport(psid, session);
    return json({ ok: true, action, psid, delivered });
  }

  return json({ ok: false, error: `үл мэдэгдэх action: ${action}` }, 400);
}
