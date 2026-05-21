const { chromium } = require('playwright');
const path = require('path');

const URL  = 'https://vong-quay.vong-quay.workers.dev';
const SS   = (name) => path.join(__dirname, `${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function testCase(browser, label, phone, code) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(800);

  // Intercept /api/invoices
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/invoices?'), { timeout: 15000 }),
    (async () => {
      await page.fill('#phone-input',   phone);
      await page.fill('#invoice-input', code);
      await page.click('#check-btn');
    })(),
  ]);

  const invoices = await response.json().catch(() => []);

  // Đợi #phone-msg có nội dung (lỗi hoặc chuyển sang wheel)
  await Promise.race([
    page.waitForFunction(() => document.getElementById('phone-msg')?.innerText?.trim().length > 0, { timeout: 8000 }).catch(() => {}),
    page.waitForSelector('#step-wheel:not(.hidden)', { timeout: 8000 }).catch(() => {}),
  ]);

  await sleep(500);
  await page.screenshot({ path: SS(label), fullPage: false });

  const msg       = await page.$eval('#phone-msg', el => el.innerText.trim()).catch(() => '');
  const wheelVis  = await page.$eval('#step-wheel', el => !el.classList.contains('hidden')).catch(() => false);
  await page.close();
  return { invoices, msg, wheelVisible: wheelVis };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page0   = await browser.newPage();
  await page0.setViewportSize({ width: 1280, height: 900 });
  await page0.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(500);

  // Kiểm tra ngưỡng MIN_AMOUNT hiển thị trên trang
  const minAmountOnPage = await page0.evaluate(() => window.CFG?.MIN_AMOUNT);
  const headerText      = await page0.$eval('h2, p', el => el.closest('body').innerText.match(/\d[\d.,]+đ/)?.[0]).catch(() => '');
  console.log('CFG.MIN_AMOUNT tren trang:', minAmountOnPage, '| Text nguong:', headerText);
  await page0.screenshot({ path: SS('01-trang-chu') });
  await page0.close();

  // ── Case 1: hóa đơn hợp lệ (1.82M, hôm nay, Hoài Đức) ─────
  console.log('\n--- Case 1: SDT + ma hop le ---');
  const r1 = await testCase(browser, '02-case1', '0912728919', 'HD157387');
  console.log('  Invoices tra ve:', r1.invoices.length, 'hoa don');
  console.log('  Msg:', r1.msg || '(trong)');
  console.log('  Wheel hien thi:', r1.wheelVisible);
  const pass1 = r1.wheelVisible || r1.msg === '';
  console.log(pass1 ? '  ✅ PASS — chuyen sang vong quay' : '  ❌ FAIL — msg: ' + r1.msg);

  // ── Case 2: SĐT không tồn tại ──────────────────────────────
  console.log('\n--- Case 2: SDT khong ton tai ---');
  const r2 = await testCase(browser, '03-case2', '0999000000', 'HD999999');
  console.log('  Invoices tra ve:', r2.invoices.length, 'hoa don');
  console.log('  Msg:', r2.msg);
  const pass2 = r2.invoices.length === 0 && r2.msg.includes('Không tìm thấy');
  console.log(pass2 ? '  ✅ PASS — bao loi khong tim thay SDT' : '  ❌ FAIL — msg: ' + r2.msg);

  // ── Case 3: SĐT đúng, mã sai ────────────────────────────────
  console.log('\n--- Case 3: SDT dung, ma sai ---');
  const r3 = await testCase(browser, '04-case3', '0912728919', 'HDSAI999');
  console.log('  Invoices tra ve:', r3.invoices.length, 'hoa don');
  console.log('  Msg:', r3.msg);
  const pass3 = r3.invoices.length > 0 && r3.msg.includes('không đúng');
  console.log(pass3 ? '  ✅ PASS — bao loi ma sai' : '  ❌ FAIL — msg: ' + r3.msg);

  // ── Case 4: hóa đơn dưới 499.000đ (332.215đ, Hoài Đức) ──────
  console.log('\n--- Case 4: hoa don duoi 499.000d (HD157416 = 332.215d) ---');
  const r4 = await testCase(browser, '05-case4', '0912728919', 'HD157416');
  console.log('  Invoices tra ve:', r4.invoices.length, 'hoa don');
  console.log('  Msg:', r4.msg);
  console.log('  Wheel hien thi:', r4.wheelVisible);
  const pass4 = !r4.wheelVisible && r4.msg.includes('499');
  console.log(pass4 ? '  ✅ PASS — bao loi gia tri thap hon nguong' : '  ❌ FAIL — msg: ' + r4.msg);

  await browser.close();

  console.log('\n══════════════════════════════');
  console.log('CFG.MIN_AMOUNT:', minAmountOnPage === 499000 ? '499.000đ ✅' : minAmountOnPage + ' ⚠️ (can cap nhat)');
  console.log('Case 1 (hop le):          ', pass1 ? 'PASS ✅' : 'FAIL ❌');
  console.log('Case 2 (SDT khong ton tai):', pass2 ? 'PASS ✅' : 'FAIL ❌');
  console.log('Case 3 (ma sai):           ', pass3 ? 'PASS ✅' : 'FAIL ❌');
  console.log('Case 4 (duoi 499k):        ', pass4 ? 'PASS ✅' : 'FAIL ❌');
})();
