/**
 * Keeps an installed (Home Screen) PWA current without the owner having to reinstall it.
 *
 * vite-plugin-pwa registers the service worker with skipWaiting + clientsClaim, so a new
 * build takes control as soon as it has installed — but the page that is already open keeps
 * running the old JavaScript until it reloads. We reload once on `controllerchange`, and we
 * poke the registration to check for a new build whenever the app comes to the foreground
 * (and hourly while it stays open).
 */
export const BUILD_ID: string = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

type SW = Pick<ServiceWorkerContainer, 'addEventListener' | 'getRegistration' | 'controller'>

export function setupAutoReload(
  sw: SW | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  reload: () => void = () => location.reload(),
  doc: Pick<Document, 'addEventListener' | 'visibilityState'> | undefined = typeof document !== 'undefined' ? document : undefined,
  intervalMs = 60 * 60 * 1000,
): () => void {
  if (!sw) return () => {}
  let refreshing = false
  const onControllerChange = () => {
    // Ignore the very first claim on a fresh install (controller was null) — nothing to reload.
    if (refreshing) return
    refreshing = true
    reload()
  }
  const hadController = !!sw.controller
  const handler = () => { if (hadController) onControllerChange() }
  sw.addEventListener('controllerchange', handler)
  const check = () => { void checkForUpdate(sw) }
  const onVisible = () => { if (!doc || doc.visibilityState === 'visible') check() }
  doc?.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(check, intervalMs)
  return () => { clearInterval(timer) }
}

/** Ask the browser to look for a newer service worker (and therefore a newer build). */
export async function checkForUpdate(sw: SW | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined): Promise<'updated' | 'current' | 'unavailable'> {
  if (!sw) return 'unavailable'
  const reg = await sw.getRegistration()
  if (!reg) return 'unavailable'
  await reg.update()
  return reg.installing || reg.waiting ? 'updated' : 'current'
}
