<template>
  <div class="min-h-screen py-12 flex flex-col items-center font-mono text-gray-900">
    <!-- Notification area -->
    <div class="fixed top-4 right-4 z-50">
      <transition-group name="fade">
        <div v-for="notification in notifications" :key="notification.id"
             class="mb-2 p-4 rounded-md shadow-md max-w-md"
             :class="notification.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'">
          {{ notification.message }}
        </div>
      </transition-group>
    </div>

    <!-- Header -->
    <h1 class="text-3xl font-semibold mb-10">Dropoo</h1>
    
    <!-- Me Section -->
    <div class="w-full max-w-md mb-6">
      <h2 class="text-2xl font-semibold mb-4 text-center">Me</h2>
      <div class="border border-gray-200 p-4 pt-8 pb-8 pl-10 rounded-lg shadow-md relative overflow-visible bg-gray-50">
        <RandomAvatar v-if="myPeerId" :seed="myPeerId" :size="170" />
        <strong class="text-lg block mb-2 ml-16 ">{{ myGreekName }}</strong>
        <p class="text-xs ml-16 mb-4 inline-block">{{ myPeerName || 'Connecting...' }}</p>
        
        <!-- Received Files -->
        <div v-if="receivedFiles.length" class="mt-6">
          <h3 class="text-lg font-semibold mb-2">Received Files</h3>
          <ul class="space-y-2 text-sm">
            <li v-for="file in receivedFiles" :key="`${file.peerId}-${file.fileName}`" class="flex justify-between items-center">
              <span class="truncate" style="max-width: 200px;">{{ file.fileName }}</span>
              <a :href="file.url" :download="file.fileName" @click="markFileAsDownloaded(file)" 
                 class="border border-gray-300 text-gray-700 py-1 px-2 rounded text-xs hover:bg-gray-100 transition duration-200">
                Download
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
    
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

    <!-- Connected Peers and Transfers -->
    <div class="w-full max-w-md mb-10">
      <h2 class="text-2xl font-semibold mb-6 text-center">Connected Peers</h2>
      <div v-if="otherPeers.length" class="space-y-6">
        <div v-for="peer in otherPeers" :key="peer.id" class="border border-gray-200 p-4 pt-8 pb-8 pl-10 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 relative overflow-visible bg-gray-50">
          <RandomAvatar :seed="peer.id" :size="170" :aria-label="peer.greekName" />
          <div class="ml-16 mt-8">
            <strong v-if="peer.greekName" class="text-lg block mb-2">{{ peer.greekName }}</strong>
            <p v-if="peer.deviceInfo" class="text-xs block mb-4">{{ peer.deviceInfo }}</p>
            <button
              @click="sendFileToPeer(peer)"
              :disabled="!selectedFiles.length || isZipping"
              class="border border-gray-300 text-gray-700 py-2 px-4 rounded text-sm hover:bg-gray-100 disabled:opacity-50 transition duration-200"
            >
              {{ isZipping ? 'Zipping...' : 'Send' }}
            </button>
          </div>
          <ul v-if="getActiveTransfersForPeer(peer.id).length" class="space-y-4 mt-6 ml-16">
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


<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import PeerService from './services/peer'
import JSZip from 'jszip'
import RandomAvatar from './components/RandomAvatar.vue'

// Reactive state
const selectedFiles = ref([])
const peers = ref([])
const transfers = ref([])
const receivedFiles = ref([])
const errors = ref([])
const isZipping = ref(false)
const myPeerId = ref(null)
const myPeerName = ref('')
const myGreekName = ref('')
const notifications = ref([])

// Computed properties
const otherPeers = computed(() => {
  return peers.value.filter(peer => peer.id !== myPeerId.value)
})

// Methods
const addNotification = (message, type = 'success') => {
  const id = Date.now()
  notifications.value.push({ id, message, type })
  setTimeout(() => {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }, 5000)
}

const addPeer = (peer) => {
  console.log("Adding peer:", peer)
  const existingPeerIndex = peers.value.findIndex(p => p.id === peer.id)
  if (existingPeerIndex !== -1) {
    // Update existing peer
    peers.value[existingPeerIndex] = { ...peers.value[existingPeerIndex], ...peer }
  } else {
    // Add new peer
    peers.value.push(peer)
  }
  // Remove any duplicates
  peers.value = Array.from(new Set(peers.value.map(p => JSON.stringify(p))))
    .map(p => JSON.parse(p))
}

const triggerFileInput = () => {
  document.querySelector('input[type="file"]').click()
}

const onItemsSelected = (event) => {
  const files = Array.from(event.target.files)
  selectedFiles.value = files.map(file => ({
    file,
    path: file.webkitRelativePath || file.name
  }))
}

const sendFileToAllPeers = async () => {
  for (const peer of otherPeers.value) {
    await sendFileToPeer(peer)
  }
}

const sendFileToPeer = async (peer) => {
  if (selectedFiles.value.length > 5) {
    await sendZippedFilesToPeer(peer)
  } else {
    sendIndividualFilesToPeer(peer)
  }
  addNotification(`Started file transfer to ${peer.name}`)
}

const sendZippedFilesToPeer = async (peer) => {
  isZipping.value = true
  const zip = new JSZip()
  const zipFileName = `dropoo_files_${new Date().toISOString()}.zip`

  selectedFiles.value.forEach(item => {
    const file = item.file || item
    const filePath = item.path || file.name
    zip.file(filePath, file)
  })

  try {
    const content = await zip.generateAsync({type: 'blob'})
    const zippedFile = new File([content], zipFileName, {type: 'application/zip'})
    await sendSingleFileToPeer(peer, zippedFile, zipFileName)
  } catch (error) {
    console.error('Error creating zip file:', error)
    handleError(peer.id, zipFileName, 'Error creating zip file')
  } finally {
    isZipping.value = false
  }
}

const sendIndividualFilesToPeer = (peer) => {
  selectedFiles.value.forEach(item => {
    if (item.file && item.file instanceof File) {
      sendSingleFileToPeer(peer, item.file, item.path)
    } else if (item instanceof File) {
      sendSingleFileToPeer(peer, item, item.name)
    } else {
      console.error('Invalid file object:', item)
      handleError(peer.id, 'Unknown file', 'Invalid file object')
    }
  })
}

const sendSingleFileToPeer = async (peer, file, filePath) => {
  const transferId = PeerService.sendFile(peer.id, file, filePath)
  const newTransfer = {
    id: transferId,
    peerId: peer.id,
    fileName: filePath || file.name,
    progress: 0,
    incoming: false,
    paused: false,
    completed: false
  }
  transfers.value.push(newTransfer)
  
  // Set up an interval to check for completion
  const checkInterval = setInterval(() => {
    if (newTransfer.progress >= 100 && !newTransfer.completed) {
      newTransfer.completed = true
      clearInterval(checkInterval)
      handleCompletedTransfer(newTransfer)
    }
  }, 100) // Check every 100ms
}

const handlePeerDisconnected = (peerId) => {
  peers.value = peers.value.filter(peer => peer.id !== peerId)
  transfers.value = transfers.value.filter(transfer => {
    if (transfer.peerId === peerId) {
      addNotification(`Transfer of ${transfer.fileName} interrupted: Peer disconnected`, 'error')
      return false
    }
    return true
  })
}

const togglePauseTransfer = (transfer) => {
  if (transfer.paused) {
    PeerService.resumeTransfer(transfer.id)
    transfer.paused = false
    addNotification(`Resumed transfer of ${transfer.fileName}`)
  } else {
    PeerService.pauseTransfer(transfer.id)
    transfer.paused = true
    addNotification(`Paused transfer of ${transfer.fileName}`)
  }
}

const cancelTransfer = (transfer) => {
  if (!transfer.incoming) {
    PeerService.cancelTransfer(transfer.id)
  }
  transfers.value = transfers.value.filter(t => t.id !== transfer.id)
  addNotification(`Cancelled transfer of ${transfer.fileName}`, 'error')
}

const handleTransferCancelled = (peerId, fileName, reason) => {
  transfers.value = transfers.value.filter(t => !(t.peerId === peerId && t.fileName === fileName))
  alert(`Transfer of ${fileName} with peer ${peerId} was cancelled: ${reason}`)
}

const handleCompletedTransfer = (transfer) => {
  // Keep the completed transfer visible for 2 seconds before removing
  setTimeout(() => {
    addNotification(`Transfer of ${transfer.fileName} completed successfully`)
    transfers.value = transfers.value.filter(t => t !== transfer)
  }, 2000)
}

const updateFileProgress = (peerId, fileName, progress) => {
  const transfer = transfers.value.find(t => t.peerId === peerId && t.fileName === fileName)
  if (transfer) {
    transfer.progress = progress
  }
}

const getActiveTransfersForPeer = (peerId) => {
  return transfers.value.filter(transfer => 
    transfer.peerId === peerId && (!transfer.completed || transfer.progress < 100)
  )
}

const markFileAsDownloaded = (file) => {
  // Remove the file from receivedFiles after a short delay
  setTimeout(() => {
    receivedFiles.value = receivedFiles.value.filter(f => f !== file)
  }, 1000)
}

const addReceivedFile = (peerId, fileName, url, size) => {
  receivedFiles.value.push({ peerId, fileName, url, size })
  // Remove any related transfer
  transfers.value = transfers.value.filter(t => !(t.peerId === peerId && t.fileName === fileName))
}

const handleTransferError = (peerId, fileName, message) => {
  errors.value.push({ peerId, fileName, message })
  addNotification(`Error in transfer with peer ${peerId} for file ${fileName}: ${message}`, 'error')
  transfers.value = transfers.value.filter(t => !(t.peerId === peerId && t.fileName === fileName))
}

const retryTransfer = (error) => {
  const file = selectedFiles.value.find(f => f.name === error.fileName)
  if (file) {
    PeerService.sendFile(error.peerId, file)
    transfers.value.push({ peerId: error.peerId, fileName: file.name, progress: 0, incoming: false })
    errors.value = errors.value.filter(e => !(e.peerId === error.peerId && e.fileName === error.fileName))
  } else {
    alert('File no longer available for retry. Please select the file again.')
  }
}

// New function to handle errors
const handleError = (peerId, fileName, message) => {
  console.error(`Error for peer ${peerId}, file ${fileName}: ${message}`);
  errors.value.push({ peerId, fileName, message });
  addNotification(`Error: ${message}`, 'error');
}

// Lifecycle hooks
onMounted(() => {
  console.log('App mounted, initializing PeerService')
  try {
    PeerService.init()
    PeerService.onPeerConnected = addPeer
    PeerService.onPeerDisconnected = handlePeerDisconnected
    PeerService.onFileProgress = updateFileProgress
    PeerService.onFileReceived = addReceivedFile
    PeerService.onTransferError = handleTransferError
    PeerService.onTransferCancelled = handleTransferCancelled
    PeerService.onTransferCompleted = handleCompletedTransfer
    PeerService.onPeerIdAssigned = (peerId) => {
      myPeerId.value = peerId
      myGreekName.value = PeerService.myGreekName
      myPeerName.value = `${PeerService.formatPeerName(PeerService.deviceInfo)}`
    }
  } catch (error) {
    console.error('Error initializing PeerService:', error)
    addNotification('Failed to initialize peer service', 'error')
  }
})

onBeforeUnmount(() => {
  // Clean up connections before the component is destroyed
  PeerService.cleanup()
})

// Expose necessary functions and reactive variables to the template
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.5s;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}
</style>
