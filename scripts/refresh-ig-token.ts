/**
 * scripts/refresh-ig-token.ts — 인스타그램 장기 토큰 자동 갱신 (2026-08-11).
 *
 * Instagram Login 경로의 장기 토큰은 60일 만료 — 방치하면 게시 버튼이 조용히 죽는다
 * (실제로 7/3 발급분이 9/1경 만료 예정이었음). 매주 refresh_access_token을 호출해
 * 만료를 60일씩 연장하고 .env를 갱신한다. 토큰이 24시간 이상 지난 뒤에만 갱신 가능(API 제약).
 *
 * 실행: scripts/refresh-ig-token.sh (launchd com.news-digest.ig-refresh, 월 05:30
 *       — .env 로드 + 성공 시 웹 서버 재기동으로 새 토큰 반영)
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { sendTelegram } from '../src/lib/telegram';

async function main() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    console.log('INSTAGRAM_ACCESS_TOKEN 미설정 — 갱신 건너뜀');
    return;
  }
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(20_000) },
  );
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!j.access_token) {
    const msg = j.error?.message ?? JSON.stringify(j).slice(0, 150);
    console.error('[ig-refresh] 갱신 실패:', msg);
    await sendTelegram(`⚠️ 인스타그램 토큰 갱신 실패 — ${msg}\n만료 전 수동 재발급이 필요할 수 있습니다 (Instagram Login 재인증).`);
    process.exitCode = 1;
    return;
  }
  const days = j.expires_in ? Math.floor(j.expires_in / 86_400) : 60;

  // .env의 토큰 라인 교체 — 백업은 output/(gitignored)에
  const envPath = join(process.cwd(), '.env');
  copyFileSync(envPath, join(process.cwd(), 'output', `.env.bak-igrefresh`));
  const env = readFileSync(envPath, 'utf8');
  if (!/^INSTAGRAM_ACCESS_TOKEN=/m.test(env)) throw new Error('.env에 INSTAGRAM_ACCESS_TOKEN 라인 없음');
  writeFileSync(envPath, env.replace(/^INSTAGRAM_ACCESS_TOKEN=.*$/m, `INSTAGRAM_ACCESS_TOKEN=${j.access_token}`));

  console.log(`[ig-refresh] 갱신 완료 — 만료 ${days}일 연장`);
  await sendTelegram(`🔑 인스타그램 토큰 자동 갱신 완료 — 만료 ${days}일 연장 (다음 갱신: 다음 주 월요일 05:30)`);
}

main().catch(async (e) => {
  console.error('[ig-refresh] fatal:', e);
  await sendTelegram(`⚠️ 인스타그램 토큰 갱신 스크립트 오류: ${e instanceof Error ? e.message.slice(0, 150) : e}`);
  process.exitCode = 1;
});
