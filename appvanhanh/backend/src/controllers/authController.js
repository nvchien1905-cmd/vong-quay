const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { jwtSecret, jwtRefreshSecret, jwtExpiresIn, jwtRefreshExpiresIn } = require('../config');
const { ok, created, error, unauthorized } = require('../utils/response');

const prisma = new PrismaClient();

const signAccess = (payload) => jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });
const signRefresh = (payload) => jwt.sign(payload, jwtRefreshSecret, { expiresIn: jwtRefreshExpiresIn });

const buildPayload = (user) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  storeId: user.storeId,
  zoneId: user.zoneId,
  name: user.name,
});

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return unauthorized(res, 'Invalid credentials');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return unauthorized(res, 'Invalid credentials');

  const payload = buildPayload(user);
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh({ id: user.id });

  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

  return ok(res, {
    accessToken,
    refreshToken,
    user: { ...payload, avatar: user.avatar },
  });
};

exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return unauthorized(res);

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, jwtRefreshSecret);
  } catch {
    return unauthorized(res, 'Invalid refresh token');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user || user.refreshToken !== refreshToken) {
    return unauthorized(res, 'Token reuse detected');
  }

  const payload = buildPayload(user);
  const newAccess = signAccess(payload);
  const newRefresh = signRefresh({ id: user.id });

  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefresh } });

  return ok(res, { accessToken: newAccess, refreshToken: newRefresh });
};

exports.logout = async (req, res) => {
  await prisma.user.update({
    where: { id: req.user.id },
    data: { refreshToken: null },
  });
  return ok(res, null, 'Logged out');
};

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  const match = await bcrypt.compare(oldPassword, user.password);
  if (!match) return error(res, 'Old password incorrect');

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });

  return ok(res, null, 'Password changed');
};

exports.saveFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
  await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken } });
  return ok(res, null, 'FCM token saved');
};

exports.getMe = async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      avatar: true, storeId: true, zoneId: true,
      store: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
    },
  });
  return ok(res, user);
};
