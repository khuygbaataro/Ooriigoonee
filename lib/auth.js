import crypto from 'node:crypto';
import { config } from './config.js';

/** ADMIN_SECRET-ээр хамгаалагдсан endpoint-уудын шалгалт. */
export function isAuthorized(request, url) {
  if (!config.adminSecret) return false; // тохируулаагүй бол хаалттай
  const provided =
    request.headers.get('x-admin-secret') ?? url.searchParams.get('secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(config.adminSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
