import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Сборка для Android (Capacitor): тот же интерфейс, что в Electron, но со своим window.api — src/mobile. */
export default defineConfig({
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    // WebView Android 7+ обновляется через Play — но старые телефоны тренеров бывают; без новейшего синтаксиса
    target: 'es2020'
  }
})
