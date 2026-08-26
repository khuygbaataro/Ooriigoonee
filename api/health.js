import { configReport, config } from '../lib/config.js';
import { isAuthorized, unauthorized } from '../lib/auth.js';
import { ping as pingClaude } from '../lib/claude.js';
import { ping as pingOpenAI } from '../lib/openai.js';
import { pingPage } from '../lib/messenger.js';
import { set, get } from '../lib/store.js';

/**
 * Тохиргоо шалгах endpoint.
 *
 *   /api/health
 *       → зөвхөн ямар хувьсагч тавигдсаныг харуулна (нууц утга харагдахгүй).
 *
 *   /api/health?deep=1&secret=<ADMIN_SECRET>
 *       → Claude, OpenAI, Redis, Facebook рүү ЖИЖИГ жинхэнэ хүсэлт явуулж,
 *         алдааны БОДИТ текстийг буцаана. "Яагаад ажиллахгүй байна вэ?" гэдгийг
 *         Vercel-ийн лог ухалгүйгээр эндээс шууд харна.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

/** Нэг шалгалтыг ажиллуулаад {ok, ms, ...} хэлбэрээр буцаана. */
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return [name, { ok: true, ms: Date.now() - started, ...detail }];
  } catch (err) {
    return [
      name,
      {
        ok: false,
        ms: Date.now() - started,
        status: err?.status ?? null,
        error: String(err?.message ?? err).slice(0, 500),
      },
    ];
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const base = {
    ok: true,
    service: 'messenger-ai-personality-bot',
    time: new Date().toISOString(),
    env: configReport(),
  };

  if (url.searchParams.get('deep') !== '1') return json(base);
  if (!isAuthorized(request, url)) return unauthorized();

  const results = await Promise.all([
    check('claude', () => pingClaude()),
    check('openai', () => pingOpenAI()),
    check('redis', async () => {
      const key = `healthcheck:${Date.now()}`;
      await set(key, { ok: true }, 60);
      const back = await get(key);
      if (!back?.ok) throw new Error('бичээд буцааж уншиж чадсангүй');
      return { backend: config.redisUrl ? 'upstash' : 'memory (production-д тохирохгүй)' };
    }),
    check('facebook', () => pingPage()),
  ]);

  const checks = Object.fromEntries(results);
  return json({ ...base, ok: Object.values(checks).every((c) => c.ok), checks });
}
