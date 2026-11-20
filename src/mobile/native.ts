import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** Пустой объект — пользователь закрыл выбор файла. */
export type Picked = { uri?: string; name?: string }

export type ProbeResult = { duration: number; width: number; height: number; fps: number; codec: string; name: string }

/**
 * Нативный модуль файлов: Android — android/…/HockeyFilesPlugin.java,
 * iOS — plugins/hockey-native/…/HockeyFilesPlugin.swift.
 */
export interface HockeyFilesPlugin {
  pickVideo(): Promise<Picked>
  probe(options: { uri: string }): Promise<ProbeResult>
  pickProject(): Promise<Picked & { text?: string; writable?: boolean }>
  createDocument(options: { name: string; text: string }): Promise<Picked>
  writeDocument(options: { uri: string; text: string }): Promise<void>
  /** Записать mp4 в выбранный пользователем файл (Android). base64 — весь клип. */
  saveVideo(options: { name: string; base64: string }): Promise<Picked>
}

export const HockeyFiles = registerPlugin<HockeyFilesPlugin>('HockeyFiles')

export type VkProgressEvent = { phase: 'video'; ratio: number | null; downloaded: number; total: number | null; speed: number | null; eta: number | null; title: string | null }

/**
 * Нативный модуль VK: Android — android/…/HockeyVkPlugin.java,
 * iOS — plugins/hockey-native/…/HockeyVkPlugin.swift: сеть VK и скачивание файла в свою папку.
 */
export interface HockeyVkPlugin {
  fetchText(options: { url: string; method?: 'GET' | 'POST'; body?: string; referer?: string }): Promise<{ text: string }>
  download(options: { url: string; name: string; referer?: string }): Promise<{ uri: string; name: string }>
  cancel(): Promise<void>
  addListener(eventName: 'vkProgress', listenerFunc: (p: VkProgressEvent) => void): Promise<PluginListenerHandle>
}

export const HockeyVk = registerPlugin<HockeyVkPlugin>('HockeyVk')

export const isIOS = Capacitor.getPlatform() === 'ios'

/**
 * Адрес, по которому WebView получает видео.
 * Android: /_hockey_video_?u=… (VideoWebViewClient.java, поддержка Range для content://).
 * iOS: встроенная раздача Capacitor /_capacitor_file_/… с Range (WebViewAssetHandler.swift).
 */
export const videoUrl = (uri: string): string =>
  isIOS ? Capacitor.convertFileSrc(uri) : `${location.origin}/_hockey_video_?u=${encodeURIComponent(uri)}`
