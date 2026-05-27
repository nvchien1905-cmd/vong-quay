const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const KPI_RULES = {
  ON_TIME: 10,
  LATE: -5,
  NO_REPORT: -10,
  REJECTED: -3,
};

const awardKpi = async (userId, storeId, score, reason, taskId = null) => {
  const now = new Date();
  return prisma.kpiScore.create({
    data: {
      userId,
      storeId,
      score,
      reason,
      taskId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    },
  });
};

const getUserKpiTotal = async (userId, month, year) => {
  const rows = await prisma.kpiScore.findMany({
    where: { userId, month, year },
  });
  return rows.reduce((sum, r) => sum + r.score, 0);
};

const getStoreRanking = async (month, year) => {
  const scores = await prisma.kpiScore.groupBy({
    by: ['storeId'],
    where: { month, year, storeId: { not: null } },
    _sum: { score: true },
    orderBy: { _sum: { score: 'desc' } },
  });
  return scores;
};

const getEmployeeRanking = async (storeId, month, year) => {
  const filter = { month, year };
  if (storeId) filter.storeId = storeId;

  const scores = await prisma.kpiScore.groupBy({
    by: ['userId'],
    where: filter,
    _sum: { score: true },
    orderBy: { _sum: { score: 'desc' } },
  });

  const users = await prisma.user.findMany({
    where: { id: { in: scores.map((s) => s.userId) } },
    select: { id: true, name: true, avatar: true, role: true },
  });

  return scores.map((s) => ({
    ...s,
    user: users.find((u) => u.id === s.userId),
    total: s._sum.score,
  }));
};

module.exports = { awardKpi, getUserKpiTotal, getStoreRanking, getEmployeeRanking, KPI_RULES };
