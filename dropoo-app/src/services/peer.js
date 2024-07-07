// src/services/peer.js

import Peer from 'simple-peer'
import JSZip from 'jszip'


class PeerService {
  constructor() {
    this.socket = null
    this.peers = {}
    this.onPeerConnected = null
    this.onPeerIdAssigned = null
    this.onPeerDisconnected = null
    this.onFileProgress = null
    this.onFileReceived = null
    this.incomingFiles = {}
    this.onTransferError = null
    this.onTransferCancelled = null
    this.activeTransfers = new Map()
    this.pausedTransfers = new Set()
    this.myPeerId = null
    this.deviceInfo = null;
    this.peerNames = new Map();
    this.myGreekName = null
    this.incomingFolders = {}
    console.log("Device info:", this.deviceInfo)
  }
  cleanup() {
    console.log('Cleaning up PeerService');
    // Destroy all peer connections
    Object.values(this.peers).forEach(peer => {
      try {
        peer.destroy();
      } catch (error) {
        console.error('Error destroying peer:', error);
      }
    });
    // Clear all stored data
    this.peers = {};
    this.incomingFiles = {};
    this.activeTransfers.clear();
    this.pausedTransfers.clear();
    this.incomingFolders = {};
    // Disconnect from the socket
    if (this.socket) {
      this.socket.close();
    }
  }

 

  getMyPeerInfo() {
    return {
      id: this.myPeerId,
      greekName: this.myGreekName,
      deviceInfo: this.deviceInfo
    };
  }
  formatPeerName(deviceInfo) {
    return `${deviceInfo.os} ${deviceInfo.type} (${deviceInfo.browser})`;
  }
  init(serverUrl) {
    console.log('Initializing PeerService with URL:', serverUrl)
    if (this.socket) {
        this.socket.close()
    }
    this.socket = new WebSocket(serverUrl)

    this.socket.onopen = () => {
        console.log('Connected to signaling server')
        this.socket.send(JSON.stringify({
            type: 'register'
        }))
    }

    this.socket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        this.handleServerMessage(data)
    }

    this.socket.onerror = (error) => {
        console.error('WebSocket error:', error)
    }

    this.socket.onclose = (event) => {
        console.log('Disconnected from signaling server:', event.reason)
    }
}
  generatePeerId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  handleServerMessage(data) {
    switch(data.type) {
        case 'peer-info':
            console.log('Received peer info:', data.peer)
            this.myPeerId = data.peer.id
            this.myGreekName = data.peer.greekName
            this.deviceInfo = data.peer.deviceInfo
            if (this.onPeerIdAssigned) {
                this.onPeerIdAssigned(this.myPeerId)
            }
            break
        case 'peers':
            console.log('Received list of peers:', data.peers)
            data.peers.forEach(peer => this.createPeer(peer.id, true, peer.deviceInfo, peer.greekName))
            break
        case 'peer-joined':
            console.log('New peer joined:', data.peer)
            this.createPeer(data.peer.id, false, data.peer.deviceInfo, data.peer.greekName)
            break
        case 'peer-left':
            console.log('Peer left:', data.peerId)
            this.handlePeerDisconnection(data.peerId)
            break
        case 'signal':
            if (this.peers[data.from]) {
                this.peers[data.from].signal(data.signal)
            }
            break
    }
  }

  createPeer(peerId, initiator, deviceInfo, greekName) {
  if (this.peers[peerId]) {
      console.log('Peer already exists:', peerId)
      return
  }
  console.log('Creating peer:', peerId, 'initiator:', initiator)
  const peer = new Peer({ initiator })

  peer.on('signal', (signal) => {
      this.socket.send(JSON.stringify({
          type: 'signal',
          to: peerId,
          signal: signal
      }))
  })

  peer.on('connect', () => {
      console.log('Connected to peer:', peerId)
      if (this.onPeerConnected) {
          const formattedDeviceInfo = this.formatPeerName(deviceInfo)
          this.onPeerConnected({
              id: peerId,
              greekName: greekName,
              deviceInfo: formattedDeviceInfo
          })
      }
  })

  peer.on('data', (data) => {
      this.handleIncomingData(peerId, data)
  })

  peer.on('close', () => {
      console.log('Peer connection closed:', peerId)
      this.handlePeerDisconnection(peerId)
  })

  this.peers[peerId] = peer
  }

  handleIncomingData(peerId, data) {
    try {
      const parsedData = JSON.parse(data.toString())
      switch(parsedData.type) {
        case 'file-start': {
          const folderPath = parsedData.fileName.split('/').slice(0, -1).join('/')
          if (folderPath) {
            if (!this.incomingFolders[folderPath]) {
              this.incomingFolders[folderPath] = {
                peerId,
                files: {},
                totalSize: 0,
                receivedSize: 0
              }
            }
            this.incomingFolders[folderPath].files[parsedData.fileName] = {
              size: parsedData.fileSize,
              type: parsedData.fileType,
              chunks: []
            };
            this.incomingFolders[folderPath].totalSize += parsedData.fileSize;
          }
          this.incomingFiles[parsedData.transferId] = {
            peerId,
            fileName: parsedData.fileName,
            fileSize: parsedData.fileSize,
            fileType: parsedData.fileType,
            chunks: []
          }
          break
        }
        case 'file-chunk': {
          if (this.incomingFiles[parsedData.transferId]) {
            this.incomingFiles[parsedData.transferId].chunks.push(new Uint8Array(parsedData.data))
            const receivedSize = this.incomingFiles[parsedData.transferId].chunks.reduce((total, chunk) => total + chunk.length, 0)
            const progress = (receivedSize / this.incomingFiles[parsedData.transferId].fileSize) * 100
            const folderPath = parsedData.fileName.split('/').slice(0, -1).join('/')
            if (folderPath && this.incomingFolders[folderPath]) {
              this.incomingFolders[folderPath].receivedSize += parsedData.data.length
              const folderProgress = (this.incomingFolders[folderPath].receivedSize / this.incomingFolders[folderPath].totalSize) * 100
              if (this.onFileProgress) {
                this.onFileProgress(peerId, folderPath, folderProgress)
              }
            } else if (this.onFileProgress) {
              this.onFileProgress(peerId, parsedData.fileName, progress)
            }
          }
          break
        }
        case 'file-end': {
          if (this.incomingFiles[parsedData.transferId]) {
            const file = this.incomingFiles[parsedData.transferId]
            const blob = new Blob(file.chunks, { type: file.fileType })
            const folderPath = file.fileName.split('/').slice(0, -1).join('/')
            if (folderPath && this.incomingFolders[folderPath]) {
              this.incomingFolders[folderPath].files[file.fileName].blob = blob
              const allFilesReceived = Object.values(this.incomingFolders[folderPath].files).every(f => f.blob)
              if (allFilesReceived) {
                this.createAndSendZipFolder(folderPath, peerId)
              }
            } else {
              const url = URL.createObjectURL(blob)
              if (this.onFileReceived) {
                this.onFileReceived(peerId, file.fileName, url, blob.size)
              }
            }
            delete this.incomingFiles[parsedData.transferId]
          }
          break
        }
        case 'file-cancel': {
          if (this.incomingFiles[parsedData.transferId]) {
            delete this.incomingFiles[parsedData.transferId]
            if (this.onTransferCancelled) {
              this.onTransferCancelled(peerId, parsedData.fileName, 'Sender cancelled the transfer')
            }
          }
          break
        }
      }
    } catch (error) {
      this.handleError(peerId, 'Unknown', 'Error processing incoming data')
    }
  }

  async createAndSendZipFolder(folderPath, peerId) {
    const zip = new JSZip();
    const folder = this.incomingFolders[folderPath];

    for (const [fileName, fileData] of Object.entries(folder.files)) {
      zip.file(fileName.replace(folderPath + '/', ''), fileData.blob);
    }

    const zipBlob = await zip.generateAsync({type: 'blob'});
    const url = URL.createObjectURL(zipBlob);

    if (this.onFileReceived) {
      this.onFileReceived(peerId, `${folderPath}.zip`, url, zipBlob.size);
    }

    delete this.incomingFolders[folderPath];
  }
  
  handlePeerDisconnection(peerId) {
    console.log('Handling peer disconnection:', peerId);
    if (this.peers[peerId]) {
      try {
        this.peers[peerId].destroy();
      } catch (error) {
        console.error('Error destroying peer:', error);
      }
      delete this.peers[peerId];
    }
    if (this.onPeerDisconnected) {
      this.onPeerDisconnected(peerId);
    }
    this.cleanupTransfers(peerId);
  }
  
  cleanupTransfers(peerId) {
    for (let [transferId] of this.activeTransfers) {
      if (transferId.startsWith(peerId)) {
        this.cancelTransfer(transferId)
      }
    }
    
    for (let transferId in this.incomingFiles) {
      if (this.incomingFiles[transferId].peerId === peerId) {
        delete this.incomingFiles[transferId]
      }
    }
  }
  
  sendFile(peerId, file, filePath) {
    const peer = this.peers[peerId];
    if (!peer) {
      this.handleError(peerId, filePath || 'Unknown', 'Peer not found');
      return;
    }
    if (!file || !(file instanceof File) || file.size === 0) {
      this.handleError(peerId, filePath || 'Unknown', 'File is empty or invalid');
      return;
    }
  
    const transferId = `${peerId}-${Date.now()}`;
    const chunkSize = 16 * 1024;
    const fileReader = new FileReader();
    let offset = 0;
    let cancelled = false;
  
    const transfer = {
      cancel: () => { cancelled = true },
      pause: () => { this.pausedTransfers.add(transferId) },
      resume: () => { 
        this.pausedTransfers.delete(transferId);
        if (!cancelled) readNextChunk();
      }
    };
  
    this.activeTransfers.set(transferId, transfer);
  
    peer.send(JSON.stringify({ 
      type: 'file-start', 
      transferId,
      fileName: filePath || file.name,
      fileSize: file.size,
      fileType: file.type
    }));
    
    fileReader.onerror = () => {
      this.handleError(peerId, filePath || file.name, 'Error reading file');
      this.activeTransfers.delete(transferId);
    };
  
    fileReader.onload = (e) => {
      if (cancelled) {
        this.activeTransfers.delete(transferId);
        peer.send(JSON.stringify({ type: 'file-cancel', transferId }));
        if (this.onTransferCancelled) {
          this.onTransferCancelled(peerId, filePath || file.name, 'Sender cancelled the transfer');
        }
        return;
      }
      if (this.pausedTransfers.has(transferId)) {
        return;
      }
      try {
        const chunk = e.target.result;
        peer.send(JSON.stringify({ 
          type: 'file-chunk', 
          transferId,
          fileName: filePath || file.name,
          data: Array.from(new Uint8Array(chunk))
        }));
        offset += chunk.byteLength;
        
        const progress = Math.min((offset / file.size) * 100, 100);
        if (this.onFileProgress) {
          this.onFileProgress(peerId, filePath || file.name, progress);
        }
  
        if (offset < file.size) {
          setTimeout(readNextChunk, 0);
        } else {
          peer.send(JSON.stringify({ 
            type: 'file-end', 
            transferId,
            fileName: filePath || file.name,
            fileType: file.type
          }));
          this.activeTransfers.delete(transferId);
        }
      } catch (error) {
        this.handleError(peerId, filePath || file.name, 'Error sending file chunk');
        this.activeTransfers.delete(transferId);
      }
    };
  
    const readNextChunk = () => {
      const slice = file.slice(offset, offset + chunkSize);
      fileReader.readAsArrayBuffer(slice);
    };
  
    readNextChunk();
    return transferId;
  }
  
  pauseTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId)
    if (transfer) {
      transfer.pause()
    }
  }

  resumeTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId)
    if (transfer) {
      transfer.resume()
    }
  }

  cancelTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId)
    if (transfer) {
      transfer.cancel()
      this.activeTransfers.delete(transferId)
    }
  }

  handleError(peerId, fileName, message) {
    console.error(`Error in transfer with peer ${peerId} for file ${fileName}: ${message}`)
    if (this.onTransferError) {
      this.onTransferError(peerId, fileName, message)
    }
  }
}

export default new PeerService()
