'use strict';

/**
 * Test suite cho Salary Backend — Tổng Kho Gia Dụng Huyền Anh
 * Chạy: npm test
 * Không cần KiotViet thật — toàn bộ test dùng dữ liệu mock
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // tắt log trong khi test

const assert = require('assert');
const http = require('http');

const {
  calculateSalary,
  calculatePayrollFromKiotviet,
  calcTeamBonusFund,
  calcPIT,
  calcInsurance,
  calcHourCoeff,
  determineFTPT,
  CONSTANTS: C,
} = require('../services/salary');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function approx(actual, expected, tolerance = 1000) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= tolerance,
    `Kỳ vọng ≈${expected.toLocaleString('vi-VN')} nhưng nhận được ${actual.toLocaleString('vi-VN')} (sai lệch ${diff.toLocaleString('vi-VN')})`
  );
}

// ─── 1. Phân loại FT / PT ─────────────────────────────────────────────────────

console.log('\n[1] Phân loại FT / PT');

test('235 giờ → FT', () => assert.strictEqual(determineFTPT(235), 'FT'));
test('260 giờ → FT', () => assert.strictEqual(determineFTPT(260), 'FT'));
test('234 giờ → PT', () => assert.strictEqual(determineFTPT(234), 'PT'));
test('100 giờ → PT', () => assert.strictEqual(determineFTPT(100), 'PT'));

// ─── 2. Hệ số giờ ────────────────────────────────────────────────────────────

console.log('\n[2] Hệ số giờ');

test('FT 252h → hệ số 1.0', () => assert.strictEqual(calcHourCoeff(252, true), 1.0));
test('FT 310h → hệ số tối đa 1.2', () => assert.strictEqual(calcHourCoeff(310, true), 1.2));
test('PT 135h → hệ số 1.0', () => assert.strictEqual(calcHourCoeff(135, false), 1.0));
test('PT 162h → hệ số tối đa 1.2', () => assert.strictEqual(calcHourCoeff(162, false), 1.2));
test('FT 126h → hệ số 0.5', () => {
  const coeff = calcHourCoeff(126, true);
  approx(coeff, 0.5, 0.01);
});

// ─── 3. Bảo hiểm ────────────────────────────────────────────────────────────

console.log('\n[3] Bảo hiểm');

test('Lương 7tr → BHXH 560k, BHYT 105k, BHTN 70k', () => {
  const ins = calcInsurance(7_000_000);
  approx(ins.bhxh, 560_000);
  approx(ins.bhyt, 105_000);
  approx(ins.bhtn, 70_000);
  approx(ins.total, 735_000);
});

test('Lương 50tr > trần 46.8tr → tính theo trần', () => {
  const ins = calcInsurance(50_000_000);
  approx(ins.bhxh, 46_800_000 * 0.08);
});

// ─── 4. Thuế TNCN ────────────────────────────────────────────────────────────

console.log('\n[4] Thuế TNCN lũy tiến');

test('Thu nhập 8tr, 0 phụ thuộc → không đủ ngưỡng chịu thuế', () => {
  const { tax, taxableBase } = calcPIT(8_000_000, 0);
  // Thu nhập chịu thuế = 8tr - 11tr giảm trừ bản thân = âm → 0
  assert.strictEqual(taxableBase, 0);
  assert.strictEqual(tax, 0);
});

test('Thu nhập 15tr, 0 phụ thuộc → thuế bậc 1+2', () => {
  // Taxable = 15tr - 11tr = 4tr → bậc 1: 4tr × 5% = 200k
  const { tax, taxableBase } = calcPIT(15_000_000, 0);
  approx(taxableBase, 4_000_000);
  approx(tax, 200_000);
});

test('Thu nhập 25tr, 1 phụ thuộc → thuế bậc 1+2', () => {
  // Taxable = 25tr - 11tr - 4.4tr = 9.6tr
  // Bậc 1: 5tr × 5% = 250k; Bậc 2: 4.6tr × 10% = 460k → Tổng 710k
  const { tax } = calcPIT(25_000_000, 1);
  approx(tax, 710_000, 5_000);
});

test('Thu nhập 40tr, 2 phụ thuộc → thuế đa bậc', () => {
  // Taxable = 40tr - 11tr - 8.8tr = 20.2tr
  // B1: 5tr×5%=250k; B2: 5tr×10%=500k; B3: 8tr×15%=1.2tr; B4: 2.2tr×20%=440k → 2.39tr
  const { tax } = calcPIT(40_000_000, 2);
  approx(tax, 2_390_000, 10_000);
});

// ─── 5. Tính lương cơ bản ─────────────────────────────────────────────────────

console.log('\n[5] Tính lương — trường hợp cơ bản');

test('NV FT chính thức, 252h, 28 công, có người thay, 0 phụ thuộc', () => {
  const result = calculateSalary(
    { name: 'NV Test', position: 'NV', isProbation: false, seniorityMonths: 0, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: true, teamBonusShare: 0 }
  );
  assert.strictEqual(result.classification.type, 'FT');
  assert.strictEqual(result.classification.hourCoeff, 1.0);
  approx(result.breakdown.adjustedSalary, 7_000_000);
  approx(result.breakdown.ftAllowance, 560_000);
  approx(result.breakdown.attendBonus, 500_000);
  assert.ok(result.netSalary > 0);
});

test('NV PT chính thức, 130h, 25 công, không có người thay', () => {
  const result = calculateSalary(
    { name: 'NV PT', position: 'NV', isProbation: false, seniorityMonths: 0, dependents: 0 },
    { actualHours: 130, actualShifts: 25, hasReplacement: false, teamBonusShare: 0 }
  );
  assert.strictEqual(result.classification.type, 'PT');
  assert.strictEqual(result.breakdown.ftAllowance, 0);
  assert.strictEqual(result.breakdown.attendBonus, 0); // thiếu công & không có người thay
});

test('NV thử việc FT → lương cứng × 85%', () => {
  const result = calculateSalary(
    { name: 'NV TV', position: 'NV', isProbation: true, seniorityMonths: 0, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: false, teamBonusShare: 0 }
  );
  approx(result.breakdown.baseSalary, 7_000_000 * 0.85);
  assert.strictEqual(result.breakdown.ftAllowance, 0); // thử việc không có phụ cấp FT
});

test('CHT: có phụ cấp 1.5tr', () => {
  const result = calculateSalary(
    { name: 'CHT Test', position: 'CHT', isProbation: false, seniorityMonths: 0, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: true, teamBonusShare: 0 }
  );
  approx(result.breakdown.positionAllowance, 1_500_000);
});

test('CHP: có phụ cấp 1tr', () => {
  const result = calculateSalary(
    { name: 'CHP Test', position: 'CHP', isProbation: false, seniorityMonths: 0, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: true, teamBonusShare: 0 }
  );
  approx(result.breakdown.positionAllowance, 1_000_000);
});

// ─── 6. Thâm niên ────────────────────────────────────────────────────────────

console.log('\n[6] Thưởng thâm niên');

test('FT 24 tháng → thưởng 200k (2 năm × 100k)', () => {
  const result = calculateSalary(
    { name: 'NV Senior', position: 'NV', isProbation: false, seniorityMonths: 24, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: false, teamBonusShare: 0 }
  );
  approx(result.breakdown.seniorityBonus, 200_000);
});

test('PT 36 tháng → thưởng 150k (3 năm × 50k)', () => {
  const result = calculateSalary(
    { name: 'NV PT Senior', position: 'NV', isProbation: false, seniorityMonths: 36, dependents: 0 },
    { actualHours: 100, actualShifts: 20, hasReplacement: false, teamBonusShare: 0 }
  );
  approx(result.breakdown.seniorityBonus, 150_000);
});

test('11 tháng → thưởng 0 (chưa đủ 1 năm)', () => {
  const result = calculateSalary(
    { name: 'NV New', position: 'NV', isProbation: false, seniorityMonths: 11, dependents: 0 },
    { actualHours: 252, actualShifts: 28, hasReplacement: false, teamBonusShare: 0 }
  );
  assert.strictEqual(result.breakdown.seniorityBonus, 0);
});

// ─── 7. Quỹ thưởng tập thể ───────────────────────────────────────────────────

console.log('\n[7] Quỹ thưởng tập thể');

test('Đạt đúng 100% mục tiêu 500tr → quỹ = 2tr + 0.5%×500tr', () => {
  const fund = calcTeamBonusFund(500_000_000, 500_000_000);
  // 2_000_000 + 500_000_000 × 0.005 = 2_000_000 + 2_500_000 = 4_500_000
  approx(fund, 4_500_000);
});

test('Vượt mục tiêu 500tr, thực tế 550tr → quỹ tăng thêm 1%×50tr', () => {
  const fund = calcTeamBonusFund(550_000_000, 500_000_000);
  // 4_500_000 + 50_000_000 × 0.01 = 4_500_000 + 500_000 = 5_000_000
  approx(fund, 5_000_000);
});

test('Không đạt mục tiêu (499tr/500tr) → quỹ = 0', () => {
  const fund = calcTeamBonusFund(499_000_000, 500_000_000);
  assert.strictEqual(fund, 0);
});

test('Mục tiêu = 0 → quỹ = 0 (tránh chia cho 0)', () => {
  const fund = calcTeamBonusFund(100_000_000, 0);
  assert.strictEqual(fund, 0);
});

// ─── 8. Tính bảng lương từ dữ liệu KiotViet mock ────────────────────────────

console.log('\n[8] Bảng lương từ dữ liệu KiotViet (mock)');

const mockKiotvietData = {
  fromDate: '2024-01-01',
  toDate: '2024-01-31',
  totalRevenue: 550_000_000,
  employees: [
    { id: 'E001', name: 'Nguyễn Thị Lan (CHT)' },
    { id: 'E002', name: 'Trần Văn Bình (CHP)' },
    { id: 'E003', name: 'Lê Thị Cúc (NV FT)' },
    { id: 'E004', name: 'Phạm Văn Dũng (NV PT)' },
    { id: 'E005', name: 'Hoàng Thị Em (NVTV FT)' },
  ],
  attendances: {
    E001: { totalHours: 260, totalDays: 28 },
    E002: { totalHours: 255, totalDays: 27 },
    E003: { totalHours: 252, totalDays: 28 },
    E004: { totalHours: 130, totalDays: 22 },
    E005: { totalHours: 240, totalDays: 26 },
  },
  revenueByEmployee: {},
  fetchedAt: new Date().toISOString(),
};

const mockSettings = [
  { employeeId: 'E001', position: 'CHT', isProbation: false, seniorityMonths: 36, dependents: 2, hasReplacement: true },
  { employeeId: 'E002', position: 'CHP', isProbation: false, seniorityMonths: 24, dependents: 1, hasReplacement: true },
  { employeeId: 'E003', position: 'NV',  isProbation: false, seniorityMonths: 12, dependents: 0, hasReplacement: true },
  { employeeId: 'E004', position: 'NV',  isProbation: false, seniorityMonths: 6,  dependents: 0, hasReplacement: false },
  { employeeId: 'E005', position: 'NV',  isProbation: true,  seniorityMonths: 2,  dependents: 0, hasReplacement: false },
];

const payroll = calculatePayrollFromKiotviet(mockKiotvietData, 500_000_000, mockSettings);

test('Bảng lương có đủ 5 nhân viên', () => {
  assert.strictEqual(payroll.summary.employeeCount, 5);
});

test('Đạt 110% mục tiêu → có quỹ thưởng', () => {
  assert.ok(payroll.teamBonus.fund > 0, `Quỹ thưởng: ${payroll.teamBonus.fund}`);
  approx(payroll.revenue.achievementRate, 110, 1); // 110%
});

test('CHT (E001) nhận nhiều nhất', () => {
  const cht = payroll.payroll.find((r) => r.employeeId === 'E001');
  const nv  = payroll.payroll.find((r) => r.employeeId === 'E003');
  assert.ok(cht, 'Không tìm thấy CHT');
  assert.ok(cht.netSalary > nv.netSalary, `CHT ${cht.netSalary} > NV ${nv.netSalary}`);
});

test('NVTV FT (E005) nhận ít hơn NV FT chính thức (E003)', () => {
  const nvtv = payroll.payroll.find((r) => r.employeeId === 'E005');
  const nv   = payroll.payroll.find((r) => r.employeeId === 'E003');
  assert.ok(nvtv.netSalary < nv.netSalary);
});

test('Tổng gross = tổng cộng gross từng người', () => {
  const sumGross = payroll.payroll.reduce((s, r) => s + r.grossIncome, 0);
  approx(sumGross, payroll.summary.totalGross);
});

test('Tổng net = gross - bảo hiểm - thuế', () => {
  const computedNet = payroll.summary.totalGross - payroll.summary.totalInsurance - payroll.summary.totalPIT;
  approx(computedNet, payroll.summary.totalNet, 5_000);
});

test('NV PT (E004) thiếu công + không có người thay → không có thưởng CC', () => {
  const pt = payroll.payroll.find((r) => r.employeeId === 'E004');
  assert.strictEqual(pt.breakdown.attendBonus, 0);
});

// ─── 9. HTTP API endpoints ───────────────────────────────────────────────────

console.log('\n[9] HTTP API endpoints');

// Override KiotViet service để không cần credentials thật
const kiotvietService = require('../services/kiotviet');
const originalGetSalaryData = kiotvietService.getSalaryData;
kiotvietService.getSalaryData = async () => mockKiotvietData;

const app = require('../src/server');
let server;

function startServer(port = 0) {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(port, () => resolve(server.address().port));
  });
}

function stopServer() {
  return new Promise((resolve) => server.close(resolve));
}

function request(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runApiTests() {
  let port;
  try {
    port = await startServer();

    await testAsync('[API] GET /health → 200', async () => {
      const res = await request(port, 'GET', '/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
    });

    await testAsync('[API] GET /api/kiotviet/status → 200', async () => {
      const res = await request(port, 'GET', '/api/kiotviet/status');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.config);
    });

    await testAsync('[API] GET /api/kiotviet/salary-data?year=2024&month=1 → 200 (mock)', async () => {
      const res = await request(port, 'GET', '/api/kiotviet/salary-data?year=2024&month=1');
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.employees));
    });

    await testAsync('[API] GET /api/kiotviet/salary-data thiếu params → 400', async () => {
      const res = await request(port, 'GET', '/api/kiotviet/salary-data');
      assert.strictEqual(res.status, 400);
    });

    await testAsync('[API] POST /api/kiotviet/clear-cache → 200', async () => {
      const res = await request(port, 'POST', '/api/kiotviet/clear-cache');
      assert.strictEqual(res.status, 200);
    });

    await testAsync('[API] POST /api/salary/calculate → 200', async () => {
      const res = await request(port, 'POST', '/api/salary/calculate', {
        employee: { name: 'Test NV', position: 'NV', isProbation: false, seniorityMonths: 12, dependents: 1 },
        input: { actualHours: 252, actualShifts: 28, hasReplacement: true, teamBonusShare: 300000 },
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.netSalary > 0);
    });

    await testAsync('[API] POST /api/salary/calculate thiếu body → 400', async () => {
      const res = await request(port, 'POST', '/api/salary/calculate', {});
      assert.strictEqual(res.status, 400);
    });

    await testAsync('[API] POST /api/salary/payroll-from-kiotviet → 200 (mock)', async () => {
      const res = await request(port, 'POST', '/api/salary/payroll-from-kiotviet', {
        year: 2024,
        month: 1,
        targetRevenue: 500_000_000,
        employeeSettings: mockSettings,
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.payroll.length > 0);
    });

    await testAsync('[API] GET /not-found → 404', async () => {
      const res = await request(port, 'GET', '/not-found');
      assert.strictEqual(res.status, 404);
    });
  } finally {
    await stopServer();
    kiotvietService.getSalaryData = originalGetSalaryData; // restore
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

// ─── Chạy tất cả ──────────────────────────────────────────────────────────────

runApiTests()
  .then(() => {
    console.log('\n' + '═'.repeat(50));
    console.log(`Kết quả: ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log('\nLỗi:');
      failures.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
    }
    console.log('═'.repeat(50));
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nTest suite crash:', err);
    process.exit(1);
  });
