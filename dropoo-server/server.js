const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

const connectedPeers = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register', (deviceInfo) => {
    connectedPeers.set(socket.id, deviceInfo);
    
    // Send the new peer info to all other clients
    socket.broadcast.emit('peer-joined', { id: socket.id, deviceInfo });

    // Send the new peer a list of all connected peers
    const peerList = Array.from(connectedPeers.entries()).map(([id, info]) => ({ id, deviceInfo: info }));
    socket.emit('peers', peerList.filter(peer => peer.id !== socket.id));
  });

  socket.on('signal', (data) => {
    console.log('Signal received from', socket.id, 'for', data.peerId);
    io.to(data.peerId).emit('signal', {
      peerId: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    connectedPeers.delete(socket.id);
    io.emit('peer-left', socket.id);
  });
});

server.listen(3001, '0.0.0.0', () => console.log('Server running on port 3001'));
