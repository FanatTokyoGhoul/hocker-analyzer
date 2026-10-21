import type { HockeyApi } from '../shared/types'

declare global {
  interface Window {
    api: HockeyApi
  }
}
