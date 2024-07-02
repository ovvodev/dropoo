<template>
  <div id="app">
    <h1>Dropoo</h1>
    <div>
      <input
        type="file"
        ref="fileInput"
        @change="onItemsSelected"
        multiple
        webkitdirectory
        style="display: none"
      >
      <button @click="triggerFileInput">Select Files or Folders</button>
      <button @click="sendFileToAllPeers" :disabled="!selectedFiles.length || !peers.length">
        Send to All Peers
      </button>
    </div>
    <div>
      <h2>Connected Peers and Transfers</h2>
      <ul>
        <li v-for="peer in peers" :key="peer.id">
          <div>
            <strong>{{ peer.name }}</strong>
            <button 
              v-if="!peer.name.startsWith('Me')" 
              @click="sendFileToPeer(peer)" 
              :disabled="!selectedFiles.length"
            >
              Send Files
            </button>
          </div>
          <ul v-if="getTransfersForPeer(peer.id).length">
            <li v-for="transfer in getTransfersForPeer(peer.id)" :key="transfer.id">
              {{ transfer.fileName }} - {{ transfer.progress.toFixed(2) }}%
              <progress :value="transfer.progress" max="100"></progress>
              <button @click="cancelTransfer(transfer)">Cancel</button>
              <button v-if="!transfer.incoming" @click="togglePauseTransfer(transfer)">
                {{ transfer.paused ? 'Resume' : 'Pause' }}
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </div>
    <div v-if="receivedFiles.length">
      <h2>Received Files</h2>
      <ul>
        <li v-for="file in receivedFiles" :key="`${file.peerId}-${file.fileName}`">
          {{ file.fileName }} from {{ getPeerName(file.peerId) }} ({{ formatFileSize(file.size) }})
          <a :href="file.url" :download="file.fileName">Download</a>
        </li>
      </ul>
    </div>
    <div v-if="errors.length">
      <h2>Errors</h2>
      <ul>
        <li v-for="error in errors" :key="`${error.peerId}-${error.fileName}`">
          Error transferring {{ error.fileName }} with peer {{ getPeerName(error.peerId) }}: {{ error.message }}
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
    try {
      PeerService.init()
      PeerService.onPeerConnected = this.addPeer
      PeerService.onPeerDisconnected = this.handlePeerDisconnected
      PeerService.onFileProgress = this.updateFileProgress
      PeerService.onFileReceived = this.addReceivedFile
      PeerService.onTransferError = this.handleTransferError
      PeerService.onTransferCancelled = this.handleTransferCancelled
    } catch (error) {
      console.error('Error initializing PeerService:', error)
    }
  },
  methods: {
    addPeer(peer) {
      console.log("Adding peer:", peer)
      const existingPeerIndex = this.peers.findIndex(p => p.id === peer.id)
      if (existingPeerIndex !== -1) {
        // Update existing peer
        this.$set(this.peers, existingPeerIndex, peer)
      } else {
        // Add new peer
        this.peers.push(peer)
      }
    },
    getTransfersForPeer(peerId) {
      return this.transfers.filter(transfer => transfer.peerId === peerId);
    },

    getPeerName(peerId) {
      const peer = this.peers.find(p => p.id === peerId);
      return peer ? peer.name : 'Unknown Peer';
    },
    triggerFileInput() {
      this.$refs.fileInput.click();
    },
    onItemsSelected(event) {
      const files = Array.from(event.target.files);
      this.selectedFiles = files.map(file => ({
        file,
        path: file.webkitRelativePath || file.name
      }));
    },
    sendFileToAllPeers() {
      this.peers.forEach(peer => this.sendFileToPeer(peer))
    },
    sendFileToPeer(peer) {
      this.selectedFiles.forEach(item => {
        const transferId = PeerService.sendFile(peer.id, item.file, item.path)
        this.transfers.push({ 
          id: transferId,
          peerId: peer.id, 
          fileName: item.path, 
          progress: 0, 
          incoming: false,
          paused: false
        })
      })
    },
    handlePeerDisconnected(peerId) {
      this.peers = this.peers.filter(peer => peer.id !== peerId)
      this.transfers = this.transfers.filter(transfer => {
        if (transfer.peerId === peerId) {
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
      this.receivedFiles.push({ peerId, fileName, url, size });
      // Remove any related transfers
      this.transfers = this.transfers.filter(t => {
        if (fileName.endsWith('.zip')) {
          return !(t.peerId === peerId && t.fileName.startsWith(fileName.slice(0, -4)));
        }
        return !(t.peerId === peerId && t.fileName === fileName);
      });
    },
    formatFileSize(bytes) {
      const units = ['bytes', 'KB', 'MB', 'GB']
      let unitIndex = 0
      let size = bytes
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
      }
      return `${size.toFixed(2)} ${units[unitIndex]}`
    },
    handleTransferError(peerId, fileName, message) {
      this.errors.push({ peerId, fileName, message })
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
