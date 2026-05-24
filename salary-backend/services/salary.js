'use strict';

// ============================================================
// HẰNG SỐ TÍNH LƯƠNG - Tổng Kho Gia Dụng Huyền Anh
// ============================================================
const C = {
  FT_BASE: 7_000_000,
  PT_BASE: 4_000_000,
  STANDARD_SHIFTS: 28,

  // Ngưỡng phân loại FT/PT
  FT_HOUR_THRESHOLD: 235,

  // Giờ chuẩn để tính hệ số
  FT_STANDARD_HOURS: 252,
  PT_STANDARD_HOURS: 135,
  MAX_HOUR_COEFF: 1.2,

  // Thử việc
  PROBATION_FACTOR: 0.85,

  // Phụ cấp
  FT_ALLOWANCE: 560_000,       // NV chính thức FT
  CHP_ALLOWANCE: 1_000_000,    // Cửa hàng phó
  CHT_ALLOWANCE: 1_500_000,    // Cửa hàng trưởng

  // Thưởng chuyên cần (đủ 28 công + có người thay)
  ATTEND_BONUS_FT: 500_000,
  ATTEND_BONUS_PT: 300_000,

  // Thưởng thâm niên (mỗi 12 tháng)
  SENIORITY_FT_PER_YEAR: 100_000,
  SENIORITY_PT_PER_YEAR: 50_000,

  // Thưởng tập thể
  TEAM_BONUS_BASE: 2_000_000,
  TEAM_BONUS_TARGET_RATE: 0.005,   // 0.5% mục tiêu
  TEAM_BONUS_EXCEED_RATE: 0.01,    // 1% phần vượt

  // Hệ số thưởng tập thể theo vị trí
  TEAM_COEFF: {
    CHT: 1.7,
    CHP: 1.25,
    NV_FT: 1.0,
    NV_PT: 0.6,
    NVTV_FT: 0.5,
    NVTV_PT: 0.3,
  },

  // Bảo hiểm xã hội (phần nhân viên đóng)
  INSURANCE_CEILING: 46_800_000,
  BHXH_RATE: 0.08,
  BHYT_RATE: 0.015,
  BHTN_RATE: 0.01,

  // Giảm trừ gia cảnh thuế TNCN
  PERSONAL_DEDUCTION: 11_000_000,
  DEPENDENT_DEDUCTION: 4_400_000,

  // Bậc thuế TNCN lũy tiến (phạm vi của từng bậc)
  PIT_BRACKETS: [
    { bandwidth: 5_000_000,  rate: 0.05 },
    { bandwidth: 5_000_000,  rate: 0.10 },
    { bandwidth: 8_000_000,  rate: 0.15 },
    { bandwidth: 14_000_000, rate: 0.20 },
    { bandwidth: 20_000_000, rate: 0.25 },
    { bandwidth: 28_000_000, rate: 0.30 },
    { bandwidth: Infinity,   rate: 0.35 },
  ],
};

// ============================================================
// CÁC HÀM TIỆN ÍCH
// ============================================================

/** Làm tròn đến hàng nghìn đồng */
function round1k(value) {
  return Math.round(value / 1000) * 1000;
}

/** Xác định FT hay PT dựa trên giờ làm thực tế */
function determineFTPT(actualHours) {
  return actualHours >= C.FT_HOUR_THRESHOLD ? 'FT' : 'PT';
}

/** Tính hệ số giờ (tối đa 1.2) */
function calcHourCoeff(actualHours, isFT) {
  const standardHours = isFT ? C.FT_STANDARD_HOURS : C.PT_STANDARD_HOURS;
  return Math.min(actualHours / standardHours, C.MAX_HOUR_COEFF);
}

/** Tính khấu trừ bảo hiểm nhân viên đóng */
function calcInsurance(grossSalary) {
  const base = Math.min(grossSalary, C.INSURANCE_CEILING);
  const bhxh = base * C.BHXH_RATE;
  const bhyt = base * C.BHYT_RATE;
  const bhtn = base * C.BHTN_RATE;
  return { bhxh, bhyt, bhtn, total: bhxh + bhyt + bhtn };
}

/** Tính thuế TNCN lũy tiến 7 bậc */
function calcPIT(incomeAfterInsurance, dependents = 0) {
  const deduction =
    C.PERSONAL_DEDUCTION + dependents * C.DEPENDENT_DEDUCTION;
  const taxableBase = Math.max(0, incomeAfterInsurance - deduction);

  let tax = 0;
  let remaining = taxableBase;

  for (const bracket of C.PIT_BRACKETS) {
    if (remaining <= 0) break;
    const taxable =
      bracket.bandwidth === Infinity
        ? remaining
        : Math.min(remaining, bracket.bandwidth);
    tax += taxable * bracket.rate;
    remaining -= taxable;
  }

  return { tax, taxableBase, deduction };
}

/**
 * Lấy key hệ số thưởng tập thể theo vị trí, loại hình và trạng thái
 * @param {'CHT'|'CHP'|'NV'} position
 * @param {boolean} isFT
 * @param {boolean} isProbation
 */
function getTeamBonusCoeffKey(position, isFT, isProbation) {
  if (position === 'CHT') return 'CHT';
  if (position === 'CHP') return 'CHP';
  if (isProbation) return isFT ? 'NVTV_FT' : 'NVTV_PT';
  return isFT ? 'NV_FT' : 'NV_PT';
}

/**
 * Tính quỹ thưởng tập thể
 * @param {number} actualRevenue - Doanh thu thực tế tháng
 * @param {number} targetRevenue - Mục tiêu doanh thu tháng
 * @returns {number} Quỹ thưởng (0 nếu không đạt 100% mục tiêu)
 */
function calcTeamBonusFund(actualRevenue, targetRevenue) {
  if (targetRevenue <= 0 || actualRevenue < targetRevenue) return 0;
  const excessRevenue = actualRevenue - targetRevenue;
  return (
    C.TEAM_BONUS_BASE +
    targetRevenue * C.TEAM_BONUS_TARGET_RATE +
    excessRevenue * C.TEAM_BONUS_EXCEED_RATE
  );
}

// ============================================================
// TÍNH LƯƠNG CHO MỘT NHÂN VIÊN
// ============================================================

/**
 * Tính toàn bộ lương cho một nhân viên
 *
 * @param {object} employee
 * @param {string}  employee.name
 * @param {'CHT'|'CHP'|'NV'} employee.position
 * @param {boolean} employee.isProbation     - Đang thử việc
 * @param {number}  employee.seniorityMonths - Số tháng thâm niên
 * @param {number}  employee.dependents      - Số người phụ thuộc
 *
 * @param {object} input
 * @param {number}  input.actualHours    - Giờ làm thực tế trong tháng
 * @param {number}  input.actualShifts   - Số công thực tế
 * @param {boolean} input.hasReplacement - Có người thay ca (để được thưởng CC)
 * @param {number}  [input.teamBonusShare=0] - Phần thưởng tập thể đã phân bổ cho NV này
 *
 * @returns {object} Chi tiết bảng lương
 */
function calculateSalary(employee, input) {
  const {
    name = '',
    position = 'NV',
    isProbation = false,
    seniorityMonths = 0,
    dependents = 0,
  } = employee;

  const {
    actualHours = 0,
    actualShifts = 0,
    hasReplacement = false,
    teamBonusShare = 0,
  } = input;

  // 1. Xác định FT/PT
  const isFT = determineFTPT(actualHours);

  // 2. Lương cứng gốc (theo FT/PT) × hệ số thử việc
  const baseRaw = isFT === 'FT' ? C.FT_BASE : C.PT_BASE;
  const baseSalary = isProbation ? baseRaw * C.PROBATION_FACTOR : baseRaw;

  // 3. Hệ số giờ & lương cứng điều chỉnh
  const hourCoeff = calcHourCoeff(actualHours, isFT === 'FT');
  const adjustedSalary = baseSalary * hourCoeff;

  // 4. Phụ cấp FT (chỉ áp dụng NV chính thức FT)
  const ftAllowance = !isProbation && isFT === 'FT' ? C.FT_ALLOWANCE : 0;

  // 5. Thưởng chuyên cần
  let attendBonus = 0;
  if (actualShifts >= C.STANDARD_SHIFTS && hasReplacement) {
    attendBonus = isFT === 'FT' ? C.ATTEND_BONUS_FT : C.ATTEND_BONUS_PT;
  }

  // 6. Thưởng thâm niên
  const seniorityYears = Math.floor(seniorityMonths / 12);
  const seniorityBonus =
    seniorityYears *
    (isFT === 'FT' ? C.SENIORITY_FT_PER_YEAR : C.SENIORITY_PT_PER_YEAR);

  // 7. Phụ cấp chức vụ
  let positionAllowance = 0;
  if (position === 'CHT') positionAllowance = C.CHT_ALLOWANCE;
  else if (position === 'CHP') positionAllowance = C.CHP_ALLOWANCE;

  // 8. Thu nhập gộp trước bảo hiểm
  const grossIncome =
    adjustedSalary +
    ftAllowance +
    attendBonus +
    seniorityBonus +
    positionAllowance +
    teamBonusShare;

  // 9. Bảo hiểm
  const insurance = calcInsurance(adjustedSalary); // BH tính trên lương hợp đồng

  // 10. Thu nhập chịu thuế
  const incomeAfterInsurance = grossIncome - insurance.total;
  const pitResult = calcPIT(incomeAfterInsurance, dependents);

  // 11. Lương thực nhận
  const netSalary = grossIncome - insurance.total - pitResult.tax;

  return {
    employee: { name, position, isProbation, seniorityMonths, dependents },
    classification: {
      type: isFT,
      actualHours,
      hourCoeff: parseFloat(hourCoeff.toFixed(4)),
    },
    breakdown: {
      baseSalary: round1k(baseSalary),
      adjustedSalary: round1k(adjustedSalary),
      ftAllowance,
      attendBonus,
      seniorityBonus,
      positionAllowance,
      teamBonusShare: round1k(teamBonusShare),
    },
    grossIncome: round1k(grossIncome),
    deductions: {
      bhxh: round1k(insurance.bhxh),
      bhyt: round1k(insurance.bhyt),
      bhtn: round1k(insurance.bhtn),
      totalInsurance: round1k(insurance.total),
      taxableBase: round1k(pitResult.taxableBase),
      personalDeduction: pitResult.deduction,
      pit: round1k(pitResult.tax),
    },
    netSalary: round1k(netSalary),
  };
}

// ============================================================
// TÍNH BẢNG LƯƠNG TỪ DỮ LIỆU KIOTVIET
// ============================================================

/**
 * Tính toàn bộ bảng lương từ dữ liệu KiotViet
 *
 * @param {object} kiotvietData - Dữ liệu từ kiotvietService.getSalaryData()
 * @param {number} targetRevenue - Mục tiêu doanh thu tháng
 * @param {Array}  employeeSettings - Cài đặt thủ công từng NV
 *   [{
 *     employeeId, isProbation, position, dependents,
 *     seniorityMonths, hasReplacement
 *   }]
 *
 * @returns {object} Bảng lương đầy đủ
 */
function calculatePayrollFromKiotviet(kiotvietData, targetRevenue, employeeSettings = []) {
  const { employees, attendances, totalRevenue, fromDate, toDate } = kiotvietData;

  // Map settings theo employeeId để tra cứu nhanh
  const settingsMap = {};
  for (const s of employeeSettings) {
    settingsMap[String(s.employeeId)] = s;
  }

  // Tính quỹ thưởng tập thể
  const teamBonusFund = calcTeamBonusFund(totalRevenue, targetRevenue);
  const achievementRate = targetRevenue > 0 ? totalRevenue / targetRevenue : 0;

  // Bước 1: tính hệ số giờ & loại hình từng NV, phục vụ chia thưởng tập thể
  const employeeCalcData = employees.map((emp) => {
    const empId = String(emp.id || emp.employeeId || '');
    const settings = settingsMap[empId] || {};
    const attendance = attendances[empId] || { totalHours: 0, totalDays: 0 };

    // Ưu tiên settings.actualHours (nhập tay) khi invoice không có dữ liệu giờ
    const actualHours = settings.actualHours ?? attendance.totalHours ?? 0;
    const isFT = determineFTPT(actualHours);
    const hourCoeff = calcHourCoeff(actualHours, isFT === 'FT');
    const position = settings.position || emp.department || 'NV';
    const isProbation = settings.isProbation !== undefined ? settings.isProbation : false;

    const teamCoeffKey = getTeamBonusCoeffKey(position, isFT === 'FT', isProbation);
    const teamCoeff = C.TEAM_COEFF[teamCoeffKey] || 1.0;
    const weightedCoeff = teamCoeff * hourCoeff;

    return {
      emp,
      empId,
      settings,
      attendance,
      actualHours,
      isFT,
      hourCoeff,
      position,
      isProbation,
      teamCoeff,
      weightedCoeff,
    };
  });

  // Bước 2: tổng hệ số có trọng số (để chia thưởng tập thể)
  const totalWeightedCoeff = employeeCalcData.reduce((sum, d) => sum + d.weightedCoeff, 0);

  // Bước 3: tính lương từng NV
  const payrollRows = employeeCalcData.map((d) => {
    const { emp, empId, settings, attendance, actualHours, position, isProbation, weightedCoeff } = d;

    const teamBonusShare =
      totalWeightedCoeff > 0 ? (weightedCoeff / totalWeightedCoeff) * teamBonusFund : 0;

    const employeeInput = {
      name: emp.name || emp.givenName || empId,
      position,
      isProbation,
      seniorityMonths: settings.seniorityMonths || 0,
      dependents: settings.dependents || 0,
    };

    const salaryInput = {
      actualHours,
      actualShifts: settings.actualShifts ?? attendance.totalDays ?? 0,
      hasReplacement: settings.hasReplacement || false,
      teamBonusShare,
    };

    const result = calculateSalary(employeeInput, salaryInput);

    return {
      employeeId: empId,
      employeeCode: emp.code || empId,
      ...result,
      teamBonus: {
        fund: round1k(teamBonusFund),
        weightedCoeff: parseFloat(d.weightedCoeff.toFixed(4)),
        share: round1k(teamBonusShare),
      },
    };
  });

  // Tổng hợp
  const summary = {
    totalGross: payrollRows.reduce((s, r) => s + r.grossIncome, 0),
    totalNet: payrollRows.reduce((s, r) => s + r.netSalary, 0),
    totalInsurance: payrollRows.reduce((s, r) => s + r.deductions.totalInsurance, 0),
    totalPIT: payrollRows.reduce((s, r) => s + r.deductions.pit, 0),
    employeeCount: payrollRows.length,
  };

  return {
    period: { fromDate, toDate },
    revenue: {
      target: targetRevenue,
      actual: totalRevenue,
      achievementRate: parseFloat((achievementRate * 100).toFixed(2)),
    },
    teamBonus: {
      fund: round1k(teamBonusFund),
      totalWeightedCoeff: parseFloat(totalWeightedCoeff.toFixed(4)),
    },
    summary,
    payroll: payrollRows,
  };
}

module.exports = {
  calculateSalary,
  calculatePayrollFromKiotviet,
  calcTeamBonusFund,
  calcPIT,
  calcInsurance,
  calcHourCoeff,
  determineFTPT,
  CONSTANTS: C,
};
