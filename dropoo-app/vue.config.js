const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')

module.exports = defineConfig({
  transpileDependencies: true,
  devServer: {
    host: '0.0.0.0',
    port: 8080, // or whatever port you're using
    allowedHosts: 'all', // This replaces the 'public' option
    client: {
      webSocketURL: 'auto://0.0.0.0:0/ws',
    },
  },
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
