const { PrismaClient } = require('@prisma/client');
const { ok } = require('../utils/response');

const prisma = new PrismaClient();

exports.overview = async (req, res) => {
  const user = req.user;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const storeFilter = user.role === 'EMPLOYEE' || user.role === 'STORE_MANAGER'
    ? { storeId: user.storeId }
    : user.role === 'ZONE_MANAGER'
    ? { store: { zoneId: user.zoneId } }
    : {};

  const [totalTasks, completedToday, overdueTasks, pendingApproval, inProgress] = await Promise.all([
    prisma.task.count({ where: storeFilter }),
    prisma.task.count({
      where: { ...storeFilter, status: 'COMPLETED', completedAt: { gte: today, lt: tomorrow } },
    }),
    prisma.task.count({
      where: {
        ...storeFilter,
        status: { notIn: ['COMPLETED'] },
        deadline: { lt: new Date() },
      },
    }),
    prisma.task.count({ where: { ...storeFilter, status: 'PENDING_APPROVAL' } }),
    prisma.task.count({ where: { ...storeFilter, status: 'IN_PROGRESS' } }),
  ]);

  const overduelist = await prisma.task.findMany({
    where: {
      ...storeFilter,
      status: { notIn: ['COMPLETED'] },
      deadline: { lt: new Date() },
    },
    select: {
      id: true, title: true, deadline: true, priority: true,
      assignee: { select: { id: true, name: true } },
      store: { select: { id: true, name: true } },
    },
    orderBy: { deadline: 'asc' },
    take: 10,
  });

  const kpiTotal = totalTasks > 0
    ? Math.round((completedToday / totalTasks) * 100)
    : 0;

  return ok(res, {
    stats: { totalTasks, completedToday, overdueTasks, pendingApproval, inProgress, kpiPercent: kpiTotal },
    overdueList: overduelist,
  });
};

exports.incompleteEmployees = async (req, res) => {
  const { storeId } = req.query;
  const sid = storeId || req.user.storeId;

  const employees = await prisma.user.findMany({
    where: { storeId: sid, role: 'EMPLOYEE' },
    select: { id: true, name: true, avatar: true },
  });

  const result = await Promise.all(
    employees.map(async (emp) => {
      const incompleteTasks = await prisma.task.count({
        where: { assigneeId: emp.id, status: { notIn: ['COMPLETED'] } },
      });
      return { ...emp, incompleteTasks };
    })
  );

  return ok(res, result.sort((a, b) => b.incompleteTasks - a.incompleteTasks));
};

// Summary for web admin home page
exports.adminSummary = async (req, res) => {
  const user = req.user;
  const storeFilter = user.role === 'STORE_MANAGER' ? { storeId: user.storeId }
    : user.role === 'ZONE_MANAGER' ? { store: { zoneId: user.zoneId } } : {};

  const [totalTasks, completed, overdue, inProgress, overdueList, busyEmployees] = await Promise.all([
    prisma.task.count({ where: storeFilter }),
    prisma.task.count({ where: { ...storeFilter, status: 'COMPLETED' } }),
    prisma.task.count({ where: { ...storeFilter, status: 'OVERDUE' } }),
    prisma.task.count({ where: { ...storeFilter, status: 'IN_PROGRESS' } }),
    prisma.task.findMany({
      where: { ...storeFilter, status: { in: ['OVERDUE', 'NOT_STARTED', 'IN_PROGRESS'] }, deadline: { lt: new Date() } },
      select: { id: true, title: true, priority: true, assignee: { select: { id: true, name: true } }, store: { select: { id: true, name: true } } },
      orderBy: { deadline: 'asc' }, take: 5,
    }),
    prisma.user.findMany({
      where: { role: 'EMPLOYEE', isActive: true, ...(user.storeId ? { storeId: user.storeId } : {}) },
      select: { id: true, name: true, avatar: true, _count: { select: { assignedTasks: true } } },
      orderBy: { assignedTasks: { _count: 'desc' } },
      take: 5,
    }),
  ]);

  return ok(res, { totalTasks, completed, overdue, inProgress, overdueList, busyEmployees });
};

exports.listUsers = async (req, res) => {
  const user = req.user;
  const where = user.role === 'ZONE_MANAGER' ? { zone: { id: user.zoneId } }
    : user.role === 'STORE_MANAGER' ? { storeId: user.storeId } : {};

  const users = await prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, role: true, avatar: true, isActive: true, store: { select: { id: true, name: true } } },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  return ok(res, users);
};

exports.listStores = async (req, res) => {
  const user = req.user;
  const where = user.role === 'ZONE_MANAGER' ? { zoneId: user.zoneId } : {};

  const stores = await prisma.store.findMany({
    where,
    include: {
      zone: { select: { id: true, name: true } },
      _count: { select: { users: true, tasks: true } },
    },
    orderBy: { name: 'asc' },
  });
  return ok(res, stores);
};
