import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

/**
 * 논문 수집 — Hugging Face Daily Papers.
 *
 * 2026-09-14: 원래 Papers with Code(`paperswithcode.com/api/v1/papers/`)를 받았는데, 그 서비스가
 * Hugging Face에 흡수되면서 API 경로가 `huggingface.co/papers/trending` HTML로 리다이렉트된다.
 * `res.json()`이 1.5MB HTML을 만나 매번 예외를 던졌고, catch가 이를 삼켜 "fetch failed" 한 줄만
 * 남기고 매일 조용히 0건이었다. sourceType은 호환을 위해 'pwc'를 유지한다(source-guard·trust 키).
 *
 * 선별 기준은 upvotes다 — 커뮤니티가 실제로 주목한 논문만 올라온다. arxiv 수집기가 최신순으로
 * 넓게 긁는 것과 역할이 갈린다(신규성 vs 주목도).
 */
export async function collectPwC(): Promise<RawArticle[]> {
  assertSourceAllowed('pwc');
  try {
    const res = await fetch('https://huggingface.co/api/daily_papers?limit=30', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[collector:pwc] DEAD — HTTP ${res.status} huggingface.co/api/daily_papers`);
      return [];
    }
    const data = (await res.json()) as Array<{
      paper?: { id?: string; title?: string; summary?: string; publishedAt?: string; upvotes?: number };
      publishedAt?: string;
    }>;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const out = (Array.isArray(data) ? data : [])
      .map((d) => ({ p: d.paper ?? {}, at: d.paper?.publishedAt ?? d.publishedAt }))
      .filter(({ p }) => p.id && p.title)
      .filter(({ at }) => !at || new Date(at).getTime() >= cutoff)
      .sort((a, b) => (b.p.upvotes ?? 0) - (a.p.upvotes ?? 0))
      .slice(0, 10)
      .map(({ p, at }) => ({
        title: p.title!,
        content: (p.summary ?? '').slice(0, 800) || `HF Daily Papers | upvotes: ${p.upvotes ?? 0}`,
        url: `https://huggingface.co/papers/${p.id}`,
        source: 'HF Daily Papers',
        category: 'AI' as const,
        publishedAt: at || undefined,
      }));
    if (out.length === 0) console.warn('[collector:pwc] EMPTY — 응답은 받았으나 최근 7일 논문 0건');
    return out;
  } catch (err) {
    console.warn(`[collector:pwc] DEAD — ${String(err)}`);
    return [];
  }
}
