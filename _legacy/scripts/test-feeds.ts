const feeds = [
  ['CNBC', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147'],
  ['MarketWatch', 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines'],
  ['한국경제', 'https://www.hankyung.com/feed/realestate'],
  ['Bloomberg', 'https://feeds.bloomberg.com/markets/news.rss'],
];
async function main() {
  for (const [name, url] of feeds) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' }, signal: AbortSignal.timeout(10000) });
      const t = await r.text();
      console.log(name, r.status, t.length, 'chars', t.slice(0, 60));
    } catch (e) { console.log(name, 'FAIL:', String(e).slice(0, 80)); }
  }
}
main();
