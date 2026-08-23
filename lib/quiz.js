/**
 * 10 асуултын тест.
 *
 * Messenger-ийн quick reply-ийн гарчиг 20 тэмдэгтээс хэтэрч болохгүй тул
 * бүрэн хувилбарыг мессежийн биед бичээд, товч дээр зөвхөн үсгийг харуулна.
 */

export const QUESTIONS = [
  {
    text: 'Шинэ хүмүүстэй уулзах үед чи ихэвчлэн…',
    options: [
      { key: 'А', label: 'Шууд яриа эхлүүлдэг' },
      { key: 'Б', label: 'Эхлээд ажигладаг' },
      { key: 'В', label: 'Нөгөө хүнээс шалтгаалдаг' },
    ],
  },
  {
    text: 'Чухал шийдвэр гаргахдаа чи…',
    options: [
      { key: 'А', label: 'Логик дээр тулгуурладаг' },
      { key: 'Б', label: 'Мэдрэмжээ дагадаг' },
      { key: 'В', label: 'Аль алиныг нь боддог' },
    ],
  },
  {
    text: 'Хэн нэгэн чамайг буруугаар ойлговол…',
    options: [
      { key: 'А', label: 'Шууд тайлбарладаг' },
      { key: 'Б', label: 'Дуугүй өнгөрөөдөг' },
      { key: 'В', label: 'Нөхцөл байдлаас шалтгаалдаг' },
    ],
  },
  {
    text: 'Ганцаараа байх үедээ чи…',
    options: [
      { key: 'А', label: 'Эрч хүч авдаг' },
      { key: 'Б', label: 'Уйддаг' },
      { key: 'В', label: 'Заримдаа ингэж, заримдаа тэгдэг' },
    ],
  },
  {
    text: 'Асуудал тулгарахад хамгийн түрүүнд…',
    options: [
      { key: 'А', label: 'Шийдэл хайдаг' },
      { key: 'Б', label: 'Сэтгэл хөдлөлөө мэдэрдэг' },
      { key: 'В', label: 'Хэн нэгэнтэй ярилцдаг' },
    ],
  },
  {
    text: 'Чамд магтаал хэлэхэд…',
    options: [
      { key: 'А', label: 'Шууд хүлээж авдаг' },
      { key: 'Б', label: 'Жаахан эвгүйцдэг' },
      { key: 'В', label: 'Дотроо их боддог' },
    ],
  },
  {
    text: 'Харилцаанд чамд хамгийн чухал нь…',
    options: [
      { key: 'А', label: 'Итгэлцэл' },
      { key: 'Б', label: 'Ойлголцол' },
      { key: 'В', label: 'Эрх чөлөө' },
    ],
  },
  {
    text: 'Чи төлөвлөгөөгөө ихэвчлэн…',
    options: [
      { key: 'А', label: 'Нарийн гаргадаг' },
      { key: 'Б', label: 'Явцдаа шийддэг' },
      { key: 'В', label: 'Ерөнхийдөө төлөвлөдөг' },
    ],
  },
  {
    text: 'Стресстэй үедээ чи…',
    options: [
      { key: 'А', label: 'Дотогшоо ордог' },
      { key: 'Б', label: 'Уурлаж / эмзэг болдог' },
      { key: 'В', label: 'Асуудлыг шууд шийдэхийг хичээдэг' },
    ],
  },
  {
    text: 'Чи өөрийнхөө талаар хамгийн их мэдэхийг хүсдэг зүйл аль вэ?',
    options: [
      { key: 'А', label: 'Миний зан чанар' },
      { key: 'Б', label: 'Харилцааны хэв маяг' },
      { key: 'В', label: 'Надад тохирох чиглэл' },
      { key: 'Г', label: 'Миний далд давуу тал' },
    ],
  },
];

export const TOTAL = QUESTIONS.length;

/** Асуултыг Messenger-т илгээхэд бэлэн текст + quick reply болгож хөрвүүлнэ. */
export function renderQuestion(index) {
  const q = QUESTIONS[index];
  const lines = q.options.map((o) => `${o.key}) ${o.label}`).join('\n');
  return {
    text: `${index + 1}/${TOTAL}  ❓ ${q.text}\n\n${lines}`,
    quickReplies: q.options.map((o) => ({
      title: o.key,
      payload: `ANS_${index}_${o.key}`,
    })),
  };
}

/** Хариултыг хүн уншихаар текст болгоно — Claude-д дамжуулна. */
export function answersToText(answers) {
  return answers
    .map((a, i) => `${i + 1}. ${QUESTIONS[i].text}\n   → ${a.key}) ${a.label}`)
    .join('\n');
}

/** Бичсэн текстээр (жишээ нь "а", "1", "A") хариулт таних. */
export function matchAnswer(index, raw) {
  const q = QUESTIONS[index];
  if (!q) return null;
  const value = (raw || '').trim().toLowerCase();
  const latinToCyrillic = { a: 'А', b: 'Б', c: 'В', d: 'Г' };
  const byNumber = { 1: 'А', 2: 'Б', 3: 'В', 4: 'Г' };
  const wanted =
    latinToCyrillic[value] ??
    byNumber[value] ??
    value.toUpperCase();
  return q.options.find((o) => o.key === wanted) ?? null;
}
