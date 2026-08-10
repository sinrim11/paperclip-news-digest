const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('http://localhost:3200/cardnews', { waitUntil: 'networkidle', timeout: 30000 });
  const genBtn = p.getByRole('button', { name: /오늘 데이터로 새로 생성/ });
  await genBtn.click();
  // 스피너(진행 표시) 캡처 시도
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/tmp/cardnews-pending.png' });
  // 시작 배너 대기
  await p.waitForSelector('text=생성을 시작했습니다', { timeout: 20000 });
  await p.screenshot({ path: '/tmp/cardnews-started.png' });
  console.log('OK: 시작 배너 확인 — URL', p.url().slice(0, 80));
  await b.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
