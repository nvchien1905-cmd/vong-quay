const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const { URLSearchParams } = require('url');

// ──── Lịch sử trúng thưởng (JSON — luôn dùng làm backup) ────
const HISTORY_FILE = path.join(__dirname, 'lich-su-trung-thuong.json');

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
  catch { return []; }
}
function writeHistory(arr) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2), 'utf8');
}

// ════════════════════════════════════════════════════════════
//  CẤU HÌNH — Điền thông tin KiotViet và Google Sheets vào đây
// ════════════════════════════════════════════════════════════
const _GS_CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
// GS_ENABLED tự bật khi có GOOGLE_CREDENTIALS_JSON (Railway) hoặc file credentials.json (local)
const _GS_ENABLED = !!process.env.GOOGLE_CREDENTIALS_JSON || fs.existsSync(_GS_CREDENTIALS_FILE);

const CFG = {
  // ── KiotViet API ──────────────────────────────────────────
  CLIENT_ID:     'd67357dc-f1f3-465d-8c21-a633456ef46d',
  CLIENT_SECRET: 'E108C2FAC4B709A859E9702824DABF6EB6F6CBFF',
  RETAILER:      'tongkhohuyenanh01',
  PORT:          process.env.PORT || 3000,

  // ── Google Sheets ──────────────────────────────────────────
  GS_ENABLED:     _GS_ENABLED,
  GS_CREDENTIALS: _GS_CREDENTIALS_FILE, // file Service Account key (local)
  GS_SHEET_ID:    '19Gn0hHao929TSI7GuhAUFtBpEsFjAlb0vvd_N7Xakoo',
  GS_TAB:         'Lich su',            // tên tab trong Google Spreadsheet
};
// ════════════════════════════════════════════════════════════

// ──── LAN IP ────
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const LAN_IP  = getLanIp();
const LAN_URL = `http://${LAN_IP}:${CFG.PORT}`;

// ──── Google Sheets ────
let googleSheets = null;

async function initSheets() {
  if (!CFG.GS_ENABLED) {
    console.log('[Sheets] Bo qua -- khong tim thay credentials (GOOGLE_CREDENTIALS_JSON chua duoc dat)');
    return;
  }
  try {
    const { google } = require('googleapis');

    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      console.log('[Sheets] Dung credentials tu bien moi truong GOOGLE_CREDENTIALS_JSON');
      try {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      } catch (parseErr) {
        throw new Error('Khong the parse GOOGLE_CREDENTIALS_JSON -- kiem tra JSON co hop le khong. ' + parseErr.message);
      }
    } else {
      console.log('[Sheets] Dung credentials tu file:', CFG.GS_CREDENTIALS);
      credentials = JSON.parse(fs.readFileSync(CFG.GS_CREDENTIALS, 'utf8'));
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    googleSheets = google.sheets({ version: 'v4', auth });

    // Tạo header row nếu sheet còn trống
    const check = await googleSheets.spreadsheets.values.get({
      spreadsheetId: CFG.GS_SHEET_ID,
      range: `${CFG.GS_TAB}!A1:F1`,
    });
    if (!check.data.values || !check.data.values[0]) {
      await googleSheets.spreadsheets.values.update({
        spreadsheetId: CFG.GS_SHEET_ID,
        range: `${CFG.GS_TAB}!A1:F1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['So dien thoai', 'Ma hoa don', 'Emoji', 'Giai thuong', 'Thoi gian quay', 'ISO Time']],
        },
      });
    }
    console.log('[Sheets] Ket noi Google Sheets thanh cong ✓');
  } catch (err) {
    console.error('[Sheets] LOI KET NOI:', err.message);
    console.error('[Sheets] -- Tren Railway: dat bien GOOGLE_CREDENTIALS_JSON = noi dung file credentials.json');
    console.error('[Sheets] -- Local: dat file credentials.json ben canh proxy-server.js');
    googleSheets = null;
  }
}

async function gsAppend(entry) {
  if (!googleSheets) return;
  try {
    await googleSheets.spreadsheets.values.append({
      spreadsheetId: CFG.GS_SHEET_ID,
      range: `${CFG.GS_TAB}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          entry.phone       || '',
          entry.invoiceCode || '',
          entry.prizeEmoji  || '',
          entry.prize       || '',
          entry.spinTime    || '',
          entry.spinTimeISO || '',
        ]],
      },
    });
    console.log(`[Sheets] Da ghi: ${entry.phone} | ${entry.prize}`);
  } catch (err) {
    console.error('[Sheets] Loi ghi:', err.message);
  }
}

async function gsRead() {
  if (!googleSheets) return null;
  try {
    const res = await googleSheets.spreadsheets.values.get({
      spreadsheetId: CFG.GS_SHEET_ID,
      range: `${CFG.GS_TAB}!A2:F`,
    });
    return (res.data.values || []).map(r => ({
      phone:       r[0] || '',
      invoiceCode: r[1] || '',
      prizeEmoji:  r[2] || '',
      prize:       r[3] || '',
      spinTime:    r[4] || '',
      spinTimeISO: r[5] || '',
    }));
  } catch (err) {
    console.error('[Sheets] Loi doc:', err.message);
    return null;
  }
}

async function gsClear() {
  if (!googleSheets) return;
  try {
    await googleSheets.spreadsheets.values.clear({
      spreadsheetId: CFG.GS_SHEET_ID,
      range: `${CFG.GS_TAB}!A2:F`,
    });
    console.log('[Sheets] Da xoa lich su tren Google Sheets');
  } catch (err) {
    console.error('[Sheets] Loi xoa:', err.message);
  }
}

// ──── KiotViet API ────
let _tok = null, _tokExp = 0;

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`KiotViet tra loi ${res.statusCode}: ${data}`));
        } catch {
          reject(new Error(`Phan hoi khong hop le (${res.statusCode}): ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  if (_tok && Date.now() < _tokExp) return _tok;

  const body = new URLSearchParams({
    scopes:        'PublicApi.Access',
    grant_type:    'client_credentials',
    client_id:     CFG.CLIENT_ID,
    client_secret: CFG.CLIENT_SECRET,
  }).toString();

  console.log('[Token] Dang lay token moi...');
  const d = await httpsRequest({
    hostname: 'id.kiotviet.vn',
    path:     '/connect/token',
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  _tok    = d.access_token;
  _tokExp = Date.now() + (d.expires_in - 120) * 1000;
  console.log('[Token] Lay token thanh cong, het han sau', d.expires_in, 'giay');
  return _tok;
}

async function getInvoices(phone) {
  const token = await getToken();
  const qs    = `/invoices?pageSize=100&customerTel=${encodeURIComponent(phone)}&orderDirection=Desc&status=1`;
  const data  = await httpsRequest({
    hostname: 'public.kiotapi.com',
    path:     qs,
    method:   'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Retailer':      CFG.RETAILER,
    },
  });
  return data.data || [];
}

// ──── HTTP Server ────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${CFG.PORT}`);

  // ── Serve HTML ──────────────────────────────────────────────
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/vong-quay-may-man.html')) {
    const htmlPath = path.join(__dirname, 'vong-quay-may-man.html');
    fs.readFile(htmlPath, (err, data) => {
      if (err) { sendJSON(res, 500, { error: 'Khong doc duoc file HTML' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS });
      res.end(data);
    });
    return;
  }

  // GET /api/info — thông tin server (LAN IP, port, Sheets status)
  if (url.pathname === '/api/info' && req.method === 'GET') {
    sendJSON(res, 200, {
      localUrl:  `http://localhost:${CFG.PORT}`,
      lanUrl:    LAN_URL,
      lanIp:     LAN_IP,
      port:      CFG.PORT,
      gsEnabled: CFG.GS_ENABLED && !!googleSheets,
    });
    return;
  }

  // GET /api/qr?url=... — QR code PNG dưới dạng data URL
  if (url.pathname === '/api/qr' && req.method === 'GET') {
    const target = url.searchParams.get('url') || LAN_URL;
    try {
      const QRCode  = require('qrcode');
      const dataUrl = await QRCode.toDataURL(target, {
        width: 200, margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      sendJSON(res, 200, { qr: dataUrl, url: target });
    } catch {
      sendJSON(res, 503, { error: 'Can cai dat: npm install qrcode' });
    }
    return;
  }

  // GET /api/invoices?phone=09xx ──────────────────────────────
  if (url.pathname === '/api/invoices' && req.method === 'GET') {
    const phone = url.searchParams.get('phone');
    if (!phone) { sendJSON(res, 400, { error: 'Thieu tham so phone' }); return; }

    console.log(`[Invoices] SDT: ${phone}`);
    try {
      const invoices = await getInvoices(phone);
      console.log(`[Invoices] SDT ${phone} -> ${invoices.length} hoa don`);
      sendJSON(res, 200, invoices);
    } catch (err) {
      console.error('[Invoices] Loi:', err.message);
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // GET /api/invoice?phone=09xx&code=HD001234 ─────────────────
  if (url.pathname === '/api/invoice' && req.method === 'GET') {
    const phone = url.searchParams.get('phone');
    const code  = (url.searchParams.get('code') || '').toUpperCase();
    if (!phone || !code) { sendJSON(res, 400, { error: 'Thieu tham so phone hoac code' }); return; }

    console.log(`[Invoice] SDT: ${phone} | Ma: ${code}`);
    try {
      const invoices = await getInvoices(phone);
      if (!invoices.length) { sendJSON(res, 200, { valid: false, reason: 'PHONE_NOT_FOUND' }); return; }

      const inv = invoices.find(i => (i.code || '').toUpperCase() === code || String(i.id) === code);
      if (!inv) { sendJSON(res, 200, { valid: false, reason: 'CODE_NOT_FOUND' }); return; }

      const rawDate = inv.purchaseDate || inv.createdDate || inv.modifiedDate;
      let todayOk = false;
      if (rawDate) {
        const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const invD = new Date(new Date(rawDate).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        todayOk = now.getFullYear() === invD.getFullYear()
               && now.getMonth()    === invD.getMonth()
               && now.getDate()     === invD.getDate();
      }
      if (!todayOk) { sendJSON(res, 200, { valid: false, reason: 'NOT_TODAY', invoiceDate: rawDate }); return; }

      const amount = inv.total || inv.totalPayment || 0;
      if (amount < 200000) { sendJSON(res, 200, { valid: false, reason: 'AMOUNT_TOO_LOW', amount }); return; }

      console.log(`[Invoice] Hop le -> #${inv.code} | ${amount.toLocaleString('vi-VN')}d`);
      sendJSON(res, 200, { valid: true, invoice: inv });
    } catch (err) {
      console.error('[Invoice] Loi:', err.message);
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // GET /api/history ──────────────────────────────────────────
  if (url.pathname === '/api/history' && req.method === 'GET') {
    const gsData = await gsRead();
    sendJSON(res, 200, gsData !== null ? gsData : readHistory());
    return;
  }

  // POST /api/history — lưu một lượt quay ────────────────────
  if (url.pathname === '/api/history' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const entry = JSON.parse(body);
        entry.serverSavedAt = new Date().toISOString();

        // Luôn lưu JSON làm backup cục bộ
        const hist = readHistory();
        hist.push(entry);
        writeHistory(hist);

        // Lưu lên Google Sheets (nếu đã bật)
        await gsAppend(entry);

        console.log(`[History] ${entry.phone} | ${entry.invoiceCode} | ${entry.prize}`);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        sendJSON(res, 400, { error: 'Body khong hop le: ' + err.message });
      }
    });
    return;
  }

  // DELETE /api/history — xóa toàn bộ lịch sử ───────────────
  if (url.pathname === '/api/history' && req.method === 'DELETE') {
    writeHistory([]);
    await gsClear();
    console.log('[History] Da xoa toan bo lich su');
    sendJSON(res, 200, { ok: true });
    return;
  }

  sendJSON(res, 404, { error: 'Khong tim thay endpoint. Vao ' + LAN_URL + ' de mo vong quay.' });
});

server.listen(CFG.PORT, async () => {
  await initSheets();

  // In QR code ra terminal nếu đã cài npm install qrcode
  if (LAN_IP !== 'localhost') {
    try {
      const QRCode = require('qrcode');
      const qrStr  = await QRCode.toString(LAN_URL, { type: 'terminal', small: true });
      console.log('\nQR Code -- Khach quet bang dien thoai:\n');
      console.log(qrStr);
    } catch { /* qrcode chua cai -- bo qua */ }
  }

  const gsStatus = CFG.GS_ENABLED && googleSheets
    ? 'Google Sheets (bat ✓)'
    : 'File JSON (Sheets tat)';

  console.log('');
  console.log('='.repeat(54));
  console.log('  VONG QUAY MAY MAN -- SERVER DANG CHAY');
  console.log('='.repeat(54));
  console.log(`  May tinh   : http://localhost:${CFG.PORT}`);
  if (LAN_IP !== 'localhost') {
    console.log(`  Dien thoai : ${LAN_URL}  <-- khach quet QR`);
  }
  console.log(`  Luu tru    : ${gsStatus}`);
  console.log('='.repeat(54));
  console.log('  Nhan Ctrl+C de dung server');
  console.log('');
});
