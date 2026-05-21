const { chromium, devices } = require('playwright');
const path = require('path');

const URL   = 'https://vong-quay.vong-quay.workers.dev';
const SS    = (name) => path.join(__dirname, `${name}.png`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Điện thoại test: iPhone 13 viewport (390×844)
const PHONE = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ── Bước 1: Trang chủ trên mobile ─────────────────────────────
  const p0 = await browser.newPage();
  await p0.setViewportSize(PHONE);
  await p0.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(800);
  await p0.screenshot({ path: SS('m01-trang-chu'), fullPage: false });
  console.log('✅ Chụp trang chủ mobile');

  // ── Bước 2: Chuyển sang tab Điểm Tích Lũy ────────────────────
  await p0.click('#tab-loyalty');
  await sleep(400);
  await p0.screenshot({ path: SS('m02-loyalty-empty'), fullPage: false });
  console.log('✅ Chụp tab loyalty (chưa nhập SĐT)');

  // Kiểm tra body overflow-y khi ở loyalty tab
  const overflowY = await p0.evaluate(() => document.body.style.overflowY);
  console.log('  body.style.overflowY trên loyalty tab:', overflowY || '(mặc định css)');
  const canScroll = await p0.evaluate(() => {
    const bh = document.body.scrollHeight;
    const vh = window.innerHeight;
    return { scrollHeight: bh, innerHeight: vh, scrollable: bh > vh };
  });
  console.log('  scrollHeight:', canScroll.scrollHeight, '| innerHeight:', canScroll.innerHeight, '| scrollable:', canScroll.scrollable);

  // ── Bước 3: Nhập SĐT và xem kết quả tích lũy ─────────────────
  await p0.fill('#loyalty-phone-input', '0912728919');
  await p0.click('#loyalty-check-btn');

  // Đợi kết quả hiện
  await p0.waitForSelector('#loyalty-result:not(.hidden)', { timeout: 12000 }).catch(() => {});
  await sleep(600);

  // Chụp trạng thái ban đầu (đầu trang)
  await p0.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await p0.screenshot({ path: SS('m03-loyalty-result-top'), fullPage: false });
  console.log('✅ Chụp kết quả tích lũy (đầu trang)');

  // Scroll xuống cuối để xem hết thông tin
  await p0.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  await p0.screenshot({ path: SS('m04-loyalty-result-bottom'), fullPage: false });
  console.log('✅ Chụp kết quả tích lũy (cuối trang)');

  // Chụp toàn bộ trang (fullPage) để thấy hết nội dung
  await p0.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await p0.screenshot({ path: SS('m05-loyalty-fullpage'), fullPage: true });
  console.log('✅ Chụp toàn bộ trang loyalty (fullPage)');

  // Kiểm tra các trường thông tin có hiển thị không
  const info = await p0.evaluate(() => ({
    points:  document.getElementById('loy-points')?.innerText,
    name:    document.getElementById('loy-name')?.innerText,
    phone:   document.getElementById('loy-phone')?.innerText,
    total:   document.getElementById('loy-total')?.innerText,
    group:   document.getElementById('loy-group')?.innerText,
    resultVisible: !document.getElementById('loyalty-result')?.classList.contains('hidden'),
  }));
  console.log('\n  Thông tin hiển thị:');
  console.log('  - Điểm tích lũy:', info.points);
  console.log('  - Tên KH:       ', info.name);
  console.log('  - SĐT:          ', info.phone);
  console.log('  - Tổng mua:     ', info.total);
  console.log('  - Hạng:         ', info.group);
  console.log('  - Result box:   ', info.resultVisible ? 'hiển thị ✅' : 'ẩn ❌');

  // Kiểm tra có thể scroll đến cuối không
  const scrollAfter = await p0.evaluate(() => ({
    scrollHeight: document.body.scrollHeight,
    innerHeight:  window.innerHeight,
    scrollTop:    document.documentElement.scrollTop || document.body.scrollTop,
  }));
  const overflowAfter = await p0.evaluate(() => document.body.style.overflowY);
  console.log('\n  Sau khi load kết quả:');
  console.log('  body.overflowY:', overflowAfter);
  console.log('  scrollHeight:', scrollAfter.scrollHeight, '| innerHeight:', scrollAfter.innerHeight);
  const needScroll = scrollAfter.scrollHeight > scrollAfter.innerHeight;
  console.log('  Cần cuộn để xem hết:', needScroll ? 'CÓ' : 'KHÔNG');
  console.log('  Có thể cuộn:', overflowAfter === 'auto' ? 'CÓ ✅' : 'KHÔNG ❌ (' + overflowAfter + ')');

  const passScroll = overflowAfter === 'auto';
  const passInfo   = info.resultVisible && info.points !== '0' && info.name !== '—';

  console.log('\n══════════════════════════════');
  console.log('Scroll trên loyalty tab:', passScroll ? 'PASS ✅' : 'FAIL ❌');
  console.log('Thông tin KH hiển thị: ', passInfo   ? 'PASS ✅' : 'FAIL ❌');

  await p0.close();
  await browser.close();
})();
