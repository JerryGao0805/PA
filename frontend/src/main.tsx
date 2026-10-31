import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './i18n'
import './index.css'
import { createApp } from './app'

const { App } = createApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
