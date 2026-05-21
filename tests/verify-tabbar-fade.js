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

  // Step 1: fade hiển thị lúc mới load (chưa scroll)
  const fadeVisible = await page.$eval('.tab-bar-wrap', el => {
    const after = window.getComputedStyle(el, '::after');
    const atEnd = el.classList.contains('at-end');
    return { atEnd, hasAfter: after.content !== 'none' };
  });
  console.log('Initial state:', fadeVisible);
  await page.screenshot({ path: SS('08-fade-01-initial.png') });

  // Step 2: scroll tab bar đến cuối → fade biến mất
  await page.$eval('#tab-bar', el => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(400);
  const atEndAfterScroll = await page.$eval('.tab-bar-wrap', el => el.classList.contains('at-end'));
  console.log('at-end class after scroll to end:', atEndAfterScroll);
  await page.screenshot({ path: SS('08-fade-02-scrolled-end.png') });

  // Step 3: scroll về đầu → fade xuất hiện lại
  await page.$eval('#tab-bar', el => { el.scrollLeft = 0; });
  await page.waitForTimeout(400);
  const atEndAfterScrollBack = await page.$eval('.tab-bar-wrap', el => el.classList.contains('at-end'));
  console.log('at-end class after scroll back:', atEndAfterScrollBack);
  await page.screenshot({ path: SS('08-fade-03-scrolled-back.png') });

  const pass = !fadeVisible.atEnd && atEndAfterScroll && !atEndAfterScrollBack;
  console.log('\n=== RESULT ===');
  console.log('Fade shown at start:', !fadeVisible.atEnd);
  console.log('Fade hidden at end:', atEndAfterScroll);
  console.log('Fade shown again after scroll back:', !atEndAfterScrollBack);
  console.log('PASS:', pass);

  await browser.close();
  process.exit(pass ? 0 : 1);
})();
