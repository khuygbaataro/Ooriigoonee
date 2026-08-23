# 🧠 Messenger AI зан чанарын чатбот

Facebook Messenger дээр ажиллах AI чатбот. 10 асуултын тест → Claude-аар анализ →
үнэгүй үр дүн → төлбөртэй бүрэн профайл. Vercel serverless дээр ажиллана.

```
Facebook Messenger
      │  webhook (POST /api/webhook)
      ▼
Vercel Node.js function ──► Upstash Redis (хэрэглэгчийн төлөв)
      │
      ├──► Claude (Anthropic)  →  анализ, тооцоолол, бүрэн тайлан
      └──► OpenAI              →  чөлөөт харилцаа, чат
      │
      ▼
Messenger Send API  →  хэрэглэгч рүү хариу
```

---

## 📁 Файлын бүтэц

| Зам | Үүрэг |
|---|---|
| `api/webhook.js` | Messenger webhook — GET баталгаажуулалт + POST event |
| `api/health.js` | Тохиргоо бүрэн эсэхийг шалгах |
| `api/setup.js` | Get Started товч, мэндчилгээ, доод цэс суулгах |
| `api/admin.js` | Төлбөр гараар баталгаажуулах, session харах |
| `api/payment-callback.js` | Төлбөрийн системээс ирэх сервер-сервер мэдэгдэл |
| `api/data-deletion.js` | Facebook-ийн өгөгдөл устгах callback (App Review-д заавал) |
| `lib/flow.js` | Ярианы бүх логик (төлөвт суурилсан машин) |
| `lib/claude.js` | **Claude API** — анализ, тайлан үүсгэх |
| `lib/openai.js` | **OpenAI API** — чөлөөт харилцаа |
| `lib/prompts.js` | AI-ийн knowledge base, системийн prompt-ууд |
| `lib/quiz.js` | 10 асуулт |
| `lib/messenger.js` | Facebook Send API |
| `lib/store.js` | Upstash Redis (санах ойн fallback-тай) |
| `public/` | Вэбсайт — нүүр, нууцлал, нөхцөл, өгөгдөл устгах, төлбөр |

---

## 🚀 Суулгах — 6 алхам

### 1. GitHub руу оруулах

```bash
git add -A && git commit -m "init: messenger ai chatbot" && git branch -M main
```

Дараа нь GitHub дээр шинэ repo үүсгээд:

```bash
git remote add origin https://github.com/<хэрэглэгч>/<repo>.git && git push -u origin main
```

### 2. Upstash Redis үүсгэх (заавал)

Vercel serverless функц бүр шинээр эхэлдэг тул хэрэглэгчийн төлөвийг
санах ойд хадгалж болохгүй.

Vercel → **Storage** → **Upstash Redis** → Create → төслөө холбоно.
`KV_REST_API_URL` ба `KV_REST_API_TOKEN` автоматаар нэмэгдэнэ.

### 3. Vercel дээр deploy хийх

[vercel.com/new](https://vercel.com/new) → GitHub repo сонгох → Deploy.
Framework: **Other**. Build command хэрэггүй.

Дараа нь **Settings → Environment Variables** дээр `.env.example` доторх
хувьсагчдыг бүгдийг нэмнэ (Production + Preview хоёуланд нь).

Нэмсэн бол дахин deploy хийж, шалгана:

```
https://<your-app>.vercel.app/api/health
```

Бүх талбар `true` байх ёстой.

### 4. Facebook App тохируулах

[developers.facebook.com](https://developers.facebook.com) → **Create App** →
төрөл нь **Business** → **Messenger** бүтээгдэхүүнийг нэмнэ.

**a) Хуудсаа холбож token авах**
Messenger → Settings → **Access Tokens** → хуудсаа сонгоод
**Generate Token** → энэ утгыг `PAGE_ACCESS_TOKEN` болгож Vercel-д хийнэ.

**b) Webhook холбох**
Messenger → Settings → **Webhooks** → **Add Callback URL**

| Талбар | Утга |
|---|---|
| Callback URL | `https://<your-app>.vercel.app/api/webhook` |
| Verify Token | `VERIFY_TOKEN`-д бичсэн утгаа яг хуулна |

**Verify and Save** дарна. Амжилттай бол ✅ гарна.

**c) Subscription fields**
Хуудасныхаа хажууд **Add Subscriptions** → дараахыг сонгоно:
`messages`, `messaging_postbacks`, `messaging_optins`, `message_deliveries` (сонголтоор)

**d) App Secret**
Settings → Basic → **App Secret** → Show → `APP_SECRET` болгож хийнэ.
(Энэ нь webhook-ийн гарын үсэг шалгахад хэрэгтэй — заавал.)

**e) Нууцлалын холбоосууд**
Settings → Basic дээр:

| Талбар | Утга |
|---|---|
| Privacy Policy URL | `https://<your-app>.vercel.app/privacy` |
| Terms of Service URL | `https://<your-app>.vercel.app/terms` |
| User Data Deletion → **Data Deletion Request URL** | `https://<your-app>.vercel.app/api/data-deletion` |

### 5. Messenger-ийн цэс суулгах

Deploy дууссаны дараа **нэг удаа** дуудна:

```
https://<your-app>.vercel.app/api/setup?secret=<ADMIN_SECRET>
```

Ингэснээр «Get Started» товч, мэндчилгээний текст, доод цэс суулгагдана.

### 6. Тест хийх

Facebook хуудсандаа орж чат нээгээд `1` гэж бичнэ.
(App нь Development горимд байгаа үед зөвхөн **Admin / Developer / Tester**
эрхтэй хүмүүс ботыг ашиглаж чадна.)

Олон нийтэд нээхийн тулд **App Review** → `pages_messaging` эрх хүсэх шаардлагатай.

---

## 🔑 Орчны хувьсагчид

`.env.example`-ийг хараарай. Хамгийн чухлууд:

| Хувьсагч | Тайлбар |
|---|---|
| `PAGE_ACCESS_TOKEN` | Facebook хуудасны token |
| `VERIFY_TOKEN` | Webhook баталгаажуулах — өөрөө зохионо |
| `APP_SECRET` | Гарын үсэг шалгах |
| `ANTHROPIC_API_KEY` | Claude — анализ |
| `OPENAI_API_KEY` | OpenAI — харилцаа |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis |
| `SITE_URL` | Вэбсайтын хаяг |
| `PAYMENT_URL` | Төлбөрийн холбоос |
| `ADMIN_SECRET` | Админ endpoint-уудын түлхүүр |

---

## 💳 Төлбөрийн урсгал

1. Хэрэглэгч «Бүрэн анализ» товч дарна.
2. Систем санамсаргүй **захиалгын код** үүсгэж Redis-д `order:<код> → PSID`
   гэж хадгална. PSID нь URL-д ордоггүй (нууцлал).
3. Хэрэглэгч `PAYMENT_URL?order=<код>` руу очиж төлнө.
4. Төлбөр баталгаажсаны дараа **аль нэг** аргаар тайланг илгээнэ:

**A. Гараар (эхэндээ хамгийн хялбар)**

```
https://<your-app>.vercel.app/api/admin?secret=<ADMIN_SECRET>&action=grant&order=<код>
```

**B. Автоматаар** — төлбөрийн системээсээ webhook тохируулна:

```
POST https://<your-app>.vercel.app/api/payment-callback
Header: x-admin-secret: <ADMIN_SECRET>
Body:   { "order": "<код>", "status": "paid" }
```

> ⚠️ `payment-callback`-ийн URL-д нууц түлхүүрээ тавиад хэрэглэгчийн browser
> руу redirect хийж болохгүй — түлхүүр задарна. Зөвхөн сервер-сервер дуудлагад.

---

## 🧪 Локал хөгжүүлэлт

```bash
npm install
```

```bash
npx vercel dev
```

Webhook-ийг локалаас туршихад тунель хэрэгтэй:

```bash
npx localtunnel --port 3000
```

Гарсан HTTPS хаягийг Facebook-ийн Callback URL болгож түр хийнэ.

---

## ⚙️ Юуг хаанаас өөрчлөх вэ?

| Юу | Хаана |
|---|---|
| 10 асуулт | `lib/quiz.js` |
| Ботын мэндчилгээ, upsell текст | `lib/flow.js` (дээд талын тогтмолууд) |
| AI-ийн зан төлөв, брэндийн дуу хоолой | `lib/prompts.js` |
| Тайлангийн бүтэц | `lib/prompts.js` → `ANALYST_SYSTEM` ба `lib/claude.js` → `formatFullReport` |
| Үнэ | `PRICE_LABEL` орчны хувьсагч |
| Үнэгүй чатын хязгаар | `FREE_CHAT_LIMIT` |

---

## 💰 Загварын сонголт ба зардал

`ANTHROPIC_MODEL` анхдагчаар `claude-opus-5` (хамгийн ухаалаг).
Зардлаа бууруулахыг хүсвэл:

```
ANTHROPIC_MODEL=claude-sonnet-5
ANTHROPIC_EFFORT=low
```

`ANTHROPIC_EFFORT` нь `low | medium | high | xhigh | max` — өндөр байх тусам
гүнзгий боловч удаан, үнэтэй. Анхдагч `medium`.

Claude-ийн хүсэлтэд сервер талын **fallback** идэвхжүүлсэн — загвар
татгалзвал автоматаар өөр загвар руу шилжинэ. Хэрэв таны бүртгэлд энэ beta
боломж байхгүй бол код өөрөө энгийн хүсэлт рүү буцаж ажиллана.

---

## 🔒 Аюулгүй байдал

- Webhook бүрийг `X-Hub-Signature-256` HMAC гарын үсгээр шалгана.
- Facebook-ийн давхардсан event-ийг Redis дээрх `SET NX` түгжээгээр шүүнэ.
- Админ endpoint-ууд `timingSafeEqual`-аар түлхүүр шалгана.
- PSID URL-д хэзээ ч ордоггүй — оронд нь түр захиалгын код ашиглана.
- Хэрэглэгч чатад «устгах» гэж бичээд бүх өгөгдлөө устгуулж чадна.

---

## 📋 Deploy хийхээс өмнө шалгах жагсаалт

- [ ] `public/index.html`, `public/payment.html` доторх `YOUR_PAGE`-г
      Facebook хуудасныхаа нэрээр солисон
- [ ] `hello@example.com`-г бодит имэйлээрээ солисон
- [ ] `public/privacy.html` дээрх «[Байгууллага / хувь хүний нэрээ бичнэ үү]»-г бөглөсөн
- [ ] `public/payment.html` дээрх банкны мэдээллийг бөглөсөн
- [ ] Vercel дээр бүх орчны хувьсагч нэмэгдсэн
- [ ] `/api/health` бүх талбар `true`
- [ ] `/api/setup?secret=...` нэг удаа дуудсан
- [ ] Facebook дээр webhook ✅ болсон, subscription талбарууд сонгогдсон
