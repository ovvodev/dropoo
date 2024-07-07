const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://dropoo.net",
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "https://dropoo.net",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"]
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

const rooms = new Map();

function getClientIp(socket) {
  return socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
}

io.on('connection', (socket) => {
  const clientIp = getClientIp(socket);
  console.log('New client connected:', socket.id, 'from IP:', clientIp);

  socket.on('register', (deviceInfo) => {
    const roomId = clientIp;
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    const room = rooms.get(roomId);

    const peerInfo = {
      id: socket.id,
      deviceInfo: deviceInfo
    };

    room.set(socket.id, peerInfo);

    // Send the new peer info to all other clients in the same room
    socket.to(roomId).emit('peer-joined', peerInfo);

    // Send the new peer a list of all connected peers in the same room
    const peerList = Array.from(room.values());
    socket.emit('peers', peerList.filter(peer => peer.id !== socket.id));
  });

  socket.on('signal', (data) => {
    const roomId = clientIp;
    console.log('Signal received from', socket.id, 'for', data.peerId);
    io.to(data.peerId).emit('signal', {
      peerId: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    const roomId = clientIp;
    console.log('Client disconnected:', socket.id);
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(socket.id);
      if (room.size === 0) {
        rooms.delete(roomId);
      } else {
        io.to(roomId).emit('peer-left', socket.id);
      }
    }
  });
});

app.get('/', (req, res) => {
  res.send('Dropoo server is running');
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
