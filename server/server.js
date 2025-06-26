const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

const User = require('./models/user');
const Room = require('./models/room');
const Message = require('./models/message');

const JWT_SECRET = 'your_secret_here'; // Use an env variable in production!

mongoose.connect('mongodb://localhost:27017/e2eechat', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// --- Auth API ---

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;
    if (!username || !password || !publicKey)
      return res.status(400).json({ error: 'Missing fields' });
    // Check for duplicate username
    const existing = await User.findOne({ username });
    if (existing)
      return res.status(400).json({ error: 'Username already exists (duplicate)' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash, publicKey });
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({
      token,
      username: user.username,
      publicKey: user.publicKey
    });
  } catch {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Allow updating publicKey (after login, if local private key is missing and regenerated)
app.post('/api/updatePublicKey', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'No token' });
    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: 'Missing publicKey' });
    user.publicKey = publicKey;
    await user.save();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid token or data' });
  }
});

// --- Room list API ---
app.get('/api/rooms/:username', async (req, res) => {
  const { username } = req.params;
  const user = await User.findOne({ username }).populate('rooms');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ rooms: user.rooms.map(r => r.code) });
});

// --- Socket.io ---

// JWT auth middleware for socket.io
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = await User.findById(payload.id);
    next();
  } catch (e) {
    next(new Error('Invalid token'));
  }
});

// Track user to socket mapping
const userSockets = new Map();

io.on('connection', (socket) => {
  // Map username to socket
  if (socket.user && socket.user.username) {
    if (!userSockets.has(socket.user.username)) userSockets.set(socket.user.username, new Set());
    userSockets.get(socket.user.username).add(socket.id);
  }

  // Join room
  socket.on('join-room', async ({ roomCode }) => {
    let room = await Room.findOne({ code: roomCode });
    if (!room) {
      room = await Room.create({ code: roomCode, users: [socket.user._id] });
    } else if (!room.users.includes(socket.user._id)) {
      room.users.push(socket.user._id);
      await room.save();
    }
    // Add room to user's room list if not already present
    if (!socket.user.rooms.includes(room._id)) {
      socket.user.rooms.push(room._id);
      await socket.user.save();
    }
    socket.join(roomCode);

    // Send user list in room (with username/publicKey)
    const users = await User.find({ _id: { $in: room.users } }).select('username publicKey');
    io.to(roomCode).emit('users', users.map(u => ({
      username: u.username,
      publicKey: u.publicKey
    })));

    // Send chat history (last 50 messages)
    const messages = await Message.find({ room: room._id }).sort({ timestamp: 1 }).populate('sender', 'username');
    socket.emit('chat-history', messages.map(m => ({
      from: m.sender.username,
      to: m.to, // NEW: Add recipient for history messages if needed
      message: m.message,
      type: m.type,
      timestamp: m.timestamp
    })));
  });

  // Relay and store encrypted message
  socket.on('encrypted-message', async (data) => {
    const { roomCode, message, type, to } = data;
    const room = await Room.findOne({ code: roomCode });
    if (!room) return;
    // Save the message
    const recipientUser = await User.findOne({ username: to });
    const msg = await Message.create({
      room: room._id,
      sender: socket.user._id,
      to, // Save recipient username
      message,
      type
    });
    // Send only to the intended recipient (and not back to sender)
    if (userSockets.has(to)) {
      for (const sockId of userSockets.get(to)) {
        io.sockets.sockets.get(sockId)?.emit('encrypted-message', {
          from: socket.user.username,
          to,
          message,
          type,
          timestamp: msg.timestamp
        });
      }
    }
  });

  socket.on('disconnect', () => {
    // Remove mapping on disconnect
    if (socket.user && socket.user.username && userSockets.has(socket.user.username)) {
      userSockets.get(socket.user.username).delete(socket.id);
      if (userSockets.get(socket.user.username).size === 0) {
        userSockets.delete(socket.user.username);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at port ${PORT}`);
});