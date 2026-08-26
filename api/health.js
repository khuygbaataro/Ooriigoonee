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

/**
 * Ботыг ажиллуулахад ЗААВАЛ хэрэгтэй тохиргоо.
 * Vercel дээр хувьсагчийн НЭР үүсгээд утгыг нь хоосон орхих нь элбэг — тэр
 * тохиолдолд байхгүйтэй адил тул эндээс шууд харагдана.
 */
function missingCritical(env) {
  const required = {
    PAGE_ACCESS_TOKEN: 'Facebook рүү мессеж илгээх боломжгүй',
    VERIFY_TOKEN: 'Webhook баталгаажуулалт бүтэхгүй',
    APP_SECRET: 'Production дээр webhook бүх хүсэлтийг татгалзана',
    ANTHROPIC_API_KEY: 'Анализ огт хийгдэхгүй',
    REDIS: 'KV_REST_API_URL / KV_REST_API_TOKEN хоосон — session нь санах ойд хадгалагдана. Serverless дээр хэрэглэгчийн хариултууд алга болно',
  };
  return Object.entries(required)
    .filter(([key]) => !env[key])
    .map(([key, why]) => `${key}: ${why}`);
}

export async function GET(request) {
  const url = new URL(request.url);
  const env = configReport();
  const warnings = missingCritical(env);
  const base = {
    ok: warnings.length === 0,
    service: 'messenger-ai-personality-bot',
    time: new Date().toISOString(),
    warnings,
    env,
  };

  if (url.searchParams.get('deep') !== '1') return json(base);

  // ADMIN_SECRET хоосон бол «unauthorized» гэдэг нь төөрөгдүүлнэ — жинхэнэ
  // шалтгааныг нь хэлье.
  if (!config.adminSecret) {
    return json(
      {
        ...base,
        error:
          'ADMIN_SECRET хоосон байна. Vercel → Settings → Environment Variables дээр ADMIN_SECRET-д утга оруулаад дахин deploy хийвэл ?deep=1 шалгалт ажиллана.',
      },
      503,
    );
  }
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
