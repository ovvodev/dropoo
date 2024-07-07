const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const parser = require('ua-parser-js');

class DropooServer {
    constructor(port) {
        this.app = express();
        this.app.use(cors({
            origin: process.env.FRONTEND_URL || "https://dropoo.net",
            methods: ["GET", "POST"],
            credentials: true
        }));

        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });

        this._rooms = {};

        this.wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));

        this.app.get('/', (req, res) => {
            res.send('Dropoo server is running');
        });

        this.server.listen(port, '0.0.0.0', () => console.log(`Dropoo is running on port ${port}`));
    }

    _onConnection(peer) {
        console.log('New client connected:', peer.id, 'from IP:', peer.ip);
        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('close', () => this._leaveRoom(peer));
        this._keepAlive(peer);
    }

    _joinRoom(peer) {
        if (!this._rooms[peer.ip]) {
            this._rooms[peer.ip] = {};
        }

        // Notify all other peers in the room
        for (const otherPeerId in this._rooms[peer.ip]) {
            const otherPeer = this._rooms[peer.ip][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        // Send the new peer a list of all connected peers in the same room
        const peerList = Object.values(this._rooms[peer.ip]).map(p => p.getInfo());
        this._send(peer, {
            type: 'peers',
            peers: peerList.filter(p => p.id !== peer.id)
        });

        // Add peer to room
        this._rooms[peer.ip][peer.id] = peer;
    }

    _leaveRoom(peer) {
        console.log('Client disconnected:', peer.id);
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;

        // Delete the peer
        delete this._rooms[peer.ip][peer.id];

        // If room is empty, delete the room
        if (Object.keys(this._rooms[peer.ip]).length === 0) {
            delete this._rooms[peer.ip];
        } else {
            // Notify all other peers
            for (const otherPeerId in this._rooms[peer.ip]) {
                const otherPeer = this._rooms[peer.ip][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _onMessage(sender, message) {
        try {
            message = JSON.parse(message);
        } catch (e) {
            return; // Ignore malformed JSON
        }

        switch (message.type) {
            case 'signal':
                this._forwardSignal(sender, message);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }
    }

    _forwardSignal(sender, message) {
        if (message.to && this._rooms[sender.ip] && this._rooms[sender.ip][message.to]) {
            const recipient = this._rooms[sender.ip][message.to];
            message.from = sender.id;
            this._send(recipient, message);
        }
    }

    _send(peer, message) {
        if (peer && peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify(message));
        }
    }

    _keepAlive(peer) {
        const timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }

        this._send(peer, { type: 'ping' });

        setTimeout(() => this._keepAlive(peer), timeout);
    }
}

class Peer {
    constructor(socket, request) {
        this.socket = socket;
        this.id = Peer.uuid();
        this._setIP(request);
        this.deviceInfo = this._getDeviceInfo(request);
        this.lastBeat = Date.now();
    }

    _setIP(request) {
        this.ip = request.headers['x-forwarded-for'] || 
                  request.connection.remoteAddress;
        if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    _getDeviceInfo(request) {
        const ua = parser(request.headers['user-agent']);
        return {
            os: ua.os.name || 'Unknown OS',
            type: ua.device.type || 'Desktop',
            model: ua.device.model || '',
            browser: ua.browser.name || 'Unknown Browser'
        };
    }

    getInfo() {
        return {
            id: this.id,
            deviceInfo: this.deviceInfo
        };
    }

    static uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

const PORT = process.env.PORT || 3000;
new DropooServer(PORT);
