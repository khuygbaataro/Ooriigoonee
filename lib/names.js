/**
 * Монгол нэрийг КИРИЛЛ/ЛАТИН ялгаагүй харьцуулах.
 *
 * Яагаад хэрэгтэй вэ: хэрэглэгч гүйлгээний утга дээр Facebook нэрээ бичнэ.
 * Facebook дээр «Хуягбаатар Очирхуяг» гэж кириллээр бичсэн байхад банкны
 * аппад «khuygbaatar ochirkhuyg» гэж латинаар бичих нь энгийн үзэгдэл.
 * Латин галиглал нь нэг мөр биш (Х → kh/h, Ө → o/u, Ү → u, Ц → ts, Ч → ch)
 * тул шууд харьцуулбал жинхэнэ төлбөрийг буруу татгалзана.
 *
 * Тиймээс хоёр талыг ижил «хялбаршуулсан» хэлбэрт оруулж харьцуулна:
 *   1. Кирилл → латин галиглал
 *   2. Хос үсгийг нэгтгэх (kh→h, ch→c, ts→c, sh→s, zh→j, ya→a …)
 *   3. Эгшгийг нэг ангид оруулах (a/e/i/o/u/y → a) — Ө, Ү-гийн зөрүүг арилгана
 *   4. Давхар үсгийг ганц болгох (baatar → batar)
 */

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Латин талын хос үсгийг кириллийн галиглалтай ижил болгоно. */
const DIGRAPHS = [
  ['kh', 'h'],
  ['ch', 'c'],
  ['ts', 'c'],
  ['sh', 's'],
  ['zh', 'j'],
  ['yo', 'o'],
  ['yu', 'u'],
  ['ya', 'a'],
];

/** Харьцуулахад итгэл төрүүлэхүйц хамгийн богино урт. */
const MIN_TOKEN = 4;

function simplify(word) {
  let out = word;
  for (const [from, to] of DIGRAPHS) out = out.split(from).join(to);
  out = out.replace(/[aeiouy]/g, 'a'); // эгшгийн ангиллыг нэгтгэнэ
  out = out.replace(/(.)\1+/g, '$1'); // давхар үсгийг ганц болгоно
  return out;
}

/** Нэрийг харьцуулахад бэлэн үг болгон хуваана. */
export function nameTokens(raw) {
  const latin = String(raw ?? '')
    .toLowerCase()
    .split('')
    .map((ch) => (ch in CYRILLIC ? CYRILLIC[ch] : ch))
    .join('');

  return latin
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(simplify)
    .filter((token) => token.length >= MIN_TOKEN);
}

/** Хоёр үг эхнээсээ таарч байвал нэг нэр гэж үзнэ. */
function tokenMatch(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < MIN_TOKEN) return false;
  return a.slice(0, n) === b.slice(0, n);
}

/**
 * Хүлээгдэж буй нэрийн ЯМАР НЭГ үг харагдсан текстэд байвал таарсанд тооцно.
 *
 * @returns {'match'|'mismatch'|'unknown'} unknown = шалгах боломжгүй
 *   (нэр богино, эсвэл Facebook профайл татагдаагүй) — энэ үед ТАТГАЛЗАХГҮЙ.
 */
export function matchName(expected, seen) {
  const wanted = nameTokens(expected);
  if (!wanted.length) return 'unknown';

  const found = nameTokens(seen);
  if (!found.length) return 'mismatch';

  const hit = wanted.some((w) => found.some((f) => tokenMatch(w, f)));
  return hit ? 'match' : 'mismatch';
}
