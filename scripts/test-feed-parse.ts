import { collectByCategory } from '../src/lib/news-collector';

// Monkey-patch to add verbose logging by checking counts before clustering
async function main() {
  // Check raw fetch + parse directly
  const urls = [
    ['CNBC', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147'],
    ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines'],
    ['한국경제', 'https://www.hankyung.com/feed/realestate'],
    ['Bloomberg', 'https://feeds.bloomberg.com/markets/news.rss'],
  ];
  for (const [name, url] of urls) {
    const r = await fetch(url, { headers: {'User-Agent':'Mozilla/5.0 (compatible; NewsDigestBot/1.0)'}, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    const items = [...text.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)];
    console.log(name, `${items.length} <item> tags, ${text.length} chars`);
    if (items[0]) {
      const block = items[0][1];
      const title = block.match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/is);
      console.log('  first title:', title?.[1]?.trim().slice(0, 60));
    }
  }
}
main().catch(console.error);
