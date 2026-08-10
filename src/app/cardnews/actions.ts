'use server';

/** /cardnews 서버 액션 — 카드뉴스 생성(스크립트 실행) · 텔레그램 캐러셀 전송(sendMediaGroup) */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join } from 'path';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { publishCardnewsCarousel, retryPendingPublish } from '@/lib/instagram';

const exec = promisify(execFile);

/** 텔레그램 API 호출 재시도 — IPv6 라우트 부재 환경의 간헐 ETIMEDOUT 흡수(2026-08-10, telegram.ts와 동일 사유) */
async function fetchRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

/** 게시 차단으로 보존된 컨테이너의 게시만 재시도 */
export async function retryInstagramPublish() {
  try {
    const r = await retryPendingPublish();
    redirect('/cardnews?ok=' + encodeURIComponent(`인스타그램 게시 완료${r.permalink ? ` — ${r.permalink}` : ` (postId ${r.postId})`}`));
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
    redirect('/cardnews?error=' + encodeURIComponent(`재시도 실패: ${e instanceof Error ? e.message.slice(0, 200) : e}`));
  }
}

/** 인스타그램(sklee01.ai) 캐러셀 게시 — 실제 공개 게시(버튼 클릭 = 사용자 확인) */
export async function publishCardnewsToInstagram(formData: FormData) {
  // date = 세트 디렉토리명(<YYYY-MM-DD>[-시리즈접미사], 3-A)
  const date = String(formData.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(date)) redirect('/cardnews?error=' + encodeURIComponent('잘못된 세트'));
  try {
    const idx = JSON.parse(readFileSync(join(process.cwd(), 'output', 'cardnews', 'index.json'), 'utf-8')) as Array<{ date: string; dir?: string; files: string[]; caption?: string }>;
    const set = idx.find((s) => (s.dir ?? s.date) === date);
    if (!set) throw new Error('세트 없음');
    const r = await publishCardnewsCarousel(date, set.files, set.caption ?? '');
    redirect('/cardnews?ok=' + encodeURIComponent(`인스타그램(@${r.username}) 게시 완료${r.permalink ? ` — ${r.permalink}` : ` (postId ${r.postId})`}`));
  } catch (e) {
    // redirect()는 내부적으로 throw하므로 통과시켜야 함
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: string }).digest).startsWith('NEXT_REDIRECT')) throw e;
    redirect('/cardnews?error=' + encodeURIComponent(`인스타 게시 실패: ${e instanceof Error ? e.message.slice(0, 200) : e}`));
  }
}

export async function generateCardnews() {
  try {
    await exec('npx', ['tsx', 'scripts/gen-cardnews.ts'], { cwd: process.cwd(), timeout: 180_000 });
  } catch (e) {
    redirect('/cardnews?error=' + encodeURIComponent(`생성 실패: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
  }
  revalidatePath('/cardnews');
  redirect('/cardnews?ok=' + encodeURIComponent('카드뉴스 생성 완료'));
}

/** 텔레그램으로 캐러셀 전송 — sendMediaGroup(최대 10장, 인스타 업로드용 원본 수신) */
export async function sendCardnewsToTelegram(formData: FormData) {
  // date = 세트 디렉토리명(<YYYY-MM-DD>[-시리즈접미사], 3-A)
  const date = String(formData.get('date') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(date)) redirect('/cardnews?error=' + encodeURIComponent('잘못된 세트'));
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) redirect('/cardnews?error=' + encodeURIComponent('TELEGRAM_BOT_TOKEN/CHAT_ID 미설정'));

  try {
    const idx = JSON.parse(readFileSync(join(process.cwd(), 'output', 'cardnews', 'index.json'), 'utf-8')) as Array<{ date: string; dir?: string; files: string[]; caption?: string }>;
    const set = idx.find((s) => (s.dir ?? s.date) === date);
    if (!set) throw new Error('세트 없음');
    const form = new FormData();
    const media = set.files.map((f, i) => ({
      type: 'photo',
      media: `attach://f${i}`,
      ...(i === 0 ? { caption: `🏠 매수 레이더 카드뉴스 · ${date}\n인스타 업로드용 (1080×1350 ×2배율)` } : {}),
    }));
    form.set('chat_id', chatId!);
    form.set('media', JSON.stringify(media));
    for (let i = 0; i < set.files.length; i++) {
      const buf = readFileSync(join(process.cwd(), 'output', 'cardnews', date, set.files[i]));
      form.set(`f${i}`, new Blob([new Uint8Array(buf)], { type: 'image/png' }), set.files[i]);
    }
    const res = await fetchRetry(`https://api.telegram.org/bot${token}/sendMediaGroup`, { method: 'POST', body: form });
    const j = await res.json();
    if (!j.ok) throw new Error(j.description ?? 'telegram 오류');
    // 인스타 캡션도 텍스트로 함께 발송 — 폰에서 복사→붙여넣기 동선
    if (set.caption) {
      await fetchRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `📝 인스타 본문(복사해서 사용)\n\n${set.caption}` }),
      }).catch(() => {});
    }
  } catch (e) {
    redirect('/cardnews?error=' + encodeURIComponent(`전송 실패: ${e instanceof Error ? e.message.slice(0, 120) : e}`));
  }
  redirect('/cardnews?ok=' + encodeURIComponent('텔레그램 전송 완료 — 사진 저장 후 인스타에 업로드하세요'));
}
