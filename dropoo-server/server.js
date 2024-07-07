const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const parser = require('ua-parser-js');
const { greekNames } = require('./constants');

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
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('close', () => this._leaveRoom(peer));
        this._keepAlive(peer);
    }

    _joinRoom(peer) {
        console.log('Joining room for peer:', peer.id, 'IP:', peer.ip);
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
        console.log('Room state after join:', JSON.stringify(this._rooms[peer.ip], null, 2));
    }

    _leaveRoom(peer) {
        console.log('Client disconnected:', peer.id);
        if (!this._rooms[peer.ip] || !this._rooms[peer.ip][peer.id]) return;

        delete this._rooms[peer.ip][peer.id];

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
            console.error('Failed to parse message:', message);
            return; // Ignore malformed JSON
        }
        console.log('Received message:', message);
        switch (message.type) {
            case 'register':
                console.log('Registering peer:', sender.id);
                this._joinRoom(sender);
                // Send back the peer's info including assigned Greek name and parsed device info
                this._send(sender, {
                    type: 'peer-info',
                    peer: sender.getInfo()
                });
                break;
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
        this.deviceInfo = this._parseDeviceInfo(request);
        this.lastBeat = Date.now();
        this.greekName = this._assignGreekName();
    }

    _setIP(request) {
        this.ip = request.headers['x-forwarded-for'] ||
                  request.connection.remoteAddress;
        if (this.ip === '::1' || this.ip === '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }
    _parseDeviceInfo(request) {
        const parser = new UAParser(request.headers['user-agent']);
        const result = parser.getResult();
        return {
            os: result.os.name || 'Unknown OS',
            type: result.device.type || 'Desktop',
            model: result.device.model || '',
            browser: result.browser.name || 'Unknown Browser'
        };
    }
    _assignGreekName() {
        const hash = this._hashCode(this.id);
        const index = Math.abs(hash) % greekNames.length;
        return greekNames[index];
    }

    _hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    getInfo() {
        return {
            id: this.id,
            deviceInfo: this.deviceInfo,
            greekName: this.greekName
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
