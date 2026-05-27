const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { awardKpi, KPI_RULES } = require('../services/kpiService');
const { sendPush } = require('../services/fcmService');

const prisma = new PrismaClient();

// Runs every day at 23:59 — penalises tasks that are overdue but not completed
async function runKpiNightlyJob() {
  console.log('[KPI Cron] Running nightly KPI job...');
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: {
      status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
      deadline: { lt: now },
      assigneeId: { not: null },
    },
    include: {
      assignee: { select: { id: true, name: true, fcmToken: true } },
    },
  });

  for (const task of overdueTasks) {
    await awardKpi(
      task.assigneeId,
      task.storeId,
      KPI_RULES.NO_REPORT,
      `Task "${task.title}" quá hạn không báo cáo`,
      task.id,
    );

    await prisma.task.update({ where: { id: task.id }, data: { status: 'OVERDUE' } });

    if (task.assignee?.fcmToken) {
      await sendPush(
        task.assignee.fcmToken,
        'Task quá hạn',
        `"${task.title}" đã quá hạn và bị trừ ${Math.abs(KPI_RULES.NO_REPORT)} điểm KPI`,
        { taskId: task.id, type: 'OVERDUE' },
      );
    }
  }

  console.log(`[KPI Cron] Processed ${overdueTasks.length} overdue tasks`);
}

function startCron() {
  // 23:59 every day
  cron.schedule('59 23 * * *', runKpiNightlyJob, { timezone: 'Asia/Ho_Chi_Minh' });
  console.log('[KPI Cron] Scheduled nightly job at 23:59 (Asia/Ho_Chi_Minh)');
}

module.exports = { startCron, runKpiNightlyJob };
