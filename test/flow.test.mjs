import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../lib/config.js';
import { set, getSession, emptySession, touchActivity } from '../lib/store.js';
import { formatFullReport } from '../lib/report.js';
import { matchAnswer, QUESTIONS, TOTAL, renderQuestion } from '../lib/quiz.js';

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

  // Тайлан нь хадгалагдсан хэвээр
  assert.deepEqual(session.fullReport, { personality: 'x' });

  // Зарах зорилготой байсан «teaser» нь «noticed» болсон
  assert.deepEqual(session.profile.noticed, ['a', 'b', 'c']);

  // Шинэ талбарууд анхдагч утгатай орж ирсэн
  assert.deepEqual(session.activeDays, []);
  assert.equal(session.shareNudgedAt, null);
});

test('гацсан «paid_pending» төлөв сэргэнэ', async () => {
  await set('u:stuck', { ...emptySession(), state: 'paid_pending', paid: true });
  const session = await getSession('stuck');
  assert.equal(session.state, 'report_pending', 'шинэ нэртэй төлөв рүү шилжинэ');
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

// ── Тайланг Messenger-т бэлдэх ──────────────────────────────────────────

const profile = { emoji: '🌱', type_name: 'Тайван ажиглагч', summary: 's' };
const report = {
  personality: 'Зан чанарын дэлгэрэнгүй тайлбар.',
  strengths: ['Нэгдүгээр хүч', 'Хоёрдугаар хүч', 'Гуравдугаар хүч'],
  weaknesses: 'Сул тал.',
  hidden_potential: 'Далд боломж.',
  relationship_style: 'Харилцаа.',
  communication: 'Ярианы хэв маяг.',
  career: 'Ажлын орчин.',
  stress: 'Стресс.',
  growth_tips: ['Эхний алхам', 'Хоёр дахь алхам'],
  mirror_questions: ['Юу мэдэрсэн бэ?', 'Хэзээ ингэж эхэлсэн бэ?', 'Одоо юу хэрэгтэй вэ?'],
};

test('тайлан хэд хэдэн мессеж болж хуваагдана', () => {
  const messages = formatFullReport(profile, report);
  assert.ok(Array.isArray(messages), 'массив буцаах ёстой');
  assert.ok(messages.length >= 5, `хангалттай хуваагдаагүй: ${messages.length}`);

  // Бүх агуулга хаа нэгтээ байх ёстой
  const all = messages.join('\n');
  for (const piece of [
    report.personality,
    report.weaknesses,
    report.hidden_potential,
    report.career,
    ...report.strengths,
    ...report.growth_tips,
    ...report.mirror_questions,
  ]) {
    assert.ok(all.includes(piece), `тайлангаас алдагдсан: ${piece}`);
  }
});

test('тайлан хүнд шууд хандсан гарчигтай', () => {
  const [first] = formatFullReport(profile, report);
  assert.ok(first.includes('ЧИНИЙ'), 'хүнд шууд хандах ёстой («ТАНЫ» биш)');
  assert.ok(first.includes(profile.type_name));
});

test('толин тусгалын асуултууд хариулт шаардахгүй', () => {
  const messages = formatFullReport(profile, report);
  const last = messages[messages.length - 1];
  assert.ok(last.includes('хариулах шаардлагагүй'), 'дарамт үүсгэхгүй байх ёстой');
});

test('mirror_questions байхгүй бол тайлан бүтэн хэвээр', () => {
  const messages = formatFullReport(profile, { ...report, mirror_questions: [] });
  assert.ok(messages.length >= 5);
  assert.ok(!messages.join('').includes('ҮЛДЭЭХ 3 АСУУЛТ'));
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
