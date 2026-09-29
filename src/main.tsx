import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/base.css'
import { setupAutoReload } from './lib/updates'
import { supabase } from './lib/supabase'
import { startSync } from './lib/sync'
import { diag } from './lib/diag'
// Ask for persistent storage up front: without it iOS evicts the Cache API (and with it
// the downloaded offline maps) after a week or so of the PWA going unused.
void navigator.storage?.persist?.().catch(() => {})
// Reload the open app once a newer build has installed, and check for one on every foreground.
setupAutoReload()
// Drain the offline write queue on `online`, on every foreground, and on a slow heartbeat.
// Only main.tsx starts it, so tests never leave a timer or listener behind.
startSync(supabase)
// The trail for a bug that only happens on the phone (More → Diagnostics): when the page was
// hidden and shown, when iOS handed it back, and every touch the system cancelled — a tap that
// never became a click leaves exactly one of those.
diag('launch', `${location.pathname} visible=${document.visibilityState}`)
document.addEventListener('visibilitychange', () => diag('visibility', document.visibilityState))
window.addEventListener('pageshow', e => diag('pageshow', (e as PageTransitionEvent).persisted ? 'from bfcache' : 'fresh'))
window.addEventListener('pagehide', () => diag('pagehide'))
window.addEventListener('online', () => diag('online'))
window.addEventListener('offline', () => diag('offline'))
document.addEventListener('touchcancel', e => {
  const t = e.target as Element | null
  diag('touchcancel', t ? `${t.tagName}${t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : ''}` : '')
}, { passive: true })
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/europe-guide"><App /></BrowserRouter>
  </React.StrictMode>,
)
