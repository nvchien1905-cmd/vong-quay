/**
 * Cloudflare Workers entry point — Tổng Kho Gia Dụng Huyền Anh Salary API
 * Runtime: Hono (edge-native, không dùng Express/Node.js)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

import { getSalaryData, cacheClear, cacheStats } from '../services/kiotviet-cf.js';
import salaryModule from '../services/salary.js';

const { calculateSalary, calculatePayrollFromKiotviet } = salaryModule;

// ── Rate limiter (in-memory per-instance) ─────────────────────
// Đủ dùng cho cửa hàng nội bộ; scale lên thì dùng Durable Objects.
const rlWindows = new Map();

function checkRL(key, max, windowMs) {
  const now = Date.now();
  const times = (rlWindows.get(key) || []).filter((t) => now - t < windowMs);
  if (times.length >= max) return false;
  times.push(now);
  rlWindows.set(key, times);
  return true;
}

function rl(max, windowMs, prefix = '') {
  return async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'local';
    if (!checkRL(`${prefix}${ip}`, max, windowMs)) {
      return c.json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút.' }, 429);
    }
    return next();
  };
}

// ── App ───────────────────────────────────────────────────────

const app = new Hono();

app.use('*', secureHeaders());

app.use('*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN || '*';
  const origins = origin.split(',').map((o) => o.trim());
  return cors({
    origin: origins.length === 1 && origins[0] === '*' ? '*' : origins,
    allowMethods: ['GET', 'POST'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

// Rate limit toàn app: 100 req/phút
app.use('*', rl(100, 60_000, 'g_'));

// Rate limit KiotViet routes: 20 req/phút
app.use('/api/kiotviet/*', rl(20, 60_000, 'kv_'));

// ── Health ────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'Tổng Kho Gia Dụng Huyền Anh — Salary API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    runtime: 'Cloudflare Workers',
  })
);

// ── KiotViet routes ───────────────────────────────────────────

app.get('/api/kiotviet/status', (c) => {
  const stats = cacheStats();
  return c.json({
    status: 'ok',
    cache: stats,
    config: {
      baseUrl: c.env.KIOTVIET_BASE_URL || 'https://public.kiotapi.com',
      retailerCode: c.env.KIOTVIET_RETAILER_CODE || '(chưa cấu hình)',
      hasCredentials: !!(c.env.KIOTVIET_CLIENT_ID && c.env.KIOTVIET_CLIENT_SECRET),
    },
  });
});

app.get('/api/kiotviet/salary-data', async (c) => {
  const year = parseInt(c.req.query('year') || '');
  const month = parseInt(c.req.query('month') || '');

  if (!year || !month || month < 1 || month > 12) {
    return c.json({ error: 'Cần year (số năm) và month (1–12).' }, 400);
  }

  const data = await getSalaryData(c.env, year, month);
  return c.json(data);
});

app.post('/api/kiotviet/clear-cache', (c) => {
  cacheClear();
  return c.json({ message: 'Cache đã được xóa.', clearedAt: new Date().toISOString() });
});

// ── Salary routes ─────────────────────────────────────────────

app.post('/api/salary/calculate', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.employee || !body?.input) {
    return c.json(
      {
        error: 'Body cần có: employee (thông tin NV) và input (dữ liệu tháng).',
        example: {
          employee: { name: 'Nguyễn Văn A', position: 'NV', isProbation: false, seniorityMonths: 24, dependents: 1 },
          input: { actualHours: 260, actualShifts: 28, hasReplacement: true, teamBonusShare: 500000 },
        },
      },
      400
    );
  }

  const { employee, input } = body;
  if (!['CHT', 'CHP', 'NV'].includes(employee.position)) {
    return c.json({ error: 'position phải là: CHT | CHP | NV' }, 400);
  }

  const result = calculateSalary(employee, input);
  return c.json(result);
});

app.post('/api/salary/payroll-from-kiotviet', async (c) => {
  const body = await c.req.json().catch(() => null);
  const { year, month, targetRevenue, employeeSettings } = body || {};

  if (!year || !month) return c.json({ error: 'Cần year và month.' }, 400);
  if (!targetRevenue || targetRevenue <= 0) return c.json({ error: 'targetRevenue phải là số dương (đồng).' }, 400);

  const parsedYear = parseInt(year);
  const parsedMonth = parseInt(month);
  if (parsedMonth < 1 || parsedMonth > 12) return c.json({ error: 'month phải từ 1–12.' }, 400);

  const kiotvietData = await getSalaryData(c.env, parsedYear, parsedMonth);
  const payroll = calculatePayrollFromKiotviet(kiotvietData, targetRevenue, employeeSettings || []);
  return c.json(payroll);
});

// ── 404 ──────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: `Endpoint không tồn tại: ${c.req.method} ${c.req.path}` }, 404));

// ── Error handler ─────────────────────────────────────────────

app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack);
  const status = err.statusCode || err.status || 500;
  return c.json({ error: err.message || 'Lỗi máy chủ nội bộ.' }, status);
});

export default app;
