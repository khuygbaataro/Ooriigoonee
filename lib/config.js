/**
 * Бүх орчны хувьсагчийг нэг дор цуглуулсан газар.
 * Vercel дээр: Project -> Settings -> Environment Variables
 */

/**
 * Орчны хувьсагчийг унших.
 * Хувьсагч огт байхгүй ч, хоосон мөр ("") байсан ч анхдагч утгыг өгнө —
 * Vercel дээр нэрийг нь үүсгээд утгыг нь хоосон орхих тохиолдол элбэг.
 */
const env = (key, fallback = '') => {
  const value = process.env[key];
  if (value == null) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' ? fallback : trimmed;
};

export const config = {
  // Facebook
  pageAccessToken: env('PAGE_ACCESS_TOKEN'),
  verifyToken: env('VERIFY_TOKEN'),
  appSecret: env('APP_SECRET'),
  graphVersion: env('FB_GRAPH_VERSION', 'v21.0'),

  // Claude — анализ, тооцоолол
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-5'),
  anthropicEffort: env('ANTHROPIC_EFFORT', 'medium'),

  // OpenAI — чөлөөт харилцаа
  openaiApiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),

  // Storage (Upstash Redis REST). Vercel Marketplace нь KV_* нэрээр өгдөг,
  // Upstash дээрээс шууд авбал UPSTASH_* нэртэй байдаг — хоёуланг нь дэмжинэ.
  redisUrl: env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL'),
  redisToken: env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN'),

  // Business
  siteUrl: (env('SITE_URL') || env('VERCEL_URL') && `https://${env('VERCEL_URL')}` || '').replace(/\/$/, ''),
  paymentUrl: env('PAYMENT_URL'),
  priceLabel: env('PRICE_LABEL', '19,900₮'),
  freeChatLimit: Number(env('FREE_CHAT_LIMIT', '15')),
  adminSecret: env('ADMIN_SECRET'),

  // Банкны шилжүүлэг — хэрэглэгч дансруу шилжүүлээд баримтын зургаа илгээнэ
  bankName: env('BANK_NAME', 'Хаан банк'),
  bankAccount: env('BANK_ACCOUNT', '5556563179'),
  bankIban: env('BANK_IBAN', 'MN570005005556563179'),
  bankAccountName: env('BANK_ACCOUNT_NAME', 'ХОНГОРЗУЛ БАТХИШИГ'),
  // Баримт дээрх дүнг шалгахад ашиглана (priceLabel нь зөвхөн харуулах текст)
  priceAmount: Number(env('PRICE_AMOUNT', '19900')),
};

/** Дансны дугаарыг зөвхөн цифрээр — харьцуулахад ашиглана. */
export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/** Тохиргоо бүрэн эсэхийг шалгах — /api/health дээр харагдана. */
export function configReport() {
  return {
    PAGE_ACCESS_TOKEN: Boolean(config.pageAccessToken),
    VERIFY_TOKEN: Boolean(config.verifyToken),
    APP_SECRET: Boolean(config.appSecret),
    ANTHROPIC_API_KEY: Boolean(config.anthropicApiKey),
    OPENAI_API_KEY: Boolean(config.openaiApiKey),
    REDIS: Boolean(config.redisUrl && config.redisToken),
    PAYMENT_URL: Boolean(config.paymentUrl),
    ADMIN_SECRET: Boolean(config.adminSecret),
    models: { claude: config.anthropicModel, openai: config.openaiModel },

    // Оношилгоо: Vercel дээр ЯМАР нэртэй хувьсагч харагдаж байгааг жагсаана.
    // Зөвхөн НЭР — утга хэзээ ч харагдахгүй. Үсгийн алдаа шалгахад хэрэгтэй.
    visibleEnvNames: Object.keys(process.env)
      .filter((name) => !SYSTEM_ENV.test(name))
      .sort(),
    deployedCommit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
}

/** Vercel / Node-ийн өөрийн дотоод хувьсагчдыг жагсаалтаас хасах. */
const SYSTEM_ENV =
  /^(VERCEL|AWS|LAMBDA|NODE|npm|PATH$|PWD$|HOME$|LANG$|TZ$|_$|SHLVL$|TERM|HOSTNAME$|X_|__|EDGE_)/i;
