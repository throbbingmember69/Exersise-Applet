import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ServicesProvider from './app/ServicesProvider'
import ToastProvider from './app/ToastProvider'
import { getAppCtx } from './services/context'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <ServicesProvider ctx={getAppCtx()}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ServicesProvider>
  </StrictMode>,
)
