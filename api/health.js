import { configReport } from '../lib/config.js';

/** Тохиргоо бүрэн эсэхийг шалгах — deploy хийсний дараа эхлээд үүнийг нээ. */
export async function GET() {
  return new Response(
    JSON.stringify(
      {
        ok: true,
        service: 'messenger-ai-personality-bot',
        time: new Date().toISOString(),
        env: configReport(),
      },
      null,
      2,
    ),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}
