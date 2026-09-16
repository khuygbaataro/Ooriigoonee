/**
 * Тайланг Messenger-т бэлдэх — ЦЭВЭР функц.
 *
 * Зориуд lib/claude.js-ээс тусад нь гаргасан: энд ямар ч API дуудлага,
 * ямар ч SDK хамаарал байхгүй тул тест шууд ажиллана.
 */

/**
 * Тайланг ХЭДЭН МЕССЕЖЭЭР буцаана — нэг урт блок биш.
 *
 * Яагаад вэ: Messenger 2000 тэмдэгтээр таслахад бүлэг дундуур тасардаг.
 * Мөн хүн 10 бүлгийг нэг дор уншихгүй. Сэдвээр нь бүлэглээд тусад нь
 * илгээхэд хүн бичиж байгаа мэт мэдрэгдэж, уншихад ч хялбар болно.
 *
 * @returns {string[]} дараалан илгээх мессежүүд
 */
export function formatFullReport(profile, report) {
  const list = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n\n');
  const bullets = (items) => items.map((item) => `• ${item}`).join('\n\n');

  const messages = [
    `${profile.emoji} ЧИНИЙ БҮРЭН ДҮР ЗУРАГ
«${profile.type_name}»

${report.personality}`,

    `💪 ЧИНИЙ ГОЛ ХҮЧ

${list(report.strengths)}`,

    `🌒 АНЗААРДАГГҮЙ ТАЛ

${report.weaknesses}

🧠 СТРЕССТЭЙ ҮЕД
${report.stress}`,

    `❤️ ОЙР ДОТНЫ ХАРИЛЦААНД
${report.relationship_style}

🗣️ ХҮМҮҮСТЭЙ ХАРИЛЦАХ АРГА
${report.communication}

💼 АЖИЛ, ОРЧИН
${report.career}`,

    `🔥 ХАРААХАН АНЗААРААГҮЙ БОЛОМЖ

${report.hidden_potential}

📈 МАРГААШААС ЭХЛЭЭД ХИЙЖ БОЛОХ ЗҮЙЛС

${list(report.growth_tips)}`,
  ];

  if (report.mirror_questions?.length) {
    messages.push(`🪞 ЧАМД ҮЛДЭЭХ 3 АСУУЛТ

Эдгээрт одоо хариулах шаардлагагүй. Зүгээр л хэдэн өдөр дотроо аваад яв.

${bullets(report.mirror_questions)}`);
  }

  return messages.filter((m) => m.trim().length > 20);
}
