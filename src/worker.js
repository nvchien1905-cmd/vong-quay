// ════════════════════════════════════════════════════════════
//  VÒNG QUAY MAY MẮN — Cloudflare Workers
//  Tương đương proxy-server.js, chạy trên Workers runtime
//
//  Env bindings cần thiết (wrangler.toml + wrangler secret):
//    HISTORY_KV            — KV namespace lưu lịch sử quay
//    GOOGLE_CREDENTIALS_JSON — Service Account JSON (secret)
//    ASSETS                — static files binding (wrangler.toml)
// ════════════════════════════════════════════════════════════

// ── Cấu hình cứng (thông tin công khai) ──────────────────────
const CFG = {
  CLIENT_ID:     'd67357dc-f1f3-465d-8c21-a633456ef46d',
  CLIENT_SECRET: 'E108C2FAC4B709A859E9702824DABF6EB6F6CBFF',
  RETAILER:      'tongkhohuyenanh01',
  GS_SHEET_ID:   '19Gn0hHao929TSI7GuhAUFtBpEsFjAlb0vvd_N7Xakoo',
  GS_TAB:        'Lich su',
  MIN_AMOUNT:    499000,
};

// ── CORS ─────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ── Base64url helper (hỗ trợ UTF-8) ──────────────────────────
function toB64Url(input) {
  let binary;
  if (typeof input === 'string') {
    // Encode string → UTF-8 bytes → binary string
    const bytes = new TextEncoder().encode(input);
    binary = String.fromCharCode(...bytes);
  } else {
    binary = String.fromCharCode(...new Uint8Array(input));
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ════════════════════════════════════════════════════════════
//  KiotViet API
// ════════════════════════════════════════════════════════════
const TARGET_BRANCHES = ['Gia dụng Hoài Đức', 'Gia dụng Hồng Hà', 'Gia dụng Phương Đình'];

// Cache token trong module-scope (tồn tại trong cùng isolate)
let _kvTok = null, _kvTokExp = 0;
let _branchIds = null, _branchIdsAt = 0;

async function getKvToken() {
  if (_kvTok && Date.now() < _kvTokExp) return _kvTok;
  const res = await fetch('https://id.kiotviet.vn/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      scopes:        'PublicApi.Access',
      grant_type:    'client_credentials',
      client_id:     CFG.CLIENT_ID,
      client_secret: CFG.CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`KiotViet token error ${res.status}: ${await res.text()}`);
  const d = await res.json();
  _kvTok    = d.access_token;
  _kvTokExp = Date.now() + (d.expires_in - 120) * 1000;
  return _kvTok;
}

async function kiotFetch(path) {
  const token = await getKvToken();
  const res = await fetch(`https://public.kiotapi.com${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Retailer':      CFG.RETAILER,
    },
  });
  if (!res.ok) throw new Error(`KiotViet ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function maskPhone(phone) {
  if (!phone || phone.length < 8) return phone;
  return phone.slice(0, 4) + '***' + phone.slice(-3);
}

// Chuẩn hoá SĐT VN: bỏ ký tự không phải số, đổi đầu 84 → 0
function normalizePhone(p) {
  p = String(p || '').replace(/\D/g, '');
  if (p.startsWith('84') && p.length >= 11) p = '0' + p.slice(2);
  return p;
}

function extractGroupInfo(c) {
  if (typeof c.groups === 'string' && c.groups.trim())
    return { groupId: c.groupId || null, groupName: c.groups.split(',')[0].trim() };
  if (Array.isArray(c.customerGroupDetails) && c.customerGroupDetails.length) {
    const g = c.customerGroupDetails[0];
    return { groupId: g.groupId || g.id || null, groupName: g.groupName || g.name || '' };
  }
  if (Array.isArray(c.groups) && c.groups.length) {
    const g = c.groups[0];
    return { groupId: g.id || null, groupName: g.name || '' };
  }
  if (c.groupName) return { groupId: c.groupId || null, groupName: c.groupName };
  return { groupId: null, groupName: '' };
}

async function getTargetBranchIds() {
  if (_branchIds && Date.now() - _branchIdsAt < 60 * 60 * 1000) return _branchIds;
  const data     = await kiotFetch('/branches');
  const branches = Array.isArray(data) ? data : (data.data || []);
  const ids = branches
    .filter(b => TARGET_BRANCHES.includes(b.branchName || b.name || ''))
    .map(b => b.id);
  _branchIds   = ids;
  _branchIdsAt = Date.now();
  return ids;
}

function buildBranchQs(ids) {
  return ids.length ? '&' + ids.map(id => `branchId=${id}`).join('&') : '';
}

// Cache nhóm khách hàng (per-isolate)
let _groupsCache = null, _groupsCacheAt = 0;

async function getCustomerGroups() {
  if (_groupsCache && Date.now() - _groupsCacheAt < 30 * 60 * 1000) return _groupsCache;
  const paths = ['/customerGroups', '/customergroups', '/customer-groups'];
  for (const p of paths) {
    try {
      const data = await kiotFetch(p);
      _groupsCache   = Array.isArray(data) ? data : (data.data || []);
      _groupsCacheAt = Date.now();
      return _groupsCache;
    } catch { /* thử path tiếp theo */ }
  }
  _groupsCache   = [];
  _groupsCacheAt = Date.now();
  return _groupsCache;
}

async function getMonthlyInvoices(env) {
  const branchIds = await getTargetBranchIds();
  const branchQs  = buildBranchQs(branchIds);
  const now   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y     = now.getFullYear();
  const m     = now.getMonth();
  const month = `${String(m + 1).padStart(2, '0')}/${y}`;

  // Trả cache KV nếu còn mới (< 20 phút)
  const cacheKey = `top_cache_${y}_${m + 1}`;
  if (env?.HISTORY_KV) {
    const hit = await env.HISTORY_KV.get(cacheKey, 'json').catch(() => null);
    if (hit && Date.now() - (hit.ts || 0) < 20 * 60 * 1000) {
      return { invoices: hit.invoices, month };
    }
  }

  const from  = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastD = new Date(y, m + 1, 0).getDate();
  const to    = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;

  const all = [];
  let currentItem = 0;
  const pageSize  = 100;
  while (true) {
    const data  = await kiotFetch(
      `/invoices?pageSize=${pageSize}&currentItem=${currentItem}&status=1&fromPurchaseDate=${from}&toPurchaseDate=${to}${branchQs}`
    );
    const items = data.data || [];
    all.push(...items);
    if (items.length < pageSize) break;
    currentItem += pageSize;
  }
  const invoices = branchIds.length === 0 ? all : all.filter(inv => branchIds.includes(inv.branchId));

  // Lưu cache KV, hết hạn sau 24h
  if (env?.HISTORY_KV) {
    await env.HISTORY_KV.put(cacheKey, JSON.stringify({ invoices, ts: Date.now() }), { expirationTtl: 86400 }).catch(() => {});
  }

  return { invoices, month };
}

// ════════════════════════════════════════════════════════════
//  Google Sheets (REST API + JWT — không cần googleapis SDK)
// ════════════════════════════════════════════════════════════
let _gsTok = null, _gsTokExp = 0;

async function getGsToken(creds) {
  if (_gsTok && Date.now() < _gsTokExp) return _gsTok;

  const now     = Math.floor(Date.now() / 1000);
  const header  = toB64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = toB64Url(JSON.stringify({
    iss:   creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }));
  const sigInput = `${header}.${payload}`;

  // Import RSA private key (PKCS#8 — định dạng Google Service Account hiện tại)
  const pemBody = creds.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(sigInput)
  );

  const jwt = `${sigInput}.${toB64Url(sigBytes)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`GS token error: ${await tokenRes.text()}`);
  const d = await tokenRes.json();
  _gsTok    = d.access_token;
  _gsTokExp = Date.now() + (d.expires_in - 60) * 1000;
  return _gsTok;
}

const GS_RANGE_APPEND = (tab) => `${encodeURIComponent(tab + '!A:F')}`;
const GS_RANGE_READ   = (tab) => `${encodeURIComponent(tab + '!A2:F')}`;
const GS_BASE = (sheetId) => `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;

async function gsAppend(creds, entry) {
  try {
    const token = await getGsToken(creds);
    await fetch(
      `${GS_BASE(CFG.GS_SHEET_ID)}/values/${GS_RANGE_APPEND(CFG.GS_TAB)}:append?valueInputOption=USER_ENTERED`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ values: [[
          entry.phone       || '',
          entry.invoiceCode || '',
          entry.prizeEmoji  || '',
          entry.prize       || '',
          entry.spinTime    || '',
          entry.spinTimeISO || '',
        ]] }),
      }
    );
  } catch (err) {
    console.error('[GS] gsAppend error:', err.message);
  }
}

async function gsRead(creds) {
  try {
    const token = await getGsToken(creds);
    const res = await fetch(
      `${GS_BASE(CFG.GS_SHEET_ID)}/values/${GS_RANGE_READ(CFG.GS_TAB)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    return (d.values || []).map(r => ({
      phone:       r[0] || '',
      invoiceCode: r[1] || '',
      prizeEmoji:  r[2] || '',
      prize:       r[3] || '',
      spinTime:    r[4] || '',
      spinTimeISO: r[5] || '',
    }));
  } catch (err) {
    console.error('[GS] gsRead error:', err.message);
    return null;
  }
}

async function gsClear(creds) {
  try {
    const token = await getGsToken(creds);
    await fetch(
      `${GS_BASE(CFG.GS_SHEET_ID)}/values/${GS_RANGE_READ(CFG.GS_TAB)}:clear`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('[GS] gsClear error:', err.message);
  }
}

// ════════════════════════════════════════════════════════════
//  Cloudflare KV — lưu lịch sử (backup cục bộ)
// ════════════════════════════════════════════════════════════
const HIST_KEY = 'history_v1';

async function histRead(kv) {
  try {
    const raw = await kv.get(HIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function histWrite(kv, arr) {
  // KV value limit 25 MB; cắt bớt nếu vượt quá 5000 entries
  const trimmed = arr.length > 5000 ? arr.slice(-5000) : arr;
  await kv.put(HIST_KEY, JSON.stringify(trimmed));
}

// ════════════════════════════════════════════════════════════
//  Route handlers
// ════════════════════════════════════════════════════════════
async function handleInvoices(url) {
  const phone = url.searchParams.get('phone');
  if (!phone) return jsonResp({ error: 'Thiếu tham số phone' }, 400);
  try {
    // Kiểm tra SĐT tồn tại trước — KiotViet trả hóa đơn ngẫu nhiên khi customerTel không khớp
    const custData = await kiotFetch(`/customers?contactNumber=${encodeURIComponent(phone)}&pageSize=1`);
    if (!(custData.data || []).length) return jsonResp([]);

    const branchIds = await getTargetBranchIds();
    const data = await kiotFetch(
      `/invoices?pageSize=100&customerTel=${encodeURIComponent(phone)}&orderDirection=Desc&status=1${buildBranchQs(branchIds)}`
    );
    const invoices = (data.data || []).filter(inv =>
      branchIds.length === 0 || branchIds.includes(inv.branchId)
    );
    return jsonResp(invoices);
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

async function handleInvoice(url) {
  const phone = url.searchParams.get('phone');
  const code  = (url.searchParams.get('code') || '').toUpperCase();
  if (!phone || !code) return jsonResp({ error: 'Thiếu tham số phone hoặc code' }, 400);
  try {
    // Bước 1: Xác minh SĐT — lấy customerId thật từ KiotViet
    // (endpoint /customers?contactNumber lọc đúng, khác với /invoices?customerTel)
    const custData  = await kiotFetch(`/customers?contactNumber=${encodeURIComponent(phone)}&pageSize=5`);
    const customers = custData.data || [];
    if (!customers.length) return jsonResp({ valid: false, reason: 'PHONE_NOT_FOUND' });
    const customerId = String(customers[0].id);

    // Bước 2: Lấy hóa đơn (KiotViet có thể trả về nhiều hơn dự kiến, không sao)
    const branchIds = await getTargetBranchIds();
    const data     = await kiotFetch(
      `/invoices?pageSize=100&customerTel=${encodeURIComponent(phone)}&orderDirection=Desc&status=1${buildBranchQs(branchIds)}`
    );
    const invoices = data.data || [];

    // Bước 3: Tìm đúng mã hóa đơn
    const inv = invoices.find(i => (i.code || '').toUpperCase() === code || String(i.id) === code);
    if (!inv) return jsonResp({ valid: false, reason: 'CODE_NOT_FOUND' });

    // Bước 4: Xác minh hóa đơn thực sự thuộc khách hàng có SĐT nhập vào
    // (so sánh customerId từ bước 1 với customerId trên hóa đơn)
    if (!inv.customerId || String(inv.customerId) !== customerId) {
      return jsonResp({ valid: false, reason: 'PHONE_MISMATCH' });
    }

    // Bước 4b: Xác minh hóa đơn thuộc đúng 3 chi nhánh (API lọc không hoàn hảo)
    if (branchIds.length > 0 && !branchIds.includes(inv.branchId)) {
      return jsonResp({ valid: false, reason: 'WRONG_BRANCH' });
    }

    // Bước 5: Kiểm tra ngày hôm nay
    const rawDate = inv.purchaseDate || inv.createdDate || inv.modifiedDate;
    let todayOk = false;
    if (rawDate) {
      const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
      const invD = new Date(new Date(rawDate).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
      todayOk = now.getFullYear() === invD.getFullYear()
             && now.getMonth()    === invD.getMonth()
             && now.getDate()     === invD.getDate();
    }
    if (!todayOk) return jsonResp({ valid: false, reason: 'NOT_TODAY', invoiceDate: rawDate });

    // Bước 6: Kiểm tra giá trị tối thiểu
    const amount = inv.total || inv.totalPayment || 0;
    if (amount < CFG.MIN_AMOUNT) return jsonResp({ valid: false, reason: 'AMOUNT_TOO_LOW', amount });

    return jsonResp({ valid: true, invoice: inv });
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

async function handleHistory(request, env, creds) {
  const kv     = env.HISTORY_KV;
  const method = request.method;

  if (method === 'GET') {
    if (creds) {
      const gsData = await gsRead(creds);
      if (gsData !== null) return jsonResp(gsData);
    }
    return jsonResp(await histRead(kv));
  }

  if (method === 'POST') {
    try {
      const entry = await request.json();
      entry.serverSavedAt = new Date().toISOString();
      const hist = await histRead(kv);
      hist.push(entry);
      await histWrite(kv, hist);
      if (creds) await gsAppend(creds, entry);
      return jsonResp({ ok: true });
    } catch (err) {
      return jsonResp({ error: 'Body không hợp lệ: ' + err.message }, 400);
    }
  }

  if (method === 'DELETE') {
    await histWrite(kv, []);
    if (creds) await gsClear(creds);
    return jsonResp({ ok: true });
  }

  return jsonResp({ error: 'Method không hỗ trợ' }, 405);
}

async function handleLoyalty(url) {
  const phone = url.searchParams.get('phone');
  if (!phone) return jsonResp({ error: 'Thiếu tham số phone' }, 400);
  try {
    const [custData, allGroups] = await Promise.all([
      kiotFetch(`/customers?contactNumber=${encodeURIComponent(phone)}&pageSize=5&includeCustomerGroup=true`),
      getCustomerGroups().catch(() => []),
    ]);
    const customers = custData.data || [];
    if (!customers.length) return jsonResp({ found: false });

    const c = customers[0];
    const { groupId, groupName } = extractGroupInfo(c);

    let totalInvoiced = c.totalInvoiced || 0;
    if (!totalInvoiced && c.id) {
      try {
        const detail  = await kiotFetch(`/customers/${c.id}`);
        totalInvoiced = detail.totalInvoiced || detail.totalRevenue || 0;
      } catch { /* bỏ qua */ }
    }

    let matchedGroup = null;
    if (groupId)
      matchedGroup = allGroups.find(g => g.id === groupId || String(g.id) === String(groupId));
    if (!matchedGroup && groupName)
      matchedGroup = allGroups.find(g => g.name && g.name.trim().toLowerCase() === groupName.toLowerCase());
    const groupDiscount = matchedGroup ? (matchedGroup.discount ?? null) : null;

    return jsonResp({
      found: true,
      name:          c.name          || '',
      phone:         c.contactNumber || phone,
      rewardPoint:   c.rewardPoint   || 0,
      totalInvoiced,
      totalPoint:    c.totalPoint    || 0,
      debt:          c.debt          || 0,
      groupId,
      groupName,
      groupDiscount,
      allGroups: allGroups.map(g => ({ id: g.id, name: g.name || '', discount: g.discount ?? 0 })),
    });
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

async function handleTopCustomers(env) {
  try {
    const { invoices, month } = await getMonthlyInvoices(env);
    const map = new Map();
    for (const inv of invoices) {
      const id    = inv.customerId || inv.customerCode;
      const name  = (inv.customerName || '').trim();
      const total = inv.total || inv.totalPayment || 0;
      if (!id || !name || name === 'Khách lẻ') continue;
      if (map.has(id)) map.get(id).total += total;
      else map.set(id, { id, name, phone: '', total });
    }

    const top10 = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 10);

    await Promise.all(top10.map(async c => {
      try {
        const detail = await kiotFetch(`/customers/${c.id}`);
        c.phone = maskPhone(detail.contactNumber || detail.mobilePhone || '');
      } catch { c.phone = ''; }
    }));

    const top = top10.map(({ id: _id, ...rest }) => rest);
    return jsonResp({ month, top });
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
//  Salary handlers
// ════════════════════════════════════════════════════════════

async function handleKiotvietSalaryData(url) {
  const monthParam = url.searchParams.get('month');
  let year, month;
  if (monthParam) {
    const [m, y] = monthParam.split('/');
    month = parseInt(m, 10);
    year  = parseInt(y, 10);
  } else {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    year  = now.getFullYear();
    month = now.getMonth() + 1;
  }
  const from  = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastD = new Date(year, month, 0).getDate();
  const to    = `${year}-${String(month).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
  try {
    const branchIds = await getTargetBranchIds();
    const branchQs  = buildBranchQs(branchIds);
    const all = [];
    let currentItem = 0;
    while (true) {
      const data  = await kiotFetch(`/invoices?pageSize=100&currentItem=${currentItem}&status=1&fromPurchaseDate=${from}&toPurchaseDate=${to}${branchQs}`);
      const items = data.data || [];
      all.push(...items);
      if (items.length < 100) break;
      currentItem += 100;
    }
    const staffMap = new Map();
    for (const inv of all) {
      if (branchIds.length > 0 && !branchIds.includes(inv.branchId)) continue;
      const sid   = inv.soldById   || inv.saleChannelId || 'unknown';
      const sname = inv.soldByName || inv.saleChannel   || 'Không xác định';
      const total = inv.total      || inv.totalPayment  || 0;
      if (staffMap.has(sid)) { const s = staffMap.get(sid); s.totalSales += total; s.invoiceCount++; }
      else staffMap.set(sid, { staffId: sid, staffName: sname, totalSales: total, invoiceCount: 1 });
    }
    const staff = [...staffMap.values()].sort((a, b) => b.totalSales - a.totalSales);
    return jsonResp({ month: `${String(month).padStart(2, '0')}/${year}`, staff });
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

async function handleSalaryCalculate(request) {
  try {
    const { name = '', baseSalary = 0, hoursWorked = 0, standardHours = 192,
            salesAmount = 0, commissionRate = 0, extraCommission = 0,
            bonus = 0, deduction = 0 } = await request.json();
    const ratio            = standardHours > 0 ? Math.min(hoursWorked / standardHours, 1) : 1;
    const actualBaseSalary = Math.round(baseSalary * ratio);
    const commission       = Math.round(salesAmount * commissionRate) + Number(extraCommission);
    const totalSalary      = actualBaseSalary + commission + Number(bonus) - Number(deduction);
    return jsonResp({ name, baseSalaryFull: baseSalary, actualBaseSalary, hoursWorked,
      standardHours, attendanceRatio: Math.round(ratio * 100), salesAmount,
      commissionRate, commission, extraCommission: Number(extraCommission),
      bonus: Number(bonus), deduction: Number(deduction), totalSalary });
  } catch (err) {
    return jsonResp({ error: 'Body không hợp lệ: ' + err.message }, 400);
  }
}

async function handlePayrollFromKiotviet(request) {
  try {
    const { month, employees = [] } = await request.json();
    if (!month) return jsonResp({ error: 'Thiếu tham số month' }, 400);
    const fakeUrl = new URL('http://x/api/kiotviet/salary-data?month=' + encodeURIComponent(month));
    const kvResp  = await handleKiotvietSalaryData(fakeUrl);
    const kvData  = await kvResp.json();
    if (kvData.error) return jsonResp({ error: kvData.error }, 500);
    const staffMap = new Map();
    for (const s of kvData.staff || []) staffMap.set(s.staffName.toLowerCase().trim(), s.totalSales);
    const payroll = employees.map(emp => {
      const salesAmount      = staffMap.get((emp.name || '').toLowerCase().trim()) || Number(emp.salesAmount) || 0;
      const baseSalary       = Number(emp.baseSalary)      || 0;
      const hoursWorked      = Number(emp.hoursWorked)     || 0;
      const standardHours    = Number(emp.standardHours)   || 192;
      const commissionRate   = (Number(emp.commissionRate) || 0) / 100;
      const extraCommission  = Number(emp.extraCommission) || 0;
      const bonus            = Number(emp.bonus)           || 0;
      const deduction        = Number(emp.deduction)       || 0;
      const ratio            = standardHours > 0 ? Math.min(hoursWorked / standardHours, 1) : 1;
      const actualBaseSalary = Math.round(baseSalary * ratio);
      const commission       = Math.round(salesAmount * commissionRate) + extraCommission;
      const totalSalary      = actualBaseSalary + commission + bonus - deduction;
      return { name: emp.name || '', baseSalary, actualBaseSalary, hoursWorked, standardHours,
               salesAmount, commissionRate, commission, extraCommission, bonus, deduction, totalSalary };
    });
    return jsonResp({ month, payroll });
  } catch (err) {
    return jsonResp({ error: err.message }, 500);
  }
}

// ════════════════════════════════════════════════════════════
//  Salary HTML (nhúng thẳng, không cần file riêng)
// ════════════════════════════════════════════════════════════
const SALARY_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tính Lương - Huyền Anh</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f0f4f0;color:#222;min-height:100vh}
header{background:#0f6e56;color:#fff;padding:16px 20px;text-align:center}
header h1{font-size:1.3rem;font-weight:700}
header p{font-size:.85rem;opacity:.8;margin-top:2px}
nav{display:flex;background:#0a5241;overflow-x:auto}
nav button{flex:1;min-width:80px;padding:12px 6px;color:#fff;background:none;border:none;cursor:pointer;font-size:.8rem;border-bottom:3px solid transparent;white-space:nowrap}
nav button.active{background:#0f6e56;border-bottom-color:#7ef5c5}
.tab-content{display:none;padding:16px;max-width:800px;margin:0 auto}
.tab-content.active{display:block}
.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.card h2{font-size:1rem;color:#0f6e56;margin-bottom:12px;font-weight:600}
label{display:block;font-size:.85rem;color:#555;margin-bottom:4px;margin-top:10px}
label:first-child{margin-top:0}
input,select{width:100%;padding:10px;border:1px solid #d0d7d5;border-radius:8px;font-size:.95rem;outline:none}
input:focus,select:focus{border-color:#0f6e56;box-shadow:0 0 0 3px rgba(15,110,86,.15)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:11px 20px;border:none;border-radius:8px;cursor:pointer;font-size:.9rem;font-weight:600;transition:.15s}
.btn-primary{background:#0f6e56;color:#fff}
.btn-primary:hover{background:#0a5241}
.btn-danger{background:#e53e3e;color:#fff}
.btn-danger:hover{background:#c53030}
.btn-success{background:#276749;color:#fff}
.btn-success:hover{background:#1e5237}
.btn-sm{padding:6px 12px;font-size:.8rem}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{background:#e8f5f0;color:#0f6e56;padding:10px 8px;text-align:left;font-weight:600}
td{padding:9px 8px;border-bottom:1px solid #f0f0f0}
tr:last-child td{border-bottom:none}
.num{text-align:right}
.alert{padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:.9rem}
.alert-error{background:#fff5f5;color:#c53030;border:1px solid #fed7d7}
.alert-success{background:#f0fff4;color:#276749;border:1px solid #c6f6d5}
.alert-info{background:#ebf8ff;color:#2b6cb0;border:1px solid #bee3f8}
.slip-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:.9rem}
.slip-row:last-child{border-bottom:none;padding-top:12px;margin-top:4px}
.slip-total{font-weight:700;font-size:1.1rem;color:#0f6e56}
.slip-label{color:#555}
.emp-card{background:#f7faf9;border:1px solid #d0e8e0;border-radius:8px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.emp-info{flex:1}
.emp-name{font-weight:600;color:#0f6e56}
.emp-meta{font-size:.8rem;color:#666;margin-top:3px;line-height:1.5}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.month-row{display:flex;gap:8px;align-items:flex-end}
.month-row input{flex:1}
@media(max-width:520px){.form-row{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>Tính Lương Huyền Anh</h1>
  <p>Quản lý nhân viên &amp; tính lương tự động</p>
</header>
<nav>
  <button class="active" onclick="showTab('kiotviet',this)">&#128257; KiotViet</button>
  <button onclick="showTab('nhanvien',this)">&#128100; Nhân viên</button>
  <button onclick="showTab('tinhluong',this)">&#128176; Tính lương</button>
  <button onclick="showTab('bangluong',this)">&#128203; Bảng lương</button>
</nav>

<!-- TAB 1: KiotViet -->
<div id="tab-kiotviet" class="tab-content active">
  <div class="card">
    <h2>Đồng bộ dữ liệu từ KiotViet</h2>
    <label>Tháng</label>
    <div class="month-row">
      <input type="month" id="kv-month">
      <button class="btn btn-primary" onclick="syncKiotviet()">Đồng bộ</button>
    </div>
    <div id="kv-msg" style="margin-top:12px"></div>
  </div>
  <div class="card" id="kv-result-card" style="display:none">
    <h2>Doanh số theo nhân viên</h2>
    <div style="overflow-x:auto">
      <table>
        <thead><tr><th>#</th><th>Nhân viên</th><th class="num">Doanh số</th><th class="num">Số HĐ</th></tr></thead>
        <tbody id="kv-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<!-- TAB 2: Nhân viên -->
<div id="tab-nhanvien" class="tab-content">
  <div class="card">
    <h2 id="emp-form-title">Thêm nhân viên</h2>
    <input type="hidden" id="emp-edit-id">
    <label>Họ tên</label>
    <input type="text" id="emp-name" placeholder="Nguyễn Văn A">
    <div class="form-row">
      <div>
        <label>Lương cơ bản (đ)</label>
        <input type="number" id="emp-base" placeholder="5000000" min="0">
      </div>
      <div>
        <label>Số giờ chuẩn/tháng</label>
        <input type="number" id="emp-hours" placeholder="192" min="1">
      </div>
    </div>
    <div class="form-row">
      <div>
        <label>Tỷ lệ hoa hồng (%)</label>
        <input type="number" id="emp-commission" placeholder="1" step="0.1" min="0">
      </div>
      <div>
        <label>Ghi chú</label>
        <input type="text" id="emp-note" placeholder="Chi nhánh, vị trí...">
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="saveEmployee()">Lưu</button>
      <button class="btn" style="background:#e2e8f0;color:#333" onclick="resetEmpForm()">Hủy</button>
    </div>
    <div id="emp-msg" style="margin-top:10px"></div>
  </div>
  <div class="card">
    <h2>Danh sách nhân viên (<span id="emp-count">0</span>)</h2>
    <div id="emp-list"></div>
  </div>
</div>

<!-- TAB 3: Tính lương -->
<div id="tab-tinhluong" class="tab-content">
  <div class="card">
    <h2>Tính lương cá nhân</h2>
    <label>Chọn nhân viên</label>
    <select id="sl-employee" onchange="fillEmployeeData()">
      <option value="">-- Chọn nhân viên --</option>
    </select>
    <div class="form-row">
      <div>
        <label>Số giờ làm thực tế</label>
        <input type="number" id="sl-hours" placeholder="160" min="0">
      </div>
      <div>
        <label>Doanh số tháng (đ)</label>
        <input type="number" id="sl-sales" placeholder="0" min="0">
      </div>
    </div>
    <div class="form-row">
      <div>
        <label>Hoa hồng thêm (đ)</label>
        <input type="number" id="sl-extra" value="0" min="0">
      </div>
      <div>
        <label>Thưởng (đ)</label>
        <input type="number" id="sl-bonus" value="0" min="0">
      </div>
    </div>
    <label>Khấu trừ (đ)</label>
    <input type="number" id="sl-deduction" value="0" min="0">
    <div class="btn-row">
      <button class="btn btn-primary" onclick="calculateSalary()">Tính lương</button>
    </div>
    <div id="sl-msg" style="margin-top:10px"></div>
  </div>
  <div class="card" id="slip-card" style="display:none">
    <h2>Phiếu lương chi tiết</h2>
    <div id="slip-content"></div>
  </div>
</div>

<!-- TAB 4: Bảng lương -->
<div id="tab-bangluong" class="tab-content">
  <div class="card">
    <h2>Tính bảng lương tất cả nhân viên</h2>
    <label>Tháng</label>
    <div class="month-row">
      <input type="month" id="bl-month">
      <button class="btn btn-primary" onclick="calcPayroll()">Tính tất cả</button>
    </div>
    <div id="bl-msg" style="margin-top:12px"></div>
  </div>
  <div class="card" id="bl-result-card" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="margin:0" id="bl-title">Bảng lương</h2>
      <button class="btn btn-success btn-sm" onclick="exportCSV()">Xuất CSV</button>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>#</th><th>Nhân viên</th>
          <th class="num">Lương CB</th><th class="num">Doanh số</th>
          <th class="num">Hoa hồng</th><th class="num">Thưởng</th>
          <th class="num">Khấu trừ</th><th class="num">Tổng lương</th>
        </tr></thead>
        <tbody id="bl-tbody"></tbody>
        <tfoot id="bl-tfoot"></tfoot>
      </table>
    </div>
  </div>
</div>

<script>
function fmt(n){ return Number(n||0).toLocaleString('vi-VN')+' đ'; }
function fmtNum(n){ return Number(n||0).toLocaleString('vi-VN'); }
function currentMonth(){
  var d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function monthToAPI(val){
  var p=val.split('-'); return p[1]+'/'+p[0];
}
function showMsg(id,text,type){
  document.getElementById(id).innerHTML='<div class="alert alert-'+(type||'info')+'">'+text+'</div>';
}
function clearMsg(id){ document.getElementById(id).innerHTML=''; }

function showTab(name,btn){
  document.querySelectorAll('.tab-content').forEach(function(el){el.classList.remove('active');});
  document.querySelectorAll('nav button').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='nhanvien') renderEmpList();
  if(name==='tinhluong') fillEmpSelect();
}

function loadEmployees(){ try{return JSON.parse(localStorage.getItem('ha_employees')||'[]');}catch{return[];} }
function saveEmployees(arr){ localStorage.setItem('ha_employees',JSON.stringify(arr)); }
function nextId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }

function renderEmpList(){
  var emps=loadEmployees();
  document.getElementById('emp-count').textContent=emps.length;
  var list=document.getElementById('emp-list');
  if(!emps.length){list.innerHTML='<p style="color:#888;text-align:center;padding:20px">Chưa có nhân viên nào</p>';return;}
  list.innerHTML=emps.map(function(e){
    return '<div class="emp-card">'+
      '<div class="emp-info">'+
        '<div class="emp-name">'+e.name+'</div>'+
        '<div class="emp-meta">'+
          'Lương CB: '+fmtNum(e.baseSalary)+' đ &nbsp;|&nbsp; '+
          'Giờ chuẩn: '+(e.standardHours||192)+'h &nbsp;|&nbsp; '+
          'HH: '+(e.commissionRate||0)+'%'+
          (e.note?' &nbsp;|&nbsp; '+e.note:'')+
        '</div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;flex-shrink:0">'+
        '<button class="btn btn-primary btn-sm" data-id="'+e.id+'" onclick="editEmployee(this.dataset.id)">Sửa</button>'+
        '<button class="btn btn-danger btn-sm" data-id="'+e.id+'" onclick="deleteEmployee(this.dataset.id)">Xóa</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

function saveEmployee(){
  var name=document.getElementById('emp-name').value.trim();
  if(!name){showMsg('emp-msg','Vui lòng nhập họ tên nhân viên','error');return;}
  var emps=loadEmployees();
  var editId=document.getElementById('emp-edit-id').value;
  var emp={
    id:editId||nextId(),name:name,
    baseSalary:Number(document.getElementById('emp-base').value)||0,
    standardHours:Number(document.getElementById('emp-hours').value)||192,
    commissionRate:Number(document.getElementById('emp-commission').value)||0,
    note:document.getElementById('emp-note').value.trim(),
  };
  if(editId){var idx=emps.findIndex(function(e){return e.id===editId;});if(idx>=0)emps[idx]=emp;}
  else emps.push(emp);
  saveEmployees(emps);
  resetEmpForm();
  renderEmpList();
  showMsg('emp-msg','Đã lưu nhân viên <strong>'+emp.name+'</strong>','success');
}

function editEmployee(id){
  var emp=loadEmployees().find(function(e){return e.id===id;});
  if(!emp)return;
  document.getElementById('emp-edit-id').value=emp.id;
  document.getElementById('emp-name').value=emp.name;
  document.getElementById('emp-base').value=emp.baseSalary;
  document.getElementById('emp-hours').value=emp.standardHours||192;
  document.getElementById('emp-commission').value=emp.commissionRate||0;
  document.getElementById('emp-note').value=emp.note||'';
  document.getElementById('emp-form-title').textContent='Sửa nhân viên';
  document.getElementById('emp-name').focus();
  clearMsg('emp-msg');
}

function deleteEmployee(id){
  if(!confirm('Xóa nhân viên này?'))return;
  saveEmployees(loadEmployees().filter(function(e){return e.id!==id;}));
  renderEmpList();
}

function resetEmpForm(){
  ['emp-edit-id','emp-name','emp-base','emp-hours','emp-commission','emp-note'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('emp-form-title').textContent='Thêm nhân viên';
  clearMsg('emp-msg');
}

// Tab 1
var kvData=null;
function syncKiotviet(){
  var monthVal=document.getElementById('kv-month').value;
  if(!monthVal){showMsg('kv-msg','Vui lòng chọn tháng','error');return;}
  showMsg('kv-msg','Đang đồng bộ...','info');
  fetch('/api/kiotviet/salary-data?month='+encodeURIComponent(monthToAPI(monthVal)))
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){showMsg('kv-msg','Lỗi: '+data.error,'error');return;}
      kvData=data;
      showMsg('kv-msg','Đồng bộ thành công tháng '+data.month+' — '+(data.staff||[]).length+' nhân viên','success');
      var tbody=document.getElementById('kv-tbody');
      var staff=data.staff||[];
      if(!staff.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:#888">Không có dữ liệu</td></tr>';}
      else tbody.innerHTML=staff.map(function(s,i){
        return '<tr><td>'+(i+1)+'</td><td>'+s.staffName+'</td><td class="num">'+fmtNum(s.totalSales)+' đ</td><td class="num">'+s.invoiceCount+'</td></tr>';
      }).join('');
      document.getElementById('kv-result-card').style.display='';
    })
    .catch(function(err){showMsg('kv-msg','Lỗi kết nối: '+err.message,'error');});
}

// Tab 3
function fillEmpSelect(){
  var sel=document.getElementById('sl-employee');
  var emps=loadEmployees();
  sel.innerHTML='<option value="">-- Chọn nhân viên --</option>'+
    emps.map(function(e){return '<option value="'+e.id+'">'+e.name+'</option>';}).join('');
}
function fillEmployeeData(){
  var id=document.getElementById('sl-employee').value;
  if(!id)return;
  var emp=loadEmployees().find(function(e){return e.id===id;});
  if(emp) document.getElementById('sl-hours').value=emp.standardHours||192;
}
function calculateSalary(){
  var id=document.getElementById('sl-employee').value;
  var emps=loadEmployees();
  var emp=id?emps.find(function(e){return e.id===id;}):null;
  var body={
    name:emp?emp.name:'Nhân viên',
    baseSalary:emp?emp.baseSalary:0,
    hoursWorked:Number(document.getElementById('sl-hours').value)||0,
    standardHours:emp?(emp.standardHours||192):192,
    salesAmount:Number(document.getElementById('sl-sales').value)||0,
    commissionRate:emp?(emp.commissionRate/100):0,
    extraCommission:Number(document.getElementById('sl-extra').value)||0,
    bonus:Number(document.getElementById('sl-bonus').value)||0,
    deduction:Number(document.getElementById('sl-deduction').value)||0,
  };
  showMsg('sl-msg','Đang tính...','info');
  fetch('/api/salary/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){showMsg('sl-msg','Lỗi: '+data.error,'error');return;}
      clearMsg('sl-msg');
      var html='<div class="slip-row"><span class="slip-label">Nhân viên</span><span><strong>'+data.name+'</strong></span></div>'+
        '<div class="slip-row"><span class="slip-label">Lương cơ bản (100%)</span><span>'+fmt(data.baseSalaryFull)+'</span></div>'+
        '<div class="slip-row"><span class="slip-label">Ngày công ('+data.hoursWorked+'/'+data.standardHours+'h = '+data.attendanceRatio+'%)</span><span>'+fmt(data.actualBaseSalary)+'</span></div>'+
        '<div class="slip-row"><span class="slip-label">Doanh số tháng</span><span>'+fmt(data.salesAmount)+'</span></div>'+
        '<div class="slip-row"><span class="slip-label">Hoa hồng ('+(data.commissionRate*100).toFixed(1)+'%)</span><span>'+fmt(data.commission)+'</span></div>';
      if(data.extraCommission) html+='<div class="slip-row"><span class="slip-label">Hoa hồng thêm</span><span>'+fmt(data.extraCommission)+'</span></div>';
      if(data.bonus) html+='<div class="slip-row"><span class="slip-label">Thưởng</span><span>+ '+fmt(data.bonus)+'</span></div>';
      if(data.deduction) html+='<div class="slip-row"><span class="slip-label">Khấu trừ</span><span>- '+fmt(data.deduction)+'</span></div>';
      html+='<div class="slip-row slip-total"><span class="slip-label">TỔNG LƯƠNG</span><span>'+fmt(data.totalSalary)+'</span></div>';
      document.getElementById('slip-content').innerHTML=html;
      document.getElementById('slip-card').style.display='';
    })
    .catch(function(err){showMsg('sl-msg','Lỗi kết nối: '+err.message,'error');});
}

// Tab 4
var payrollData=null;
function calcPayroll(){
  var monthVal=document.getElementById('bl-month').value;
  if(!monthVal){showMsg('bl-msg','Vui lòng chọn tháng','error');return;}
  var emps=loadEmployees();
  if(!emps.length){showMsg('bl-msg','Chưa có nhân viên. Vui lòng thêm ở tab Nhân viên','error');return;}
  showMsg('bl-msg','Đang tính bảng lương...','info');
  fetch('/api/salary/payroll-from-kiotviet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:monthToAPI(monthVal),employees:emps})})
    .then(function(r){return r.json();})
    .then(function(data){
      if(data.error){showMsg('bl-msg','Lỗi: '+data.error,'error');return;}
      payrollData=data;
      showMsg('bl-msg','Đã tính xong bảng lương tháng '+data.month,'success');
      document.getElementById('bl-title').textContent='Bảng lương tháng '+data.month;
      var payroll=data.payroll||[];
      var tBase=0,tSales=0,tComm=0,tBonus=0,tDed=0,tAll=0;
      document.getElementById('bl-tbody').innerHTML=payroll.map(function(p,i){
        tBase+=p.actualBaseSalary;tSales+=p.salesAmount;tComm+=p.commission;
        tBonus+=p.bonus;tDed+=p.deduction;tAll+=p.totalSalary;
        return '<tr><td>'+(i+1)+'</td><td>'+p.name+'</td>'+
          '<td class="num">'+fmtNum(p.actualBaseSalary)+'</td>'+
          '<td class="num">'+fmtNum(p.salesAmount)+'</td>'+
          '<td class="num">'+fmtNum(p.commission)+'</td>'+
          '<td class="num">'+fmtNum(p.bonus)+'</td>'+
          '<td class="num">'+fmtNum(p.deduction)+'</td>'+
          '<td class="num"><strong>'+fmtNum(p.totalSalary)+'</strong></td></tr>';
      }).join('');
      document.getElementById('bl-tfoot').innerHTML='<tr style="background:#e8f5f0;font-weight:600">'+
        '<td colspan="2">Tổng cộng</td>'+
        '<td class="num">'+fmtNum(tBase)+'</td><td class="num">'+fmtNum(tSales)+'</td>'+
        '<td class="num">'+fmtNum(tComm)+'</td><td class="num">'+fmtNum(tBonus)+'</td>'+
        '<td class="num">'+fmtNum(tDed)+'</td><td class="num">'+fmtNum(tAll)+'</td></tr>';
      document.getElementById('bl-result-card').style.display='';
    })
    .catch(function(err){showMsg('bl-msg','Lỗi kết nối: '+err.message,'error');});
}

function exportCSV(){
  if(!payrollData)return;
  var rows=[['STT','Ho ten','Luong CB','Doanh so','Hoa hong','Thuong','Khau tru','Tong luong']];
  (payrollData.payroll||[]).forEach(function(p,i){
    rows.push([i+1,p.name,p.actualBaseSalary,p.salesAmount,p.commission,p.bonus,p.deduction,p.totalSalary]);
  });
  var csv=rows.map(function(r){return r.join(',');}).join('\\n');
  var blob=new Blob(['\\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='bang-luong-'+(payrollData.month||'').replace('/','_')+'.csv';
  a.click();URL.revokeObjectURL(url);
}

// Init
document.getElementById('kv-month').value=currentMonth();
document.getElementById('bl-month').value=currentMonth();
renderEmpList();
</script>
</body>
</html>`;

// ════════════════════════════════════════════════════════════
//  Main fetch handler
// ════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;

    // Preflight CORS
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Parse Google credentials từ secret env
    let gsCreds = null;
    if (env.GOOGLE_CREDENTIALS_JSON) {
      try { gsCreds = JSON.parse(env.GOOGLE_CREDENTIALS_JSON); } catch { /* invalid JSON */ }
    }

    // ── Serve trang tính lương (GET /) ────────────────────
    if (method === 'GET' && url.pathname === '/') {
      return new Response(SALARY_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
      });
    }

    // ── Serve vòng quay (static asset) ────────────────────
    if (method === 'GET' && url.pathname === '/vong-quay-may-man.html') {
      const assetUrl = new URL('/vong-quay-may-man.html', request.url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // ── /api/info ──────────────────────────────────────────
    if (url.pathname === '/api/info' && method === 'GET') {
      const base = `${url.protocol}//${url.host}`;
      return jsonResp({
        localUrl:  base,
        lanUrl:    base,
        lanIp:     url.hostname,
        port:      url.port || (url.protocol === 'https:' ? 443 : 80),
        gsEnabled: !!gsCreds,
      });
    }

    // ── /api/qr — QR code sinh trên client, trả URL thôi ──
    if (url.pathname === '/api/qr' && method === 'GET') {
      const target = url.searchParams.get('url') || `${url.protocol}//${url.host}`;
      return jsonResp({ qr: null, url: target });
    }

    // ── /api/invoices ──────────────────────────────────────
    if (url.pathname === '/api/invoices' && method === 'GET') {
      return handleInvoices(url);
    }

    // ── /api/invoice ───────────────────────────────────────
    if (url.pathname === '/api/invoice' && method === 'GET') {
      return handleInvoice(url);
    }

    // ── /api/history ───────────────────────────────────────
    if (url.pathname === '/api/history') {
      return handleHistory(request, env, gsCreds);
    }

    // ── /api/loyalty ───────────────────────────────────────
    if (url.pathname === '/api/loyalty' && method === 'GET') {
      return handleLoyalty(url);
    }

    // ── /api/top-customers ─────────────────────────────────
    if (url.pathname === '/api/top-customers' && method === 'GET') {
      return handleTopCustomers(env);
    }

    // ── /api/customergroups ────────────────────────────────
    if (url.pathname === '/api/customergroups' && method === 'GET') {
      try {
        return jsonResp(await getCustomerGroups());
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    // ── /api/kiotviet/salary-data ──────────────────────────
    if (url.pathname === '/api/kiotviet/salary-data' && method === 'GET') {
      return handleKiotvietSalaryData(url);
    }

    // ── /api/salary/calculate ──────────────────────────────
    if (url.pathname === '/api/salary/calculate' && method === 'POST') {
      return handleSalaryCalculate(request);
    }

    // ── /api/salary/payroll-from-kiotviet ──────────────────
    if (url.pathname === '/api/salary/payroll-from-kiotviet' && method === 'POST') {
      return handlePayrollFromKiotviet(request);
    }

    return jsonResp({ error: 'Endpoint không tồn tại' }, 404);
  },
};
