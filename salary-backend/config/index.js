require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  kiotviet: {
    clientId: process.env.KIOTVIET_CLIENT_ID || '',
    clientSecret: process.env.KIOTVIET_CLIENT_SECRET || '',
    retailerCode: process.env.KIOTVIET_RETAILER_CODE || '',
    baseUrl: process.env.KIOTVIET_BASE_URL || 'https://public.kiotapi.com',
    tokenUrl: 'https://id.kiotviet.vn/connect/token',
  },

  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : '*',
  },

  rateLimit: {
    global: {
      windowMs: 60 * 1000,
      max: 100,
    },
    kiotviet: {
      windowMs: 60 * 1000,
      max: 20,
    },
  },

  cache: {
    tokenTtl: 23 * 60 * 60,
    dataTtl: 5 * 60,
  },
};

module.exports = config;
