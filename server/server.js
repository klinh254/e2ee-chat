const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const users = {}; // socket.id => { username, publicKey, roomCode }
const rooms = {}; // roomCode => Set of socket ids

// Serve static files from the parent directory (project root)
app.use(express.static(path.join(__dirname, '..', 'client')));

io.on('connection', (socket) => {
    // User registers with username, publicKey, roomCode
    socket.on('register', ({ username, publicKey, roomCode }) => {
        users[socket.id] = { username, publicKey, roomCode, socketId: socket.id };
        if (!rooms[roomCode]) rooms[roomCode] = new Set();
        rooms[roomCode].add(socket.id);
        updateUsers(roomCode);
    });

    // Send the list of users in the room
    socket.on('get-users', () => {
        const user = users[socket.id];
        if (user && rooms[user.roomCode]) {
            updateUsers(user.roomCode);
        }
    });

    // Relay encrypted messages to the intended recipient in the room
    socket.on('encrypted-message', (data) => {
        const { to, from, message, type } = data;
        if (users[to]) {
            io.to(to).emit('encrypted-message', { from, message, type });
        }
    });

    // Clean up on disconnect
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user && rooms[user.roomCode]) {
            rooms[user.roomCode].delete(socket.id);
            if (rooms[user.roomCode].size === 0) delete rooms[user.roomCode];
            updateUsers(user.roomCode);
        }
        delete users[socket.id];
    });

    function updateUsers(roomCode) {
        if (rooms[roomCode]) {
            const userList = Array.from(rooms[roomCode]).map(id => users[id]);
            for (const id of rooms[roomCode]) {
                io.to(id).emit('users', userList);
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at port ${PORT}`);
});