import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../lib/config.js';
import {
  BASE_RULES,
  MONEY_SILENCE,
  VOICE,
  FREE_ANALYST_SYSTEM,
  REPORT_CORE_SYSTEM,
  REPORT_APPLIED_SYSTEM,
  MEMORY_UPDATE_SYSTEM,
  guideSystem,
  chatSystem,
} from '../lib/prompts.js';
import { giftAnswer, shareNudge, giftThanks, shareAnswer, giftUnclear } from '../lib/gift.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * АРХИТЕКТУРЫН БАТАЛГАА.
 *
 * Хэрэглэгчийн гол шаардлага: «мөнгө бүр нэхэхгүй, тааруухан мэдрэмжийг
 * ерөөсөө төрүүлэхгүй». Үүнийг сайн санаанд найдаж биш, БҮТЦЭЭР баталгаажуулна:
 *
 *   · Дансны мэдээлэл ЗӨВХӨН lib/gift.js дотор байна.
 *   · giftAnswer() -г ЗӨВХӨН handleGiftAsk() дуудна.
 *   · handleGiftAsk() -г ЗӨВХӨН asksAboutGift() үнэн байхад дуудна.
 *   · AI загварын бүх системийн prompt мөнгө дурдахыг ХОРИГЛОСОН байна.
 *
 * Хэрэв хэн нэгэн ирээдүйд «жаахан сануулга нэмье» гэвэл энэ тестүүд унана.
 */

// ── 1. Данс хаана байж болох вэ ─────────────────────────────────────────

test('дансны дугаар эх кодод зөвхөн зөвшөөрөгдсөн газар байна', () => {
  const account = config.bankAccount;
  assert.ok(account.length >= 6, 'тестэд ашиглах данс хэт богино байна');

  const mustNotContain = [
    'lib/flow.js',
    'lib/prompts.js',
    'lib/claude.js',
    'lib/openai.js',
    'lib/messenger.js',
    'lib/quiz.js',
    'lib/store.js',
    // ⚠️ Вэб хуудсанд данс ХЭЗЭЭ Ч байхгүй. Данс нь зөвхөн чат дотор,
    //    зөвхөн хүн өөрөө асуусан үед л харагдана.
    'public/index.html',
    'public/privacy.html',
    'public/terms.html',
    'public/data-deletion.html',
  ];

  for (const path of mustNotContain) {
    assert.ok(
      !read(path).includes(account),
      `${path} дотор дансны дугаар байх ЁСГҮЙ — зөвхөн lib/gift.js данс харуулна`,
    );
  }
});

test('үнийн шошго эх кодод үлдээгүй', () => {
  // Хуучин хувилбарын үлдэгдэл — «19,900₮», «PRICE_LABEL» гэх мэт.
  for (const path of ['lib/flow.js', 'lib/prompts.js', 'lib/claude.js', 'public/index.html']) {
    const src = read(path);
    assert.ok(!/19[.,\s]?900/.test(src), `${path} дотор хуучин үнэ үлдсэн байна`);
    assert.ok(!src.includes('priceLabel'), `${path} дотор priceLabel үлдсэн байна`);
    assert.ok(!src.includes('priceAmount'), `${path} дотор priceAmount үлдсэн байна`);
  }
});

// ── 2. Бэлгийн текст рүү хүрэх цорын ганц зам ───────────────────────────

test('giftAnswer()-ийг зөвхөн handleGiftAsk() дуудна', () => {
  const flow = read('lib/flow.js');
  const calls = flow.match(/giftAnswer\(\)/g) ?? [];
  assert.equal(calls.length, 1, 'giftAnswer() яг нэг л газраас дуудагдах ёстой');

  // Тэр ганц дуудлага handleGiftAsk() функцийн дотор байх ёстой
  const fn = flow.slice(flow.indexOf('async function handleGiftAsk'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  assert.ok(body.includes('giftAnswer()'), 'giftAnswer() нь handleGiftAsk дотор байх ёстой');
});

test('handleGiftAsk()-ийг зөвхөн asksAboutGift() шалгасны дараа дуудна', () => {
  const flow = read('lib/flow.js');
  // Функцийн ТОДОРХОЙЛОЛТЫГ тооцохгүй — зөвхөн дуудлагыг
  const calls = flow.match(/(?<!function )handleGiftAsk\(psid, session\)/g) ?? [];
  assert.equal(calls.length, 1, 'handleGiftAsk яг нэг л газраас дуудагдах ёстой');

  // Дуудлагын мөрийн ӨМНӨХ хамгаалалт хоёуланг шалгасан байх ёстой
  const at = flow.indexOf('return handleGiftAsk(psid, session)');
  assert.ok(at > 0, 'дуудлагын мөр олдсонгүй');

  const guardBlock = flow.slice(Math.max(0, at - 200), at);
  assert.ok(guardBlock.includes('asksAboutGift(text)'), 'asksAboutGift шалгалт байх ёстой');
  assert.ok(guardBlock.includes('!isHeavyMoment(text)'), 'хүнд мөчийн хамгаалалт байх ёстой');
});

test('lib/flow.js доторх илгээгдэх текстэд мөнгөний үг байхгүй', () => {
  // Тайлбар мөрүүдийг хасна — зөвхөн БОДИТООР илгээгдэх текстийг шалгана.
  const code = read('lib/flow.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /**
   * Цорын ганц зөвшөөрөгдсөн мөр — мэндчилгээн дэх «Төлбөргүй, бүртгэлгүй.»
   * Энэ нь мөнгө гуйхын ЭСРЭГ: хүмүүс хуучин төлбөртэй хувилбарыг санаж
   * «дараа нь мөнгө нэхэх байх» гэж эргэлздэг тул түүнийг нь эхэндээ арилгана.
   */
  const ALLOWED = 'Төлбөргүй, бүртгэлгүй';

  const moneyWords = ['мөнгө', 'төлбөр', 'төлөх', 'данс', 'хандив', 'төгрөг', '₮', 'үнэтэй'];
  const offenders = code
    .split('\n')
    .map((line, i) => [i + 1, line.trim()])
    .filter(([, line]) => !line.includes(ALLOWED))
    .filter(([, line]) => moneyWords.some((w) => line.toLowerCase().includes(w)));

  assert.deepEqual(
    offenders,
    [],
    'flow.js-ийн илгээгдэх текстэд мөнгөний үг орж ирлээ — бүх мөнгөний текст lib/gift.js дотор байх ёстой',
  );
});

test('зөөлөн сануулга мөнгө дурдахгүй — зөвхөн хуваалцах', () => {
  const nudge = shareNudge();
  for (const word of ['данс', 'мөнгө', 'төгрөг', 'төлбөр', 'хандив', config.bankAccount]) {
    assert.ok(!nudge.includes(word), `зөөлөн сануулгад «${word}» байх ЁСГҮЙ`);
  }
  assert.ok(nudge.includes('хэлээрэй') || nudge.includes('яриарай'), 'хуваалцахыг санал болгоно');
});

test('талархал дүн дурдахгүй', () => {
  const thanks = giftThanks();
  assert.ok(!/\d{3,}/.test(thanks), 'талархалд тоон дүн байх ЁСГҮЙ');
  assert.ok(!thanks.includes('₮'), 'талархалд төгрөгийн тэмдэг байх ЁСГҮЙ');
  // Нэмэлт эрх нээгддэггүй гэдгийг тодорхой хэлнэ
  assert.ok(thanks.includes('өөрчлөгдөхгүй'), 'юу ч өөрчлөгдөхгүй гэдгийг хэлэх ёстой');
});

test('бэлгийн хариулт эхлээд ЧӨЛӨӨЛНӨ, дараа нь л данс харуулна', () => {
  const answer = giftAnswer();
  const freeAt = answer.indexOf('үнэгүй');
  const accountAt = answer.indexOf(config.bankAccount);

  assert.ok(freeAt >= 0, '«үнэгүй» гэж хэлэх ёстой');
  assert.ok(accountAt > freeAt, 'данс нь «үнэгүй» гэсэн мэдээллийн ДАРАА байх ёстой');
  assert.ok(answer.includes('өргүй'), '«чи надад юу ч өргүй» гэж чөлөөлөх ёстой');
  assert.ok(answer.includes('өгөө авъяа'), 'соёлын хэллэг байх ёстой');
  assert.ok(
    answer.includes('Огт өгөхгүй байсан ч'),
    'огт өгөхгүй байх сонголтыг тодорхой хэлэх ёстой',
  );
  assert.ok(answer.includes('хуваалцах') || answer.includes('хэлээрэй'), 'хуваалцахыг дурдана');
  assert.ok(!/\b\d{1,3}[.,]?\d{3}\s*₮/.test(answer), 'тодорхой үнэ байх ЁСГҮЙ');
});

test('бэлэг тодорхойгүй үед буруутгахгүй', () => {
  const text = giftUnclear();
  for (const word of ['дахин илгээ', 'буруу', 'таарахгүй', 'шаардлагатай']) {
    assert.ok(!text.includes(word), `татгалзсан өнгө аяс байх ЁСГҮЙ: ${word}`);
  }
});

test('хуваалцах хариулт дарамтгүй', () => {
  assert.ok(!shareAnswer().includes('заавал'), 'хуваалцахыг шаардаж болохгүй');
});

// ── 3. AI загвар мөнгө дурдахыг хориглосон эсэх ─────────────────────────

test('бүх системийн prompt мөнгөний чимээгүй байдлыг өвлөнө', () => {
  const marker = 'ХЭЗЭЭ Ч БҮҮ ДУРД';
  assert.ok(MONEY_SILENCE.includes(marker), 'MONEY_SILENCE дүрэм өөрөө байх ёстой');
  assert.ok(BASE_RULES.includes(marker), 'BASE_RULES дотор багтсан байх ёстой');

  const withProfile = { profile: { type_name: 'x' }, chatHistory: [] };
  const prompts = {
    FREE_ANALYST_SYSTEM,
    REPORT_CORE_SYSTEM,
    REPORT_APPLIED_SYSTEM,
    'guideSystem': guideSystem(withProfile),
    'chatSystem (профайлтай)': chatSystem(withProfile),
    'chatSystem (профайлгүй)': chatSystem({ profile: null, chatHistory: [] }),
  };

  for (const [name, prompt] of Object.entries(prompts)) {
    assert.ok(prompt.includes(marker), `${name} дотор мөнгөний хоригийг өвлөх ёстой`);
    assert.ok(!prompt.includes(config.bankAccount), `${name} дотор данс байх ЁСГҮЙ`);
  }

  // Санах ойн prompt нь хэрэглэгчтэй ЯРИХГҮЙ тул MONEY_SILENCE-ийг өвлөхгүй.
  // Харин данс тэмдэглэлд орохоос сэргийлж хувийн мэдээллийн хоригтой байна.
  assert.ok(!MEMORY_UPDATE_SYSTEM.includes(config.bankAccount));
  assert.ok(
    MEMORY_UPDATE_SYSTEM.includes('картын дугаар'),
    'санах ой хувийн мэдээлэл хадгалахыг хориглох ёстой',
  );
});

// ── 4. Хүн шиг дуу хоолой бүх prompt-д хүрсэн эсэх ──────────────────────

test('эргэлзээ илэрхийлэх заавар бүх prompt-д байна', () => {
  assert.ok(VOICE.includes('100% үнэн биш байж магадгүй'), 'эргэлзээний хэллэг байх ёстой');
  assert.ok(VOICE.includes('ЭРГЭЛЗЭЭГЭЭ НУУХГҮЙ'));
  assert.ok(VOICE.includes('ЗӨВЛӨГӨӨ БИШ'), 'асуулт асуух зарчим байх ёстой');
  assert.ok(BASE_RULES.includes('ХАЖУУД НЬ СУУЖ БАЙГАА ХҮН'), 'хөтөчийн үүрэг байх ёстой');

  for (const prompt of [FREE_ANALYST_SYSTEM, guideSystem({ profile: null }), chatSystem({ profile: null })]) {
    assert.ok(prompt.includes('магадгүй'), 'зөөлрүүлэх заавар байх ёстой');
  }
});

test('аюулгүй байдлын дүрэм бүх prompt-д байна', () => {
  assert.ok(BASE_RULES.includes('Онош ХЭЗЭЭ Ч тавихгүй'));
  assert.ok(BASE_RULES.includes(config.helpline), 'тусламжийн мэдээлэл байх ёстой');
});
