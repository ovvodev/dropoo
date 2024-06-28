const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow your Vue app's origin
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Notify all other clients about the new peer
  socket.broadcast.emit('peer-joined', socket.id);

  // Send the new peer a list of all connected peers
  const connectedPeers = Array.from(io.sockets.sockets.keys());
  socket.emit('peers', connectedPeers.filter(id => id !== socket.id));

  socket.on('signal', (data) => {
    console.log('Signal received from', socket.id, 'for', data.peerId);
    io.to(data.peerId).emit('signal', {
      peerId: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    io.emit('peer-left', socket.id);
  });
});

server.listen(3001, '0.0.0.0', () => console.log('Server running on port 3001'));
