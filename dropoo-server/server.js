const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const { networkInterfaces } = require('os');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

function getLocalIpAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join', (data) => {
    const { clientId, room, deviceInfo } = data;
    socket.join(room);
    if (!rooms.has(room)) {
      rooms.set(room, new Map());
    }
    rooms.get(room).set(clientId, { socket, deviceInfo });
    
    // Notify other peers about the new peer
    socket.to(room).emit('peer-joined', { id: clientId, deviceInfo });
    
    // Send list of existing peers to the new peer
    const peers = Array.from(rooms.get(room).entries()).map(([id, { deviceInfo }]) => ({ id, deviceInfo }));
    socket.emit('peers', peers.filter(peer => peer.id !== clientId));
  });

  socket.on('signal', (data) => {
    const { peerId, signal } = data;
    const peerSocket = io.sockets.sockets.get(peerId);
    if (peerSocket) {
      peerSocket.emit('signal', { peerId: socket.id, signal });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    rooms.forEach((peers, room) => {
      if (peers.delete(socket.id)) {
        socket.to(room).emit('peer-left', socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
const localIp = getLocalIpAddress();

app.get('/', (req, res) => {
  res.send(`Dropoo server is running on http://${localIp}:${PORT}`);
});

server.listen(PORT, () => {
  console.log(`Server running on http://${localIp}:${PORT}`);
});
