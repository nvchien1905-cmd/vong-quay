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
  MIN_AMOUNT:    200000,
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

async function getMonthlyInvoices() {
  const branchIds = await getTargetBranchIds();
  const branchQs  = buildBranchQs(branchIds);
  const now   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y     = now.getFullYear();
  const m     = now.getMonth();
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
  return { invoices: all, month: `${String(m + 1).padStart(2, '0')}/${y}` };
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
    const branchIds = await getTargetBranchIds();
    const data = await kiotFetch(
      `/invoices?pageSize=100&customerTel=${encodeURIComponent(phone)}&orderDirection=Desc&status=1${buildBranchQs(branchIds)}`
    );
    return jsonResp(data.data || []);
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

async function handleTopCustomers() {
  try {
    const { invoices, month } = await getMonthlyInvoices();
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

    // ── Serve HTML (static asset) ──────────────────────────
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/vong-quay-may-man.html')) {
      // Yêu cầu file cụ thể từ ASSETS binding
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
      return handleTopCustomers();
    }

    // ── /api/customergroups ────────────────────────────────
    if (url.pathname === '/api/customergroups' && method === 'GET') {
      try {
        return jsonResp(await getCustomerGroups());
      } catch (err) {
        return jsonResp({ error: err.message }, 500);
      }
    }

    return jsonResp({ error: 'Endpoint không tồn tại' }, 404);
  },
};
