import { getSession, deleteSession } from '../lib/store.js';
import { showMirror } from '../lib/flow.js';
import { isAuthorized, unauthorized, json } from '../lib/auth.js';

/**
 * Админ хэрэгсэл. ADMIN_SECRET шаардана.
 *
 *   /api/admin?secret=X&action=view&psid=123      → session-ийг харах
 *   /api/admin?secret=X&action=send&psid=123      → тусгалыг чат руу нь дахин илгээх
 *   /api/admin?secret=X&action=reset&psid=123     → хэрэглэгчийн өгөгдлийг устгах
 *
 * ⚠️ «grant» action-ыг АВЧ ХАЯСАН — нээх зүйл байхгүй болсон. Бүх зүйл
 *    эхнээсээ бүгдэд нээлттэй (lib/flow.js).
 */
export async function GET(request) {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) return unauthorized();

  const action = url.searchParams.get('action') ?? 'view';
  const psid = url.searchParams.get('psid');

  if (!psid) return json({ ok: false, error: 'psid шаардлагатай' }, 400);

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
      answered: session.answers.length,
      type: session.profile?.type_name ?? null,

      // Урт хугацааны тэмдэглэл — бот энэ хүний тухай юу санаж байгаа вэ.
      // Хөтөчлөлт «хазайсан» юм шиг санагдвал хамгийн түрүүнд эндээс хараарай.
      memory: session.memory ?? null,
      messagesSinceMemory: session.messagesSinceMemory ?? 0,
      recentExchanges: Math.floor((session.chatHistory?.length ?? 0) / 2),

      // Хамт явсан хугацаа — зөөлөн сануулгын нөхцөлийг оношлоход
      createdAt: new Date(session.createdAt).toISOString(),
      activeDays: session.activeDays?.length ?? 0,
      messageCount: session.messageCount ?? 0,
      shareNudgedAt: session.shareNudgedAt ? new Date(session.shareNudgedAt).toISOString() : null,
      giftShownAt: session.giftShownAt ? new Date(session.giftShownAt).toISOString() : null,

      // Бэлэг — ЮУГ Ч ТҮГЖИХГҮЙ, зөвхөн эзэмшигчийн бүртгэл
      gifted: Boolean(session.gifted),
      giftedAt: session.giftedAt ? new Date(session.giftedAt).toISOString() : null,
      giftProof: session.giftProof ?? null,

      updatedAt: new Date(session.updatedAt).toISOString(),
    });
  }

  if (action === 'send') {
    if (!session.profile) return json({ ok: false, error: 'хэрэглэгч тест өгөөгүй' }, 400);
    const delivered = await showMirror(psid, session);
    return json({ ok: true, action, psid, delivered });
  }

  return json({ ok: false, error: `үл мэдэгдэх action: ${action}` }, 400);
}
