/**
 * Retail Ops Manager — Cloudflare Workers entry point
 * Stack: Hono + postgres.js (CF Workers native TCP) + jose JWT + Upstash Redis + FCM via fetch
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { SignJWT, jwtVerify } from 'jose';
import { compare, hash } from 'bcryptjs';
import { Redis } from '@upstash/redis';
import postgres from 'postgres';

// ── DB helper ─────────────────────────────────────────────────

function getSql(env) {
  // Hyperdrive provides a local connection string — no SSL needed from Worker side
  const connStr = env.HYPERDRIVE ? env.HYPERDRIVE.connectionString : env.DATABASE_URL;
  return postgres(connStr, {
    ssl: env.HYPERDRIVE ? false : 'require',
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
  });
}

function getRedis(env) {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
}

// ── JWT helpers ───────────────────────────────────────────────

async function signAccess(payload, secret) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret));
}

async function signRefresh(payload, secret) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

async function verifyToken(token, secret) {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  return payload;
}

// ── FCM helpers ───────────────────────────────────────────────

async function sendFcm(env, tokens, title, body, data = {}) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return;
  const arr = Array.isArray(tokens) ? tokens.filter(Boolean) : [tokens].filter(Boolean);
  if (!arr.length) return;
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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

// ── Response helpers ──────────────────────────────────────────

function ok(c, data, message = 'Success') { return c.json({ success: true, message, data }); }
function created(c, data) { return c.json({ success: true, message: 'Created', data }, 201); }
function notFound(c) { return c.json({ success: false, message: 'Not found' }, 404); }
function unauthorized(c, msg = 'Unauthorized') { return c.json({ success: false, message: msg }, 401); }
function forbidden(c) { return c.json({ success: false, message: 'Forbidden' }, 403); }
function badRequest(c, msg) { return c.json({ success: false, message: msg }, 400); }

// ── Auth middleware ───────────────────────────────────────────

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

// ── Query helpers ─────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

async function taskRow(sql, taskId) {
  const [t] = await sql`
    SELECT t.*,
      json_build_object('id', cr.id, 'name', cr.name, 'avatar', cr.avatar) AS creator,
      CASE WHEN t."assigneeId" IS NOT NULL
        THEN json_build_object('id', as2.id, 'name', as2.name, 'avatar', as2.avatar)
        ELSE NULL END AS assignee,
      CASE WHEN t."storeId" IS NOT NULL
        THEN json_build_object('id', st.id, 'name', st.name)
        ELSE NULL END AS store
    FROM "Task" t
    LEFT JOIN "User" cr ON cr.id = t."creatorId"
    LEFT JOIN "User" as2 ON as2.id = t."assigneeId"
    LEFT JOIN "Store" st ON st.id = t."storeId"
    WHERE t.id = ${taskId}
  `;
  if (!t) return null;
  const collabs = await sql`
    SELECT u.id, u.name, u.avatar FROM "_CollaboratingTasks" ct
    JOIN "User" u ON u.id = ct."B" WHERE ct."A" = ${taskId}
  `;
  t.collaborators = collabs;
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM "TaskComment" WHERE "taskId" = ${taskId}`;
  t._count = { comments: count };
  return t;
}

// ── App ───────────────────────────────────────────────────────

const app = new Hono();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  const origins = (c.env.CLIENT_URL || '*').split(',').map(o => o.trim());
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
  const sql = getSql(c.env);
  const [user] = await sql`SELECT * FROM "User" WHERE email = ${email} AND "isActive" = true`;
  if (!user) return unauthorized(c, 'Invalid credentials');
  const match = await compare(password, user.password);
  if (!match) return unauthorized(c, 'Invalid credentials');
  const payload = { id: user.id, email: user.email, role: user.role, storeId: user.storeId, zoneId: user.zoneId, name: user.name };
  const accessToken = await signAccess(payload, c.env.JWT_SECRET);
  const refreshToken = await signRefresh({ id: user.id }, c.env.JWT_REFRESH_SECRET);
  await sql`UPDATE "User" SET "refreshToken" = ${refreshToken} WHERE id = ${user.id}`;
  return ok(c, { accessToken, refreshToken, user: { ...payload, avatar: user.avatar } });
});

app.post('/api/auth/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) return unauthorized(c);
  let decoded;
  try { decoded = await verifyToken(refreshToken, c.env.JWT_REFRESH_SECRET); } catch { return unauthorized(c, 'Invalid refresh token'); }
  const sql = getSql(c.env);
  const [user] = await sql`SELECT * FROM "User" WHERE id = ${decoded.id}`;
  if (!user || user.refreshToken !== refreshToken) return unauthorized(c, 'Token reuse detected');
  const payload = { id: user.id, email: user.email, role: user.role, storeId: user.storeId, zoneId: user.zoneId, name: user.name };
  const newAccess = await signAccess(payload, c.env.JWT_SECRET);
  const newRefresh = await signRefresh({ id: user.id }, c.env.JWT_REFRESH_SECRET);
  await sql`UPDATE "User" SET "refreshToken" = ${newRefresh} WHERE id = ${user.id}`;
  return ok(c, { accessToken: newAccess, refreshToken: newRefresh });
});

app.post('/api/auth/logout', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    await sql`UPDATE "User" SET "refreshToken" = NULL WHERE id = ${c.get('user').id}`;
    return ok(c, null, 'Logged out');
  }, c.env);
});

app.get('/api/auth/me', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const [user] = await sql`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.avatar, u."storeId", u."zoneId",
        CASE WHEN u."storeId" IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END AS store,
        CASE WHEN u."zoneId" IS NOT NULL THEN json_build_object('id', z.id, 'name', z.name) ELSE NULL END AS zone
      FROM "User" u
      LEFT JOIN "Store" s ON s.id = u."storeId"
      LEFT JOIN "Zone" z ON z.id = u."zoneId"
      WHERE u.id = ${c.get('user').id}
    `;
    return ok(c, user);
  }, c.env);
});

app.put('/api/auth/change-password', async (c) => {
  return authMiddleware(c, async () => {
    const { oldPassword, newPassword } = await c.req.json();
    const sql = getSql(c.env);
    const [user] = await sql`SELECT * FROM "User" WHERE id = ${c.get('user').id}`;
    if (!await compare(oldPassword, user.password)) return badRequest(c, 'Old password incorrect');
    const hashed = await hash(newPassword, 10);
    await sql`UPDATE "User" SET password = ${hashed}, "updatedAt" = NOW() WHERE id = ${user.id}`;
    return ok(c, null, 'Password changed');
  }, c.env);
});

app.put('/api/auth/fcm-token', async (c) => {
  return authMiddleware(c, async () => {
    const { fcmToken } = await c.req.json();
    const sql = getSql(c.env);
    await sql`UPDATE "User" SET "fcmToken" = ${fcmToken} WHERE id = ${c.get('user').id}`;
    return ok(c, null, 'FCM token saved');
  }, c.env);
});

// ── Tasks ─────────────────────────────────────────────────────

app.get('/api/tasks', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { status, priority, storeId, assigneeId, page = '1', limit = '20' } = c.req.query();
    const pg = Number(page); const lim = Number(limit);
    const sql = getSql(c.env);

    const filters = [sql`1=1`];
    if (status) filters.push(sql`t.status = ${status}::"TaskStatus"`);
    if (priority) filters.push(sql`t.priority = ${priority}::"Priority"`);
    if (user.role === 'EMPLOYEE') {
      filters.push(sql`(t."assigneeId" = ${user.id} OR EXISTS (SELECT 1 FROM "_CollaboratingTasks" ct WHERE ct."A" = t.id AND ct."B" = ${user.id}))`);
    } else if (user.role === 'STORE_MANAGER') {
      filters.push(sql`t."storeId" = ${user.storeId}`);
    } else if (user.role === 'ZONE_MANAGER') {
      filters.push(sql`t."storeId" IN (SELECT id FROM "Store" WHERE "zoneId" = ${user.zoneId})`);
    }
    if (storeId && ['OWNER', 'ZONE_MANAGER'].includes(user.role)) filters.push(sql`t."storeId" = ${storeId}`);
    if (assigneeId) filters.push(sql`t."assigneeId" = ${assigneeId}`);

    const where = sql`WHERE ${filters.reduce((a, b) => sql`${a} AND ${b}`)}`;

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM "Task" t ${where}`;
    const tasks = await sql`
      SELECT t.*,
        json_build_object('id', cr.id, 'name', cr.name, 'avatar', cr.avatar) AS creator,
        CASE WHEN t."assigneeId" IS NOT NULL THEN json_build_object('id', as2.id, 'name', as2.name, 'avatar', as2.avatar) ELSE NULL END AS assignee,
        CASE WHEN t."storeId" IS NOT NULL THEN json_build_object('id', st.id, 'name', st.name) ELSE NULL END AS store,
        (SELECT COUNT(*)::int FROM "TaskComment" WHERE "taskId" = t.id) AS comments_count
      FROM "Task" t
      LEFT JOIN "User" cr ON cr.id = t."creatorId"
      LEFT JOIN "User" as2 ON as2.id = t."assigneeId"
      LEFT JOIN "Store" st ON st.id = t."storeId"
      ${where}
      ORDER BY CASE t.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, t.deadline ASC NULLS LAST
      LIMIT ${lim} OFFSET ${(pg - 1) * lim}
    `;
    return ok(c, { tasks, total: count, page: pg, limit: lim });
  }, c.env);
});

app.get('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [t] = await sql`
      SELECT t.*,
        json_build_object('id', cr.id, 'name', cr.name, 'avatar', cr.avatar) AS creator,
        CASE WHEN t."assigneeId" IS NOT NULL THEN json_build_object('id', as2.id, 'name', as2.name, 'avatar', as2.avatar) ELSE NULL END AS assignee,
        CASE WHEN t."storeId" IS NOT NULL THEN json_build_object('id', st.id, 'name', st.name) ELSE NULL END AS store
      FROM "Task" t
      LEFT JOIN "User" cr ON cr.id = t."creatorId"
      LEFT JOIN "User" as2 ON as2.id = t."assigneeId"
      LEFT JOIN "Store" st ON st.id = t."storeId"
      WHERE t.id = ${id}
    `;
    if (!t) return notFound(c);
    const [collabs, comments, logs, attachments] = await Promise.all([
      sql`SELECT u.id, u.name, u.avatar FROM "_CollaboratingTasks" ct JOIN "User" u ON u.id = ct."B" WHERE ct."A" = ${id}`,
      sql`SELECT tc.*, json_build_object('id', u.id, 'name', u.name, 'avatar', u.avatar) AS user FROM "TaskComment" tc JOIN "User" u ON u.id = tc."userId" WHERE tc."taskId" = ${id} ORDER BY tc."createdAt" ASC`,
      sql`SELECT tl.*, json_build_object('id', u.id, 'name', u.name) AS user FROM "TaskLog" tl JOIN "User" u ON u.id = tl."userId" WHERE tl."taskId" = ${id} ORDER BY tl."createdAt" DESC`,
      sql`SELECT * FROM "TaskAttachment" WHERE "taskId" = ${id}`,
    ]);
    t.collaborators = collabs;
    t.comments = comments;
    t.logs = logs;
    t.attachments = attachments;
    return ok(c, t);
  }, c.env);
});

app.post('/api/tasks', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { title, description, assigneeId, collaboratorIds = [], deadline, priority = 'MEDIUM', standard, storeId } = await c.req.json();
    const sql = getSql(c.env);
    const id = uuid();
    const [task] = await sql`
      INSERT INTO "Task" (id, title, description, "assigneeId", deadline, priority, standard, "storeId", "creatorId", status, "createdAt", "updatedAt")
      VALUES (${id}, ${title}, ${description || null}, ${assigneeId || null}, ${deadline ? new Date(deadline) : null},
        ${priority}::"Priority", ${standard || null}, ${storeId || user.storeId || null}, ${user.id},
        'NOT_STARTED'::"TaskStatus", NOW(), NOW())
      RETURNING *
    `;
    if (collaboratorIds.length) {
      const vals = collaboratorIds.map(uid => sql`(${id}, ${uid})`);
      await sql`INSERT INTO "_CollaboratingTasks" ("A", "B") VALUES ${vals.reduce((a, b) => sql`${a}, ${b}`)}`;
    }
    await sql`INSERT INTO "TaskLog" (id, "taskId", "userId", action, detail, "createdAt") VALUES (${uuid()}, ${id}, ${user.id}, 'CREATED', 'Task created', NOW())`;
    if (assigneeId) {
      const [assignee] = await sql`SELECT "fcmToken" FROM "User" WHERE id = ${assigneeId}`;
      if (assignee?.fcmToken) await sendFcm(c.env, assignee.fcmToken, 'Có task mới!', `Bạn được giao: ${title}`, { taskId: id, type: 'NEW_TASK' });
    }
    const result = await taskRow(sql, id);
    return created(c, result);
  }, c.env);
});

app.put('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [task] = await sql`SELECT * FROM "Task" WHERE id = ${id}`;
    if (!task) return notFound(c);
    const { title, description, assigneeId, collaboratorIds, deadline, priority, standard, storeId } = await c.req.json();
    await sql`
      UPDATE "Task" SET
        title = ${title ?? task.title},
        description = ${description ?? task.description},
        deadline = ${deadline ? new Date(deadline) : task.deadline},
        priority = ${priority ?? task.priority}::"Priority",
        standard = ${standard ?? task.standard},
        "storeId" = ${storeId ?? task.storeId},
        "assigneeId" = ${assigneeId !== undefined ? assigneeId : task.assigneeId},
        "updatedAt" = NOW()
      WHERE id = ${id}
    `;
    if (collaboratorIds !== undefined) {
      await sql`DELETE FROM "_CollaboratingTasks" WHERE "A" = ${id}`;
      if (collaboratorIds.length) {
        const vals = collaboratorIds.map(uid => sql`(${id}, ${uid})`);
        await sql`INSERT INTO "_CollaboratingTasks" ("A", "B") VALUES ${vals.reduce((a, b) => sql`${a}, ${b}`)}`;
      }
    }
    await sql`INSERT INTO "TaskLog" (id, "taskId", "userId", action, "createdAt") VALUES (${uuid()}, ${id}, ${c.get('user').id}, 'UPDATED', NOW())`;
    return ok(c, await taskRow(sql, id));
  }, c.env);
});

app.patch('/api/tasks/:id/status', async (c) => {
  return authMiddleware(c, async () => {
    const { status, rejectedReason } = await c.req.json();
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [task] = await sql`SELECT * FROM "Task" WHERE id = ${id}`;
    if (!task) return notFound(c);
    const user = c.get('user');
    if (['IN_PROGRESS', 'PENDING_APPROVAL'].includes(status) && task.assigneeId !== user.id && user.role !== 'STORE_MANAGER') return forbidden(c);
    if (['COMPLETED', 'REJECTED'].includes(status) && !['STORE_MANAGER', 'ZONE_MANAGER', 'OWNER'].includes(user.role)) return forbidden(c);
    const completedAt = status === 'COMPLETED' ? new Date() : null;
    const rejectedAt = status === 'REJECTED' ? new Date() : null;
    await sql`
      UPDATE "Task" SET status = ${status}::"TaskStatus",
        "completedAt" = ${completedAt},
        "rejectedAt" = ${rejectedAt},
        "rejectedReason" = ${status === 'REJECTED' ? (rejectedReason || null) : task.rejectedReason},
        "updatedAt" = NOW()
      WHERE id = ${id}
    `;
    await sql`INSERT INTO "TaskLog" (id, "taskId", "userId", action, detail, "createdAt") VALUES (${uuid()}, ${id}, ${user.id}, ${'STATUS_' + status}, ${rejectedReason || null}, NOW())`;
    const now = new Date();
    const month = now.getMonth() + 1; const year = now.getFullYear();
    if (status === 'COMPLETED' && task.assigneeId) {
      const isLate = task.deadline && now > new Date(task.deadline);
      await sql`INSERT INTO "KpiScore" (id, "userId", "storeId", score, reason, "taskId", month, year, "createdAt") VALUES (${uuid()}, ${task.assigneeId}, ${task.storeId}, ${isLate ? -5 : 10}, ${isLate ? 'Hoàn thành muộn deadline' : 'Hoàn thành đúng deadline'}, ${id}, ${month}, ${year}, NOW())`;
    }
    if (status === 'REJECTED' && task.assigneeId) {
      await sql`INSERT INTO "KpiScore" (id, "userId", "storeId", score, reason, "taskId", month, year, "createdAt") VALUES (${uuid()}, ${task.assigneeId}, ${task.storeId}, -3, 'Task bị từ chối', ${id}, ${month}, ${year}, NOW())`;
    }
    return ok(c, await taskRow(sql, id));
  }, c.env);
});

app.post('/api/tasks/:id/comments', async (c) => {
  return authMiddleware(c, async () => {
    const { content, mentions = [] } = await c.req.json();
    const sql = getSql(c.env);
    const taskId = c.req.param('id');
    const [task] = await sql`SELECT id FROM "Task" WHERE id = ${taskId}`;
    if (!task) return notFound(c);
    const id = uuid();
    const [comment] = await sql`
      INSERT INTO "TaskComment" (id, "taskId", "userId", content, mentions, "createdAt")
      VALUES (${id}, ${taskId}, ${c.get('user').id}, ${content}, ${mentions}, NOW())
      RETURNING *
    `;
    const [commentWithUser] = await sql`
      SELECT tc.*, json_build_object('id', u.id, 'name', u.name, 'avatar', u.avatar) AS user
      FROM "TaskComment" tc JOIN "User" u ON u.id = tc."userId" WHERE tc.id = ${id}
    `;
    if (mentions.length > 0) {
      const users = await sql`SELECT "fcmToken" FROM "User" WHERE id = ANY(${mentions}) AND "fcmToken" IS NOT NULL`;
      for (const u of users) {
        await sendFcm(c.env, u.fcmToken, 'Bạn được nhắc đến', `${c.get('user').name} đã đề cập đến bạn`, { taskId, type: 'MENTION' });
      }
    }
    return created(c, commentWithUser);
  }, c.env);
});

app.delete('/api/tasks/:id', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [task] = await sql`SELECT id FROM "Task" WHERE id = ${id}`;
    if (!task) return notFound(c);
    await sql`DELETE FROM "Task" WHERE id = ${id}`;
    return ok(c, null, 'Task deleted');
  }, c.env);
});

// ── Dashboard ─────────────────────────────────────────────────

app.get('/api/dashboard', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const sql = getSql(c.env);
    const storeFilter = user.role === 'STORE_MANAGER' ? sql`AND t."storeId" = ${user.storeId}` :
      user.role === 'ZONE_MANAGER' ? sql`AND t."storeId" IN (SELECT id FROM "Store" WHERE "zoneId" = ${user.zoneId})` : sql``;

    const [[tc], [comp], [over], [inp], overdue, busy] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM "Task" t WHERE 1=1 ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS count FROM "Task" t WHERE status = 'COMPLETED'::"TaskStatus" ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS count FROM "Task" t WHERE status = 'OVERDUE'::"TaskStatus" ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS count FROM "Task" t WHERE status = 'IN_PROGRESS'::"TaskStatus" ${storeFilter}`,
      sql`
        SELECT t.id, t.title, t.priority, t.deadline,
          CASE WHEN t."assigneeId" IS NOT NULL THEN json_build_object('id', u.id, 'name', u.name) ELSE NULL END AS assignee,
          CASE WHEN t."storeId" IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END AS store
        FROM "Task" t
        LEFT JOIN "User" u ON u.id = t."assigneeId"
        LEFT JOIN "Store" s ON s.id = t."storeId"
        WHERE t.status = ANY(ARRAY['OVERDUE', 'NOT_STARTED', 'IN_PROGRESS']::"TaskStatus"[]) AND t.deadline < NOW()
        ${storeFilter}
        ORDER BY t.deadline ASC LIMIT 5
      `,
      sql`
        SELECT u.id, u.name, u.avatar, COUNT(t.id)::int AS task_count
        FROM "User" u
        LEFT JOIN "Task" t ON t."assigneeId" = u.id
        WHERE u.role = 'EMPLOYEE' AND u."isActive" = true
          ${user.storeId ? sql`AND u."storeId" = ${user.storeId}` : sql``}
        GROUP BY u.id ORDER BY task_count DESC LIMIT 5
      `,
    ]);
    return ok(c, {
      totalTasks: tc.count, completed: comp.count, overdue: over.count, inProgress: inp.count,
      overdueList: overdue, busyEmployees: busy,
    });
  }, c.env);
});

app.get('/api/dashboard/overview', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const storeFilter = user.role === 'EMPLOYEE' || user.role === 'STORE_MANAGER' ? sql`AND t."storeId" = ${user.storeId}` :
      user.role === 'ZONE_MANAGER' ? sql`AND t."storeId" IN (SELECT id FROM "Store" WHERE "zoneId" = ${user.zoneId})` : sql``;
    const sql = getSql(c.env);
    const [[total], [ct], [od], [pa], [ip]] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM "Task" t WHERE 1=1 ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" t WHERE status = 'COMPLETED'::"TaskStatus" AND "completedAt" >= ${today} AND "completedAt" < ${tomorrow} ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" t WHERE status != 'COMPLETED'::"TaskStatus" AND deadline < NOW() ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" t WHERE status = 'PENDING_APPROVAL'::"TaskStatus" ${storeFilter}`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" t WHERE status = 'IN_PROGRESS'::"TaskStatus" ${storeFilter}`,
    ]);
    return ok(c, { stats: { totalTasks: total.c, completedToday: ct.c, overdueTasks: od.c, pendingApproval: pa.c, inProgress: ip.c } });
  }, c.env);
});

app.get('/api/dashboard/users', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const sql = getSql(c.env);
    const filter = user.role === 'ZONE_MANAGER' ? sql`WHERE u."zoneId" = ${user.zoneId}` :
      user.role === 'STORE_MANAGER' ? sql`WHERE u."storeId" = ${user.storeId}` : sql``;
    const users = await sql`
      SELECT u.id, u.name, u.email, u.role, u.avatar, u."isActive", u."storeId",
        CASE WHEN u."storeId" IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END AS store
      FROM "User" u LEFT JOIN "Store" s ON s.id = u."storeId"
      ${filter}
      ORDER BY u.role ASC, u.name ASC
    `;
    return ok(c, users);
  }, c.env);
});

app.get('/api/dashboard/stores', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const sql = getSql(c.env);
    const filter = user.role === 'ZONE_MANAGER' ? sql`WHERE s."zoneId" = ${user.zoneId}` : sql``;
    const stores = await sql`
      SELECT s.*,
        CASE WHEN s."zoneId" IS NOT NULL THEN json_build_object('id', z.id, 'name', z.name) ELSE NULL END AS zone,
        COUNT(DISTINCT u.id)::int AS user_count,
        COUNT(DISTINCT t.id)::int AS task_count
      FROM "Store" s
      LEFT JOIN "Zone" z ON z.id = s."zoneId"
      LEFT JOIN "User" u ON u."storeId" = s.id
      LEFT JOIN "Task" t ON t."storeId" = s.id
      ${filter}
      GROUP BY s.id, z.id ORDER BY s.name ASC
    `;
    return ok(c, stores);
  }, c.env);
});

// ── KPI ───────────────────────────────────────────────────────

app.get('/api/kpi/me', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const sql = getSql(c.env);
    const history = await sql`SELECT * FROM "KpiScore" WHERE "userId" = ${c.get('user').id} AND month = ${m} AND year = ${y} ORDER BY "createdAt" DESC`;
    const total = history.reduce((s, r) => s + r.score, 0);
    return ok(c, { total, history, month: m, year: y });
  }, c.env);
});

app.get('/api/kpi/employees', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { storeId, month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const sid = storeId || c.get('user').storeId;
    const sql = getSql(c.env);
    const storeFilter = sid ? sql`AND k."storeId" = ${sid}` : sql``;
    const ranking = await sql`
      SELECT k."userId", SUM(k.score)::int AS total,
        json_build_object('id', u.id, 'name', u.name, 'avatar', u.avatar, 'role', u.role) AS user
      FROM "KpiScore" k JOIN "User" u ON u.id = k."userId"
      WHERE k.month = ${m} AND k.year = ${y} ${storeFilter}
      GROUP BY k."userId", u.id ORDER BY total DESC
    `;
    return ok(c, { ranking, month: m, year: y });
  }, c.env);
});

app.get('/api/kpi/stores', async (c) => {
  return authMiddleware(c, async () => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = c.req.query();
    const m = Number(month); const y = Number(year);
    const sql = getSql(c.env);
    const ranking = await sql`
      SELECT k."storeId", SUM(k.score)::int AS total,
        json_build_object('id', s.id, 'name', s.name) AS store
      FROM "KpiScore" k JOIN "Store" s ON s.id = k."storeId"
      WHERE k.month = ${m} AND k.year = ${y} AND k."storeId" IS NOT NULL
      GROUP BY k."storeId", s.id ORDER BY total DESC
    `;
    return ok(c, { ranking, month: m, year: y });
  }, c.env);
});

// ── Reports ───────────────────────────────────────────────────

app.get('/api/reports', async (c) => {
  return authMiddleware(c, async () => {
    const year = Number(c.req.query('year') || new Date().getFullYear());
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year}-12-31T23:59:59.999Z`);
    const sql = getSql(c.env);
    const rows = await sql`
      SELECT EXTRACT(MONTH FROM "createdAt")::int AS month, status, t."storeId", s.name AS store_name
      FROM "Task" t LEFT JOIN "Store" s ON s.id = t."storeId"
      WHERE t."createdAt" >= ${start} AND t."createdAt" <= ${end}
    `;
    const monthMap = {};
    for (let m = 1; m <= 12; m++) monthMap[m] = { month: m, total: 0, completed: 0, overdue: 0 };
    const storeMap = {};
    rows.forEach(r => {
      monthMap[r.month].total++;
      if (r.status === 'COMPLETED') monthMap[r.month].completed++;
      if (r.status === 'OVERDUE') monthMap[r.month].overdue++;
      if (r.storeId) {
        if (!storeMap[r.storeId]) storeMap[r.storeId] = { name: r.store_name || r.storeId, total: 0, completed: 0 };
        storeMap[r.storeId].total++;
        if (r.status === 'COMPLETED') storeMap[r.storeId].completed++;
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
    const end = to ? new Date(to) : new Date();
    const sql = getSql(c.env);
    const sid = storeId || user.storeId;
    const storeFilter = sid ? sql`AND "storeId" = ${sid}` : sql``;
    const base = sql`WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter}`;
    const [[total], [comp], [over], [pend], [inp], [rej]] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM "Task" ${base}`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter} AND status = 'COMPLETED'::"TaskStatus"`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter} AND status = 'OVERDUE'::"TaskStatus"`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter} AND status = 'PENDING_APPROVAL'::"TaskStatus"`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter} AND status = 'IN_PROGRESS'::"TaskStatus"`,
      sql`SELECT COUNT(*)::int AS c FROM "Task" WHERE "createdAt" >= ${start} AND "createdAt" <= ${end} ${storeFilter} AND status = 'REJECTED'::"TaskStatus"`,
    ]);
    return ok(c, { summary: { total: total.c, completed: comp.c, overdue: over.c, pending: pend.c, inProgress: inp.c, rejected: rej.c, completionRate: total.c > 0 ? Math.round((comp.c / total.c) * 100) : 0 } });
  }, c.env);
});

// ── Checklists ────────────────────────────────────────────────

app.get('/api/checklists/templates', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const sql = getSql(c.env);
    const storeFilter = user.storeId ? sql`WHERE ct."storeId" = ${user.storeId} OR ct."storeId" IS NULL` : sql``;
    const templates = await sql`SELECT * FROM "ChecklistTemplate" ct ${storeFilter} ORDER BY ct."createdAt" DESC`;
    for (const t of templates) {
      t.items = await sql`SELECT * FROM "ChecklistTemplateItem" WHERE "templateId" = ${t.id} ORDER BY "order" ASC`;
    }
    return ok(c, templates);
  }, c.env);
});

app.post('/api/checklists/templates', async (c) => {
  return authMiddleware(c, async () => {
    const { name, type, storeId, items = [] } = await c.req.json();
    const sql = getSql(c.env);
    const id = uuid();
    const [tmpl] = await sql`
      INSERT INTO "ChecklistTemplate" (id, name, type, "storeId", "createdAt", "updatedAt")
      VALUES (${id}, ${name}, ${type}::"ChecklistType", ${storeId || c.get('user').storeId || null}, NOW(), NOW())
      RETURNING *
    `;
    if (items.length) {
      const vals = items.map((item, i) => sql`(${uuid()}, ${id}, ${item.label}, ${i}, ${item.requirePhoto || false})`);
      await sql`INSERT INTO "ChecklistTemplateItem" (id, "templateId", label, "order", "requirePhoto") VALUES ${vals.reduce((a, b) => sql`${a}, ${b}`)}`;
    }
    tmpl.items = await sql`SELECT * FROM "ChecklistTemplateItem" WHERE "templateId" = ${id} ORDER BY "order" ASC`;
    return created(c, tmpl);
  }, c.env);
});

app.get('/api/checklists/sessions', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { storeId, date } = c.req.query();
    const sql = getSql(c.env);
    const filters = [sql`1=1`];
    if (user.role === 'EMPLOYEE') filters.push(sql`cs."userId" = ${user.id}`);
    else if (user.role === 'STORE_MANAGER') filters.push(sql`cs."storeId" = ${user.storeId}`);
    if (storeId) filters.push(sql`cs."storeId" = ${storeId}`);
    if (date) {
      const d = new Date(date); const next = new Date(d); next.setDate(next.getDate() + 1);
      filters.push(sql`cs."shiftDate" >= ${d} AND cs."shiftDate" < ${next}`);
    }
    const sessions = await sql`
      SELECT cs.*,
        json_build_object('id', ct.id, 'name', ct.name, 'type', ct.type) AS template,
        json_build_object('id', u.id, 'name', u.name) AS user
      FROM "ChecklistSession" cs
      JOIN "ChecklistTemplate" ct ON ct.id = cs."templateId"
      JOIN "User" u ON u.id = cs."userId"
      WHERE ${filters.reduce((a, b) => sql`${a} AND ${b}`)}
      ORDER BY cs."shiftDate" DESC
    `;
    for (const s of sessions) {
      s.items = await sql`SELECT * FROM "ChecklistSessionItem" WHERE "sessionId" = ${s.id}`;
    }
    return ok(c, sessions);
  }, c.env);
});

app.post('/api/checklists/sessions', async (c) => {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    const { templateId, storeId } = await c.req.json();
    const sql = getSql(c.env);
    const [template] = await sql`SELECT * FROM "ChecklistTemplate" WHERE id = ${templateId}`;
    if (!template) return notFound(c);
    const items = await sql`SELECT * FROM "ChecklistTemplateItem" WHERE "templateId" = ${templateId} ORDER BY "order" ASC`;
    const id = uuid();
    await sql`INSERT INTO "ChecklistSession" (id, "templateId", "storeId", "userId", "shiftDate", "createdAt") VALUES (${id}, ${templateId}, ${storeId || user.storeId}, ${user.id}, NOW(), NOW())`;
    if (items.length) {
      const vals = items.map(item => sql`(${uuid()}, ${id}, ${item.label}, false, NOW())`);
      // insert session items - note checkedAt not needed here
      const vals2 = items.map(item => sql`(${uuid()}, ${id}, ${item.label}, false)`);
      await sql`INSERT INTO "ChecklistSessionItem" (id, "sessionId", label, "isChecked") VALUES ${vals2.reduce((a, b) => sql`${a}, ${b}`)}`;
    }
    const [session] = await sql`
      SELECT cs.*, json_build_object('id', ct.id, 'name', ct.name, 'type', ct.type) AS template
      FROM "ChecklistSession" cs JOIN "ChecklistTemplate" ct ON ct.id = cs."templateId"
      WHERE cs.id = ${id}
    `;
    session.items = await sql`SELECT * FROM "ChecklistSessionItem" WHERE "sessionId" = ${id}`;
    return created(c, session);
  }, c.env);
});

app.patch('/api/checklists/sessions/:id/complete', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [session] = await sql`SELECT id FROM "ChecklistSession" WHERE id = ${id}`;
    if (!session) return notFound(c);
    const [updated] = await sql`UPDATE "ChecklistSession" SET "completedAt" = NOW() WHERE id = ${id} RETURNING *`;
    return ok(c, updated);
  }, c.env);
});

// ── SOP ───────────────────────────────────────────────────────

app.get('/api/sop/documents', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const docs = await sql`SELECT * FROM "SopDocument" ORDER BY "createdAt" DESC`;
    return ok(c, docs);
  }, c.env);
});

app.get('/api/sop/documents/my-progress', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const progress = await sql`
      SELECT sp.*, json_build_object('id', d.id, 'title', d.title, 'fileType', d."fileType") AS document
      FROM "SopProgress" sp JOIN "SopDocument" d ON d.id = sp."documentId"
      WHERE sp."userId" = ${c.get('user').id}
    `;
    return ok(c, progress);
  }, c.env);
});

app.get('/api/sop/documents/:id', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const id = c.req.param('id');
    const [doc] = await sql`SELECT * FROM "SopDocument" WHERE id = ${id}`;
    if (!doc) return notFound(c);
    const quizzes = await sql`SELECT id, title FROM "Quiz" WHERE "documentId" = ${id}`;
    doc.quizzes = quizzes;
    return ok(c, doc);
  }, c.env);
});

app.post('/api/sop/documents/:id/progress', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const documentId = c.req.param('id');
    const userId = c.get('user').id;
    const [existing] = await sql`SELECT id FROM "SopProgress" WHERE "userId" = ${userId} AND "documentId" = ${documentId}`;
    let progress;
    if (existing) {
      [progress] = await sql`UPDATE "SopProgress" SET "isCompleted" = true, "completedAt" = NOW() WHERE id = ${existing.id} RETURNING *`;
    } else {
      [progress] = await sql`INSERT INTO "SopProgress" (id, "userId", "documentId", "isCompleted", "completedAt", "createdAt") VALUES (${uuid()}, ${userId}, ${documentId}, true, NOW(), NOW()) RETURNING *`;
    }
    return ok(c, progress);
  }, c.env);
});

app.get('/api/sop/quizzes/:id', async (c) => {
  return authMiddleware(c, async () => {
    const sql = getSql(c.env);
    const [quiz] = await sql`SELECT id, title, questions, "documentId" FROM "Quiz" WHERE id = ${c.req.param('id')}`;
    if (!quiz) return notFound(c);
    return ok(c, quiz);
  }, c.env);
});

app.post('/api/sop/quizzes/:id/submit', async (c) => {
  return authMiddleware(c, async () => {
    const { answers } = await c.req.json();
    const sql = getSql(c.env);
    const [quiz] = await sql`SELECT * FROM "Quiz" WHERE id = ${c.req.param('id')}`;
    if (!quiz) return notFound(c);
    const questions = quiz.questions;
    const score = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
    const passed = score / questions.length >= 0.7;
    const [attempt] = await sql`
      INSERT INTO "QuizAttempt" (id, "quizId", "userId", answers, score, passed, "createdAt")
      VALUES (${uuid()}, ${quiz.id}, ${c.get('user').id}, ${JSON.stringify(answers)}, ${score}, ${passed}, NOW())
      RETURNING *
    `;
    return ok(c, { ...attempt, total: questions.length });
  }, c.env);
});

// ── WebSocket ─────────────────────────────────────────────────

const rooms = new Map();

app.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected websocket', 426);
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
  server.addEventListener('close', () => { rooms.forEach(set => set.delete(server)); });
  return new Response(null, { status: 101, webSocket: client });
});

// ── 404 / Error ───────────────────────────────────────────────

app.notFound(c => c.json({ success: false, message: `Not found: ${c.req.method} ${c.req.path}` }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ success: false, message: err.message || 'Internal error' }, err.status || 500);
});

// ── KPI Nightly Cron ──────────────────────────────────────────

async function runKpiNightlyCron(env) {
  const sql = getSql(env);
  const now = new Date();
  const month = now.getMonth() + 1; const year = now.getFullYear();
  const overdue = await sql`
    SELECT t.*, u."fcmToken", u.id AS uid FROM "Task" t
    JOIN "User" u ON u.id = t."assigneeId"
    WHERE t.status = ANY(ARRAY['NOT_STARTED', 'IN_PROGRESS']::"TaskStatus"[]) AND t.deadline < ${now} AND t."assigneeId" IS NOT NULL
  `;
  for (const task of overdue) {
    await sql`INSERT INTO "KpiScore" (id, "userId", "storeId", score, reason, "taskId", month, year, "createdAt") VALUES (${uuid()}, ${task.uid}, ${task.storeId}, -10, ${`Task "${task.title}" quá hạn không báo cáo`}, ${task.id}, ${month}, ${year}, NOW())`;
    await sql`UPDATE "Task" SET status = 'OVERDUE'::"TaskStatus", "updatedAt" = NOW() WHERE id = ${task.id}`;
    if (task.fcmToken) await sendFcm(env, task.fcmToken, 'Task quá hạn', `"${task.title}" đã quá hạn và bị trừ 10 điểm KPI`, { taskId: task.id, type: 'OVERDUE' });
  }
  console.log(`[KPI Cron] Processed ${overdue.length} overdue tasks`);
}

// ── Export ────────────────────────────────────────────────────

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runKpiNightlyCron(env));
  },
};
