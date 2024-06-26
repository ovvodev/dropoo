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
        <li v-for="transfer in transfers" :key="`${transfer.peerId}-${transfer.fileName}`">
          {{ transfer.fileName }} {{ transfer.incoming ? 'from' : 'to' }} {{ transfer.peerId }} - {{ transfer.progress.toFixed(2) }}%
          <progress :value="transfer.progress" max="100"></progress>
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
      receivedFiles: []
    }
  },
  mounted() {
    console.log('App mounted, initializing PeerService')
    PeerService.init()
    PeerService.onPeerConnected = this.addPeer
    PeerService.onPeerDisconnected = this.removePeer
    PeerService.onFileProgress = this.updateFileProgress
    PeerService.onFileReceived = this.addReceivedFile
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
        PeerService.sendFile(peer.id, file)
        this.transfers.push({ peerId: peer.id, fileName: file.name, progress: 0, incoming: false })
      })
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
      } else {
        this.transfers.push({ peerId, fileName, progress, incoming: true })
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
