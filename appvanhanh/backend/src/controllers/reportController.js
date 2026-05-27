const { PrismaClient } = require('@prisma/client');
const { ok } = require('../utils/response');

const prisma = new PrismaClient();

const parseRange = (from, to) => {
  const start = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
  const end = to ? new Date(to) : new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

exports.taskStats = async (req, res) => {
  const { from, to, storeId, userId } = req.query;
  const { start, end } = parseRange(from, to);
  const user = req.user;

  const where = { createdAt: { gte: start, lte: end } };
  if (storeId) where.storeId = storeId;
  else if (user.storeId) where.storeId = user.storeId;
  if (userId) where.assigneeId = userId;

  const [total, completed, overdue, pending, inProgress, rejected] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.count({ where: { ...where, status: 'COMPLETED' } }),
    prisma.task.count({ where: { ...where, status: 'OVERDUE' } }),
    prisma.task.count({ where: { ...where, status: 'PENDING_APPROVAL' } }),
    prisma.task.count({ where: { ...where, status: 'IN_PROGRESS' } }),
    prisma.task.count({ where: { ...where, status: 'REJECTED' } }),
  ]);

  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Daily breakdown for chart
  const tasks = await prisma.task.findMany({
    where,
    select: { createdAt: true, status: true },
  });

  const dailyMap = {};
  tasks.forEach((t) => {
    const day = t.createdAt.toISOString().split('T')[0];
    if (!dailyMap[day]) dailyMap[day] = { date: day, total: 0, completed: 0 };
    dailyMap[day].total++;
    if (t.status === 'COMPLETED') dailyMap[day].completed++;
  });

  const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return ok(res, {
    summary: { total, completed, overdue, pending, inProgress, rejected, completionRate },
    dailyData,
  });
};

exports.yearlyReport = async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end = new Date(`${year}-12-31T23:59:59.999Z`);

  const tasks = await prisma.task.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { createdAt: true, status: true, storeId: true, store: { select: { name: true } } },
  });

  // Group by month
  const monthMap = {};
  for (let m = 1; m <= 12; m++) monthMap[m] = { month: m, total: 0, completed: 0, overdue: 0 };
  tasks.forEach((t) => {
    const m = new Date(t.createdAt).getMonth() + 1;
    monthMap[m].total++;
    if (t.status === 'COMPLETED') monthMap[m].completed++;
    if (t.status === 'OVERDUE') monthMap[m].overdue++;
  });

  // Group by store
  const storeMap = {};
  tasks.forEach((t) => {
    if (!t.storeId) return;
    if (!storeMap[t.storeId]) storeMap[t.storeId] = { name: t.store?.name || t.storeId, total: 0, completed: 0 };
    storeMap[t.storeId].total++;
    if (t.status === 'COMPLETED') storeMap[t.storeId].completed++;
  });

  return ok(res, { monthly: Object.values(monthMap), storeStats: Object.values(storeMap) });
};

exports.kpiReport = async (req, res) => {
  const { month, year, storeId } = req.query;
  const now = new Date();
  const m = month ? Number(month) : now.getMonth() + 1;
  const y = year ? Number(year) : now.getFullYear();

  const where = { month: m, year: y };
  if (storeId) where.storeId = storeId;
  else if (req.user.storeId) where.storeId = req.user.storeId;

  const scores = await prisma.kpiScore.groupBy({
    by: ['userId'],
    where,
    _sum: { score: true },
    orderBy: { _sum: { score: 'desc' } },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: scores.map((s) => s.userId) } },
    select: { id: true, name: true, avatar: true, role: true },
  });

  const result = scores.map((s) => ({
    user: users.find((u) => u.id === s.userId),
    total: s._sum.score,
  }));

  return ok(res, { report: result, month: m, year: y });
};
