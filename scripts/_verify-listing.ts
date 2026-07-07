/**
 * _verify-listing.ts — 특정 단지의 매매 매물을 면적·가격순으로 개별 추출(급매 진단). 1회성.
 * 실행: npx tsx scripts/_verify-listing.ts [complexNo] [minExclu] [maxExclu]
 */
import { harvestComplexArticles, repInfoOf, isDealType } from '../src/lib/collectors/naver-land';

const complexNo = process.argv[2] || '121645';
const minEx = Number(process.argv[3] || 78);
const maxEx = Number(process.argv[4] || 92);

const eok = (won: number) => (won / 100000000).toFixed(2).replace(/\.?0+$/, '') + '억';
function dirKo(code: string): string {
  const map: Record<string, string> = { E: '동', W: '서', S: '남', N: '북' };
  return (code || '').split('').map((c) => map[c] || c).join('') || '?';
}

(async () => {
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'ko-KR', viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(`()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome=window.chrome||{runtime:{}};}`);
  const page = await ctx.newPage();
  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const { articles, totalCount } = await harvestComplexArticles(page, complexNo);
  await b.close();

  const deals = articles.filter((a) => isDealType(repInfoOf(a)));
  const rows = deals.map((a) => {
    const r = repInfoOf(a) as any;
    const sp = r.spaceInfo || {};
    const d = r.articleDetail || {};
    const v = r.verificationInfo || {};
    return {
      no: r.articleNumber,
      dong: r.dongName,
      exclu: sp.exclusiveSpace,
      supply: sp.supplySpace,
      typeName: sp.exclusiveSpaceName,
      price: r.priceInfo?.dealPrice ?? null,
      floor: d.floorInfo,
      dir: dirKo(d.direction),
      desc: d.articleFeatureDescription || '',
      verify: v.verificationType,
      confirm: v.articleConfirmDate,
      broker: r.brokerInfo?.brokerageName || '',
    };
  }).filter((x) => x.price != null);

  const band = rows.filter((x) => x.exclu >= minEx && x.exclu <= maxEx).sort((a, b) => (a.price! - b.price!));
  console.log(`\n■ complexNo ${complexNo} · 전체매물 ${totalCount ?? '?'} · 매매 ${deals.length} · 전용 ${minEx}~${maxEx}㎡ ${band.length}건 (가격순)\n`);
  band.forEach((x, i) => {
    console.log(`${i + 1}. ${eok(x.price!)} · 전용 ${x.exclu}㎡(${x.typeName || ''}) · ${x.dong}동 · ${x.floor}층 · ${x.dir}향 · ${x.verify === 'OWNER' ? '소유자확인' : x.verify || ''}(${x.confirm})`);
    console.log(`   "${x.desc}" — ${x.broker}`);
  });

  // 전체 면적 분포도 요약
  console.log('\n[참고] 전용면적별 매매 매물 수/최저가:');
  const byType: Record<string, number[]> = {};
  for (const x of rows) { const k = Math.round(x.exclu) + '㎡'; (byType[k] = byType[k] || []).push(x.price!); }
  Object.entries(byType).sort((a, b) => Number(a[0].replace('㎡', '')) - Number(b[0].replace('㎡', ''))).forEach(([k, ps]) => {
    console.log(`  · 전용 ${k}: ${ps.length}건 · 최저 ${eok(Math.min(...ps))} ~ 최고 ${eok(Math.max(...ps))}`);
  });
})();
