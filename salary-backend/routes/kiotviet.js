'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const config = require('../config');
const kiotvietService = require('../services/kiotviet');

const kiotvietLimiter = rateLimit({
  windowMs: config.rateLimit.kiotviet.windowMs,
  max: config.rateLimit.kiotviet.max,
  message: { error: 'Quá nhiều yêu cầu đến KiotViet API. Vui lòng thử lại sau 1 phút.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(kiotvietLimiter);

// GET /api/kiotviet/status
router.get('/status', (req, res) => {
  const stats = kiotvietService.getCacheStats();
  res.json({
    status: 'ok',
    cache: stats,
    config: {
      baseUrl: config.kiotviet.baseUrl,
      retailerCode: config.kiotviet.retailerCode || '(chưa cấu hình)',
      hasCredentials: !!(config.kiotviet.clientId && config.kiotviet.clientSecret),
    },
  });
});

// GET /api/kiotviet/salary-data?year=2024&month=5
router.get('/salary-data', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({
        error: 'Tham số không hợp lệ. Cần year (số năm) và month (1-12).',
      });
    }

    const data = await kiotvietService.getSalaryData(year, month);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/kiotviet/clear-cache
router.post('/clear-cache', (req, res) => {
  kiotvietService.clearCache();
  res.json({ message: 'Cache đã được xóa thành công.', clearedAt: new Date().toISOString() });
});

module.exports = router;
