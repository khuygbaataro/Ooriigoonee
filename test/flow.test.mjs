import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../lib/config.js';
import { set, getSession, emptySession, touchActivity } from '../lib/store.js';
import { matchAnswer, QUESTIONS, TOTAL, renderQuestion } from '../lib/quiz.js';
import { guideSystem } from '../lib/prompts.js';

/** Redis тохируулаагүй тул store нь санах ойн горимд ажиллана. */

// ── Хуучин төлбөртэй session-ийг шилжүүлэх ──────────────────────────────

test('хуучин «төлсөн» хэрэглэгч дахин эхлэх шаардлагагүй', async () => {
  await set('u:old-paid', {
    state: 'result',
    questionIndex: 10,
    answers: [{ key: 'А', label: 'тест' }],
    profile: { type_name: 'Хуучин', teaser: ['a', 'b', 'c'] },
    fullReport: { personality: 'x' },
    paid: true,
    paidAt: 1700000000000,
    paymentProof: { amount: '19900' },
    chatHistory: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });

  const session = await getSession('old-paid');

  // Төлбөр нь одоо юуг ч түгжихгүй — бэлэг өгсөнд тооцогдоно
  assert.equal(session.gifted, true, 'төлж байсан хүн бэлэг өгсөнд тооцогдоно');
  assert.equal(session.giftedAt, 1700000000000);
  assert.equal(session.paid, undefined, 'хуучин paid талбар үлдэх ЁСГҮЙ');
  assert.equal(session.paymentProof, undefined, 'хуучин paymentProof үлдэх ЁСГҮЙ');

  // Бүрэн тайлан гэж байхаа больсон — талбар нь цэвэрлэгдэнэ
  assert.equal(session.fullReport, undefined, 'хуучин fullReport үлдэх ЁСГҮЙ');

  // Зарах зорилготой байсан «teaser» нь «noticed» болсон
  assert.deepEqual(session.profile.noticed, ['a', 'b', 'c']);

  // Шинэ талбарууд анхдагч утгатай орж ирсэн
  assert.deepEqual(session.activeDays, []);
  assert.equal(session.shareNudgedAt, null);
});

test('хуучирсан төлөвүүд ярианд буцна', async () => {
  // Бүрэн тайлан гэж байхаа больсон тул түүнийг хүлээж байсан хүмүүс
  // гацахгүйгээр шууд ярианд орох ёстой.
  for (const old of ['paid_pending', 'report_pending', 'mirror', 'result']) {
    await set('u:old-' + old, { ...emptySession(), state: old, profile: { type_name: 'x' } });
    const s = await getSession('old-' + old);
    assert.equal(s.state, 'chat', old + ' → chat');
  }
  // Профайлгүй бол эхнээс нь
  await set('u:no-profile', { ...emptySession(), state: 'mirror', profile: null });
  assert.equal((await getSession('no-profile')).state, 'idle');
});

test('шинэ хэрэглэгч цэвэр session авна', async () => {
  const session = await getSession('brand-new');
  assert.equal(session.state, 'idle');
  assert.equal(session.gifted, false);
  assert.equal(session.profile, null);
});

// ── Яриаг хязгаарлахгүй байх ────────────────────────────────────────────

test('өдрийн хязгаар анхдагчаар ХЯЗГААРГҮЙ', () => {
  // Яриа бол энэ бүтээгдэхүүний гол үнэ цэн. Хэн нэгэн ирээдүйд анхдагчаар
  // хязгаар тавьвал энэ тест унана — тэр нь санаатай.
  assert.equal(config.dailyChatLimit, 0, 'анхдагч утга 0 (хязгааргүй) байх ёстой');
});

test('хязгаарын шалгалт зөвхөн тодорхой тоо тавьсан үед ажиллана', () => {
  const flow = readFileSync(new URL('../lib/flow.js', import.meta.url), 'utf8');
  const at = flow.indexOf('DAILY_LIMIT)');
  assert.ok(at > 0, 'хязгаарын мессеж олдсонгүй');

  const guard = flow.slice(Math.max(0, at - 300), at);
  assert.ok(
    guard.includes('config.dailyChatLimit > 0'),
    'хязгаарыг зөвхөн 0-ээс их үед л шалгах ёстой',
  );
});

// ── Зардлын чиглүүлэлт ──────────────────────────────────────────────────

/**
 * Ажил бүр хэр олон удаа давтагдахаас нь хамаарч давхаргаа сонгоно:
 *   хүн тутамд НЭГ УДАА  → Claude (анализ, тайлан)
 *   хүн тутамд ОЛОН ЗУУ  → OpenAI (яриа, санах ой)
 *
 * Хэрэв хэн нэгэн давтагддаг ажлыг үнэтэй давхарга руу буцаавал зардал
 * ХҮНЭЭС биш МЕССЕЖЭЭС хамаарч өснө. Эдгээр тест түүнээс хамгаална.
 */

test('давтагддаг ажил анхдагчаар хямд давхарга дээр', () => {
  assert.equal(config.chatProvider, 'openai', 'яриа ба санах ой хямд давхарга дээр байх ёстой');
});

test('профайлтай хүн ч гэсэн үнэтэй давхарга руу АЛБААР явахгүй', () => {
  const flow = readFileSync(new URL('../lib/flow.js', import.meta.url), 'utf8');
  const at = flow.indexOf('async function generateReply');
  const body = flow.slice(at, at + 1600);

  assert.ok(
    !/useClaude\s*=\s*Boolean\(session\.profile\)/.test(body),
    'профайл байгаа нь Claude-ыг албадах ЁСГҮЙ — тэр нь чатын зардлыг 10 дахин нэмнэ',
  );
  assert.ok(
    body.includes("config.chatProvider === 'claude'"),
    'давхаргыг зөвхөн тохиргоо шийдэх ёстой',
  );
});

test('санах ой ч мөн хямд давхаргаар анхдагчаар явна', () => {
  const flow = readFileSync(new URL('../lib/flow.js', import.meta.url), 'utf8');
  const at = flow.indexOf('async function runMemoryUpdate');
  assert.ok(at > 0, 'runMemoryUpdate олдсонгүй');

  const body = flow.slice(at, at + 700);
  assert.ok(body.includes("config.chatProvider === 'claude'"), 'тохиргоог дагах ёстой');
  assert.ok(body.includes('openaiUpdateMemory'), 'хямд хувилбар байх ёстой');
});

test('анализ ҮРГЭЛЖ Claude дээр үлдэнэ', () => {
  // Хүн тутамд нэг удаа тул чанар нь зардлаас чухал.
  const claude = readFileSync(new URL('../lib/claude.js', import.meta.url), 'utf8');
  const at = claude.indexOf('export async function analyzeQuick');
  assert.ok(at > 0, 'analyzeQuick олдсонгүй');
  assert.ok(
    claude.slice(at, at + 1200).includes('config.anthropicModel'),
    'analyzeQuick нь anthropicModel ашиглах ёстой',
  );
});

// ── Дүн шинжилгээ бол баримт бичиг биш, яриа ────────────────────────────

/**
 * ⚠️ Өмнө нь бот тестийн дараа 10 бүлэгтэй тайланг 6 мессежээр нэг дор
 *    хаядаг байв. Хүн уншаад л өнгөрдөг — толгойд нь юу ч үлддэггүй.
 *
 *    Хэрэв хэн нэгэн ирээдүйд «бүрэн тайлан нэмье» гэвэл эдгээр тест унана.
 */

test('бүрэн тайлан үүсгэх / хаях код БАЙХГҮЙ', () => {
  for (const file of ['../lib/flow.js', '../lib/claude.js', '../lib/prompts.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const dead of ['generateFullReport', 'formatFullReport', 'REPORT_CORE_SYSTEM']) {
      assert.ok(!src.includes(dead), `${file} дотор ${dead} үлдсэн байна`);
    }
  }
});

test('тестийн дараа ГАНЦ тусгал гараад шууд яриа эхэлнэ', () => {
  const flow = readFileSync(new URL('../lib/flow.js', import.meta.url), 'utf8');
  const at = flow.indexOf('async function sendMirror');
  assert.ok(at > 0, 'sendMirror олдсонгүй');

  // Функцийн биеийг ЯГ таслаж авна — тогтмол уртаар зүсвэл дараагийн
  // функц руу орж, буруу тоолно.
  const rest = flow.slice(at);
  const body = rest.slice(0, rest.indexOf('\n}\n') + 3);

  const sends = (body.match(/fb\.sendText\(/g) ?? []).length;
  assert.ok(sends <= 2, `тусгал хамгийн ихдээ 2 мессеж байх ёстой, одоо ${sends}`);
  assert.ok(body.includes("session.state = 'chat'"), 'шууд ярианд орох ёстой');
  assert.ok(!body.includes('sendQuickReplies'), 'товч дарж тайлан хүлээх шат байх ЁСГҮЙ');
});

test('хөтөч бүх зүйлээ нэг дор хэлэхийг ХОРИГЛОСОН', () => {
  const session = { profile: { type_name: 'x', summary: 's', strength: 'h', blind_spot: 'b' } };
  const prompt = guideSystem(session);

  assert.ok(prompt.includes('НЭГ ДОР БҮҮ ХАЯ'), 'аажмаар гаргах дүрэм байх ёстой');
  assert.ok(prompt.includes('Нэг мессежид НЭГ ажиглалт'), 'нэг ажиглалтын дүрэм байх ёстой');
  assert.ok(
    prompt.includes('Хүн өөрийгөө ойлгох нь чиний ажил'),
    'зорилгыг нь тодорхой хэлэх ёстой',
  );
});

test('хөтөч тестийн хариултуудыг түүхий материал болгож хардаг', () => {
  const answers = QUESTIONS.map((q) => ({ key: q.options[0].key, label: q.options[0].label }));
  const prompt = guideSystem({ profile: { type_name: 'x' }, answers });

  assert.ok(prompt.includes('ТЕСТИЙН ХАРИУЛТУУД'), 'хариултууд prompt-д байх ёстой');
  assert.ok(prompt.includes(answers[0].label), 'тодорхой хариулт ишлэх боломжтой байх ёстой');
  assert.ok(prompt.includes('нэг дор бүү тоочиж хэл'), 'нэг дор тоочихыг хориглох ёстой');
});

test('хоёр давхарга ИЖИЛ системийн prompt ашиглана', () => {
  // Хэрэглэгч аль давхарга хариулснаа мэдэх ёсгүй: ижил VOICE, ижил
  // профайл, ижил урт хугацааны тэмдэглэл хоёуланд нь очно.
  for (const file of ['../lib/claude.js', '../lib/openai.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(src.includes('guideSystem'), `${file} нь guideSystem ашиглах ёстой`);
    assert.ok(src.includes('chatSystem'), `${file} нь chatSystem ашиглах ёстой`);
    assert.ok(src.includes('MEMORY_UPDATE_SYSTEM'), `${file} нь санах ойг шинэчилж чадах ёстой`);
  }
});

// ── Идэвхийн бүртгэл ────────────────────────────────────────────────────

test('нэг өдөрт олон мессеж бичсэн ч нэг л өдөр тоологдоно', () => {
  const session = emptySession();
  touchActivity(session);
  touchActivity(session);
  touchActivity(session);
  assert.equal(session.activeDays.length, 1, 'нэг өдөр = нэг бичлэг');
  assert.equal(session.messageCount, 3, 'мессеж тус бүр тоологдоно');
});

test('өмнөх өдрүүдийн бүртгэл хадгалагдана', () => {
  const session = { ...emptySession(), activeDays: ['2026-01-01', '2026-01-02'] };
  touchActivity(session);
  assert.equal(session.activeDays.length, 3);
  assert.equal(session.activeDays[0], '2026-01-01', 'хуучин өдрүүд үлдэнэ');
});

// ── Тестийн асуултууд ───────────────────────────────────────────────────

test('хариултыг кирилл, латин, тоогоор таних', () => {
  assert.equal(matchAnswer(0, 'А').key, 'А');
  assert.equal(matchAnswer(0, 'а').key, 'А');
  assert.equal(matchAnswer(0, 'a').key, 'А'); // латин a
  assert.equal(matchAnswer(0, '2').key, 'Б');
  assert.equal(matchAnswer(0, 'c').key, 'В');
  assert.equal(matchAnswer(0, 'зззз'), null);
});

test('асуулт бүр Messenger-ийн хязгаарт багтана', () => {
  assert.equal(TOTAL, QUESTIONS.length);
  for (let i = 0; i < TOTAL; i++) {
    const { text, quickReplies } = renderQuestion(i);
    assert.ok(text.length < 640, `${i + 1}-р асуулт хэт урт`);
    assert.ok(quickReplies.length <= 13, 'quick reply хэт олон');
    for (const reply of quickReplies) {
      assert.ok(reply.title.length <= 20, `товчны гарчиг хэт урт: ${reply.title}`);
    }
  }
});
