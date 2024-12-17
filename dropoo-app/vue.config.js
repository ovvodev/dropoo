const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const { umamiAnalyticsPlugin } = require('@vuepress/plugin-umami-analytics')

module.exports = defineConfig({
  transpileDependencies: true,
  plugins: [
    umamiAnalyticsPlugin({
      id: '1be950bc-ffb5-4890-a648-b6f50501edb6',
      src: 'https://cloud.umami.is/script.js'
    })
  ],
  configureWebpack: {
    plugins: [
      new webpack.ProvidePlugin({
        process: 'process/browser',
      }),
    ],
    resolve: {
      fallback: {
        "process": require.resolve("process/browser")
      }
    }
  }
})
