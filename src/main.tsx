import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/base.css'
// Ask for persistent storage up front: without it iOS evicts the Cache API (and with it
// the downloaded offline maps) after a week or so of the PWA going unused.
void navigator.storage?.persist?.().catch(() => {})
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/europe-guide"><App /></BrowserRouter>
  </React.StrictMode>,
)
