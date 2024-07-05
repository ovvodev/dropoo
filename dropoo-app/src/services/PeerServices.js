import Peer from 'simple-peer'

class PeerService {
  constructor() {
    this.ws = null
    this.peers = {}
    this.onPeerConnected = null
    this.onPeerDisconnected = null
    this.onFileProgress = null
    this.onFileReceived = null
    this.onTransferError = null
    this.onTransferCancelled = null
    this.onRoomCreated = null
    this.onPeerIdAssigned = null
    this.clientId = null
    this.room = null
    this.transfers = new Map()
  }

  init() {
    this.ws = new WebSocket('ws://localhost:3000')
    this.room = this.generateRoomId()

    this.ws.onopen = () => {
      console.log('Connected to signaling server')
      this.ws.send(JSON.stringify({ type: 'join', room: this.room }))
      if (this.onRoomCreated) {
        this.onRoomCreated(this.room)
      }
    }

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'peers') {
        data.peers.forEach(peerId => {
          if (peerId !== this.clientId && !this.peers[peerId]) {
            this.createPeer(peerId, true)
          }
        })
      } else if (data.type === 'signal') {
        if (this.peers[data.sender]) {
          this.peers[data.sender].signal(data.signal)
        }
      } else if (data.type === 'id-assigned') {
        this.clientId = data.id
        if (this.onPeerIdAssigned) {
          this.onPeerIdAssigned(this.clientId)
        }
      }
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    this.ws.onclose = () => {
      console.log('Disconnected from signaling server')
    }
  }

  createPeer(peerId, initiator) {
    const peer = new Peer({ initiator })

    peer.on('signal', (signal) => {
      this.ws.send(JSON.stringify({ type: 'signal', target: peerId, signal }))
    })

    peer.on('connect', () => {
      console.log('Connected to peer:', peerId)
      if (this.onPeerConnected) {
        this.onPeerConnected(peerId)
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

  sendFile(peerId, file) {
    const peer = this.peers[peerId]
    if (!peer) {
      console.error('Peer not found:', peerId)
      return
    }

    const transferId = `${peerId}-${Date.now()}`
    const chunkSize = 16 * 1024 // 16 KB chunks
    const fileReader = new FileReader()
    let offset = 0

    const transfer = {
      file,
      offset,
      paused: false,
      cancelled: false
    }

    this.transfers.set(transferId, transfer)

    const sendChunk = () => {
      if (transfer.cancelled) {
        this.transfers.delete(transferId)
        peer.send(JSON.stringify({ type: 'file-cancel', transferId }))
        if (this.onTransferCancelled) {
          this.onTransferCancelled(peerId, file.name, 'Sender cancelled the transfer')
        }
        return
      }

      if (transfer.paused) {
        return
      }

      const slice = file.slice(offset, offset + chunkSize)
      fileReader.readAsArrayBuffer(slice)
    }

    fileReader.onload = (e) => {
      const chunk = e.target.result
      peer.send(JSON.stringify({
        type: 'file-chunk',
        transferId,
        fileName: file.name,
        fileType: file.type,
        data: Array.from(new Uint8Array(chunk))
      }))

      offset += chunk.byteLength
      transfer.offset = offset
      const progress = Math.min((offset / file.size) * 100, 100)
      if (this.onFileProgress) {
        this.onFileProgress(peerId, file.name, progress)
      }

      if (offset < file.size) {
        sendChunk()
      } else {
        peer.send(JSON.stringify({ type: 'file-end', transferId, fileName: file.name }))
        this.transfers.delete(transferId)
      }
    }

    peer.send(JSON.stringify({
      type: 'file-start',
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    }))

    sendChunk()
    return transferId
  }

  handleIncomingData(peerId, data) {
    const parsedData = JSON.parse(data)
    switch(parsedData.type) {
      case 'file-start':
        this.incomingFile = {
          transferId: parsedData.transferId,
          name: parsedData.fileName,
          size: parsedData.fileSize,
          type: parsedData.fileType,
          data: []
        }
        break
      case 'file-chunk':
        if (this.incomingFile && this.incomingFile.transferId === parsedData.transferId) {
          this.incomingFile.data.push(new Uint8Array(parsedData.data))
          const progress = (this.incomingFile.data.reduce((total, chunk) => total + chunk.length, 0) / this.incomingFile.size) * 100
          if (this.onFileProgress) {
            this.onFileProgress(peerId, this.incomingFile.name, progress)
          }
        }
        break
      case 'file-end':
        if (this.incomingFile && this.incomingFile.transferId === parsedData.transferId) {
          const blob = new Blob(this.incomingFile.data, { type: this.incomingFile.type })
          const url = URL.createObjectURL(blob)
          if (this.onFileReceived) {
            this.onFileReceived(peerId, this.incomingFile.name, url, blob.size)
          }
          this.incomingFile = null
        }
        break
      case 'file-cancel':
        if (this.incomingFile && this.incomingFile.transferId === parsedData.transferId) {
          if (this.onTransferCancelled) {
            this.onTransferCancelled(peerId, this.incomingFile.name, 'Sender cancelled the transfer')
          }
          this.incomingFile = null
        }
        break
    }
  }

  pauseTransfer(transferId) {
    const transfer = this.transfers.get(transferId)
    if (transfer) {
      transfer.paused = true
    }
  }

  resumeTransfer(transferId) {
    const transfer = this.transfers.get(transferId)
    if (transfer) {
      transfer.paused = false
      this.sendFile(transferId.split('-')[0], transfer.file)
    }
  }

  cancelTransfer(transferId) {
    const transfer = this.transfers.get(transferId)
    if (transfer) {
      transfer.cancelled = true
    }
  }

  generateRoomId() {
    return Math.random().toString(36).substring(2, 15)
  }

  cleanup() {
    if (this.ws) {
      this.ws.close()
    }
    Object.values(this.peers).forEach(peer => peer.destroy())
    this.peers = {}
    this.transfers.clear()
  }
}

export default new PeerService()
