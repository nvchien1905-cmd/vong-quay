/**
 * Retail Ops Manager — Cloudflare Workers entry point
 * Stack: Hono + Prisma (pg adapter) + jose JWT + Upstash Redis + FCM via fetch
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { compare, hash } from 'bcryptjs';
import { Redis } from '@upstash/redis';

// ── Helpers ────────────────────────────────────────────────────

function getPrisma(env) {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function getRedis(env) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
}

async function signAccess(payload, secret, expiresIn = '15m') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

async function signRefresh(payload, secret, expiresIn = '7d') {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

async function verifyToken(token, secret) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  return payload;
}

async function sendFcm(env, tokens, title, body, data = {}) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return;
  const arr = Array.isArray(tokens) ? tokens.filter(Boolean) : [tokens].filter(Boolean);
  if (!arr.length) return;
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const tokenRes = await fetch(`https://oauth2.googleapis.com/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await makeGoogleJwt(sa),
      }),
    });
    const { access_token } = await tokenRes.json();
    await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
      body: JSON.stringify({
        message: {
          notification: { title, body },
          data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
          token: arr[0],
        },
      }),
    });
  } catch {}
}

async function makeGoogleJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = btoa(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  }));
  const pemKey = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  return `${header}.${claim}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

function ok(c, data, message = 'Success') { return c.json({ success: true, message, data }); }
function created(c, data) { return c.json({ success: true, message: 'Created', data }, 201); }
function notFound(c) { return c.json({ success: false, message: 'Not found' }, 404); }
function unauthorized(c, msg = 'Unauthorized') { return c.json({ success: false, message: msg }, 401); }
function forbidden(c) { return c.json({ success: false, message: 'Forbidden' }, 403); }
function badRequest(c, msg) { return c.json({ success: false, message: msg }, 400); }

// Auth middleware
async function authMiddleware(c, next, env) {
  const header = c.req.header('Authorization') || '';
  const token = header.replace('Bearer ', '');
  if (!token) return unauthorized(c);
  try {
    const payload = await verifyToken(token, env.JWT_SECRET);
    c.set('user', payload);
    return next();
  } catch {
    return unauthorized(c, 'Invalid token');
  }
}

function requireRole(...roles) {
  return async (c, next) => {
    const user = c.get('user');
    if (!roles.includes(user?.role)) return forbidden(c);
    return next();
  };
}

// ── App ───────────────────────────────────────────────────────

const app = new Hono();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  const env = c.env;
  const origins = (env.CLIENT_URL || '*').split(',').map(o => o.trim());
  return cors({
    origin: origins.length === 1 && origins[0] === '*' ? '*' : origins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next);
});

// ── Health ────────────────────────────────────────────────────

app.get('/health', c => c.json({ status: 'ok', runtime: 'Cloudflare Workers', timestamp: new Date().toISOString() }));

// ── Auth ──────────────────────────────────────────────────────

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json();
  const prisma = getPrisma(c.env);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return unauthorized(c, 'Invalid credentials');
  const match = await compare(password, user.password);
  if (!match) return unauthorized(c, 'Invalid credentials');
  const payload = { id: user.id, email: user.email, role: user.role, storeId: user.storeId, zoneId: user.zoneId, name: user.name };
  const accessToken = await signAccess(payload, c.env.JWT_SECRET);
  const refreshToken = await signRefresh({ id: user.id }, c.env.JWT_REFRESH_SECRET);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
  return ok(c, { accessToken, refreshToken, user: { ...payload, avatar: user.avatar } });
});

app.post('/api/auth/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) return unauthorized(c);
  let decoded;
  try { decoded = await verifyToken(refreshToken, c.env.JWT_REFRESH_SECRET); } catch { return unauthorized(c, 'Invalid refresh token'); }
  const prisma = getPrisma(c.env);
  const user = await prisma.user.findUnique({ where: { id: decoded.id } });
  if (!user || user.refreshToken !== refreshToken) return unauthorized(c, 'Token reuse detected');
  const payload = { id: user.id, email: user.email, role: user.role, storeId: user.storeId, zoneId: user.zoneId, name: user.name };
  const newAccess = await signAccess(payload, c.env.JWT_SECRET);
  const newRefresh = await signRefresh({ id: user.id }, c.env.JWT_REFRESH_SECRET);
  await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefresh } });
  return ok(c, { accessToken: newAccess, refreshToken: newRefresh });
});

app.post('/api/auth/logout', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    await prisma.user.update({ where: { id: c.get('user').id }, data: { refreshToken: null } });
    return ok(c, null, 'Logged out');
  }, c.env);
});

app.get('/api/auth/me', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const user = await prisma.user.findUnique({
      where: { id: c.get('user').id },
      select: { id: true, name: true, email: true, phone: true, role: true, avatar: true, storeId: true, zoneId: true, store: { select: { id: true, name: true } }, zone: { select: { id: true, name: true } } },
    });
    return ok(c, user);
  }, c.env);
});

app.put('/api/auth/change-password', async (c) => {
  return authMiddleware(c, async () => {
    const { oldPassword, newPassword } = await c.req.json();
    const prisma = getPrisma(c.env);
    const user = await prisma.user.findUnique({ where: { id: c.get('user').id } });
    if (!await compare(oldPassword, user.password)) return badRequest(c, 'Old password incorrect');
    const hashed = await hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return ok(c, null, 'Password changed');
  }, c.env);
});

app.put('/api/auth/fcm-token', async (c) => {
  return authMiddleware(c, async () => {
    const { fcmToken } = await c.req.json();
    const prisma = getPrisma(c.env);
    await prisma.user.update({ where: { id: c.get('user').id }, data: { fcmToken } });
    return ok(c, null, 'FCM token saved');
  }, c.env);
});

// ── Tasks ─────────────────────────────────────────────────────

const taskSelect = {
  id: true, title: true, description: true, status: true, priority: true,
  deadline: true, standard: true, completedAt: true, rejectedReason: true, createdAt: true, updatedAt: true,
  creator: { select: { id: true, name: true, avatar: true } },
  assignee: { select: { id: true, name: true, avatar: true } },
  collaborators: { select: { id: true, name: true, avatar: true } },
  store: { select: { id: true, name: true } },
  attachments: true,
  _count: { select: { comments: true } },
};

app.get('/api/tasks', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { status, priority, storeId, assigneeId, page = '1', limit = '20' } = c.req.query();
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (user.role === 'EMPLOYEE') where.OR = [{ assigneeId: user.id }, { collaborators: { some: { id: user.id } } }];
    else if (user.role === 'STORE_MANAGER') where.storeId = user.storeId;
    else if (user.role === 'ZONE_MANAGER') where.store = { zoneId: user.zoneId };
    if (storeId && ['OWNER', 'ZONE_MANAGER'].includes(user.role)) where.storeId = storeId;
    if (assigneeId) where.assigneeId = assigneeId;
    const prisma = getPrisma(c.env);
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({ where, select: taskSelect, skip: (Number(page) - 1) * Number(limit), take: Number(limit), orderBy: [{ priority: 'desc' }, { deadline: 'asc' }] }),
      prisma.task.count({ where }),
    ]);
    return ok(c, { tasks, total, page: Number(page), limit: Number(limit) });
  }, c.env);
});

app.get('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const task = await prisma.task.findUnique({
      where: { id: c.req.param('id') },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        assignee: { select: { id: true, name: true, avatar: true } },
        collaborators: { select: { id: true, name: true, avatar: true } },
        store: { select: { id: true, name: true } },
        attachments: true,
        comments: { include: { user: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: 'asc' } },
        logs: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!task) return notFound(c);
    return ok(c, task);
  }, c.env);
});

app.post('/api/tasks', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { title, description, assigneeId, collaboratorIds = [], deadline, priority, standard, storeId } = await c.req.json();
    const prisma = getPrisma(c.env);
    const task = await prisma.task.create({
      data: {
        title, description, deadline: deadline ? new Date(deadline) : null,
        priority: priority || 'MEDIUM', standard,
        storeId: storeId || user.storeId, creatorId: user.id,
        assigneeId: assigneeId || null,
        collaborators: collaboratorIds.length ? { connect: collaboratorIds.map(id => ({ id })) } : undefined,
      },
      select: taskSelect,
    });
    await prisma.taskLog.create({ data: { taskId: task.id, userId: user.id, action: 'CREATED', detail: 'Task created' } });
    if (assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { fcmToken: true } });
      if (assignee?.fcmToken) await sendFcm(c.env, assignee.fcmToken, 'Có task mới!', `Bạn được giao: ${title}`, { taskId: task.id, type: 'NEW_TASK' });
    }
    return created(c, task);
  }, c.env);
});

app.put('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const task = await prisma.task.findUnique({ where: { id: c.req.param('id') } });
    if (!task) return notFound(c);
    const { title, description, assigneeId, collaboratorIds, deadline, priority, standard, storeId } = await c.req.json();
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        title: title ?? task.title, description: description ?? task.description,
        deadline: deadline ? new Date(deadline) : task.deadline,
        priority: priority ?? task.priority, standard: standard ?? task.standard,
        storeId: storeId ?? task.storeId,
        assigneeId: assigneeId !== undefined ? assigneeId : task.assigneeId,
        collaborators: collaboratorIds ? { set: collaboratorIds.map(id => ({ id })) } : undefined,
      },
      select: taskSelect,
    });
    await prisma.taskLog.create({ data: { taskId: task.id, userId: c.get('user').id, action: 'UPDATED', detail: 'Task updated' } });
    return ok(c, updated);
  }, c.env);
});

app.patch('/api/tasks/:id/status', async (c) => {
  return authMiddleware(c, async () => {
    const { status, rejectedReason } = await c.req.json();
    const prisma = getPrisma(c.env);
    const task = await prisma.task.findUnique({ where: { id: c.req.param('id') } });
    if (!task) return notFound(c);
    const user = c.get('user');
    if (['IN_PROGRESS', 'PENDING_APPROVAL'].includes(status) && task.assigneeId !== user.id && user.role !== 'STORE_MANAGER') return forbidden(c);
    if (['COMPLETED', 'REJECTED'].includes(status) && !['STORE_MANAGER', 'ZONE_MANAGER', 'OWNER'].includes(user.role)) return forbidden(c);
    const data = { status };
    if (status === 'COMPLETED') data.completedAt = new Date();
    if (status === 'REJECTED') { data.rejectedAt = new Date(); data.rejectedReason = rejectedReason; }
    const updated = await prisma.task.update({ where: { id: task.id }, data, select: taskSelect });
    await prisma.taskLog.create({ data: { taskId: task.id, userId: user.id, action: `STATUS_${status}`, detail: rejectedReason || null } });
    const KPI_RULES = { ON_TIME: 10, LATE: -5, REJECTED: -3 };
    const now = new Date();
    const month = now.getMonth() + 1; const year = now.getFullYear();
    if (status === 'COMPLETED' && task.assigneeId) {
      const isLate = task.deadline && now > new Date(task.deadline);
      await prisma.kpiScore.create({ data: { userId: task.assigneeId, storeId: task.storeId, score: isLate ? KPI_RULES.LATE : KPI_RULES.ON_TIME, reason: isLate ? 'Hoàn thành muộn deadline' : 'Hoàn thành đúng deadline', taskId: task.id, month, year } });
    }
    if (status === 'REJECTED' && task.assigneeId) {
      await prisma.kpiScore.create({ data: { userId: task.assigneeId, storeId: task.storeId, score: KPI_RULES.REJECTED, reason: 'Task bị từ chối', taskId: task.id, month, year } });
    }
    return ok(c, updated);
  }, c.env);
});

app.post('/api/tasks/:id/comments', async (c) => {
  return authMiddleware(c, async () => {
    const { content, mentions = [] } = await c.req.json();
    const prisma = getPrisma(c.env);
    const task = await prisma.task.findUnique({ where: { id: c.req.param('id') } });
    if (!task) return notFound(c);
    const comment = await prisma.taskComment.create({
      data: { taskId: task.id, userId: c.get('user').id, content, mentions },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    });
    if (mentions.length > 0) {
      const mentionedUsers = await prisma.user.findMany({ where: { id: { in: mentions } }, select: { fcmToken: true } });
      for (const u of mentionedUsers) {
        if (u.fcmToken) await sendFcm(c.env, u.fcmToken, 'Bạn được nhắc đến', `${c.get('user').name} đã đề cập đến bạn`, { taskId: task.id, type: 'MENTION' });
      }
    }
    return created(c, comment);
  }, c.env);
});

app.delete('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const task = await prisma.task.findUnique({ where: { id: c.req.param('id') } });
    if (!task) return notFound(c);
    await prisma.task.delete({ where: { id: task.id } });
    return ok(c, null, 'Task deleted');
  }, c.env);
});

// ── Dashboard ─────────────────────────────────────────────────

app.get('/api/dashboard', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const storeFilter = user.role === 'STORE_MANAGER' ? { storeId: user.storeId } : user.role === 'ZONE_MANAGER' ? { store: { zoneId: user.zoneId } } : {};
    const prisma = getPrisma(c.env);
    const [totalTasks, completed, overdue, inProgress, overdueList, busyEmployees] = await Promise.all([
      prisma.task.count({ where: storeFilter }),
      prisma.task.count({ where: { ...storeFilter, status: 'COMPLETED' } }),
      prisma.task.count({ where: { ...storeFilter, status: 'OVERDUE' } }),
      prisma.task.count({ where: { ...storeFilter, status: 'IN_PROGRESS' } }),
      prisma.task.findMany({ where: { ...storeFilter, status: { in: ['OVERDUE', 'NOT_STARTED', 'IN_PROGRESS'] }, deadline: { lt: new Date() } }, select: { id: true, title: true, priority: true, assignee: { select: { id: true, name: true } }, store: { select: { id: true, name: true } } }, orderBy: { deadline: 'asc' }, take: 5 }),
      prisma.user.findMany({ where: { role: 'EMPLOYEE', isActive: true, ...(user.storeId ? { storeId: user.storeId } : {}) }, select: { id: true, name: true, avatar: true, _count: { select: { assignedTasks: true } } }, orderBy: { assignedTasks: { _count: 'desc' } }, take: 5 }),
    ]);
    return ok(c, { totalTasks, completed, overdue, inProgress, overdueList, busyEmployees });
  }, c.env);
});

app.get('/api/dashboard/overview', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const storeFilter = user.role === 'EMPLOYEE' || user.role === 'STORE_MANAGER' ? { storeId: user.storeId } : user.role === 'ZONE_MANAGER' ? { store: { zoneId: user.zoneId } } : {};
    const prisma = getPrisma(c.env);
    const [totalTasks, completedToday, overdueTasks, pendingApproval, inProgress] = await Promise.all([
      prisma.task.count({ where: storeFilter }),
      prisma.task.count({ where: { ...storeFilter, status: 'COMPLETED', completedAt: { gte: today, lt: tomorrow } } }),
      prisma.task.count({ where: { ...storeFilter, status: { notIn: ['COMPLETED'] }, deadline: { lt: new Date() } } }),
      prisma.task.count({ where: { ...storeFilter, status: 'PENDING_APPROVAL' } }),
      prisma.task.count({ where: { ...storeFilter, status: 'IN_PROGRESS' } }),
    ]);
    return ok(c, { stats: { totalTasks, completedToday, overdueTasks, pendingApproval, inProgress } });
  }, c.env);
});

app.get('/api/dashboard/users', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const where = user.role === 'ZONE_MANAGER' ? { zone: { id: user.zoneId } } : user.role === 'STORE_MANAGER' ? { storeId: user.storeId } : {};
    const prisma = getPrisma(c.env);
    const users = await prisma.user.findMany({ where, select: { id: true, name: true, email: true, role: true, avatar: true, isActive: true, store: { select: { id: true, name: true } } }, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    return ok(c, users);
  }, c.env);
});

app.get('/api/dashboard/stores', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const where = user.role === 'ZONE_MANAGER' ? { zoneId: user.zoneId } : {};
    const prisma = getPrisma(c.env);
    const stores = await prisma.store.findMany({ where, include: { zone: { select: { id: true, name: true } }, _count: { select: { users: true, tasks: true } } }, orderBy: { name: 'asc' } });
    return ok(c, stores);
  }, c.env);
});

// ── KPI ───────────────────────────────────────────────────────

app.get('/api/kpi/me', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const prisma = getPrisma(c.env);
    const history = await prisma.kpiScore.findMany({ where: { userId: c.get('user').id, month: m, year: y }, orderBy: { createdAt: 'desc' } });
    const total = history.reduce((sum, r) => sum + r.score, 0);
    return ok(c, { total, history, month: m, year: y });
  }, c.env);
});

app.get('/api/kpi/employees', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { storeId, month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const sid = storeId || c.get('user').storeId;
    const prisma = getPrisma(c.env);
    const filter = { month: m, year: y };
    if (sid) filter.storeId = sid;
    const scores = await prisma.kpiScore.groupBy({ by: ['userId'], where: filter, _sum: { score: true }, orderBy: { _sum: { score: 'desc' } } });
    const users = await prisma.user.findMany({ where: { id: { in: scores.map(s => s.userId) } }, select: { id: true, name: true, avatar: true, role: true } });
    const ranking = scores.map(s => ({ ...s, user: users.find(u => u.id === s.userId), total: s._sum.score }));
    return ok(c, { ranking, month: m, year: y });
  }, c.env);
});

app.get('/api/kpi/stores', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const prisma = getPrisma(c.env);
    const scores = await prisma.kpiScore.groupBy({ by: ['storeId'], where: { month: m, year: y, storeId: { not: null } }, _sum: { score: true }, orderBy: { _sum: { score: 'desc' } } });
    const stores = await prisma.store.findMany({ where: { id: { in: scores.map(s => s.storeId).filter(Boolean) } }, select: { id: true, name: true } });
    const ranking = scores.map(s => ({ store: stores.find(st => st.id === s.storeId), total: s._sum.score }));
    return ok(c, { ranking, month: m, year: y });
  }, c.env);
});

// ── Reports ───────────────────────────────────────────────────

app.get('/api/reports', async (c) => {
  return authMiddleware(c, async () => {
    const year = Number(c.req.query('year') || new Date().getFullYear());
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);
    const prisma = getPrisma(c.env);
    const tasks = await prisma.task.findMany({ where: { createdAt: { gte: start, lte: end } }, select: { createdAt: true, status: true, storeId: true, store: { select: { name: true } } } });
    const monthMap = {};
    for (let m = 1; m <= 12; m++) monthMap[m] = { month: m, total: 0, completed: 0, overdue: 0 };
    const storeMap = {};
    tasks.forEach(t => {
      const m = new Date(t.createdAt).getMonth() + 1;
      monthMap[m].total++;
      if (t.status === 'COMPLETED') monthMap[m].completed++;
      if (t.status === 'OVERDUE') monthMap[m].overdue++;
      if (t.storeId) {
        if (!storeMap[t.storeId]) storeMap[t.storeId] = { name: t.store?.name || t.storeId, total: 0, completed: 0 };
        storeMap[t.storeId].total++;
        if (t.status === 'COMPLETED') storeMap[t.storeId].completed++;
      }
    });
    return ok(c, { monthly: Object.values(monthMap), storeStats: Object.values(storeMap) });
  }, c.env);
});

app.get('/api/reports/tasks', async (c) => {
  return authMiddleware(c, async () => {
    const { from, to, storeId } = c.req.query();
    const user = c.get('user');
    const start = from ? new Date(from) : (() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })();
    const end = to ? new Date(to) : new Date(); end.setHours(23, 59, 59, 999);
    const where = { createdAt: { gte: start, lte: end } };
    if (storeId) where.storeId = storeId; else if (user.storeId) where.storeId = user.storeId;
    const prisma = getPrisma(c.env);
    const [total, completed, overdue, pending, inProgress, rejected] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.task.count({ where: { ...where, status: 'OVERDUE' } }),
      prisma.task.count({ where: { ...where, status: 'PENDING_APPROVAL' } }),
      prisma.task.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { ...where, status: 'REJECTED' } }),
    ]);
    return ok(c, { summary: { total, completed, overdue, pending, inProgress, rejected, completionRate: total > 0 ? Math.round((completed / total) * 100) : 0 } });
  }, c.env);
});

// ── Checklists ────────────────────────────────────────────────

app.get('/api/checklists/templates', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const where = user.storeId ? { OR: [{ storeId: user.storeId }, { storeId: null }] } : {};
    const prisma = getPrisma(c.env);
    const templates = await prisma.checklistTemplate.findMany({ where, include: { items: { orderBy: { order: 'asc' } } } });
    return ok(c, templates);
  }, c.env);
});

app.post('/api/checklists/templates', async (c) => {
  return authMiddleware(c, async () => {
    const { name, type, storeId, items = [] } = await c.req.json();
    const prisma = getPrisma(c.env);
    const template = await prisma.checklistTemplate.create({
      data: { name, type, storeId: storeId || c.get('user').storeId, items: { create: items.map((item, i) => ({ label: item.label, order: i, requirePhoto: item.requirePhoto || false })) } },
      include: { items: true },
    });
    return created(c, template);
  }, c.env);
});

app.get('/api/checklists/sessions', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { storeId, date } = c.req.query();
    const where = {};
    if (user.role === 'EMPLOYEE') where.userId = user.id;
    else if (user.role === 'STORE_MANAGER') where.storeId = user.storeId;
    if (storeId) where.storeId = storeId;
    if (date) { const d = new Date(date); const next = new Date(d); next.setDate(next.getDate() + 1); where.shiftDate = { gte: d, lt: next }; }
    const prisma = getPrisma(c.env);
    const sessions = await prisma.checklistSession.findMany({ where, include: { template: { select: { id: true, name: true, type: true } }, user: { select: { id: true, name: true } }, items: true }, orderBy: { shiftDate: 'desc' } });
    return ok(c, sessions);
  }, c.env);
});

app.post('/api/checklists/sessions', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { templateId, storeId } = await c.req.json();
    const prisma = getPrisma(c.env);
    const template = await prisma.checklistTemplate.findUnique({ where: { id: templateId }, include: { items: true } });
    if (!template) return notFound(c);
    const session = await prisma.checklistSession.create({
      data: {
        templateId, storeId: storeId || user.storeId, userId: user.id,
        items: { create: template.items.map(item => ({ label: item.label })) },
      },
      include: { items: true, template: { select: { id: true, name: true, type: true } } },
    });
    return created(c, session);
  }, c.env);
});

app.patch('/api/checklists/sessions/:id/complete', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const session = await prisma.checklistSession.findUnique({ where: { id: c.req.param('id') } });
    if (!session) return notFound(c);
    const updated = await prisma.checklistSession.update({ where: { id: session.id }, data: { completedAt: new Date() } });
    return ok(c, updated);
  }, c.env);
});

// ── SOP ───────────────────────────────────────────────────────

app.get('/api/sop/documents', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const documents = await prisma.sopDocument.findMany({ orderBy: { createdAt: 'desc' } });
    return ok(c, documents);
  }, c.env);
});

app.get('/api/sop/documents/my-progress', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const progress = await prisma.sopProgress.findMany({ where: { userId: c.get('user').id }, include: { document: { select: { id: true, title: true, fileType: true } } } });
    return ok(c, progress);
  }, c.env);
});

app.get('/api/sop/documents/:id', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const doc = await prisma.sopDocument.findUnique({ where: { id: c.req.param('id') }, include: { quizzes: { select: { id: true, title: true } } } });
    if (!doc) return notFound(c);
    return ok(c, doc);
  }, c.env);
});

app.post('/api/sop/documents/:id/progress', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const progress = await prisma.sopProgress.upsert({
      where: { userId_documentId: { userId: c.get('user').id, documentId: c.req.param('id') } },
      update: { isCompleted: true, completedAt: new Date() },
      create: { userId: c.get('user').id, documentId: c.req.param('id'), isCompleted: true, completedAt: new Date() },
    });
    return ok(c, progress);
  }, c.env);
});

app.get('/api/sop/quizzes/:id', async (c) => {
  return authMiddleware(c, async () => {
    const prisma = getPrisma(c.env);
    const quiz = await prisma.quiz.findUnique({ where: { id: c.req.param('id') }, select: { id: true, title: true, questions: true, documentId: true } });
    if (!quiz) return notFound(c);
    return ok(c, quiz);
  }, c.env);
});

app.post('/api/sop/quizzes/:id/submit', async (c) => {
  return authMiddleware(c, async () => {
    const { answers } = await c.req.json();
    const prisma = getPrisma(c.env);
    const quiz = await prisma.quiz.findUnique({ where: { id: c.req.param('id') } });
    if (!quiz) return notFound(c);
    const questions = quiz.questions;
    const score = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
    const passed = score / questions.length >= 0.7;
    const attempt = await prisma.quizAttempt.create({ data: { quizId: quiz.id, userId: c.get('user').id, answers, score, passed } });
    return ok(c, { ...attempt, total: questions.length });
  }, c.env);
});

// ── WebSocket (realtime thay thế Socket.IO) ───────────────────

// Map storeId → Set of WebSocket connections
const rooms = new Map();

app.get('/ws', async (c) => {
  const upgrade = c.req.header('Upgrade');
  if (upgrade !== 'websocket') return c.text('Expected websocket upgrade', 426);

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  server.addEventListener('message', event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'join' && msg.room) {
        if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
        rooms.get(msg.room).add(server);
        server.send(JSON.stringify({ type: 'joined', room: msg.room }));
      }
    } catch {}
  });

  server.addEventListener('close', () => {
    rooms.forEach(set => set.delete(server));
  });

  return new Response(null, { status: 101, webSocket: client });
});

// Helper to broadcast to a room (used internally)
function broadcast(room, event, data) {
  const set = rooms.get(room);
  if (!set) return;
  const msg = JSON.stringify({ type: event, data });
  set.forEach(ws => { try { ws.send(msg); } catch {} });
}

// ── 404 / Error ───────────────────────────────────────────────

app.notFound(c => c.json({ success: false, message: `Not found: ${c.req.method} ${c.req.path}` }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, message: err.message || 'Internal error' }, err.status || 500);
});

// ── KPI Nightly Cron ──────────────────────────────────────────

async function runKpiNightlyCron(env) {
  const prisma = getPrisma(env);
  const now = new Date();
  const month = now.getMonth() + 1; const year = now.getFullYear();

  const overdueTasks = await prisma.task.findMany({
    where: { status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, deadline: { lt: now }, assigneeId: { not: null } },
    include: { assignee: { select: { id: true, fcmToken: true } } },
  });

  for (const task of overdueTasks) {
    await prisma.kpiScore.create({ data: { userId: task.assigneeId, storeId: task.storeId, score: -10, reason: `Task "${task.title}" quá hạn không báo cáo`, taskId: task.id, month, year } });
    await prisma.task.update({ where: { id: task.id }, data: { status: 'OVERDUE' } });
    if (task.assignee?.fcmToken) {
      await sendFcm(env, task.assignee.fcmToken, 'Task quá hạn', `"${task.title}" đã quá hạn và bị trừ 10 điểm KPI`, { taskId: task.id, type: 'OVERDUE' });
    }
  }
  console.log(`[KPI Cron] Processed ${overdueTasks.length} overdue tasks`);
}

// ── Export ────────────────────────────────────────────────────

export default {
  fetch: app.fetch,
  // CF Workers Cron Trigger — cấu hình trong wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runKpiNightlyCron(env));
  },
};
