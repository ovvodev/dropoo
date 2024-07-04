<template>
  <div class="min-h-screen py-12 flex flex-col items-center font-mono text-gray-900">
    <h1 class="text-3xl font-semibold mb-10">Dropoo</h1>
    
    <!-- File selection -->
    <div class="mb-10 flex space-x-4">
      <input
        type="file"
        ref="fileInput"
        @change="onItemsSelected"
        multiple
        webkitdirectory
        class="hidden"
      >
      <button 
        @click="triggerFileInput"
        class="border border-gray-300 text-gray-700 py-2 px-6 rounded hover:bg-gray-100 transition duration-200"
      >
        Select Files
      </button>
      <button 
        @click="sendFileToAllPeers" 
        :disabled="!selectedFiles.length || !otherPeers.length || isZipping"
        class="border border-gray-300 text-gray-700 py-2 px-6 rounded hover:bg-gray-100 disabled:opacity-50 transition duration-200"
      >
        {{ isZipping ? 'Zipping Files...' : 'Send to All' }}
      </button>
    </div>
  <!-- Me Section -->
  <div class="w-full max-w-md mb-6">
        <h2 class="text-2xl font-semibold mb-4 text-center">Me</h2>
        <div class="border border-gray-200 p-6 rounded-lg shadow-md flex items-center">
          <PeerAvatar v-if="myPeerId" :seed="myPeerId" />
          <strong class="text-lg ml-4">{{ myPeerName || 'Connecting...' }}</strong>
        </div>
    </div>
   <!-- Connected Peers and Transfers -->
   <div class="w-full max-w-md mb-10">
      <h2 class="text-2xl font-semibold mb-6 text-center">Connected Peers</h2>
      <div v-if="otherPeers.length" class="space-y-6">
        <div v-for="peer in otherPeers" :key="peer.id" class="border border-gray-200 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300">
          <div class="flex items-center mb-4">
            <PeerAvatar :seed="peer.id" />
            <strong class="text-lg ml-4">{{ peer.name }}</strong>
            <button
              @click="sendFileToPeer(peer)"
              :disabled="!selectedFiles.length || isZipping"
              class="border border-gray-300 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-100 disabled:opacity-50 transition duration-200"
            >
              {{ isZipping ? 'Zipping...' : 'Send' }}
            </button>
          </div>
          <ul v-if="getActiveTransfersForPeer(peer.id).length" class="space-y-4">
            <li v-for="transfer in getActiveTransfersForPeer(peer.id)" :key="transfer.id" class="text-sm">
              <div class="flex items-center mb-2">
                <span class="mr-2 truncate" style="max-width: 200px;">{{ transfer.fileName }}</span>
                <span class="ml-auto">{{ transfer.progress.toFixed(0) }}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div class="bg-gray-600 h-2 rounded-full" :style="{ width: `${transfer.progress}%` }"></div>
              </div>
              <div class="flex justify-end space-x-4">
                <button v-if="!transfer.completed" @click="cancelTransfer(transfer)" class="text-sm text-gray-500 hover:text-gray-700 transition duration-200">Cancel</button>
                <button v-if="!transfer.incoming && !transfer.completed" @click="togglePauseTransfer(transfer)" class="text-sm text-gray-500 hover:text-gray-700 transition duration-200">
                  {{ transfer.paused ? 'Resume' : 'Pause' }}
                </button>
                <span v-if="transfer.completed" class="text-sm text-green-500">Completed</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
      <p v-else class="text-center text-gray-500">No other peers connected</p>
    </div>

    <!-- Received Files -->
    <div v-if="receivedFiles.length" class="w-full max-w-md mb-10">
      <h2 class="text-2xl font-semibold mb-6 text-center">Received Files</h2>
      <ul class="space-y-4 text-sm">
        <li v-for="file in receivedFiles" :key="`${file.peerId}-${file.fileName}`" class="flex justify-between items-center p-4 rounded-lg shadow-md">
          <span class="truncate" style="max-width: 200px;">{{ file.fileName }}</span>
          <a :href="file.url" :download="file.fileName" @click="markFileAsDownloaded(file)" class="border border-gray-300 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-100 transition duration-200">Download</a>
        </li>
      </ul>
    </div>

    <!-- Errors -->
    <div v-if="errors.length" class="w-full max-w-md">
      <h2 class="text-2xl font-semibold mb-6 text-center">Errors</h2>
      <ul class="space-y-4 text-sm">
        <li v-for="error in errors" :key="`${error.peerId}-${error.fileName}`" class="flex justify-between items-center p-4 rounded-lg shadow-md">
          <span class="truncate" style="max-width: 200px;">Error: {{ error.fileName }}</span>
          <button @click="retryTransfer(error)" class="border border-gray-300 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-100 transition duration-200">Retry</button>
        </li>
      </ul>
    </div>
  </div>
</template>


<script>
import PeerService from './services/peer'
import JSZip from 'jszip';
import PeerAvatar from './components/PeerAvatar'

export default {
  name: 'App',
  components: {
    PeerAvatar,
  },
  data() {
    return {
      selectedFiles: [],
      peers: [],
      transfers: [],
      receivedFiles: [],
      errors: [],
      isZipping: false,
      myPeerId: null,
      myPeerName: '',
    }
  },
  beforeUnmount() {
    // Clean up connections before the component is destroyed
    PeerService.cleanup();
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
      PeerService.onPeerIdAssigned = (peerId) => {
        this.myPeerId = peerId;
        this.myPeerName = `Me (${PeerService.formatPeerName(PeerService.deviceInfo)})`;
      }
    } catch (error) {
      console.error('Error initializing PeerService:', error)
    }
  },
  methods: {
    addPeer(peer) {
      console.log("Adding peer:", peer);
      const existingPeerIndex = this.peers.findIndex(p => p.id === peer.id);
      if (existingPeerIndex !== -1) {
        // Update existing peer
        this.$set(this.peers, existingPeerIndex, peer);
      } else {
        // Add new peer
        this.peers.push(peer);
      }
      // Remove any duplicates
      this.peers = Array.from(new Set(this.peers.map(p => JSON.stringify(p))))
        .map(p => JSON.parse(p));
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
    async sendFileToAllPeers() {
      for (const peer of this.otherPeers) {
        await this.sendFileToPeer(peer);
      }
    },
    async sendFileToPeer(peer) {
      if (this.selectedFiles.length > 5) {
        await this.sendZippedFilesToPeer(peer);
      } else {
        this.sendIndividualFilesToPeer(peer);
      }
    },
    async sendZippedFilesToPeer(peer) {
      this.isZipping = true;
      const zip = new JSZip();
      const zipFileName = `dropoo_files_${new Date().toISOString()}.zip`;

      this.selectedFiles.forEach(item => {
        const file = item.file || item;
        const filePath = item.path || file.name;
        zip.file(filePath, file);
      });

      try {
        const content = await zip.generateAsync({type: 'blob'});
        const zippedFile = new File([content], zipFileName, {type: 'application/zip'});
        await this.sendSingleFileToPeer(peer, zippedFile, zipFileName);
      } catch (error) {
        console.error('Error creating zip file:', error);
        this.handleError(peer.id, zipFileName, 'Error creating zip file');
      } finally {
        this.isZipping = false;
      }
    },
    sendIndividualFilesToPeer(peer) {
      this.selectedFiles.forEach(item => {
        if (item.file && item.file instanceof File) {
          this.sendSingleFileToPeer(peer, item.file, item.path);
        } else if (item instanceof File) {
          this.sendSingleFileToPeer(peer, item, item.name);
        } else {
          console.error('Invalid file object:', item);
          this.handleError(peer.id, 'Unknown file', 'Invalid file object');
        }
      });
    },
    async sendSingleFileToPeer(peer, file, filePath) {
      const transferId = PeerService.sendFile(peer.id, file, filePath);
      const newTransfer = { 
        id: transferId,
        peerId: peer.id, 
        fileName: filePath || file.name, 
        progress: 0, 
        incoming: false,
        paused: false,
        completed: false
      };
      this.transfers.push(newTransfer);
      
      // Set up an interval to check for completion
      const checkInterval = setInterval(() => {
        if (newTransfer.progress >= 100 && !newTransfer.completed) {
          newTransfer.completed = true;
          clearInterval(checkInterval);
          this.handleCompletedTransfer(newTransfer);
        }
      }, 100); // Check every 100ms
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
    handleCompletedTransfer(transfer) {
      // Keep the completed transfer visible for 2 seconds before removing
      setTimeout(() => {
        this.transfers = this.transfers.filter(t => t !== transfer);
      }, 2000);
    },
    updateFileProgress(peerId, fileName, progress) {
      const transfer = this.transfers.find(t => t.peerId === peerId && t.fileName === fileName);
      if (transfer) {
        transfer.progress = progress;
      }
    },
    getActiveTransfersForPeer(peerId) {
      return this.transfers.filter(transfer => 
        transfer.peerId === peerId && (!transfer.completed || transfer.progress < 100)
      );
    },
    markFileAsDownloaded(file) {
      // Remove the file from receivedFiles after a short delay
      setTimeout(() => {
        this.receivedFiles = this.receivedFiles.filter(f => f !== file);
      }, 1000);
    },
    addReceivedFile(peerId, fileName, url, size) {
      this.receivedFiles.push({ peerId, fileName, url, size });
      // Remove any related transfer
      this.transfers = this.transfers.filter(t => !(t.peerId === peerId && t.fileName === fileName));
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
  },
  computed: {
    otherPeers() {
      return this.peers.filter(peer => peer.id !== this.myPeerId);
    }
  },
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
