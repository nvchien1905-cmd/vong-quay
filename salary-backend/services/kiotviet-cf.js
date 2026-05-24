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

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.KIOTVIET_CLIENT_ID,
    client_secret: env.KIOTVIET_CLIENT_SECRET,
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
      Retailer: env.KIOTVIET_RETAILER_CODE || '',
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

// ── Nhân viên ─────────────────────────────────────────────────

async function getEmployees(env) {
  const employees = await fetchAllPages(env, '/employees', { includeInactive: false });
  console.log(`KiotViet: ${employees.length} nhân viên`);
  return employees;
}

// ── Chấm công ────────────────────────────────────────────────

async function getAttendances(env, fromDate, toDate) {
  const records = await fetchAllPages(env, '/employees/attendances', { fromDate, toDate });

  const agg = {};
  for (const r of records) {
    const id = String(r.employeeId || r.employeeCode || '');
    if (!id) continue;
    if (!agg[id]) agg[id] = { employeeId: id, totalHours: 0, totalDays: 0 };
    agg[id].totalHours += r.workingHour || 0;
    agg[id].totalDays += 1;
  }

  console.log(`KiotViet: chấm công ${fromDate}→${toDate}: ${records.length} bản ghi`);
  return agg;
}

// ── Doanh thu ────────────────────────────────────────────────

async function getMonthlyRevenue(env, fromDate, toDate) {
  const invoices = await fetchAllPages(env, '/invoices', {
    status: 'Complete',
    fromPurchaseDate: fromDate,
    toPurchaseDate: toDate,
  });

  const revenueByEmployee = {};
  let totalRevenue = 0;

  for (const inv of invoices) {
    const payment = inv.totalPayment || 0;
    totalRevenue += payment;
    const sid = String(inv.soldById || '');
    if (sid) revenueByEmployee[sid] = (revenueByEmployee[sid] || 0) + payment;
  }

  console.log(`KiotViet: ${invoices.length} hóa đơn, tổng ${totalRevenue.toLocaleString('vi-VN')}đ`);
  return { revenueByEmployee, totalRevenue };
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

  console.log(`KiotViet: lấy dữ liệu lương ${fromDate}→${toDate}`);

  const [employees, attendances, { revenueByEmployee, totalRevenue }] = await Promise.all([
    getEmployees(env),
    getAttendances(env, fromDate, toDate),
    getMonthlyRevenue(env, fromDate, toDate),
  ]);

  const result = {
    employees,
    attendances,
    revenueByEmployee,
    totalRevenue,
    fromDate,
    toDate,
    fetchedAt: new Date().toISOString(),
  };

  cacheSet(cacheKey, result, 5 * 60);
  return result;
}
