'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const logger = require('./logger');
const errorHandler = require('../middleware/errorHandler');
const kiotvietRoutes = require('../routes/kiotviet');
const salaryRoutes = require('../routes/salary');

const app = express();

// ── Bảo mật ────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: config.cors.origin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsing ───────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Rate limit toàn app ────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.global.windowMs,
  max: config.rateLimit.global.max,
  message: { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ── Health check ───────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Tổng Kho Gia Dụng Huyền Anh — Salary API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: config.nodeEnv,
  });
});

// ── Routes ─────────────────────────────────────────────────
app.use('/api/kiotviet', kiotvietRoutes);
app.use('/api/salary', salaryRoutes);

// ── 404 ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Endpoint không tồn tại: ${req.method} ${req.path}` });
});

// ── Error handler (phải đặt cuối cùng) ────────────────────
app.use(errorHandler);

// ── Khởi động server ───────────────────────────────────────
if (require.main === module) {
  const PORT = config.port;
  app.listen(PORT, () => {
    logger.info(`Server đang chạy tại http://localhost:${PORT} [${config.nodeEnv}]`);
    logger.info('Endpoints: GET /health | /api/kiotviet/* | /api/salary/*');
  });
}

module.exports = app;
