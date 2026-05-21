const { chromium, devices } = require('playwright');
const path = require('path');

const URL = 'https://vong-quay.vong-quay.workers.dev';
const SS  = n => path.join(__dirname, n);
const ZALO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ZaloApp/23.11.01 (iPhone13,2)';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx  = await browser.newContext({ ...devices['iPhone 13'], userAgent: ZALO_UA });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // Step 1: đúng 4 tabs, không có Ưu Đãi
  const tabs = await page.$$eval('.tab-btn', els => els.map(e => e.textContent.trim()));
  console.log('TABS:', JSON.stringify(tabs));
  const hasUuDai   = tabs.some(t => t.includes('Ưu Đãi'));
  const hasHoiVien = tabs.some(t => t.includes('Hội Viên'));
  console.log('Ưu Đãi removed:', !hasUuDai);
  console.log('Hội Viên present:', hasHoiVien);
  await page.screenshot({ path: SS('09-tabbar-01-landing.png') });

  // Step 2: không overflow → at-end ngay, fade ẩn (đúng vì 4 tab vừa màn hình)
  const info = await page.evaluate(() => {
    const bar = document.getElementById('tab-bar');
    return {
      overflow: bar.scrollWidth > bar.clientWidth,
      btnWidths: [...document.querySelectorAll('.tab-btn')].map(b => Math.round(b.getBoundingClientRect().width)),
    };
  });
  console.log('Overflow:', info.overflow, '| btn widths:', info.btnWidths);
  const atEnd = await page.$eval('.tab-bar-wrap', el => el.classList.contains('at-end'));
  console.log('No overflow → fade hidden (at-end=true):', atEnd);

  // Step 3: lần lượt click từng tab, kiểm tra không bị lỗi
  for (const t of ['loyalty', 'top', 'hoivien', 'spin']) {
    await page.click(`#tab-${t}`);
    await page.waitForTimeout(300);
    const active = await page.$eval(`#tab-${t}`, el => el.classList.contains('active'));
    console.log(`Tab ${t} active after click:`, active);
  }
  await page.screenshot({ path: SS('09-tabbar-02-spin-active.png') });

  // Step 4: click Hội Viên, scroll xuống cuối
  await page.click('#tab-hoivien');
  await page.waitForTimeout(400);
  await page.screenshot({ path: SS('09-tabbar-03-hoivien.png') });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: SS('09-tabbar-04-hoivien-bottom.png') });

  // Step 5: không còn #section-uudai trong DOM
  const uudaiExists = await page.$('#section-uudai');
  console.log('#section-uudai in DOM:', !!uudaiExists);

  const pass = tabs.length === 4 && !hasUuDai && hasHoiVien && !info.overflow && !uudaiExists;
  console.log('\n=== RESULT ===');
  console.log('Tab count (expected 4):', tabs.length);
  console.log('PASS:', pass);

  await browser.close();
  process.exit(pass ? 0 : 1);
})();
