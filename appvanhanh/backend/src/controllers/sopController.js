const { PrismaClient } = require('@prisma/client');
const { ok, created, notFound, error } = require('../utils/response');
const { uploadBuffer } = require('../services/cloudinaryService');

const prisma = new PrismaClient();

exports.listDocuments = async (req, res) => {
  const { category } = req.query;
  const where = {};
  if (category) where.category = category;

  const docs = await prisma.sopDocument.findMany({
    where,
    select: { id: true, title: true, description: true, fileType: true, category: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, docs);
};

exports.getDocument = async (req, res) => {
  const doc = await prisma.sopDocument.findUnique({
    where: { id: req.params.id },
    include: { quizzes: { select: { id: true, title: true } } },
  });
  if (!doc) return notFound(res);

  const progress = await prisma.sopProgress.findUnique({
    where: { userId_documentId: { userId: req.user.id, documentId: doc.id } },
  });

  return ok(res, { ...doc, progress });
};

exports.uploadDocument = async (req, res) => {
  if (!req.file) return error(res, 'No file uploaded');
  const { title, description, category } = req.body;

  const resourceType = req.file.mimetype.startsWith('video') ? 'video' : 'raw';
  const result = await uploadBuffer(req.file.buffer, { resource_type: resourceType, folder: 'retail-ops/sop' });

  const doc = await prisma.sopDocument.create({
    data: {
      title,
      description,
      category,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      fileType: resourceType === 'video' ? 'video' : 'pdf',
    },
  });
  return created(res, doc);
};

exports.markProgress = async (req, res) => {
  const doc = await prisma.sopDocument.findUnique({ where: { id: req.params.id } });
  if (!doc) return notFound(res);

  const progress = await prisma.sopProgress.upsert({
    where: { userId_documentId: { userId: req.user.id, documentId: doc.id } },
    update: { isCompleted: true, completedAt: new Date() },
    create: { userId: req.user.id, documentId: doc.id, isCompleted: true, completedAt: new Date() },
  });
  return ok(res, progress);
};

exports.getQuiz = async (req, res) => {
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quizId } });
  if (!quiz) return notFound(res);

  // Hide correct answers from response
  const sanitized = {
    ...quiz,
    questions: quiz.questions.map(({ question, options }) => ({ question, options })),
  };
  return ok(res, sanitized);
};

exports.createQuiz = async (req, res) => {
  const { title, questions } = req.body;
  const quiz = await prisma.quiz.create({
    data: { documentId: req.params.id, title, questions },
  });
  return created(res, quiz);
};

exports.submitQuiz = async (req, res) => {
  const { answers } = req.body;
  const quiz = await prisma.quiz.findUnique({ where: { id: req.params.quizId } });
  if (!quiz) return notFound(res);

  const questions = quiz.questions;
  let correct = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correctIndex) correct++;
  });

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= 70;

  const attempt = await prisma.quizAttempt.create({
    data: { quizId: quiz.id, userId: req.user.id, answers, score, passed },
  });

  return ok(res, { score, passed, correct, total: questions.length, attempt });
};

exports.myProgress = async (req, res) => {
  const progress = await prisma.sopProgress.findMany({
    where: { userId: req.user.id },
    include: { document: { select: { id: true, title: true, fileType: true, category: true } } },
  });

  const attempts = await prisma.quizAttempt.findMany({
    where: { userId: req.user.id },
    include: { quiz: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return ok(res, { progress, attempts });
};
