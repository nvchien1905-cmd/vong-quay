const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');
const { unauthorized } = require('../utils/response');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res);
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return unauthorized(res, 'Token invalid or expired');
  }
};
