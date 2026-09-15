import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/base.css'
import { setupAutoReload } from './lib/updates'
import { supabase } from './lib/supabase'
import { startSync } from './lib/sync'
// Ask for persistent storage up front: without it iOS evicts the Cache API (and with it
// the downloaded offline maps) after a week or so of the PWA going unused.
void navigator.storage?.persist?.().catch(() => {})
// Reload the open app once a newer build has installed, and check for one on every foreground.
setupAutoReload()
// Drain the offline write queue on `online`, on every foreground, and on a slow heartbeat.
// Only main.tsx starts it, so tests never leave a timer or listener behind.
startSync(supabase)
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/europe-guide"><App /></BrowserRouter>
  </React.StrictMode>,
)
