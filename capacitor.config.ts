import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ftg.hockeyanalyzer',
  appName: 'Hockey Analyzer',
  // мобильная сборка (vite.mobile.config.ts): тот же интерфейс, но работа с файлами — через Android
  webDir: 'out/mobile',
  // тёмная тема: фон под WebView и светлые значки в строке состояния
  backgroundColor: '#0f1216',
  android: {
    // видео матча — локальный файл, http-запросы приложению не нужны
    allowMixedContent: false
  },
  ios: {
    // видео отдаётся через /_capacitor_file_ с Range — контент из своих папок, внешних http нет
    contentInset: 'never'
  },
  plugins: {
    SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' }
  }
}

export default config
