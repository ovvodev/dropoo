const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  let clientRoom;

  // Send the client their assigned ID
  ws.send(JSON.stringify({ type: 'id-assigned', id: clientId }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'join') {
      clientRoom = data.room;
      if (!rooms.has(clientRoom)) {
        rooms.set(clientRoom, new Map());
      }
      rooms.get(clientRoom).set(clientId, ws);
      broadcastPeers(clientRoom);
    } else if (data.type === 'signal') {
      const targetWs = rooms.get(clientRoom).get(data.target);
      if (targetWs) {
        targetWs.send(JSON.stringify({
          type: 'signal',
          sender: clientId,
          signal: data.signal
        }));
      }
    }
  });

  ws.on('close', () => {
    if (clientRoom && rooms.has(clientRoom)) {
      rooms.get(clientRoom).delete(clientId);
      if (rooms.get(clientRoom).size === 0) {
        rooms.delete(clientRoom);
      } else {
        broadcastPeers(clientRoom);
      }
    }
  });

  function broadcastPeers(room) {
    const peers = Array.from(rooms.get(room).keys());
    rooms.get(room).forEach((clientWs) => {
      clientWs.send(JSON.stringify({ type: 'peers', peers }));
    });
  }
});

// Add a basic route for health checks
app.get('/', (req, res) => {
  res.send('Dropoo server is running');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
