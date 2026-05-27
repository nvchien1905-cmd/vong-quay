const { forbidden } = require('../utils/response');

const ROLE_LEVEL = { OWNER: 4, ZONE_MANAGER: 3, STORE_MANAGER: 2, EMPLOYEE: 1 };

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return forbidden(res, 'Insufficient permissions');
  }
  next();
};

const requireLevel = (minLevel) => (req, res, next) => {
  if ((ROLE_LEVEL[req.user.role] || 0) < minLevel) {
    return forbidden(res, 'Insufficient permissions');
  }
  next();
};

module.exports = { requireRole, requireLevel, ROLE_LEVEL };
