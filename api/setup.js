import { installMenu } from '../lib/messenger.js';
import { isAuthorized, unauthorized, json } from '../lib/auth.js';

/**
 * Messenger-ийн "Get Started" товч, мэндчилгээ, доод цэсийг суулгана.
 * Deploy хийсний дараа НЭГ УДАА дуудна:
 *   https://<domain>/api/setup?secret=<ADMIN_SECRET>
 */
export default async function handler(request) {
  const url = new URL(request.url, 'http://localhost');
  if (!isAuthorized(request, url)) return unauthorized();

  const result = await installMenu();
  if (!result) return json({ ok: false, error: 'Facebook API алдаа — лог шалгана уу' }, 502);

  return json({ ok: true, installed: result });
}
