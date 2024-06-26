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
  }

  init() {
    console.log('Initializing PeerService')
    this.socket = io('http://localhost:3001')

    this.socket.on('connect', () => {
      console.log('Connected to signaling server with ID:', this.socket.id)
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
      console.log('Disconnected from peer:', peerId)
      delete this.peers[peerId]
      if (this.onPeerDisconnected) {
        this.onPeerDisconnected(peerId)
      }
    })

    this.peers[peerId] = peer
  }

  handleIncomingData(peerId, data) {
    const parsedData = JSON.parse(data.toString())
    
    switch(parsedData.type) {
      case 'file-start':
        this.incomingFiles[peerId] = {
          fileName: parsedData.fileName,
          fileSize: parsedData.fileSize,
          fileType: parsedData.fileType,
          chunks: []
        }
        break
      
      case 'file-chunk':
        if (this.incomingFiles[peerId]) {
          this.incomingFiles[peerId].chunks.push(new Uint8Array(parsedData.data))
          const receivedSize = this.incomingFiles[peerId].chunks.reduce((total, chunk) => total + chunk.length, 0)
          const progress = (receivedSize / this.incomingFiles[peerId].fileSize) * 100
          
          if (this.onFileProgress) {
            this.onFileProgress(peerId, parsedData.fileName, progress)
          }
        }
        break
      
      case 'file-end':
        if (this.incomingFiles[peerId]) {
          const file = this.incomingFiles[peerId]
          const blob = new Blob(file.chunks, { type: file.fileType })
          const url = URL.createObjectURL(blob)
          
          if (this.onFileReceived) {
            this.onFileReceived(peerId, file.fileName, url, blob.size)
          }
          
          delete this.incomingFiles[peerId]
        }
        break
    }
  }

  sendFile(peerId, file) {
    const peer = this.peers[peerId]
    if (!peer) {
      console.error('Peer not found:', peerId)
      return
    }

    const chunkSize = 16 * 1024 // 16 KB chunks
    const fileReader = new FileReader()
    let offset = 0

    peer.send(JSON.stringify({ 
      type: 'file-start', 
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    }))

    fileReader.onload = (e) => {
      const chunk = e.target.result
      peer.send(JSON.stringify({ 
        type: 'file-chunk', 
        fileName: file.name,
        data: Array.from(new Uint8Array(chunk))
      }))
      offset += chunk.byteLength
      
      const progress = Math.min((offset / file.size) * 100, 100)
      if (this.onFileProgress) {
        this.onFileProgress(peerId, file.name, progress)
      }

      if (offset < file.size) {
        readNextChunk()
      } else {
        peer.send(JSON.stringify({ 
          type: 'file-end', 
          fileName: file.name,
          fileType: file.type
        }))
      }
    }

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + chunkSize)
      fileReader.readAsArrayBuffer(slice)
    }

    readNextChunk()
  }
}

export default new PeerService()
