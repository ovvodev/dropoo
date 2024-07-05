<template>
    <div class="peer-avatar">
      <svg :width="size" :height="size" viewBox="0 0 100 100">
        <rect width="100" height="100" :fill="backgroundColor" />
        <text x="50" y="50" font-family="Arial" :font-size="fontSize" fill="#ffffff" text-anchor="middle" dominant-baseline="central">
          {{ initials }}
        </text>
      </svg>
    </div>
  </template>
  
  <script>
  export default {
    name: 'PeerAvatar',
    props: {
      seed: {
        type: String,
        required: true
      },
      size: {
        type: Number,
        default: 100
      }
    },
    computed: {
      initials() {
        return this.seed.slice(0, 2).toUpperCase()
      },
      backgroundColor() {
        const colors = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#34495e', '#16a085', '#27ae60', '#2980b9', '#8e44ad', '#2c3e50']
        const index = this.hashCode(this.seed) % colors.length
        return colors[index]
      },
      fontSize() {
        return this.size / 2
      }
    },
    methods: {
      hashCode(str) {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i)
          hash = ((hash << 5) - hash) + char
          hash = hash & hash // Convert to 32bit integer
        }
        return Math.abs(hash)
      }
    }
  }
  </script>
  
  <style scoped>
  .peer-avatar {
    display: inline-block;
  }
  </style>
  