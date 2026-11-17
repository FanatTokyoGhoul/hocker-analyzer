import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMobileApi } from './mobileApi'
import MobileApp from './MobileApp'
import '../renderer/src/styles.css'
import './mobile.css'

// интерфейс общий с компьютером и обращается к window.api — на телефоне это файлы Android и localStorage
window.api = createMobileApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>
)
