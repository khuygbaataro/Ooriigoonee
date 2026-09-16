/**
 * УРТ ХУГАЦААНЫ САНАХ ОЙ.
 *
 * АСУУДАЛ: chatHistory нь сүүлийн 10 харилцааг л барьдаг. Сар ярилцсан
 * хүнийхээ нэр, амьдралын нөхцөл, юун дээр ажиллаж байсныг, ямар ахиц
 * гаргасныг мартвал «хөтөч» байх утгаа алдана — хаашаа чиглүүлэхээ мэдэхгүй
 * болно.
 *
 * ШИЙДЭЛ: ярианы түүхийг бүхэлд нь хадгалахын оронд, хэдэн харилцаа тутамд
 * түүнийг ХУРААНГУЙ ТЭМДЭГЛЭЛ болгон нэгтгэнэ. Тэмдэглэл нь ургаж,
 * шинэчлэгдэж, хуучирсан зүйл нь унадаг — хүн санадаг шигээ.
 *
 * ⚠️ Энэ файлд API дуудлага БАЙХГҮЙ — зөвхөн цэвэр логик тул шууд тест
 *    хийж болно. Загварын дуудлага нь lib/claude.js → updateMemory().
 */

/** Хэдэн харилцаа тутамд тэмдэглэлээ шинэчлэх вэ. */
export const MEMORY_EVERY = 6;

/**
 * Тэмдэглэлийн хэмжээний таг.
 *
 * ⚠️ Хязгааргүй ургавал (а) системийн prompt хавдаж зардал өснө,
 *    (б) чухал зүйл нь жижиг зүйлсийн дунд живнэ. Хүний санах ой ч
 *    ингэж ажилладаг — чухал нь үлдэж, үлдсэн нь бүдгэрдэг.
 */
export const LIMITS = {
  about: 700,      // тэмдэгт
  direction: 400,  // тэмдэгт
  threads: 6,      // нээлттэй сэдэв
  milestones: 12,  // ахицын мөч
  avoid: 8,        // хөндөхгүй сэдэв
  covered: 15,     // аль хэдийн ярилцсан
};

export const emptyMemory = () => ({
  /** Хэн бэ — амьдралын нөхцөл, ойр дотны хүмүүс, ажил. Удаан өөрчлөгдөнө. */
  about: '',
  /** ⭐ Хаашаа явахыг ӨӨРӨӨ хүсэж байгаа вэ. Хөтөчлөх чиглэлийн цөм. */
  direction: '',
  /** Одоо нээлттэй байгаа сэдвүүд — хамгийн хурдан өөрчлөгдөнө. */
  threads: [],
  /** Ахиц, эргэлтийн мөчүүд — хуримтлагдана. Хүнд ахицыг нь харуулахад. */
  milestones: [],
  /** ⚠️ Хүн өөрөө ярихыг хүсээгүй зүйлс — ХЭЗЭЭ Ч хөндөхгүй. */
  avoid: [],
  /** Аль хэдийн ярилцсан / санал болгосон зүйлс — давтахгүйн тулд. */
  covered: [],

  updatedAt: null,
});

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

const cleanList = (value, max) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(-max); // сүүлийнх нь = хамгийн шинэ нь үлдэнэ

/** Загвараас ирсэн тэмдэглэлийг аюулгүй хэлбэрт оруулна. */
export function normalizeMemory(raw) {
  return {
    about: clean(raw?.about, LIMITS.about),
    direction: clean(raw?.direction, LIMITS.direction),
    threads: cleanList(raw?.threads, LIMITS.threads),
    milestones: cleanList(raw?.milestones, LIMITS.milestones),
    avoid: cleanList(raw?.avoid, LIMITS.avoid),
    covered: cleanList(raw?.covered, LIMITS.covered),
    updatedAt: Date.now(),
  };
}

/** Тэмдэглэлд ямар нэг зүйл бий юу. */
export const hasMemory = (memory) =>
  Boolean(
    memory &&
      (memory.about ||
        memory.direction ||
        memory.threads?.length ||
        memory.milestones?.length ||
        memory.avoid?.length),
  );

/**
 * Тэмдэглэлийг системийн prompt-д тавих блок болгоно.
 *
 * ⚠️ Дараалал санаатай: эхлээд ХЭН БЭ, дараа нь ХААШАА, дараа нь ОДОО ЮУ.
 *    Хориотой сэдвийг ХАМГИЙН СҮҮЛД тавьсан — загвар сүүлийн зааврыг
 *    хамгийн сайн сануулдаг.
 */
export function renderMemory(memory) {
  if (!hasMemory(memory)) return '';

  const block = [];
  const list = (items) => items.map((item) => `- ${item}`).join('\n');

  block.push('ЭНЭ ХҮНИЙГ ЧИ ӨМНӨ НЬ МЭДДЭГ. Доорх нь өмнөх яриануудын тэмдэглэл:');

  if (memory.about) block.push(`\nХЭН БЭ:\n${memory.about}`);

  if (memory.direction) {
    block.push(
      `\n⭐ ХААШАА ЯВАХЫГ ХҮСЭЖ БАЙГАА (өөрийнх нь үгээр):\n${memory.direction}\n` +
        'Чиглүүлэх шаардлагатай бол ЭНЭ рүү чиглүүл — өөрийнхөө бодсон зүг рүү биш.',
    );
  }

  if (memory.threads?.length) {
    block.push(`\nОДОО НЭЭЛТТЭЙ БАЙГАА ЗҮЙЛС:\n${list(memory.threads)}`);
  }

  if (memory.milestones?.length) {
    block.push(
      `\nАЛХАМ АЛХМААР ГАРГАСАН АХИЦ:\n${list(memory.milestones)}\n` +
        'Эдгээрийг САНААД БАЙГААГАА мэдэгд. «Чи саяхан … гэж хэлж байсан шүү дээ» гэх нь\n' +
        'энэ ярианы хамгийн үнэ цэнтэй мөчүүдийн нэг. Гэхдээ хэтрүүлж дурдахгүй.',
    );
  }

  if (memory.covered?.length) {
    block.push(
      `\nАЛЬ ХЭДИЙН ЯРИЛЦСАН (дахин бүү давт, цааш нь ав):\n${list(memory.covered)}`,
    );
  }

  if (memory.avoid?.length) {
    block.push(
      `\n⛔ ХҮН ЭДГЭЭРИЙГ ЯРИХЫГ ХҮСЭЭГҮЙ — ЧИ ӨӨРӨӨ ХЭЗЭЭ Ч БҮҮ ХӨНД:\n${list(memory.avoid)}\n` +
        'Хүн өөрөө эргэж ярьвал өөр хэрэг. Чи санаачилж болохгүй.',
    );
  }

  block.push(
    '\n⚠️ Тэмдэглэл бол өнгөрсний зураг — хүн өөрчлөгдсөн байж магадгүй.\n' +
      'Үүнийг «би чамайг мэднэ» гэсэн баталгаа биш, сэжиг гэж ашигла.\n' +
      'Тэмдэглэлийг хэзээ ч бүхэлд нь уншиж бүү сонсго. Зөвхөн хэрэгтэй нэгийг нь ишлэ.',
  );

  return block.join('\n');
}

/**
 * Тэмдэглэлээ шинэчлэх цаг болсон уу?
 *
 * Хариултыг ИЛГЭЭСНИЙ ДАРАА л ажиллана — хэрэглэгч хүлээхгүй.
 */
export const shouldUpdate = (session) =>
  Boolean(session.chatHistory?.length) &&
  (session.messagesSinceMemory ?? 0) >= MEMORY_EVERY;

/**
 * Загварт дамжуулах ярианы хэсгийг текст болгоно.
 * Сүүлийн харилцаанууд — эдгээрээс шинэ мэдээллийг шүүж авна.
 */
export function historyToText(history) {
  return (history ?? [])
    .map((row) => `${row.role === 'user' ? 'ХҮН' : 'ЧИ'}: ${row.content}`)
    .join('\n\n');
}

// ── Ойрын ярианы түүх ───────────────────────────────────────────────────

/**
 * Загварт шууд дамжуулах сүүлийн харилцааны тоо.
 *
 * ⚠️ MEMORY_EVERY-ээс ИХ байх ЁСТОЙ. Эс тэгвээс тэмдэглэл шинэчлэгдэхээс
 *    өмнө ярианы эхлэл цонхноос гарч, мэдээлэл БҮРМӨСӨН алдагдана.
 *    Одоо: 10 > 6 тул тэмдэглэл шинэчлэх бүрд түүнээс хойшхи бүх яриа
 *    цонхонд бүтнээрээ багтаж байгаа.
 */
export const HISTORY_LIMIT = 10;

/**
 * Ярианы түүхийг шинэчилнэ.
 * Мөн тэмдэглэл шинэчлэх хүртэлх тоолуурыг нэмэгдүүлнэ.
 */
export function pushHistory(session, userMessage, assistantReply) {
  session.chatHistory = [
    ...(session.chatHistory ?? []),
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantReply },
  ].slice(-HISTORY_LIMIT * 2);

  session.messagesSinceMemory = (session.messagesSinceMemory ?? 0) + 1;
  return session;
}
