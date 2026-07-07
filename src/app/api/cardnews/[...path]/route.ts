/** output/cardnews 이미지 서빙(경로 이탈 차단) — /cardnews 페이지·다운로드용 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = resolve(process.cwd(), 'output', 'cardnews');
  const target = resolve(base, ...path);
  const isPng = target.endsWith('.png');
  const isJpg = /\.jpe?g$/.test(target); // 인스타 게시용 JPEG 변환본
  if (!target.startsWith(base + '/') || (!isPng && !isJpg)) {
    return new Response('bad path', { status: 400 });
  }
  try {
    const buf = readFileSync(target);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': isPng ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
