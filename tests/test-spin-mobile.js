const { chromium, devices } = require('playwright');
const path = require('path');

const URL   = 'https://vong-quay.vong-quay.workers.dev';
const SS    = (name) => path.join(__dirname, `${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Dùng iPhone 13 device profile: đúng UA, touch, viewport
const iPhone13 = devices['iPhone 13'];

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Bước 1: Tab Quay Thưởng — form nhập ───────────────────────
  const ctx  = await browser.newContext({ ...iPhone13 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(600);

  await page.screenshot({ path: SS('s01-spin-form'), fullPage: false });
  console.log('✅ Chụp form nhập (step-phone)');

  // Kiểm tra form có hiển thị đầy đủ trong viewport không
  const formCheck = await page.evaluate(() => {
    const card = document.querySelector('#step-phone .card');
    const btn  = document.getElementById('check-btn');
    const rect  = card?.getBoundingClientRect();
    const brect = btn?.getBoundingClientRect();
    return {
      cardVisible:   rect  && rect.top >= 0 && rect.bottom <= window.innerHeight,
      btnVisible:    brect && brect.top >= 0 && brect.bottom <= window.innerHeight,
      cardBottom:    Math.round(rect?.bottom),
      btnBottom:     Math.round(brect?.bottom),
      innerHeight:   window.innerHeight,
      overflowY:     document.body.style.overflowY,
    };
  });
  console.log('  Card hoàn toàn trong viewport:', formCheck.cardVisible ? '✅' : '❌ (bottom=' + formCheck.cardBottom + ', vp=' + formCheck.innerHeight + ')');
  console.log('  Nút "Xác nhận" trong viewport: ', formCheck.btnVisible  ? '✅' : '❌ (bottom=' + formCheck.btnBottom  + ', vp=' + formCheck.innerHeight + ')');
  console.log('  body.overflowY trên spin tab:  ', formCheck.overflowY || 'hidden (default)');

  // ── Bước 2: Nhập SĐT + mã hợp lệ → chuyển sang vòng quay ─────
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/invoices?'), { timeout: 15000 }),
    (async () => {
      await page.fill('#phone-input',   '0912728919');
      await page.fill('#invoice-input', 'HD157387');
      await page.click('#check-btn');
    })(),
  ]);
  await response.json().catch(() => []);

  await Promise.race([
    page.waitForSelector('#step-wheel:not(.hidden)', { timeout: 10000 }).catch(() => {}),
    page.waitForFunction(() => document.getElementById('phone-msg')?.innerText?.trim().length > 0, { timeout: 10000 }).catch(() => {}),
  ]);
  await sleep(600);

  await page.screenshot({ path: SS('s02-spin-wheel'), fullPage: false });
  console.log('✅ Chụp vòng quay');

  // Kiểm tra vòng quay hiển thị đầy đủ
  const wheelCheck = await page.evaluate(() => {
    const wheel = document.getElementById('step-wheel');
    const btn   = document.getElementById('spin-btn');
    const canvas= document.getElementById('wheel-canvas');
    const wRect = wheel?.getBoundingClientRect();
    const cRect = canvas?.getBoundingClientRect();
    const bRect = btn?.getBoundingClientRect();
    return {
      wheelVisible:   !wheel?.classList.contains('hidden'),
      canvasSize:     Math.round(cRect?.width),
      canvasInVp:     cRect && cRect.top >= 0 && cRect.bottom <= window.innerHeight,
      spinBtnInVp:    bRect && bRect.top >= 0 && bRect.bottom <= window.innerHeight,
      wheelBottom:    Math.round(wRect?.bottom),
      innerHeight:    window.innerHeight,
      badge:          document.getElementById('cust-badge')?.innerText?.trim(),
      invBadge:       document.getElementById('inv-badge')?.innerText?.trim(),
    };
  });

  console.log('\n  Vòng quay:');
  console.log('  Wheel hiển thị:           ', wheelCheck.wheelVisible ? '✅' : '❌');
  console.log('  Canvas size:              ', wheelCheck.canvasSize + 'px');
  console.log('  Canvas trong viewport:    ', wheelCheck.canvasInVp   ? '✅' : '❌ (bottom=' + wheelCheck.wheelBottom + ', vp=' + wheelCheck.innerHeight + ')');
  console.log('  Nút QUAY trong viewport:  ', wheelCheck.spinBtnInVp  ? '✅' : '❌');
  console.log('  Badge KH:                 ', wheelCheck.badge);
  console.log('  Badge HĐ:                 ', wheelCheck.invBadge?.slice(0, 60));

  // ── Bước 3: Scroll kiểm tra có bị ẩn gì không ────────────────
  const scrollCheck = await page.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    innerHeight:  window.innerHeight,
    overflowY:    document.body.style.overflowY,
  }));
  console.log('\n  Scroll spin tab:');
  console.log('  body.overflowY:', scrollCheck.overflowY || 'hidden (default)');
  console.log('  scrollHeight:', scrollCheck.scrollHeight, '| innerHeight:', scrollCheck.innerHeight);
  console.log('  Nội dung vừa màn hình:', scrollCheck.scrollHeight <= scrollCheck.innerHeight ? '✅' : '⚠️ cần cuộn (' + scrollCheck.scrollHeight + 'px)');

  // ── Kết quả ───────────────────────────────────────────────────
  const passForm    = formCheck.cardVisible && formCheck.btnVisible;
  const passWheel   = wheelCheck.wheelVisible && wheelCheck.canvasInVp && wheelCheck.spinBtnInVp;
  // Nếu nội dung tràn, ít nhất phải cho phép scroll (overflowY: auto)
  const overflow    = scrollCheck.scrollHeight - scrollCheck.innerHeight;
  const passScroll  = overflow <= 0 || scrollCheck.overflowY === 'auto';

  console.log('\n══════════════════════════════');
  console.log('Form nhập vừa màn hình:  ', passForm   ? 'PASS ✅' : 'FAIL ❌');
  console.log('Vòng quay hiển thị đủ:  ', passWheel  ? 'PASS ✅' : 'FAIL ❌');
  console.log('Scroll khi cần (wheel):  ', passScroll ? 'PASS ✅' : 'FAIL ❌');

  await ctx.close();
  await browser.close();
})();
