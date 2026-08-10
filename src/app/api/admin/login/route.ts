/**
 * GET /api/admin/login?token=<ADMIN_TOKEN> — 관리자 기기 인증 (2026-08-10).
 * 터널(공개 도메인) 경유 변경 요청은 middleware가 차단하므로, 소유자 기기는 이 URL을
 * 한 번 열어 HttpOnly 쿠키(nd_admin, 1년)를 받는다. 이후 카드뉴스 생성·텔레그램 전송·
 * 인스타 게시 버튼이 그 기기에서 정상 동작한다. 토큰은 .env ADMIN_TOKEN(비밀) 전용.
 */

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return NextResponse.json({ error: 'ADMIN_TOKEN 미설정 — .env에 추가 후 서버 재시작 필요' }, { status: 500 });
  if (token !== expected) return NextResponse.json({ error: '잘못된 토큰' }, { status: 401 });

  const res = NextResponse.redirect(
    new URL('/cardnews?ok=' + encodeURIComponent('관리자 인증 완료 — 이 기기에서 생성·전송·게시 버튼을 사용할 수 있습니다'), req.url),
  );
  res.cookies.set('nd_admin', expected, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  return res;
}
