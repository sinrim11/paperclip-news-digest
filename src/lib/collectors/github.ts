import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

const AI_KEYWORDS = ['ai', 'llm', 'ml', 'machine learning', 'agent', 'gpt', 'transformer', 'neural', 'model', 'diffusion', 'embedding', 'rag', 'inference'];

export async function collectGithub(): Promise<RawArticle[]> {
  assertSourceAllowed('github');
  const articles: RawArticle[] = [];
  for (const lang of ['python', 'typescript']) {
    try {
      const res = await fetch(`https://github.com/trending/${lang}?since=daily`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      let count = 0;
      for (const block of html.matchAll(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
        if (count >= 5) break;
        const content = block[1];
        const repoPath = content.match(/href="\/([^"\/]+\/[^"\/]+)"/)?.[1] ?? '';
        if (!repoPath) continue;
        const description = content.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? '';
        const starsDelta = parseInt((content.match(/([\d,]+)\s*stars today/i)?.[1] ?? '0').replace(/,/g, ''), 10);
        const fullText = `${repoPath} ${description}`.toLowerCase();
        if (!AI_KEYWORDS.some((kw) => fullText.includes(kw))) continue;
        articles.push({
          title: `[GitHub Trending] ${repoPath} — ${description || 'AI/ML 오픈소스'}`,
          content: `${description} | Language: ${lang} | Stars today: +${starsDelta}`,
          url: `https://github.com/${repoPath}`,
          source: 'GitHub Trending',
          category: 'AI' as const,
          isGithubTrending: true,
          githubStarsDelta: starsDelta,
          githubLanguage: lang.charAt(0).toUpperCase() + lang.slice(1),
        });
        count++;
      }
    } catch {
      console.warn(`[collector:github] trending (${lang}) fetch failed`);
    }
  }
  return articles;
}
