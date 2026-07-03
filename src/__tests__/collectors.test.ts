/**
 * CMP-160: Integration tests for 6 collectors + persist.ts
 * Covers: assertSourceAllowed, upsert, no MLX refs, per-collector pass/fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(body: string | object, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status });
}

const SAMPLE_RSS_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>Test Article One</title><link>https://example.com/1</link><description>Summary one</description><pubDate>Mon, 18 Apr 2026 00:00:00 GMT</pubDate></item>
  <item><title>Test Article Two</title><link>https://example.com/2</link><description>Summary two</description></item>
</channel></rss>`;

const SAMPLE_ARXIV_XML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Large Language Models for Reasoning</title>
    <id>https://arxiv.org/abs/2601.00001</id>
    <summary>We study LLM reasoning capabilities.</summary>
    <published>${new Date().toISOString()}</published>
  </entry>
  <entry>
    <title>Diffusion Models Survey</title>
    <id>https://arxiv.org/abs/2601.00002</id>
    <summary>A survey of diffusion models.</summary>
    <published>${new Date().toISOString()}</published>
  </entry>
</feed>`;

const SAMPLE_HN_RESPONSE = {
  hits: [
    { title: 'GPT-5 Released', url: 'https://openai.com/gpt5', objectID: '1001', points: 300, author: 'user1' },
    { title: 'LLM Agents Survey', url: 'https://arxiv.org/abs/99', objectID: '1002', points: 120, author: 'user2' },
  ],
};

const SAMPLE_PWC_RESPONSE = {
  results: [
    { title: 'Attention Is All You Need v2', url_abs: 'https://paperswithcode.com/paper/attention', abstract: 'Transformer paper.', published: new Date().toISOString(), repository_count: 10 },
  ],
};

const SAMPLE_GITHUB_HTML = `
<html><body>
<article class="Box-row">
  <h2><a href="/openai/gpt-next">openai/gpt-next</a></h2>
  <p>An AI LLM model for next generation tasks</p>
  <span>1,200 stars today</span>
</article>
<article class="Box-row">
  <h2><a href="/pytorch/pytorch">pytorch/pytorch</a></h2>
  <p>Machine learning framework</p>
  <span>500 stars today</span>
</article>
</body></html>`;

// ─── No MLX refs ─────────────────────────────────────────────────────────────

describe('no MLX/Ollama refs in collector files', () => {
  const collectorFiles = ['rss', 'github', 'hn', 'arxiv', 'pwc', 'newsletter', 'persist'];
  const root = join(process.cwd(), 'src/lib/collectors');

  for (const name of collectorFiles) {
    it(`${name}.ts has no mlx/ollama references`, () => {
      const src = readFileSync(join(root, `${name}.ts`), 'utf8').toLowerCase();
      expect(src).not.toMatch(/\bmlx\b/);
      expect(src).not.toMatch(/\bollama\b/);
      expect(src).not.toMatch(/localhost:11434/);
      expect(src).not.toMatch(/localhost:8080/);
    });
  }
});

// ─── source-guard: assertSourceAllowed integration ───────────────────────────

describe('assertSourceAllowed is called by each collector', () => {
  it('source-guard module exports assertSourceAllowed', async () => {
    const mod = await import('../lib/source-guard');
    expect(typeof mod.assertSourceAllowed).toBe('function');
    expect(() => mod.assertSourceAllowed('rss')).not.toThrow();
    expect(() => mod.assertSourceAllowed('github')).not.toThrow();
    expect(() => mod.assertSourceAllowed('hn')).not.toThrow();
    expect(() => mod.assertSourceAllowed('arxiv')).not.toThrow();
    expect(() => mod.assertSourceAllowed('pwc')).not.toThrow();
    expect(() => mod.assertSourceAllowed('newsletter')).not.toThrow();
  });
});

// ─── RSS collector ────────────────────────────────────────────────────────────

describe('rss collector', () => {
  it('parseRssItems returns RawArticle[] with required fields', async () => {
    const { parseRssItems } = await import('../lib/collectors/rss');
    const source = { name: 'TestFeed', url: 'https://example.com/rss', category: 'AI' };
    const articles = parseRssItems(SAMPLE_RSS_XML, source);

    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(a.title).toBeTruthy();
      expect(a.url).toBeTruthy();
      expect(a.source).toBe('TestFeed');
      expect(a.category).toBe('AI');
    }
  });

  it('parseRssItems limits to 15 items', async () => {
    const { parseRssItems } = await import('../lib/collectors/rss');
    const items = Array.from({ length: 20 }, (_, i) =>
      `<item><title>Article ${i}</title><link>https://ex.com/${i}</link></item>`
    ).join('');
    const xml = `<rss><channel>${items}</channel></rss>`;
    const source = { name: 'Feed', url: 'https://ex.com/rss', category: 'GLOBAL' };
    const articles = parseRssItems(xml, source);
    expect(articles.length).toBeLessThanOrEqual(15);
  });

  it('collectRss calls assertSourceAllowed("rss")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_RSS_XML)));

    const { collectRss } = await import('../lib/collectors/rss');
    await collectRss([{ name: 'Test', url: 'https://ex.com/rss', category: 'AI' }]);

    expect(spy).toHaveBeenCalledWith('rss');
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});

// ─── GitHub collector ─────────────────────────────────────────────────────────

describe('github collector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_GITHUB_HTML)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('collectGithub calls assertSourceAllowed("github")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    const { collectGithub } = await import('../lib/collectors/github');
    await collectGithub();
    expect(spy).toHaveBeenCalledWith('github');
    spy.mockRestore();
  });

  it('collectGithub returns articles with isGithubTrending=true', async () => {
    const { collectGithub } = await import('../lib/collectors/github');
    const articles = await collectGithub();
    for (const a of articles) {
      expect(a.isGithubTrending).toBe(true);
      expect(a.title).toBeTruthy();
      expect(a.url).toMatch(/^https:\/\/github\.com\//);
      expect(a.category).toBe('AI');
    }
  });
});

// ─── HN collector ─────────────────────────────────────────────────────────────

describe('hn collector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_HN_RESPONSE)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('collectHN calls assertSourceAllowed("hn")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    const { collectHN } = await import('../lib/collectors/hn');
    await collectHN();
    expect(spy).toHaveBeenCalledWith('hn');
    spy.mockRestore();
  });

  it('collectHN returns articles with required fields', async () => {
    const { collectHN } = await import('../lib/collectors/hn');
    const articles = await collectHN();
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(a.title).toBeTruthy();
      expect(a.url).toBeTruthy();
      expect(a.source).toBe('HackerNews');
      expect(a.category).toBe('AI');
    }
  });

  it('collectHN returns [] on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const { collectHN } = await import('../lib/collectors/hn');
    const articles = await collectHN();
    expect(articles).toEqual([]);
  });
});

// ─── ArXiv collector ──────────────────────────────────────────────────────────

describe('arxiv collector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_ARXIV_XML)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('collectArxiv calls assertSourceAllowed("arxiv")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    const { collectArxiv } = await import('../lib/collectors/arxiv');
    await collectArxiv();
    expect(spy).toHaveBeenCalledWith('arxiv');
    spy.mockRestore();
  });

  it('collectArxiv returns articles with ArXiv URLs', async () => {
    const { collectArxiv } = await import('../lib/collectors/arxiv');
    const articles = await collectArxiv();
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(a.title).toBeTruthy();
      expect(a.url).toMatch(/arxiv\.org/);
      expect(a.source).toBe('ArXiv');
      expect(a.category).toBe('AI');
    }
  });

  it('collectArxiv filters out articles older than 48h', async () => {
    const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const oldXml = `<?xml version="1.0"?><feed>
      <entry>
        <title>Old Paper</title>
        <id>https://arxiv.org/abs/0001.00001</id>
        <summary>Old content</summary>
        <published>${oldDate}</published>
      </entry>
    </feed>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(oldXml)));
    const { collectArxiv } = await import('../lib/collectors/arxiv');
    const articles = await collectArxiv();
    expect(articles).toHaveLength(0);
  });
});

// ─── PwC collector ────────────────────────────────────────────────────────────

describe('pwc collector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_PWC_RESPONSE)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('collectPwC calls assertSourceAllowed("pwc")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    const { collectPwC } = await import('../lib/collectors/pwc');
    await collectPwC();
    expect(spy).toHaveBeenCalledWith('pwc');
    spy.mockRestore();
  });

  it('collectPwC returns articles with required fields', async () => {
    const { collectPwC } = await import('../lib/collectors/pwc');
    const articles = await collectPwC();
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      expect(a.title).toBeTruthy();
      expect(a.url).toBeTruthy();
      expect(a.source).toBe('Papers with Code');
      expect(a.category).toBe('AI');
    }
  });

  it('collectPwC returns [] on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const { collectPwC } = await import('../lib/collectors/pwc');
    const articles = await collectPwC();
    expect(articles).toEqual([]);
  });
});

// ─── Newsletter collector ─────────────────────────────────────────────────────

describe('newsletter collector', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(SAMPLE_RSS_XML)));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('collectNewsletter calls assertSourceAllowed("newsletter")', async () => {
    const guard = await import('../lib/source-guard');
    const spy = vi.spyOn(guard, 'assertSourceAllowed');
    const { collectNewsletter } = await import('../lib/collectors/newsletter');
    await collectNewsletter();
    expect(spy).toHaveBeenCalledWith('newsletter');
    spy.mockRestore();
  });

  it('collectNewsletter returns at most 12 articles', async () => {
    const { collectNewsletter } = await import('../lib/collectors/newsletter');
    const articles = await collectNewsletter();
    expect(articles.length).toBeLessThanOrEqual(12);
  });

  it('collectNewsletter returns [] when all feeds fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
    const { collectNewsletter } = await import('../lib/collectors/newsletter');
    const articles = await collectNewsletter();
    expect(articles).toEqual([]);
  });
});

// ─── persist.ts ──────────────────────────────────────────────────────────────

describe('persistArticles', () => {
  const mockUpsert = vi.fn().mockResolvedValue({});
  const mockPrisma = { article: { upsert: mockUpsert }, entityStat: { upsert: vi.fn().mockResolvedValue({}) } };

  beforeEach(() => {
    vi.doMock('../lib/db', () => ({ prisma: mockPrisma }));
    mockUpsert.mockClear();
  });
  afterEach(() => { vi.doUnmock('../lib/db'); });

  it('persistArticles calls upsert for each valid article', async () => {
    const { persistArticles } = await import('../lib/collectors/persist');
    const articles = [
      { title: 'Article A', url: 'https://ex.com/a', source: 'Test', content: 'body', category: 'AI' as const },
      { title: 'Article B', url: 'https://ex.com/b', source: 'Test', content: 'body', category: 'AI' as const },
    ];
    const count = await persistArticles(articles, 'rss');
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  });

  it('persistArticles skips articles missing url or title', async () => {
    const { persistArticles } = await import('../lib/collectors/persist');
    const articles = [
      { title: '', url: 'https://ex.com/a', source: 'Test', content: '', category: 'AI' as const },
      { title: 'Has Title', url: '', source: 'Test', content: '', category: 'AI' as const },
      { title: 'Valid', url: 'https://ex.com/c', source: 'Test', content: '', category: 'AI' as const },
    ];
    const count = await persistArticles(articles, 'rss');
    expect(count).toBe(1);
  });

  it('persistArticles sets correct sourceType in create payload', async () => {
    const { persistArticles } = await import('../lib/collectors/persist');
    const articles = [
      { title: 'GitHub Repo', url: 'https://github.com/org/repo', source: 'GitHub Trending', content: 'desc', category: 'AI' as const, isGithubTrending: true, githubStarsDelta: 100, githubLanguage: 'Python' },
    ];
    await persistArticles(articles, 'github');
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceType: 'github' }),
      })
    );
  });

  it('persistArticles returns 0 when upsert always throws', async () => {
    mockUpsert.mockRejectedValue(new Error('DB error'));
    const { persistArticles } = await import('../lib/collectors/persist');
    const articles = [
      { title: 'Article', url: 'https://ex.com/x', source: 'Test', content: 'body', category: 'AI' as const },
    ];
    const count = await persistArticles(articles, 'rss');
    expect(count).toBe(0);
  });
});
