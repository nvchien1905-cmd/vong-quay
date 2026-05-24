const { chromium } = require('playwright');
const path = require('path');

const URL  = 'https://vong-quay.vong-quay.workers.dev';
const SS   = (name) => path.join(__dirname, `salary-${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Chuyển tab bằng cách gọi showTab() trực tiếp (global function trong HTML)
async function switchTab(page, name, btnIdx) {
  const ok = await page.evaluate(({ name, btnIdx }) => {
    try {
      const btn = document.querySelectorAll('nav button')[btnIdx];
      // Gọi showTab trực tiếp nếu có
      if (typeof window.showTab === 'function') {
        window.showTab(name, btn);
        return { method: 'showTab', active: document.getElementById('tab-' + name)?.classList.contains('active') };
      }
      // Fallback: thao tác DOM trực tiếp
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
      const tab = document.getElementById('tab-' + name);
      if (tab) tab.classList.add('active');
      if (btn) btn.classList.add('active');
      if (name === 'nhanvien' && typeof window.renderEmpList === 'function') window.renderEmpList();
      if (name === 'tinhluong' && typeof window.fillEmpSelect === 'function') window.fillEmpSelect();
      return { method: 'fallback', active: tab?.classList.contains('active') };
    } catch (e) {
      return { error: e.message };
    }
  }, { name, btnIdx });
  console.log(`  switchTab('${name}'):`, ok);
  await sleep(400);
}

// Set giá trị input bằng evaluate (tránh visibility check của Playwright)
async function setVal(page, id, val) {
  await page.evaluate(({ id, val }) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
  }, { id, val });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 430, height: 900 });

  // Bắt console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PageError: ' + err.message));

  console.log('Mở trang...');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(800);

  // Kiểm tra globals
  const globals = await page.evaluate(() => ({
    hasShowTab:      typeof window.showTab,
    hasRenderEmpList: typeof window.renderEmpList,
    hasFillEmpSelect: typeof window.fillEmpSelect,
    tabCount:         document.querySelectorAll('.tab-content').length,
  }));
  console.log('Globals:', globals);

  // ── Screenshot Tab 1: KiotViet ──────────────────────────────
  await page.screenshot({ path: SS('01-kiotviet'), fullPage: false });
  console.log('✅ Tab 1 KiotViet →', SS('01-kiotviet'));

  // ── Screenshot Tab 2: Nhân viên (trống) ────────────────────
  await switchTab(page, 'nhanvien', 1);
  await page.screenshot({ path: SS('02-nhanvien-empty'), fullPage: false });
  console.log('✅ Tab 2 Nhân viên (trống) →', SS('02-nhanvien-empty'));

  // Thêm nhân viên mẫu qua evaluate
  await setVal(page, 'emp-name', 'Nguyễn Thị Hương');
  await setVal(page, 'emp-base', '5000000');
  await setVal(page, 'emp-hours', '192');
  await setVal(page, 'emp-commission', '1');
  await setVal(page, 'emp-note', 'Bán hàng Hoài Đức');

  const saveResult = await page.evaluate(() => {
    try {
      if (typeof window.saveEmployee === 'function') { window.saveEmployee(); return 'saveEmployee called'; }
      return 'saveEmployee not found';
    } catch (e) { return 'Error: ' + e.message; }
  });
  console.log('  saveEmployee:', saveResult);
  await sleep(400);
  await page.screenshot({ path: SS('02b-nhanvien-saved'), fullPage: false });
  console.log('✅ Tab 2 Nhân viên (sau thêm) →', SS('02b-nhanvien-saved'));

  // ── Screenshot Tab 3: Tính lương ───────────────────────────
  await switchTab(page, 'tinhluong', 2);
  await page.screenshot({ path: SS('03-tinhluong'), fullPage: false });
  console.log('✅ Tab 3 Tính lương →', SS('03-tinhluong'));

  // Nhập liệu tính lương
  const empOptions = await page.evaluate(() => {
    const sel = document.getElementById('sl-employee');
    if (!sel) return [];
    return Array.from(sel.options).map(o => o.text);
  });
  console.log('  Options nhân viên:', empOptions);

  await page.evaluate(() => {
    const sel = document.getElementById('sl-employee');
    if (sel && sel.options.length > 1) {
      sel.selectedIndex = 1;
      sel.dispatchEvent(new Event('change'));
    }
  });
  await sleep(200);
  await setVal(page, 'sl-hours', '160');
  await setVal(page, 'sl-sales', '80000000');
  await setVal(page, 'sl-bonus', '500000');

  const calcResult = await page.evaluate(() => {
    try {
      if (typeof window.calculateSalary === 'function') { window.calculateSalary(); return 'calculateSalary called'; }
      return 'not found';
    } catch (e) { return 'Error: ' + e.message; }
  });
  console.log('  calculateSalary:', calcResult);
  await sleep(2500);
  await page.screenshot({ path: SS('03b-phieu-luong'), fullPage: true });
  console.log('✅ Tab 3 Phiếu lương →', SS('03b-phieu-luong'));

  // ── Screenshot Tab 4: Bảng lương ───────────────────────────
  await switchTab(page, 'bangluong', 3);
  await page.screenshot({ path: SS('04-bangluong'), fullPage: false });
  console.log('✅ Tab 4 Bảng lương →', SS('04-bangluong'));

  if (consoleErrors.length) {
    console.log('\n⚠️  Console errors:');
    consoleErrors.forEach(e => console.log(' ', e));
  } else {
    console.log('\n✅ Không có console error');
  }

  await browser.close();
  console.log('\nXong! Xem ảnh: tests/salary-*.png');
})().catch(err => { console.error('LỖI:', err.message); process.exit(1); });
