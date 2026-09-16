/**
 * Бүх орчны хувьсагчийг нэг дор цуглуулсан газар.
 * Vercel дээр: Project -> Settings -> Environment Variables
 *
 * ⚠️ ЭНЭ ТӨСӨЛД ЗАРАХ ЮМ БАЙХГҮЙ. Бүх зүйл үнэгүй.
 *    Доорх дансны мэдээлэл нь ЗӨВХӨН хэрэглэгч ӨӨРӨӨ асуусан үед харагдана
 *    (lib/gift.js). Хэзээ ч урьдчилж, шаардаж харуулахгүй.
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

const bool = (key, fallback) => {
  const value = env(key, fallback ? '1' : '0').toLowerCase();
  return !['0', 'false', 'no', 'off', 'үгүй'].includes(value);
};

export const config = {
  // Facebook
  pageAccessToken: env('PAGE_ACCESS_TOKEN'),
  verifyToken: env('VERIFY_TOKEN'),
  appSecret: env('APP_SECRET'),
  graphVersion: env('FB_GRAPH_VERSION', 'v21.0'),

  // Claude — анализ, бүрэн тайлан
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-opus-5'),
  // Чат нь олон удаа давтагдана — тайлангаас хямд загвар ашиглаж болно.
  anthropicChatModel: env('ANTHROPIC_CHAT_MODEL') || env('ANTHROPIC_MODEL', 'claude-sonnet-5'),
  anthropicEffort: env('ANTHROPIC_EFFORT', 'medium'),

  // OpenAI — чөлөөт харилцаа
  openaiApiKey: env('OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),

  // Аль давхарга чат хөтлөх вэ: 'openai' (хямд) | 'claude' (гүн)
  // Аль нь ч унавал нөгөө рүү нь автоматаар шилжинэ (lib/flow.js).
  chatProvider: env('CHAT_PROVIDER', 'openai').toLowerCase() === 'claude' ? 'claude' : 'openai',

  // Storage (Upstash Redis REST). Vercel Marketplace нь KV_* нэрээр өгдөг,
  // Upstash дээрээс шууд авбал UPSTASH_* нэртэй байдаг — хоёуланг нь дэмжинэ.
  redisUrl: env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL'),
  redisToken: env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN'),

  siteUrl: (env('SITE_URL') || (env('VERCEL_URL') && `https://${env('VERCEL_URL')}`) || '').replace(/\/$/, ''),
  adminSecret: env('ADMIN_SECRET'),

  /**
   * Нэг хэрэглэгч нэг өдөрт хэдэн мессеж бичиж болох вэ.
   *
   * ⚠️ 0 = ХЯЗГААРГҮЙ, энэ нь АНХДАГЧ. Хүн хүссэн хэрээрээ ярина.
   *    Яриа бол энэ бүтээгдэхүүний гол үнэ цэн — түүнийг тасалдаг зүйл
   *    маш сайн шалтгаангүйгээр байх ёсгүй.
   *
   * ⚠️ Хуучин FREE_CHAT_LIMIT-ийг ЗОРИУД уншихаа больсон. Тэр нэр төлбөртэй
   *    үеийнх («үнэгүй хэрэглэгч 15 мессеж авна») бөгөөд Vercel дээр үлдсэн
   *    хуучин утга нь хүмүүсийг чимээгүйхэн хязгаарлах байлаа.
   *    Хязгаар тавимаар бол DAILY_CHAT_LIMIT-ийг тодорхой бичнэ үү.
   */
  dailyChatLimit: Number(env('DAILY_CHAT_LIMIT', '0')) || 0,

  // ── БЭЛЭГ («өгөө авъяа») ──────────────────────────────────────────────
  // Хэрэглэгч ӨӨРӨӨ «яаж дэмжих вэ / данс байна уу» гэж асуусан үед л
  // харагдана. Хэзээ ч урьдчилж санал болгохгүй.
  giftEnabled: bool('GIFT_ENABLED', true),
  bankName: env('BANK_NAME', 'Хаан банк'),
  bankAccount: env('BANK_ACCOUNT', '5024703476'),
  bankIban: env('BANK_IBAN', 'MN070005005024703476'),
  bankAccountName: env('BANK_ACCOUNT_NAME', 'Хуягбаатар'),

  /**
   * Хүн хүнд байдлын тухай ярьвал санал болгох тусламжийн мэдээлэл.
   * Тодорхой утасны дугаар мэддэг бол энд бичээрэй.
   */
  helpline: env('HELPLINE_TEXT', 'яаралтай тусламж 103'),

  // Facebook хуудасны хаяг — хуваалцахад хэрэглэнэ (m.me/<энэ>)
  pageHandle: env('PAGE_HANDLE', ''),
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
    ADMIN_SECRET: Boolean(config.adminSecret),
    GIFT_ENABLED: config.giftEnabled,
    chatProvider: config.chatProvider,
    dailyChatLimit: config.dailyChatLimit > 0 ? config.dailyChatLimit : 'хязгааргүй',
    models: {
      claude: config.anthropicModel,
      claudeChat: config.anthropicChatModel,
      openai: config.openaiModel,
    },

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
