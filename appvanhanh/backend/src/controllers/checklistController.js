const { PrismaClient } = require('@prisma/client');
const { ok, created, notFound } = require('../utils/response');
const { uploadBuffer } = require('../services/cloudinaryService');

const prisma = new PrismaClient();

exports.listTemplates = async (req, res) => {
  const { storeId } = req.query;
  const user = req.user;

  const where = {};
  if (storeId) where.storeId = storeId;
  else if (user.storeId) where.storeId = user.storeId;

  const templates = await prisma.checklistTemplate.findMany({
    where,
    include: { items: { orderBy: { order: 'asc' } } },
  });
  return ok(res, templates);
};

exports.createTemplate = async (req, res) => {
  const { name, type, storeId, items = [] } = req.body;
  const template = await prisma.checklistTemplate.create({
    data: {
      name,
      type,
      storeId: storeId || req.user.storeId,
      items: {
        create: items.map((item, i) => ({
          label: item.label,
          order: i,
          requirePhoto: item.requirePhoto || false,
        })),
      },
    },
    include: { items: true },
  });
  return created(res, template);
};

exports.startSession = async (req, res) => {
  const { templateId, storeId } = req.body;
  const template = await prisma.checklistTemplate.findUnique({
    where: { id: templateId },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  if (!template) return notFound(res, 'Template not found');

  const session = await prisma.checklistSession.create({
    data: {
      templateId,
      storeId: storeId || req.user.storeId,
      userId: req.user.id,
      items: {
        create: template.items.map((item) => ({
          label: item.label,
          isChecked: false,
        })),
      },
    },
    include: { items: true, template: { select: { name: true, type: true } } },
  });
  return created(res, session);
};

exports.listSessions = async (req, res) => {
  const { storeId, date } = req.query;
  const user = req.user;

  const where = {};
  if (user.role === 'EMPLOYEE') where.userId = user.id;
  else if (user.storeId) where.storeId = user.storeId;
  if (storeId) where.storeId = storeId;
  if (date) {
    const d = new Date(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    where.shiftDate = { gte: d, lt: next };
  }

  const sessions = await prisma.checklistSession.findMany({
    where,
    include: {
      template: { select: { name: true, type: true } },
      user: { select: { id: true, name: true } },
      items: true,
    },
    orderBy: { shiftDate: 'desc' },
  });
  return ok(res, sessions);
};

exports.updateItem = async (req, res) => {
  const { isChecked, note } = req.body;
  const sessionItem = await prisma.checklistSessionItem.findUnique({
    where: { id: req.params.itemId },
  });
  if (!sessionItem) return notFound(res);

  let photoUrl = sessionItem.photoUrl;
  if (req.file) {
    const result = await uploadBuffer(req.file.buffer);
    photoUrl = result.secure_url;
  }

  const updated = await prisma.checklistSessionItem.update({
    where: { id: sessionItem.id },
    data: {
      isChecked: isChecked !== undefined ? isChecked : sessionItem.isChecked,
      note: note ?? sessionItem.note,
      photoUrl,
      checkedAt: isChecked ? new Date() : null,
    },
  });
  return ok(res, updated);
};

exports.completeSession = async (req, res) => {
  const session = await prisma.checklistSession.findUnique({
    where: { id: req.params.sessionId },
    include: { items: true },
  });
  if (!session) return notFound(res);

  const updated = await prisma.checklistSession.update({
    where: { id: session.id },
    data: { completedAt: new Date() },
  });
  return ok(res, updated);
};
