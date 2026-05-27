const { ok } = require('../utils/response');
const { getUserKpiTotal, getStoreRanking, getEmployeeRanking } = require('../services/kpiService');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const nowMonthYear = () => {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
};

exports.myKpi = async (req, res) => {
  const { month, year } = req.query;
  const m = month ? Number(month) : nowMonthYear().month;
  const y = year ? Number(year) : nowMonthYear().year;

  const total = await getUserKpiTotal(req.user.id, m, y);
  const history = await prisma.kpiScore.findMany({
    where: { userId: req.user.id, month: m, year: y },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { total, history, month: m, year: y });
};

exports.employeeRanking = async (req, res) => {
  const { storeId, month, year } = req.query;
  const m = month ? Number(month) : nowMonthYear().month;
  const y = year ? Number(year) : nowMonthYear().year;

  const sid = storeId || req.user.storeId;
  const ranking = await getEmployeeRanking(sid, m, y);
  return ok(res, { ranking, month: m, year: y });
};

exports.storeRanking = async (req, res) => {
  const { month, year } = req.query;
  const m = month ? Number(month) : nowMonthYear().month;
  const y = year ? Number(year) : nowMonthYear().year;

  const ranking = await getStoreRanking(m, y);

  const stores = await prisma.store.findMany({
    where: { id: { in: ranking.map((r) => r.storeId).filter(Boolean) } },
    select: { id: true, name: true },
  });

  const result = ranking.map((r) => ({
    store: stores.find((s) => s.id === r.storeId),
    total: r._sum.score,
  }));

  return ok(res, { ranking: result, month: m, year: y });
};
