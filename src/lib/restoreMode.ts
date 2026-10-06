/**
 * How ScrollReset puts a list back where it was on Back — switchable from More → Diagnostics so
 * the owner can run the dead-tap recipe (Day → open a stop → Back → tap a tab) under each mode
 * on the phone, one variable at a time:
 *
 *  - immediate: write #root.scrollTop in the layout effect, the moment the new screen commits
 *    (the behaviour every freeze in the 6 Oct log followed within seconds);
 *  - deferred: reset to the top in the layout effect, then write the offset two animation
 *    frames later, once iOS has laid out and committed the new screen;
 *  - off: never restore — every screen opens at the top.
 *
 * If a mode makes the recipe stop freezing, that is the evidence; the mode then becomes the
 * default and the switch goes.
 */
export const RESTORE_MODE_KEY = 'europe-guide.restoreMode'
export const RESTORE_MODES = ['immediate', 'deferred', 'off'] as const
export type RestoreMode = typeof RESTORE_MODES[number]
export const DEFAULT_RESTORE_MODE: RestoreMode = 'immediate'

export function getRestoreMode(): RestoreMode {
  try {
    const raw = localStorage.getItem(RESTORE_MODE_KEY)
    return (RESTORE_MODES as readonly string[]).includes(raw ?? '') ? (raw as RestoreMode) : DEFAULT_RESTORE_MODE
  } catch { return DEFAULT_RESTORE_MODE }
}

export function setRestoreMode(mode: RestoreMode): void {
  try { localStorage.setItem(RESTORE_MODE_KEY, mode) } catch { /* private mode: the default stands */ }
}
