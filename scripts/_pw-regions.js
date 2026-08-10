const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  await p.goto('http://localhost:3200/regions', { waitUntil: 'networkidle', timeout: 30000 });
  await p.screenshot({ path: '/tmp/regions-desktop.png' });
  // 첫 번째 구 펼침 상태 스크린샷 (defaultOpen이라 이미 열려있음) — 테이블 영역으로 스크롤
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:3200/regions?band=parent', { waitUntil: 'networkidle', timeout: 30000 });
  await m.screenshot({ path: '/tmp/regions-mobile.png' });
  await b.close();
  console.log('screenshots done');
})();
