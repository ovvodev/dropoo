// src/services/peer.js

import io from 'socket.io-client'
import Peer from 'simple-peer'

class PeerService {
  constructor() {
    this.socket = null
    this.peers = {}
    this.onPeerConnected = null
    this.onPeerDisconnected = null
    this.onFileProgress = null
    this.onFileReceived = null
    this.incomingFiles = {}
    this.onTransferError = null
    this.onTransferCancelled = null
    this.activeTransfers = new Map()
    this.pausedTransfers = new Set()
  }

  init() {
    console.log('Initializing PeerService')
    this.socket = io('http://192.168.8.134:3001')

    this.socket.on('connect', () => {
      console.log('Connected to signaling server with ID:', this.socket.id)
    })
    this.socket.on('connect_error', (error) => {
      console.error('Failed to connect to signaling server:', error)
      // Handle the error, maybe retry connection or notify the user
    })
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from signaling server:', reason)
      if (reason === 'io server disconnect') {
        // The disconnection was initiated by the server, you need to reconnect manually
        this.socket.connect()
      }
      // else the socket will automatically try to reconnect
    })
    this.socket.on('peers', (peerIds) => {
      console.log('Received list of peers:', peerIds)
      peerIds.forEach(peerId => this.createPeer(peerId, true))
    })

    this.socket.on('peer-joined', (peerId) => {
      console.log('New peer joined:', peerId)
      this.createPeer(peerId, false)
    })

    this.socket.on('peer-left', (peerId) => {
      console.log('Peer left:', peerId)
      if (this.peers[peerId]) {
        this.peers[peerId].destroy()
        delete this.peers[peerId]
        if (this.onPeerDisconnected) {
          this.onPeerDisconnected(peerId)
        }
      }
    })

    this.socket.on('signal', (data) => {
      if (this.peers[data.peerId]) {
        this.peers[data.peerId].signal(data.signal)
      }
    })
  }

  createPeer(peerId, initiator) {
    if (this.peers[peerId]) {
      console.log('Peer already exists:', peerId)
      return
    }

    console.log('Creating peer:', peerId, 'initiator:', initiator)
    const peer = new Peer({ initiator })

    peer.on('signal', (signal) => {
      this.socket.emit('signal', { peerId, signal })
    })

    peer.on('connect', () => {
      console.log('Connected to peer:', peerId)
      if (this.onPeerConnected) {
        this.onPeerConnected({ id: peerId })
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
        case 'file-start':
          this.incomingFiles[parsedData.transferId] = {
            peerId,
            fileName: parsedData.fileName,
            fileSize: parsedData.fileSize,
            fileType: parsedData.fileType,
            chunks: []
          }
          break
        
        case 'file-chunk':
          if (this.incomingFiles[parsedData.transferId]) {
            this.incomingFiles[parsedData.transferId].chunks.push(new Uint8Array(parsedData.data))
            const receivedSize = this.incomingFiles[parsedData.transferId].chunks.reduce((total, chunk) => total + chunk.length, 0)
            const progress = (receivedSize / this.incomingFiles[parsedData.transferId].fileSize) * 100
            
            if (this.onFileProgress) {
              this.onFileProgress(peerId, parsedData.fileName, progress)
            }
          }
          break
        
        case 'file-end':
          if (this.incomingFiles[parsedData.transferId]) {
            const file = this.incomingFiles[parsedData.transferId]
            const blob = new Blob(file.chunks, { type: file.fileType })
            const url = URL.createObjectURL(blob)
            
            if (this.onFileReceived) {
              this.onFileReceived(peerId, file.fileName, url, blob.size)
            }
            
            delete this.incomingFiles[parsedData.transferId]
          }
          break
  
        case 'file-cancel':
          if (this.incomingFiles[parsedData.transferId]) {
            delete this.incomingFiles[parsedData.transferId]
            if (this.onTransferCancelled) {
              this.onTransferCancelled(peerId, parsedData.fileName, 'Sender cancelled the transfer')
            }
          }
          break
      }
    } catch (error) {
      this.handleError(peerId, 'Unknown', 'Error processing incoming data')
    }
  }
  
  handlePeerDisconnection(peerId) {
    console.log('Handling peer disconnection:', peerId)
    delete this.peers[peerId]
    if (this.onPeerDisconnected) {
      this.onPeerDisconnected(peerId)
    }
    // Clean up any ongoing transfers with this peer
    this.cleanupTransfers(peerId)
  }
  
  cleanupTransfers(peerId) {
    // Remove any active transfers with this peer
    for (let [transferId] of this.activeTransfers) {
      if (transferId.startsWith(peerId)) {
        this.cancelTransfer(transferId)
      }
    }
    
    // Remove any incoming files from this peer
    for (let transferId in this.incomingFiles) {
      if (this.incomingFiles[transferId].peerId === peerId) {
        delete this.incomingFiles[transferId]
      }
    }
  }
  
  sendFile(peerId, file) {
    const peer = this.peers[peerId]
    if (!peer) {
      this.handleError(peerId, file.name, 'Peer not found')
      return
    }
    if (!file || file.size === 0) {
      this.handleError(peerId, file ? file.name : 'Unknown', 'File is empty or invalid')
      return
    }

    const transferId = `${peerId}-${file.name}-${Date.now()}`
    const chunkSize = 16 * 1024 // 16 KB chunks
    const fileReader = new FileReader()
    let offset = 0
    let cancelled = false

    const transfer = {
      cancel: () => { cancelled = true },
      pause: () => { this.pausedTransfers.add(transferId) },
      resume: () => { 
        this.pausedTransfers.delete(transferId)
        if (!cancelled) readNextChunk()
      }
    }

    this.activeTransfers.set(transferId, transfer)

    peer.send(JSON.stringify({ 
      type: 'file-start', 
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    }))

    fileReader.onerror = () => {
      this.handleError(peerId, file.name, 'Error reading file')
      this.activeTransfers.delete(transferId)
    }

    fileReader.onload = (e) => {
      if (cancelled) {
        this.activeTransfers.delete(transferId)
        peer.send(JSON.stringify({ type: 'file-cancel', transferId }))
        if (this.onTransferCancelled) {
          this.onTransferCancelled(peerId, file.name, 'Sender cancelled the transfer')
        }
        return
      }
      if (this.pausedTransfers.has(transferId)) {
        return // Don't proceed if transfer is paused
      }
      try {
        const chunk = e.target.result
        peer.send(JSON.stringify({ 
          type: 'file-chunk', 
          transferId,
          fileName: file.name,
          data: Array.from(new Uint8Array(chunk))
        }))
        offset += chunk.byteLength
        
        const progress = Math.min((offset / file.size) * 100, 100)
        if (this.onFileProgress) {
          this.onFileProgress(peerId, file.name, progress)
        }

        if (offset < file.size) {
          setTimeout(readNextChunk, 0)
        } else {
          peer.send(JSON.stringify({ 
            type: 'file-end', 
            transferId,
            fileName: file.name,
            fileType: file.type
          }))
          this.activeTransfers.delete(transferId)
        }
      } catch (error) {
        this.handleError(peerId, file.name, 'Error sending file chunk')
        this.activeTransfers.delete(transferId)
      }
    }

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + chunkSize)
      fileReader.readAsArrayBuffer(slice)
    }

    readNextChunk()
    return transferId
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
