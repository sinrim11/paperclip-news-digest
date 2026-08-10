/**
 * 보안 완화 미들웨어 (2026-07-08) — makeagent.dev 터널이 앱 전체를 공개 프록시하는 동안의 임시 방어.
 *
 * 정책: 터널(Cloudflare) 경유 요청은 조회(GET/HEAD/OPTIONS)만 허용, 변경성 메서드(POST 등)는 403.
 *  - 서버 액션(재무 프로필 수정·인스타 게시·텔레그램 전송)과 트리거성 API(cron/digest/collectors)가
 *    모두 POST이므로 단일 관문으로 커버.
 *  - 판별: cloudflared가 원본에 붙이는 cf-ray / cf-connecting-ip 헤더 — 로컬·LAN 직접 요청엔 없음.
 *  - 근본 해결(사용자 조치)은 report/platform-v2-final-2026-07-08.md 하단: CRON_SECRET 실값 설정 +
 *    Cloudflare 라우트 축소(/api/cardnews/*) 또는 Access 부착. 해결 후엔 이 미들웨어를 제거해도 됨.
 *  - 원격에서 변경 작업이 정말 필요하면 .env에 ALLOW_TUNNEL_MUTATIONS=true (비권장 — Access 부착 후에만).
 *  - 2026-08-10: 관리자 쿠키 게이트 추가 — /api/admin/login?token=<ADMIN_TOKEN> 을 한 번 열면
 *    그 기기(쿠키 nd_admin)에 한해 터널 경유 변경 요청 허용. 익명 공개 접근은 계속 403.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method)) return NextResponse.next();
  if (process.env.ALLOW_TUNNEL_MUTATIONS === 'true') return NextResponse.next();
  if (req.headers.get('cf-ray') || req.headers.get('cf-connecting-ip')) {
    const adminToken = process.env.ADMIN_TOKEN;
    if (adminToken && req.cookies.get('nd_admin')?.value === adminToken) return NextResponse.next();
    return NextResponse.json(
      { error: '외부(터널) 경유 변경 요청이 차단되었습니다 — /api/admin/login?token=… 으로 이 기기를 인증하거나 로컬(:3200)에서 실행하세요. (src/middleware.ts)' },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
