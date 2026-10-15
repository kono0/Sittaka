import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    worker: { format: 'es' },
    // AudioWorklet を data: URL で埋め込むと CSP で読めないので、必ずファイルとして出す
    build: {
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
