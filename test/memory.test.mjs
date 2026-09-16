import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyMemory,
  normalizeMemory,
  renderMemory,
  hasMemory,
  shouldUpdate,
  pushHistory,
  historyToText,
  HISTORY_LIMIT,
  MEMORY_EVERY,
  LIMITS,
} from '../lib/memory.js';
import { set, getSession } from '../lib/store.js';

/**
 * УРТ ХУГАЦААНЫ САНАХ ОЙН ТЕСТ.
 *
 * Гол эрсдэл: сар ярилцсан хүнийхээ тухай мэдэх бүхнээ алдах. Тэр үед бот
 * «хөтөч» байхаа больж, хаашаа чиглүүлэхээ мэдэхгүй болно.
 */

// ── Хамгийн чухал инвариант ─────────────────────────────────────────────

test('ойрын цонх нь тэмдэглэл шинэчлэх давтамжаас ИХ байх ёстой', () => {
  /**
   * ⚠️ Хэрэв HISTORY_LIMIT <= MEMORY_EVERY бол ярианы эхлэл нь тэмдэглэлд
   *    ороогүй байхад цонхноос гарч, БҮРМӨСӨН алдагдана. Энэ тохиолдолд
   *    хүн юу ярьсныг хэн ч санахгүй болно.
   */
  assert.ok(
    HISTORY_LIMIT > MEMORY_EVERY,
    `ойрын цонх (${HISTORY_LIMIT}) нь шинэчлэлтийн давтамжаас (${MEMORY_EVERY}) их байх ёстой — ` +
      'эс тэгвээс яриа тэмдэглэлд орохоосоо өмнө алдагдана',
  );
});

test('тэмдэглэл шинэчлэх хүртэл бүх яриа цонхонд багтана', () => {
  let session = { chatHistory: [], messagesSinceMemory: 0 };

  // Шинэчлэлт хийх хүртэл яг хэдэн харилцаа болохыг дүүргэнэ
  for (let i = 0; i < MEMORY_EVERY; i++) {
    pushHistory(session, `хүн ${i}`, `бот ${i}`);
  }

  assert.equal(shouldUpdate(session), true, 'шинэчлэх цаг болсон байх ёстой');

  // Эхний мессеж хүртэл цонхонд бүтнээрээ байгаа эсэх — юу ч алдагдаагүй
  const text = historyToText(session.chatHistory);
  for (let i = 0; i < MEMORY_EVERY; i++) {
    assert.ok(text.includes(`хүн ${i}`), `${i}-р мессеж алдагдсан байна`);
  }
});

// ── Тоолуур ба цонх ─────────────────────────────────────────────────────

test('pushHistory тоолуурыг нэмэгдүүлнэ', () => {
  const session = { chatHistory: [], messagesSinceMemory: 0 };
  pushHistory(session, 'сайн уу', 'сайн');
  assert.equal(session.messagesSinceMemory, 1);
  assert.equal(session.chatHistory.length, 2, 'нэг харилцаа = хоёр бичлэг');
});

test('цонх дүүрэхэд хамгийн хуучин нь унана', () => {
  const session = { chatHistory: [], messagesSinceMemory: 0 };
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) pushHistory(session, `хүн ${i}`, `бот ${i}`);

  assert.equal(session.chatHistory.length, HISTORY_LIMIT * 2);
  assert.equal(session.chatHistory[0].role, 'user', 'цонх үргэлж хүнээр эхэлнэ');
  const text = historyToText(session.chatHistory);
  assert.ok(!text.includes('хүн 0'), 'хамгийн хуучин нь унасан байх ёстой');
  assert.ok(text.includes(`хүн ${HISTORY_LIMIT + 4}`), 'хамгийн шинэ нь үлдсэн байх ёстой');
});

test('shouldUpdate — яриа байхгүй бол шинэчлэхгүй', () => {
  assert.equal(shouldUpdate({ chatHistory: [], messagesSinceMemory: 99 }), false);
  assert.equal(shouldUpdate({ chatHistory: [{}], messagesSinceMemory: 0 }), false);
  assert.equal(shouldUpdate({ chatHistory: [{}], messagesSinceMemory: MEMORY_EVERY }), true);
});

// ── Тэмдэглэлийг цэвэрлэх ───────────────────────────────────────────────

test('normalizeMemory хэмжээг барина', () => {
  const huge = normalizeMemory({
    about: 'а'.repeat(5000),
    direction: 'б'.repeat(5000),
    threads: Array.from({ length: 50 }, (_, i) => `сэдэв ${i}`),
    milestones: Array.from({ length: 50 }, (_, i) => `ахиц ${i}`),
    avoid: Array.from({ length: 50 }, (_, i) => `хориотой ${i}`),
    covered: Array.from({ length: 50 }, (_, i) => `ярилцсан ${i}`),
  });

  assert.equal(huge.about.length, LIMITS.about);
  assert.equal(huge.direction.length, LIMITS.direction);
  assert.equal(huge.threads.length, LIMITS.threads);
  assert.equal(huge.milestones.length, LIMITS.milestones);
  assert.equal(huge.avoid.length, LIMITS.avoid);
  assert.equal(huge.covered.length, LIMITS.covered);
});

test('хэмжээ хэтрэхэд ХАМГИЙН ШИНЭ нь үлдэнэ', () => {
  const { milestones } = normalizeMemory({
    milestones: Array.from({ length: 50 }, (_, i) => `ахиц ${i}`),
  });
  assert.equal(milestones[milestones.length - 1], 'ахиц 49', 'хамгийн сүүлийнх нь үлдэх ёстой');
});

test('normalizeMemory эвдэрсэн оролтод унахгүй', () => {
  for (const bad of [null, undefined, {}, { threads: 'мөр' }, { about: 42 }]) {
    const m = normalizeMemory(bad);
    assert.ok(Array.isArray(m.threads), `оролт: ${JSON.stringify(bad)}`);
    assert.equal(typeof m.about, 'string');
  }
});

test('хоосон мөрүүд жагсаалтад орохгүй', () => {
  const { threads } = normalizeMemory({ threads: ['', '  ', 'жинхэнэ сэдэв', null] });
  assert.deepEqual(threads, ['жинхэнэ сэдэв']);
});

// ── Prompt болгон буулгах ───────────────────────────────────────────────

test('хоосон тэмдэглэл prompt-д юу ч нэмэхгүй', () => {
  assert.equal(hasMemory(emptyMemory()), false);
  assert.equal(renderMemory(emptyMemory()), '');
  assert.equal(renderMemory(null), '');
});

test('дүүрэн тэмдэглэл бүх хэсгээ агуулна', () => {
  const rendered = renderMemory(
    normalizeMemory({
      about: 'Ганаа гэдэг, 27 настай, багш.',
      direction: 'Ажлаа солимоор байна гэж хэлсэн.',
      threads: ['ээжтэйгээ ярилцах эсэх'],
      milestones: ['анх удаа үгүй гэж хэлсэн'],
      avoid: ['аавынх нь тухай'],
      covered: ['амьсгалын дасгал санал болгосон'],
    }),
  );

  for (const piece of [
    'Ганаа гэдэг',
    'Ажлаа солимоор',
    'ээжтэйгээ ярилцах эсэх',
    'анх удаа үгүй гэж хэлсэн',
    'аавынх нь тухай',
    'амьсгалын дасгал',
  ]) {
    assert.ok(rendered.includes(piece), `тэмдэглэлээс алдагдсан: ${piece}`);
  }
});

test('хориотой сэдэв ХАМГИЙН СҮҮЛД, хүчтэй анхааруулгатай', () => {
  const rendered = renderMemory(
    normalizeMemory({ about: 'тест', avoid: ['аавынх нь тухай'], threads: ['ажил'] }),
  );

  assert.ok(rendered.includes('ХЭЗЭЭ Ч БҮҮ ХӨНД'), 'хүчтэй анхааруулга байх ёстой');
  assert.ok(
    rendered.indexOf('БҮҮ ХӨНД') > rendered.indexOf('ажил'),
    'хориотой сэдэв сүүлд байх ёстой — загвар сүүлийн зааврыг хамгийн сайн сануулдаг',
  );
});

test('тэмдэглэлийг баталгаа биш, СЭЖИГ гэж ашиглахыг сануулна', () => {
  const rendered = renderMemory(normalizeMemory({ about: 'тест' }));
  assert.ok(rendered.includes('өөрчлөгдсөн байж магадгүй'), 'хүн өөрчлөгддөгийг сануулах ёстой');
  assert.ok(rendered.includes('бүхэлд нь уншиж бүү сонсго'), 'тэмдэглэлээ уншиж сонсгож болохгүй');
});

test('чиглэл байвал түүн рүү чиглүүлэхийг заана', () => {
  const rendered = renderMemory(normalizeMemory({ direction: 'Ажлаа солимоор байна' }));
  assert.ok(rendered.includes('өөрийнхөө бодсон зүг рүү биш'), 'хүний чиглэлийг дагах ёстой');
});

// ── Session-д хадгалагдах ───────────────────────────────────────────────

test('санах ойгүй хуучин session шилжихдээ хоосон тэмдэглэл авна', async () => {
  await set('u:no-mem', { state: 'chat', answers: [], chatHistory: [], createdAt: 1 });
  const session = await getSession('no-mem');
  assert.deepEqual(session.memory.threads, []);
  assert.equal(session.memory.about, '');
});

test('хагас дутуу тэмдэглэл нөхөгдөнө', async () => {
  await set('u:half-mem', {
    state: 'chat',
    answers: [],
    chatHistory: [],
    createdAt: 1,
    memory: { about: 'мэддэг зүйл' }, // threads, avoid г.м. байхгүй
  });
  const session = await getSession('half-mem');
  assert.equal(session.memory.about, 'мэддэг зүйл', 'байгаа нь хадгалагдана');
  assert.deepEqual(session.memory.avoid, [], 'дутуу нь нөхөгдөнө');
});

test('«Дахин эхлэх» дарахад тэмдэглэл АЛДАГДАХГҮЙ', () => {
  /**
   * Хүн тестээ дахин өгөх нь өөр хүн болно гэсэн үг биш. Сар ярилцсан
   * хүн «дахин эхлэх» дарахад танихгүй хүн болж хувирвал энэ системийн
   * гол зорилго нурна.
   */
  const flow = readFileSync(new URL('../lib/flow.js', import.meta.url), 'utf8');
  const at = flow.indexOf("payload === 'RESTART'");
  assert.ok(at > 0, 'RESTART боловсруулалт олдсонгүй');

  const block = flow.slice(at, at + 1400);
  assert.ok(block.includes('memory: session.memory'), 'тэмдэглэл хадгалагдах ёстой');
  assert.ok(block.includes('chatHistory: session.chatHistory'), 'ойрын яриа хадгалагдах ёстой');
});
