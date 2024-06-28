<template>
  <div id="app">
    <h1>Dropoo</h1>
    <div>
      <input type="file" @change="onFileSelected" multiple>
      <button @click="sendFileToAllPeers" :disabled="!selectedFiles.length || !peers.length">
        Send to All Peers
      </button>
    </div>
    <div>
      <h2>Connected Peers</h2>
      <ul>
        <li v-for="peer in peers" :key="peer.id">
          {{ peer.id }}
          <button @click="sendFileToPeer(peer)" :disabled="!selectedFiles.length">
            Send Files
          </button>
        </li>
      </ul>
    </div>
    <div v-if="transfers.length">
      <h2>File Transfers</h2>
      <ul>
        <li v-for="transfer in transfers" :key="transfer.id">
          {{ transfer.fileName }} {{ transfer.incoming ? 'from' : 'to' }} {{ transfer.peerId }} - {{ transfer.progress.toFixed(2) }}%
          <progress :value="transfer.progress" max="100"></progress>
          <button @click="cancelTransfer(transfer)">Cancel</button>
          <button v-if="!transfer.incoming" @click="togglePauseTransfer(transfer)">
            {{ transfer.paused ? 'Resume' : 'Pause' }}
          </button>
        </li>
      </ul>
    </div>
    <div v-if="receivedFiles.length">
      <h2>Received Files</h2>
      <ul>
        <li v-for="file in receivedFiles" :key="`${file.peerId}-${file.fileName}`">
          {{ file.fileName }} from {{ file.peerId }} ({{ formatFileSize(file.size) }})
          <a :href="file.url" :download="file.fileName">Download</a>
        </li>
      </ul>
    </div>
    <div v-if="errors.length">
      <h2>Errors</h2>
      <ul>
        <li v-for="error in errors" :key="`${error.peerId}-${error.fileName}`">
          Error transferring {{ error.fileName }} with peer {{ error.peerId }}: {{ error.message }}
          <button @click="retryTransfer(error)">Retry</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import PeerService from './services/peer'

export default {
  name: 'App',
  data() {
    return {
      selectedFiles: [],
      peers: [],
      transfers: [],
      receivedFiles: [],
      errors: []
    }
  },
  mounted() {
    console.log('App mounted, initializing PeerService')
    PeerService.init()
    PeerService.onPeerConnected = this.addPeer
    PeerService.onPeerDisconnected = this.handlePeerDisconnected
    PeerService.onFileProgress = this.updateFileProgress
    PeerService.onFileReceived = this.addReceivedFile
    PeerService.onTransferError = this.handleTransferError
    PeerService.onTransferCancelled = this.handleTransferCancelled
  },
  methods: {
    onFileSelected(event) {
      this.selectedFiles = Array.from(event.target.files)
    },
    sendFileToAllPeers() {
      this.peers.forEach(peer => this.sendFileToPeer(peer))
    },
    sendFileToPeer(peer) {
      this.selectedFiles.forEach(file => {
        const transferId = PeerService.sendFile(peer.id, file)
        this.transfers.push({ 
          id: transferId,
          peerId: peer.id, 
          fileName: file.name, 
          progress: 0, 
          incoming: false,
          paused: false
        })
      })
    },
    handlePeerDisconnected(peerId) {
      // Remove the peer from the list of connected peers
      this.peers = this.peers.filter(peer => peer.id !== peerId)

      // Update any ongoing transfers
      this.transfers = this.transfers.filter(transfer => {
        if (transfer.peerId === peerId) {
          // Notify the user that the transfer was interrupted
          this.$toast.error(`Transfer of ${transfer.fileName} interrupted: Peer disconnected`)
          return false
        }
        return true
      })
    },

    togglePauseTransfer(transfer) {
      if (transfer.paused) {
        PeerService.resumeTransfer(transfer.id)
        transfer.paused = false
      } else {
        PeerService.pauseTransfer(transfer.id)
        transfer.paused = true
      }
    },
    cancelTransfer(transfer) {
      if (!transfer.incoming) {
        PeerService.cancelTransfer(transfer.id)
      }
      this.transfers = this.transfers.filter(t => t.id !== transfer.id)
    },
    handleTransferCancelled(peerId, fileName, reason) {
      this.transfers = this.transfers.filter(t => !(t.peerId === peerId && t.fileName === fileName))
      alert(`Transfer of ${fileName} with peer ${peerId} was cancelled: ${reason}`)
    },
    addPeer(peer) {
      if (!this.peers.some(p => p.id === peer.id)) {
        this.peers.push(peer)
      }
    },
    removePeer(peerId) {
      this.peers = this.peers.filter(p => p.id !== peerId)
      this.transfers = this.transfers.filter(t => t.peerId !== peerId)
    },
    updateFileProgress(peerId, fileName, progress) {
      const transfer = this.transfers.find(t => t.peerId === peerId && t.fileName === fileName)
      if (transfer) {
        transfer.progress = progress
      }
    },

    addReceivedFile(peerId, fileName, url, size) {
      this.receivedFiles.push({ peerId, fileName, url, size })
      // Remove the transfer from the list
      this.transfers = this.transfers.filter(t => !(t.peerId === peerId && t.fileName === fileName))
    },
    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' bytes'
      else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB'
      else if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + ' MB'
      else return (bytes / 1073741824).toFixed(2) + ' GB'
    },
    handleTransferError(peerId, fileName, message) {
      this.errors.push({ peerId, fileName, message })
      // Remove the failed transfer from the transfers list
      this.transfers = this.transfers.filter(t => !(t.peerId === peerId && t.fileName === fileName))
    },

    retryTransfer(error) {
      const file = this.selectedFiles.find(f => f.name === error.fileName)
      if (file) {
        PeerService.sendFile(error.peerId, file)
        this.transfers.push({ peerId: error.peerId, fileName: file.name, progress: 0, incoming: false })
        this.errors = this.errors.filter(e => !(e.peerId === error.peerId && e.fileName === error.fileName))
      } else {
        alert('File no longer available for retry. Please select the file again.')
      }
    }
  }
}
</script>


<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
