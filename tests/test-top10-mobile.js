const { chromium } = require('playwright');
const path = require('path');

const URL   = 'https://vong-quay.vong-quay.workers.dev';
const SS    = (name) => path.join(__dirname, `${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PHONE = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize(PHONE);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(600);

  // Chuyển sang tab Top 10
  await page.click('#tab-top');

  // Đợi dữ liệu load xong
  await page.waitForSelector('#top-loading.hidden', { timeout: 15000 }).catch(() => {});
  await sleep(600);

  // Chụp đầu trang
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: SS('t01-top10-top'), fullPage: false });
  console.log('✅ Chụp Top 10 (đầu trang)');

  // Scroll xuống cuối
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await page.screenshot({ path: SS('t02-top10-bottom'), fullPage: false });
  console.log('✅ Chụp Top 10 (cuối trang)');

  // Chụp toàn trang
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: SS('t03-top10-fullpage'), fullPage: true });
  console.log('✅ Chụp Top 10 fullPage');

  // Kiểm tra dữ liệu bảng
  const result = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#top-tbody .top-row')];
    return {
      rowCount: rows.length,
      top3: rows.slice(0, 3).map(r => ({
        rank:  r.querySelector('.top-rank')?.innerText?.trim(),
        name:  r.querySelector('.top-name')?.innerText?.trim(),
        total: r.querySelector('.top-total')?.innerText?.trim(),
      })),
      overflowY:    document.body.style.overflowY,
      scrollHeight: document.body.scrollHeight,
      innerHeight:  window.innerHeight,
      countdown:    document.getElementById('top-countdown')?.innerText?.trim(),
      month:        document.getElementById('top-month')?.innerText?.trim(),
    };
  });

  console.log('\n  Thông tin Top 10:');
  console.log('  Số hàng trong bảng:', result.rowCount);
  console.log('  Tháng:             ', result.month);
  console.log('  Countdown:         ', result.countdown);
  console.log('  body.overflowY:    ', result.overflowY);
  console.log('  scrollHeight:      ', result.scrollHeight, '| innerHeight:', result.innerHeight);
  console.log('  Top 3:');
  result.top3.forEach(r => console.log(`    ${r.rank}. ${r.name} — ${r.total}`));

  const passRows    = result.rowCount > 0;
  const passScroll  = result.overflowY === 'auto';
  const passCountdown = result.countdown && result.countdown !== '--';

  console.log('\n══════════════════════════════');
  console.log('Bảng Top 10 có dữ liệu:', passRows     ? 'PASS ✅' : 'FAIL ❌');
  console.log('Scroll hoạt động:       ', passScroll   ? 'PASS ✅' : 'FAIL ❌');
  console.log('Countdown hiển thị:     ', passCountdown? 'PASS ✅' : 'FAIL ❌');

  await browser.close();
})();
