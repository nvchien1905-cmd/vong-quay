const { PrismaClient } = require('@prisma/client');
const { ok, created, notFound, forbidden, error } = require('../utils/response');
const { awardKpi, KPI_RULES } = require('../services/kpiService');
const { uploadBuffer } = require('../services/cloudinaryService');
const { sendPush } = require('../services/fcmService');

const prisma = new PrismaClient();

const taskSelect = {
  id: true, title: true, description: true, status: true, priority: true,
  deadline: true, standard: true, completedAt: true, rejectedReason: true,
  createdAt: true, updatedAt: true,
  creator: { select: { id: true, name: true, avatar: true } },
  assignee: { select: { id: true, name: true, avatar: true } },
  collaborators: { select: { id: true, name: true, avatar: true } },
  store: { select: { id: true, name: true } },
  attachments: true,
  _count: { select: { comments: true } },
};

exports.list = async (req, res) => {
  const { status, priority, storeId, assigneeId, page = 1, limit = 20 } = req.query;
  const user = req.user;

  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  if (user.role === 'EMPLOYEE') {
    where.OR = [{ assigneeId: user.id }, { collaborators: { some: { id: user.id } } }];
  } else if (user.role === 'STORE_MANAGER') {
    where.storeId = user.storeId;
  } else if (user.role === 'ZONE_MANAGER') {
    where.store = { zoneId: user.zoneId };
  }

  if (storeId && ['OWNER', 'ZONE_MANAGER'].includes(user.role)) where.storeId = storeId;
  if (assigneeId) where.assigneeId = assigneeId;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where, select: taskSelect,
      skip: (page - 1) * limit,
      take: Number(limit),
      orderBy: [{ priority: 'desc' }, { deadline: 'asc' }],
    }),
    prisma.task.count({ where }),
  ]);

  return ok(res, { tasks, total, page: Number(page), limit: Number(limit) });
};

exports.getOne = async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      creator: { select: { id: true, name: true, avatar: true } },
      assignee: { select: { id: true, name: true, avatar: true } },
      collaborators: { select: { id: true, name: true, avatar: true } },
      store: { select: { id: true, name: true } },
      attachments: true,
      comments: {
        include: { user: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
      logs: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!task) return notFound(res);
  return ok(res, task);
};

exports.create = async (req, res) => {
  const { title, description, assigneeId, collaboratorIds = [], deadline, priority, standard, storeId } = req.body;

  const task = await prisma.task.create({
    data: {
      title, description, deadline: deadline ? new Date(deadline) : null,
      priority: priority || 'MEDIUM',
      standard,
      storeId: storeId || req.user.storeId,
      creatorId: req.user.id,
      assigneeId: assigneeId || null,
      collaborators: collaboratorIds.length ? { connect: collaboratorIds.map((id) => ({ id })) } : undefined,
    },
    select: taskSelect,
  });

  await prisma.taskLog.create({
    data: { taskId: task.id, userId: req.user.id, action: 'CREATED', detail: `Task created` },
  });

  req.io?.to(`store-${task.storeId}`).emit('task:created', task);

  if (assigneeId) {
    const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { fcmToken: true, name: true } });
    if (assignee?.fcmToken) {
      await sendPush(assignee.fcmToken, 'Có task mới!', `Bạn được giao: ${title}`, { taskId: task.id, type: 'NEW_TASK' });
    }
  }

  return created(res, task);
};

exports.update = async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return notFound(res);

  const { title, description, assigneeId, collaboratorIds, deadline, priority, standard, storeId } = req.body;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      title: title ?? task.title,
      description: description ?? task.description,
      deadline: deadline ? new Date(deadline) : task.deadline,
      priority: priority ?? task.priority,
      standard: standard ?? task.standard,
      storeId: storeId ?? task.storeId,
      assigneeId: assigneeId !== undefined ? assigneeId : task.assigneeId,
      collaborators: collaboratorIds ? { set: collaboratorIds.map((id) => ({ id })) } : undefined,
    },
    select: taskSelect,
  });

  await prisma.taskLog.create({
    data: { taskId: task.id, userId: req.user.id, action: 'UPDATED', detail: 'Task updated' },
  });

  req.io?.to(`store-${updated.storeId?.id || updated.storeId}`).emit('task:updated', updated);

  return ok(res, updated);
};

exports.updateStatus = async (req, res) => {
  const { status, rejectedReason } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return notFound(res);

  const user = req.user;

  // Permission checks
  if (status === 'IN_PROGRESS' || status === 'PENDING_APPROVAL') {
    if (task.assigneeId !== user.id && user.role !== 'STORE_MANAGER') {
      return forbidden(res);
    }
  }
  if (status === 'COMPLETED' || status === 'REJECTED') {
    if (!['STORE_MANAGER', 'ZONE_MANAGER', 'OWNER'].includes(user.role)) {
      return forbidden(res);
    }
  }

  const data = { status };
  if (status === 'COMPLETED') data.completedAt = new Date();
  if (status === 'REJECTED') {
    data.rejectedAt = new Date();
    data.rejectedReason = rejectedReason;
  }

  const updated = await prisma.task.update({ where: { id: task.id }, data, select: taskSelect });

  await prisma.taskLog.create({
    data: { taskId: task.id, userId: user.id, action: `STATUS_${status}`, detail: rejectedReason || null },
  });

  // KPI scoring
  if (status === 'COMPLETED' && task.assigneeId) {
    const isLate = task.deadline && new Date() > new Date(task.deadline);
    await awardKpi(
      task.assigneeId, task.storeId,
      isLate ? KPI_RULES.LATE : KPI_RULES.ON_TIME,
      isLate ? 'Hoàn thành muộn deadline' : 'Hoàn thành đúng deadline',
      task.id
    );
  }
  if (status === 'REJECTED' && task.assigneeId) {
    await awardKpi(task.assigneeId, task.storeId, KPI_RULES.REJECTED, 'Task bị từ chối', task.id);
  }

  req.io?.to(`store-${task.storeId}`).emit('task:statusChanged', { taskId: task.id, status });

  return ok(res, updated);
};

exports.uploadAttachment = async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return notFound(res);
  if (!req.file) return error(res, 'No file uploaded');

  const result = await uploadBuffer(req.file.buffer, {
    resource_type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
  });

  const attachment = await prisma.taskAttachment.create({
    data: {
      taskId: task.id,
      url: result.secure_url,
      publicId: result.public_id,
      type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
    },
  });

  await prisma.taskLog.create({
    data: { taskId: task.id, userId: req.user.id, action: 'ATTACHMENT_ADDED', detail: attachment.url },
  });

  return created(res, attachment);
};

exports.addComment = async (req, res) => {
  const { content, mentions = [] } = req.body;
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return notFound(res);

  const comment = await prisma.taskComment.create({
    data: { taskId: task.id, userId: req.user.id, content, mentions },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });

  req.io?.to(`task-${task.id}`).emit('task:newComment', comment);

  if (mentions.length > 0) {
    mentions.forEach((uid) => {
      req.io?.to(`user-${uid}`).emit('notification', {
        type: 'MENTION',
        taskId: task.id,
        message: `${req.user.name} đã đề cập đến bạn`,
      });
    });
  }

  return created(res, comment);
};

exports.remove = async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return notFound(res);

  await prisma.task.delete({ where: { id: task.id } });
  return ok(res, null, 'Task deleted');
};
