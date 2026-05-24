'use strict';

const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('../src/logger');

const cache = new NodeCache({ useClones: false });

const CACHE_KEYS = {
  TOKEN: 'kv_token',
  SALARY_PREFIX: 'kv_salary_',
};

// ============================================================
// XÁC THỰC
// ============================================================

async function getAccessToken() {
  const cached = cache.get(CACHE_KEYS.TOKEN);
  if (cached) return cached;

  if (!config.kiotviet.clientId || !config.kiotviet.clientSecret) {
    throw Object.assign(
      new Error('Thiếu KIOTVIET_CLIENT_ID hoặc KIOTVIET_CLIENT_SECRET trong cấu hình'),
      { statusCode: 503 }
    );
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.kiotviet.clientId,
    client_secret: config.kiotviet.clientSecret,
    scopes: 'PublicApi.Access',
  });

  const response = await axios.post(config.kiotviet.tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10_000,
  });

  const token = response.data.access_token;
  cache.set(CACHE_KEYS.TOKEN, token, config.cache.tokenTtl);
  logger.info('KiotViet: token mới đã được lưu cache (23h)');
  return token;
}

// ============================================================
// HTTP CLIENT
// ============================================================

async function createApiClient() {
  const token = await getAccessToken();
  return axios.create({
    baseURL: config.kiotviet.baseUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      Retailer: config.kiotviet.retailerCode,
      'Content-Type': 'application/json',
    },
    timeout: 30_000,
  });
}

// ============================================================
// PHÂN TRANG CHUNG
// ============================================================

async function fetchAllPages(client, endpoint, params = {}) {
  const pageSize = 100;
  let currentItem = 0;
  let allData = [];

  while (true) {
    const response = await client.get(endpoint, {
      params: { ...params, currentItem, pageSize },
    });

    const { data = [], total = 0 } = response.data;
    allData = allData.concat(data);

    logger.debug(`KiotViet ${endpoint}: lấy ${allData.length}/${total}`);

    if (allData.length >= total || data.length < pageSize) break;
    currentItem += pageSize;
  }

  return allData;
}

// ============================================================
// NHÂN VIÊN
// ============================================================

async function getEmployees() {
  const client = await createApiClient();
  const employees = await fetchAllPages(client, '/employees', { includeInactive: false });
  logger.info(`KiotViet: lấy được ${employees.length} nhân viên`);
  return employees;
}

// ============================================================
// CHẤM CÔNG
// ============================================================

async function getAttendances(fromDate, toDate) {
  const client = await createApiClient();
  const records = await fetchAllPages(client, '/employees/attendances', {
    fromDate,
    toDate,
  });

  // Tổng hợp workingHour theo employeeId
  const aggregated = {};
  for (const record of records) {
    const id = String(record.employeeId || record.employeeCode || '');
    if (!id) continue;
    if (!aggregated[id]) {
      aggregated[id] = { employeeId: id, totalHours: 0, totalDays: 0 };
    }
    aggregated[id].totalHours += record.workingHour || 0;
    aggregated[id].totalDays += 1;
  }

  logger.info(
    `KiotViet: chấm công ${fromDate}→${toDate}, ${records.length} bản ghi, ${Object.keys(aggregated).length} NV`
  );
  return aggregated;
}

// ============================================================
// HÓA ĐƠN / DOANH THU
// ============================================================

async function getMonthlyRevenue(fromDate, toDate) {
  const client = await createApiClient();
  const invoices = await fetchAllPages(client, '/invoices', {
    status: 'Complete',
    fromPurchaseDate: fromDate,
    toPurchaseDate: toDate,
  });

  const revenueByEmployee = {};
  let totalRevenue = 0;

  for (const invoice of invoices) {
    const payment = invoice.totalPayment || 0;
    totalRevenue += payment;

    const soldById = String(invoice.soldById || '');
    if (soldById) {
      revenueByEmployee[soldById] = (revenueByEmployee[soldById] || 0) + payment;
    }
  }

  logger.info(
    `KiotViet: ${invoices.length} hóa đơn, tổng doanh thu ${totalRevenue.toLocaleString('vi-VN')}đ`
  );
  return { revenueByEmployee, totalRevenue };
}

// ============================================================
// DỮ LIỆU TỔNG HỢP CHO TÍNH LƯƠNG
// ============================================================

/**
 * Lấy toàn bộ dữ liệu cần thiết để tính lương, có cache 5 phút.
 * @param {number} year
 * @param {number} month  (1-12)
 */
async function getSalaryData(year, month) {
  const cacheKey = `${CACHE_KEYS.SALARY_PREFIX}${year}_${String(month).padStart(2, '0')}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.info(`KiotViet: cache hit salary-data ${year}/${month}`);
    return cached;
  }

  const mm = String(month).padStart(2, '0');
  const fromDate = `${year}-${mm}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  logger.info(`KiotViet: bắt đầu lấy dữ liệu lương ${fromDate} → ${toDate}`);

  const [employees, attendances, { revenueByEmployee, totalRevenue }] = await Promise.all([
    getEmployees(),
    getAttendances(fromDate, toDate),
    getMonthlyRevenue(fromDate, toDate),
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

  cache.set(cacheKey, result, config.cache.dataTtl);
  logger.info(`KiotViet: dữ liệu lương ${year}/${month} đã cache (5 phút)`);
  return result;
}

// ============================================================
// QUẢN LÝ CACHE
// ============================================================

function clearCache() {
  cache.flushAll();
  logger.info('KiotViet: toàn bộ cache đã xóa');
}

function getCacheStats() {
  return cache.getStats();
}

module.exports = {
  getSalaryData,
  getEmployees,
  getAttendances,
  getMonthlyRevenue,
  clearCache,
  getCacheStats,
};
