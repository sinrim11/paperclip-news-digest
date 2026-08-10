/**
 * GET /api/build-id — 현재 서버의 Next 빌드 ID (2026-08-10).
 * BuildGuard(클라이언트)가 주기 폴링해 재배포를 감지 — 열린 탭의 서버 액션 ID가
 * 무효화되면("Failed to find Server Action") 새로고침 배너를 띄우기 위함.
 */

import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  let buildId = 'dev';
  try {
    buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf-8').trim();
  } catch {
    /* dev 모드 등 BUILD_ID 부재 — 'dev' 고정이면 배너가 뜨지 않는다 */
  }
  return NextResponse.json({ buildId });
}
