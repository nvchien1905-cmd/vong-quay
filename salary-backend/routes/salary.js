'use strict';

const express = require('express');
const router = express.Router();
const salaryService = require('../services/salary');
const kiotvietService = require('../services/kiotviet');
const logger = require('../src/logger');

// POST /api/salary/calculate
// Tính lương cho 1 nhân viên với input tùy chỉnh
router.post('/calculate', (req, res, next) => {
  try {
    const { employee, input } = req.body;

    if (!employee || !input) {
      return res.status(400).json({
        error: 'Body phải có 2 trường: employee (thông tin NV) và input (dữ liệu tháng).',
        example: {
          employee: {
            name: 'Nguyễn Văn A',
            position: 'NV',
            isProbation: false,
            seniorityMonths: 24,
            dependents: 1,
          },
          input: {
            actualHours: 260,
            actualShifts: 28,
            hasReplacement: true,
            teamBonusShare: 500000,
          },
        },
      });
    }

    if (!['CHT', 'CHP', 'NV'].includes(employee.position)) {
      return res.status(400).json({
        error: 'employee.position phải là: CHT (cửa hàng trưởng), CHP (cửa hàng phó), hoặc NV (nhân viên)',
      });
    }

    const result = salaryService.calculateSalary(employee, input);
    logger.info(`Tính lương: ${employee.name || 'N/A'}, lương thực nhận: ${result.netSalary.toLocaleString('vi-VN')}đ`);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/salary/payroll-from-kiotviet
// Tính bảng lương toàn shop từ dữ liệu KiotViet
router.post('/payroll-from-kiotviet', async (req, res, next) => {
  try {
    const { year, month, targetRevenue, employeeSettings } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: 'Cần cung cấp year và month' });
    }

    if (!targetRevenue || targetRevenue <= 0) {
      return res.status(400).json({ error: 'targetRevenue phải là số dương (đơn vị: đồng)' });
    }

    const parsedYear = parseInt(year);
    const parsedMonth = parseInt(month);

    if (parsedMonth < 1 || parsedMonth > 12) {
      return res.status(400).json({ error: 'month phải trong khoảng 1-12' });
    }

    logger.info(`Bắt đầu tính bảng lương ${parsedYear}/${parsedMonth}, mục tiêu: ${targetRevenue.toLocaleString('vi-VN')}đ`);

    const kiotvietData = await kiotvietService.getSalaryData(parsedYear, parsedMonth);
    const payroll = salaryService.calculatePayrollFromKiotviet(
      kiotvietData,
      targetRevenue,
      employeeSettings || []
    );

    logger.info(
      `Bảng lương ${parsedYear}/${parsedMonth}: ${payroll.summary.employeeCount} NV, tổng lương thực nhận: ${payroll.summary.totalNet.toLocaleString('vi-VN')}đ`
    );

    res.json(payroll);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
