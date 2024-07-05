<template>
    <div class="avatar" :style="avatarStyle">
      <img :src="avatarSrc" :alt="altText" width="100%" height="100%">
    </div>
  </template>
  
  <script>
  import { computed } from 'vue'
  
  export default {
    name: 'RandomAvatar',
    props: {
      seed: {
        type: String,
        required: true
      },
      size: {
        type: Number,
        default: 170 // Increased from 50 to 150
      }
    },
    setup(props) {
      const totalAvatars = 54 // Total number of avatar files
  
      const avatarIndex = computed(() => {
        return (hashCode(props.seed) % totalAvatars) + 1
      })
  
      const avatarSrc = computed(() => {
        const paddedIndex = avatarIndex.value.toString().padStart(2, '0')
        return require(`@/assets/avatars/bighead-${paddedIndex}.svg`)
      })
  
      const altText = computed(() => {
        return `Avatar ${avatarIndex.value}`
      })
  
      const avatarStyle = computed(() => ({
        width: `${props.size}px`,
        height: `${props.size}px`,
        position: 'absolute',
        top: `-${props.size / 5}px`,  
        left: `-${props.size / 3}px`, 
        zIndex: 10
    }))
  
      function hashCode(str) {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i)
          hash = ((hash << 5) - hash) + char
          hash = hash & hash // Convert to 32bit integer
        }
        return Math.abs(hash)
      }
  
      return {
        avatarSrc,
        altText,
        avatarStyle
      }
    }
  }
  </script>
  
  <style scoped>
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: 50%;
  }


  </style>
  