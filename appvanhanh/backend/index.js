require('dotenv').config();
require('express-async-errors');
const { startCron } = require('./src/cron/kpiCron');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { port, clientUrl } = require('./src/config');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: clientUrl, credentials: true },
});

require('./src/socket')(io);

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inject io into req
app.use((req, _res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/tasks', require('./src/routes/tasks'));
app.use('/api/checklists', require('./src/routes/checklists'));
app.use('/api/kpi', require('./src/routes/kpi'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/sop', require('./src/routes/sop'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal error' });
});

httpServer.listen(port, () => {
  console.log(`Server running on port ${port}`);
  startCron();
});

module.exports = { app, io };
