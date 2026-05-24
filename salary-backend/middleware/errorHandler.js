const logger = require('../src/logger');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  logger.error('Unhandled error', {
    message: err.message,
    statusCode,
    path: req.path,
    method: req.method,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });

  res.status(statusCode).json({
    error: err.message || 'Lỗi máy chủ nội bộ',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
