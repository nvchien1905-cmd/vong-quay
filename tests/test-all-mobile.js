const { chromium, devices } = require('playwright');
const path = require('path');

const URL   = 'https://vong-quay.vong-quay.workers.dev';
const SS    = (name) => path.join(__dirname, `${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const iPhone13 = devices['iPhone 13'];

const results = {};

// ════════════════════════════════════════════════════════════
//  TAB 1: QUAY THƯỞNG
// ════════════════════════════════════════════════════════════
async function testSpin(browser) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  TAB 1: QUAY THƯỞNG                 ║');
  console.log('╚══════════════════════════════════════╝');

  const ctx  = await browser.newContext({ ...iPhone13 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(600);

  // Form nhập
  const formCheck = await page.evaluate(() => {
    const card  = document.querySelector('#step-phone .card');
    const btn   = document.getElementById('check-btn');
    const rCard = card?.getBoundingClientRect();
    const rBtn  = btn?.getBoundingClientRect();
    return {
      cardOk: rCard && rCard.top >= 0 && rCard.bottom <= window.innerHeight,
      btnOk:  rBtn  && rBtn.top  >= 0 && rBtn.bottom  <= window.innerHeight,
    };
  });
  await page.screenshot({ path: SS('all-01-spin-form') });
  console.log('  Form card trong viewport:', formCheck.cardOk ? '✅' : '❌');
  console.log('  Nút Xác nhận trong viewport:', formCheck.btnOk ? '✅' : '❌');

  // Nhập hóa đơn hợp lệ → chuyển sang vòng quay
  const [res] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/invoices?'), { timeout: 15000 }),
    (async () => {
      await page.fill('#phone-input',   '0912728919');
      await page.fill('#invoice-input', 'HD157387');
      await page.click('#check-btn');
    })(),
  ]);
  await res.json().catch(() => []);
  await Promise.race([
    page.waitForSelector('#step-wheel:not(.hidden)', { timeout: 10000 }).catch(() => {}),
    page.waitForFunction(() => document.getElementById('phone-msg')?.innerText?.trim().length > 0, { timeout: 10000 }).catch(() => {}),
  ]);
  await sleep(500);
  await page.screenshot({ path: SS('all-02-spin-wheel') });

  const wheelCheck = await page.evaluate(() => {
    const canvas = document.getElementById('wheel-canvas');
    const btn    = document.getElementById('spin-btn');
    const cRect  = canvas?.getBoundingClientRect();
    const bRect  = btn?.getBoundingClientRect();
    const scroll = document.body.scrollHeight - window.innerHeight;
    return {
      wheelVisible: !document.getElementById('step-wheel')?.classList.contains('hidden'),
      canvasInVp:   cRect && cRect.top >= 0 && cRect.bottom <= window.innerHeight,
      btnInVp:      bRect && bRect.top >= 0 && bRect.bottom <= window.innerHeight,
      canvasSize:   Math.round(cRect?.width),
      overflowY:    document.body.style.overflowY,
      overflow:     scroll,
    };
  });
  console.log('  Vòng quay hiển thị:   ', wheelCheck.wheelVisible ? '✅' : '❌');
  console.log('  Canvas trong viewport:', wheelCheck.canvasInVp ? '✅' : '❌', '(' + wheelCheck.canvasSize + 'px)');
  console.log('  Nút QUAY trong viewport:', wheelCheck.btnInVp ? '✅' : '❌');
  console.log('  overflowY khi wheel:  ', wheelCheck.overflowY);
  console.log('  Nội dung tràn:        ', wheelCheck.overflow > 0 ? wheelCheck.overflow + 'px (có thể cuộn)' : 'vừa màn hình ✅');

  results.spin = {
    formOk:  formCheck.cardOk && formCheck.btnOk,
    wheelOk: wheelCheck.wheelVisible && wheelCheck.canvasInVp && wheelCheck.btnInVp,
    scrollOk: wheelCheck.overflow <= 0 || wheelCheck.overflowY === 'auto',
  };
  await ctx.close();
}

// ════════════════════════════════════════════════════════════
//  TAB 2: ĐIỂM TÍCH LŨY
// ════════════════════════════════════════════════════════════
async function testLoyalty(browser) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  TAB 2: ĐIỂM TÍCH LŨY              ║');
  console.log('╚══════════════════════════════════════╝');

  const ctx  = await browser.newContext({ ...iPhone13 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(500);
  await page.click('#tab-loyalty');
  await sleep(400);
  await page.screenshot({ path: SS('all-03-loyalty-empty') });

  const overflowEmpty = await page.evaluate(() => document.body.style.overflowY);
  console.log('  overflowY (loyalty empty):', overflowEmpty);

  // Nhập SĐT
  await page.fill('#loyalty-phone-input', '0912728919');
  await page.click('#loyalty-check-btn');
  await page.waitForSelector('#loyalty-result:not(.hidden)', { timeout: 12000 }).catch(() => {});
  await sleep(500);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: SS('all-04-loyalty-top') });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await page.screenshot({ path: SS('all-05-loyalty-bottom') });

  const loyaltyCheck = await page.evaluate(() => {
    const result = document.getElementById('loyalty-result');
    return {
      resultVisible: !result?.classList.contains('hidden'),
      points:   document.getElementById('loy-points')?.innerText,
      name:     document.getElementById('loy-name')?.innerText,
      total:    document.getElementById('loy-total')?.innerText,
      group:    document.getElementById('loy-group')?.innerText,
      overflowY: document.body.style.overflowY,
      scrollH:   document.body.scrollHeight,
      innerH:    window.innerHeight,
    };
  });
  console.log('  Kết quả hiển thị:  ', loyaltyCheck.resultVisible ? '✅' : '❌');
  console.log('  Điểm:              ', loyaltyCheck.points);
  console.log('  Tên KH:            ', loyaltyCheck.name);
  console.log('  Tổng mua:          ', loyaltyCheck.total);
  console.log('  Hạng:              ', loyaltyCheck.group);
  console.log('  overflowY:         ', loyaltyCheck.overflowY);
  console.log('  scroll:', loyaltyCheck.scrollH, '>', loyaltyCheck.innerH, '→', loyaltyCheck.scrollH > loyaltyCheck.innerH ? 'cần cuộn, được phép ✅' : 'vừa màn hình ✅');

  results.loyalty = {
    resultOk:  loyaltyCheck.resultVisible && loyaltyCheck.points !== '0' && loyaltyCheck.name !== '—',
    scrollOk:  loyaltyCheck.overflowY === 'auto',
  };
  await ctx.close();
}

// ════════════════════════════════════════════════════════════
//  TAB 3: TOP 10
// ════════════════════════════════════════════════════════════
async function testTop10(browser) {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  TAB 3: TOP 10                      ║');
  console.log('╚══════════════════════════════════════╝');

  const ctx  = await browser.newContext({ ...iPhone13 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(500);
  await page.click('#tab-top');
  await page.waitForSelector('#top-loading.hidden', { timeout: 15000 }).catch(() => {});
  await sleep(600);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await page.screenshot({ path: SS('all-06-top10-top') });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await page.screenshot({ path: SS('all-07-top10-bottom') });

  const topCheck = await page.evaluate(() => ({
    rowCount:  document.querySelectorAll('#top-tbody .top-row').length,
    month:     document.getElementById('top-month')?.innerText?.trim(),
    countdown: document.getElementById('top-countdown')?.innerText?.trim(),
    overflowY: document.body.style.overflowY,
    scrollH:   document.body.scrollHeight,
    innerH:    window.innerHeight,
    top1:      document.querySelector('#top-tbody .top-row:first-child .top-name')?.innerText?.trim(),
    top1total: document.querySelector('#top-tbody .top-row:first-child .top-total')?.innerText?.trim(),
  }));
  console.log('  Số hàng bảng:  ', topCheck.rowCount);
  console.log('  Tháng:         ', topCheck.month);
  console.log('  Countdown:     ', topCheck.countdown);
  console.log('  overflowY:     ', topCheck.overflowY);
  console.log('  Scroll:        ', topCheck.scrollH, '>', topCheck.innerH, '→', topCheck.scrollH > topCheck.innerH ? 'cần cuộn, được phép ✅' : 'vừa màn hình ✅');
  console.log('  #1:            ', topCheck.top1, '—', topCheck.top1total);

  results.top10 = {
    dataOk:    topCheck.rowCount >= 10,
    scrollOk:  topCheck.overflowY === 'auto',
    countdownOk: topCheck.countdown && topCheck.countdown !== '--',
  };
  await ctx.close();
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
(async () => {
  const browser = await chromium.launch({ headless: true });

  await testSpin(browser);
  await testLoyalty(browser);
  await testTop10(browser);

  await browser.close();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  KẾT QUẢ TỔNG HỢP — MOBILE (iPhone 13) ║');
  console.log('╚══════════════════════════════════════════╝');

  const r = results;
  console.log('TAB QUAY THƯỞNG');
  console.log('  Form nhập vừa màn hình:', r.spin.formOk  ? 'PASS ✅' : 'FAIL ❌');
  console.log('  Vòng quay hiển thị đủ: ', r.spin.wheelOk ? 'PASS ✅' : 'FAIL ❌');
  console.log('  Scroll hợp lệ:         ', r.spin.scrollOk? 'PASS ✅' : 'FAIL ❌');

  console.log('TAB ĐIỂM TÍCH LŨY');
  console.log('  Thông tin KH đầy đủ:   ', r.loyalty.resultOk ? 'PASS ✅' : 'FAIL ❌');
  console.log('  Scroll hoạt động:       ', r.loyalty.scrollOk ? 'PASS ✅' : 'FAIL ❌');

  console.log('TAB TOP 10');
  console.log('  Có đủ 10 hàng dữ liệu: ', r.top10.dataOk    ? 'PASS ✅' : 'FAIL ❌');
  console.log('  Scroll hoạt động:       ', r.top10.scrollOk  ? 'PASS ✅' : 'FAIL ❌');
  console.log('  Countdown hiển thị:     ', r.top10.countdownOk?'PASS ✅' : 'FAIL ❌');

  const allPass = r.spin.formOk && r.spin.wheelOk && r.spin.scrollOk
               && r.loyalty.resultOk && r.loyalty.scrollOk
               && r.top10.dataOk && r.top10.scrollOk && r.top10.countdownOk;
  console.log('\n' + (allPass ? '✅ TẤT CẢ PASS' : '❌ CÓ CASE FAIL'));
})();
