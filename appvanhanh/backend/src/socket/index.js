const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');

module.exports = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth required'));
    try {
      socket.user = jwt.verify(token, jwtSecret);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;

    // Personal room for notifications
    socket.join(`user-${user.id}`);

    // Store room
    if (user.storeId) socket.join(`store-${user.storeId}`);

    socket.on('task:join', (taskId) => {
      socket.join(`task-${taskId}`);
    });

    socket.on('task:leave', (taskId) => {
      socket.leave(`task-${taskId}`);
    });

    socket.on('disconnect', () => {});
  });
};
