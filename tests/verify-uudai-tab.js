const { chromium, devices } = require('playwright');
const path = require('path');
const fs   = require('fs');

const URL = 'https://vong-quay.vong-quay.workers.dev';
const SS  = (name) => path.join(__dirname, name);

const ZALO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 '
  + 'ZaloApp/23.11.01 (iPhone13,2)';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent: ZALO_UA,
  });
  const page = await ctx.newPage();

  // ── Step 1: Load trang, kiểm tra 4 tab buttons ──────────────
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SS('06-uudai-01-landing.png'), fullPage: false });

  const tabs = await page.$$eval('.tab-btn', els => els.map(e => e.textContent.trim()));
  console.log('TABS:', JSON.stringify(tabs));

  const hasUuDai = tabs.some(t => t.includes('Ưu Đãi'));
  console.log('Has Ưu Đãi tab:', hasUuDai);

  // ── Step 2: Click tab Ưu Đãi ────────────────────────────────
  await page.click('#tab-uudai');
  await page.waitForTimeout(600);
  await page.screenshot({ path: SS('06-uudai-02-tab-clicked.png'), fullPage: false });

  const sectionVisible = await page.$eval('#section-uudai', el =>
    !el.classList.contains('hidden') && el.offsetHeight > 0
  );
  console.log('Section #section-uudai visible:', sectionVisible);

  // ── Step 3: Scroll & chụp full section ──────────────────────
  await page.screenshot({ path: SS('06-uudai-03-full.png'), fullPage: true });

  // ── Step 4: Kiểm tra header card ────────────────────────────
  const headerText = await page.$eval('.uudai-header-card', el => el.innerText);
  console.log('Header card text:', headerText.replace(/\n/g, ' | '));

  const freePrice = await page.$eval('.uudai-free-price', el => el.innerText);
  console.log('Free price:', freePrice);

  // ── Step 5: Kiểm tra 5 benefit cards ─────────────────────────
  const discounts = await page.$$eval('.uudai-discount-pct', els =>
    els.map(e => e.innerText.trim())
  );
  console.log('Discount percentages:', JSON.stringify(discounts));

  const benefitNames = await page.$$eval('.uudai-benefit-name', els =>
    els.map(e => e.innerText.trim().replace(/\n/g, ' '))
  );
  console.log('Benefit names:', JSON.stringify(benefitNames));

  // ── Step 6: Kiểm tra note card ───────────────────────────────
  const noteText = await page.$eval('.uudai-note-card', el => el.innerText);
  console.log('Note card:', noteText.replace(/\n/g, ' | '));

  // ── Step 7: Probe – các tab khác vẫn hoạt động sau khi switch ─
  await page.click('#tab-spin');
  await page.waitForTimeout(400);
  const spinVisible = await page.$eval('#section-spin', el => !el.classList.contains('hidden'));
  const uudaiHidden = await page.$eval('#section-uudai', el => el.classList.contains('hidden'));
  console.log('Switch back to spin — spin visible:', spinVisible, '| uudai hidden:', uudaiHidden);
  await page.screenshot({ path: SS('06-uudai-04-switch-back-spin.png'), fullPage: false });

  // ── Step 8: Probe – tab Ưu Đãi lần 2, scroll xuống dưới ─────
  await page.click('#tab-uudai');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({ path: SS('06-uudai-05-scrolled-bottom.png'), fullPage: false });

  // ── Tổng hợp kết quả ────────────────────────────────────────
  const pass = hasUuDai && sectionVisible
    && discounts.length === 5
    && benefitNames.length === 5
    && freePrice.includes('0');

  console.log('\n=== RESULT ===');
  console.log('Discounts count (expected 5):', discounts.length);
  console.log('Benefit names count (expected 5):', benefitNames.length);
  console.log('PASS:', pass);

  await browser.close();
  process.exit(pass ? 0 : 1);
})();
