/**
 * KiotViet service dành cho Cloudflare Workers.
 * Dùng native fetch() và in-memory Map để cache.
 * Module-level cache tồn tại suốt vòng đời worker instance.
 */

// ── In-memory cache ──────────────────────────────────────────
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlSeconds) {
  cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function cacheClear() {
  cache.clear();
}

export function cacheStats() {
  return { keys: cache.size };
}

// ── Auth ─────────────────────────────────────────────────────

async function getAccessToken(env) {
  const cached = cacheGet('kv_token');
  if (cached) return cached;

  if (!env.KIOTVIET_CLIENT_ID || !env.KIOTVIET_CLIENT_SECRET) {
    throw Object.assign(
      new Error('Thiếu KIOTVIET_CLIENT_ID hoặc KIOTVIET_CLIENT_SECRET'),
      { statusCode: 503 }
    );
  }

  // Trim BOM (﻿) có thể bị thêm khi set secret qua Windows PowerShell
  const clientId     = (env.KIOTVIET_CLIENT_ID     || '').replace(/^﻿/, '').trim();
  const clientSecret = (env.KIOTVIET_CLIENT_SECRET || '').replace(/^﻿/, '').trim();

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scopes: 'PublicApi.Access',
  });

  const res = await fetch('https://id.kiotviet.vn/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`KiotViet auth thất bại: ${res.status} ${text}`), {
      statusCode: 502,
    });
  }

  const data = await res.json();
  const token = data.access_token;
  cacheSet('kv_token', token, 23 * 60 * 60);
  console.log('KiotViet: token mới đã cache (23h)');
  return token;
}

// ── HTTP helper ───────────────────────────────────────────────

async function kvFetch(env, path, params = {}) {
  const token = await getAccessToken(env);
  const baseUrl = env.KIOTVIET_BASE_URL || 'https://public.kiotapi.com';

  const url = new URL(baseUrl + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Retailer: (env.KIOTVIET_RETAILER_CODE || '').replace(/^﻿/, '').trim(),
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`KiotViet API lỗi ${res.status}: ${text}`), {
      statusCode: 502,
    });
  }

  return res.json();
}

// ── Phân trang chung ─────────────────────────────────────────

async function fetchAllPages(env, path, params = {}) {
  const pageSize = 100;
  let currentItem = 0;
  let all = [];

  while (true) {
    const data = await kvFetch(env, path, { ...params, currentItem, pageSize });
    const page = data.data || [];
    all = all.concat(page);
    const total = data.total || 0;
    if (all.length >= total || page.length < pageSize) break;
    currentItem += pageSize;
  }

  return all;
}

// ── Invoices → danh sách seller + doanh thu + ngày làm việc ──
// /employees và /employees/attendances không khả dụng ở gói API này.
// Thay thế: dùng /invoices để suy ra seller list, doanh thu, số công.
// Giờ làm (totalHours) phải cung cấp thủ công qua employeeSettings.

async function getDataFromInvoices(env, fromDate, toDate) {
  const invoices = await fetchAllPages(env, '/invoices', {
    status: 1,                      // 1 = Hoàn thành (số, giống main worker)
    fromPurchaseDate: fromDate,
    toPurchaseDate: toDate,
  });

  const sellerMap = new Map(); // sellerId → { id, name, revenue, workDays (ngày distinct) }
  let totalRevenue = 0;

  for (const inv of invoices) {
    const payment = inv.totalPayment || inv.total || 0;
    totalRevenue += payment;

    const sid  = String(inv.soldById   || '');
    const name = String(inv.soldByName || '');
    if (!sid) continue;

    const dateKey = (inv.purchaseDate || '').slice(0, 10); // YYYY-MM-DD
    if (!sellerMap.has(sid)) {
      sellerMap.set(sid, { id: sid, name, revenue: 0, workDates: new Set(), invoiceCount: 0 });
    }
    const s = sellerMap.get(sid);
    s.revenue += payment;
    s.invoiceCount += 1;
    if (dateKey) s.workDates.add(dateKey);
  }

  // Chuyển thành cấu trúc tương thích với calculatePayrollFromKiotviet:
  // employees[], attendances{}, revenueByEmployee{}
  const employees = [];
  const attendances = {};
  const revenueByEmployee = {};

  for (const [sid, s] of sellerMap) {
    employees.push({ id: sid, name: s.name, invoiceCount: s.invoiceCount });
    // totalDays = số ngày distinct có hóa đơn (xấp xỉ số công)
    // totalHours = 0 — phải nhập tay qua employeeSettings
    attendances[sid] = { employeeId: sid, totalHours: 0, totalDays: s.workDates.size };
    revenueByEmployee[sid] = s.revenue;
  }

  console.log(`KiotViet invoices: ${invoices.length} HĐ, ${employees.length} người bán, tổng ${totalRevenue.toLocaleString('vi-VN')}đ`);
  return { employees, attendances, revenueByEmployee, totalRevenue };
}

// ── Dữ liệu tổng hợp (có cache) ──────────────────────────────

export async function getSalaryData(env, year, month) {
  const mm = String(month).padStart(2, '0');
  const cacheKey = `salary_${year}_${mm}`;

  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`KiotViet: cache hit salary-data ${year}/${month}`);
    return cached;
  }

  const fromDate = `${year}-${mm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  console.log(`KiotViet: lấy dữ liệu lương từ invoices ${fromDate}→${toDate}`);

  const { employees, attendances, revenueByEmployee, totalRevenue } =
    await getDataFromInvoices(env, fromDate, toDate);

  const result = {
    employees,
    attendances,       // totalDays = ngày bán, totalHours = 0 (nhập tay)
    revenueByEmployee,
    totalRevenue,
    fromDate,
    toDate,
    fetchedAt: new Date().toISOString(),
    dataSource: 'invoices',
    warning: 'Giờ làm (totalHours) không có trong dữ liệu invoice. Cung cấp qua employeeSettings[].actualHours để tính FT/PT chính xác.',
  };

  cacheSet(cacheKey, result, 5 * 60);
  return result;
}
