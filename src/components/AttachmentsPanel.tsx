import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useAuth } from '../lib/auth'
import { useAttachments, QUEUED_COPY } from '../lib/state'
import type { AttachmentRow } from '../lib/state'
import { Pill } from './Pill'

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} kB`
}

export function AttachmentsPanel({ tripSlug, bookingId }: { tripSlug: string; bookingId: string }) {
  const { session } = useAuth()
  const ownerId = session?.user.id ?? ''
  const { list, loading: attLoading, upload, url, remove, error: attError, cached } = useAttachments(tripSlug, bookingId, ownerId)

  const [uploading, setUploading] = useState(false)
  const [uploadQueued, setUploadQueued] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const uploadMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (uploadMsgTimer.current) clearTimeout(uploadMsgTimer.current)
  }, [])

  async function handleOpenAttachment(a: AttachmentRow) {
    // Open the window synchronously in the click handler (before any await) so iOS
    // Safari's popup blocker treats it as a direct result of the user gesture; navigate
    // it to the signed URL once that resolves.
    const w = window.open('', '_blank', 'noopener')
    try {
      const signedUrl = await url(a)
      if (w) w.location.href = signedUrl
      else window.location.assign(signedUrl)
    } catch (e) {
      if (w) w.close()
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDeleteAttachment(a: AttachmentRow) {
    if (!window.confirm(`Delete ${a.filename}?`)) return
    try {
      await remove(a)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadQueued(false)
    try {
      const result = await upload(file)
      if (result?.queued) {
        // Same lifetime as the Save message: say it, then get out of the way.
        setUploadQueued(true)
        if (uploadMsgTimer.current) clearTimeout(uploadMsgTimer.current)
        uploadMsgTimer.current = setTimeout(() => setUploadQueued(false), 2000)
      }
    } catch {
      // error already surfaced via the attachments hook's error state
    } finally {
      setUploading(false)
    }
  }

  if (!ownerId) return null

  return (
    <div className="attachments">
      <h3 className="h5 attachments__heading">Attachments</h3>
      {list.length > 0 && (
        <ul className="attachments__list">
          {list.map(a => (
            <li key={a.id} className="attachments__row">
              <button type="button" className="attachments__name" onClick={() => void handleOpenAttachment(a)}>
                {a.filename}
              </button>
              <span className="attachments__size">{fmtSize(a.size)}</span>
              {a.pendingUpload && <Pill tone="highlight">waiting to upload</Pill>}
              {!a.pendingUpload && cached.has(a.id) && <Pill tone="muted">offline</Pill>}
              <button type="button" className="attachments__delete" onClick={() => void handleDeleteAttachment(a)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label className="field__label" htmlFor="booking-attachment">Add PDF or photo</label>
        <input
          id="booking-attachment"
          type="file"
          accept="application/pdf,image/*"
          disabled={uploading || attLoading}
          onChange={e => void handleFileChange(e)}
        />
        {attLoading && <p className="caption">Loading attachments…</p>}
      </div>
      {uploadQueued && <p className="form__msg form__msg--queued">{QUEUED_COPY}</p>}
      {(actionError ?? attError) && <p className="form__msg form__msg--error">{actionError ?? attError}</p>}
    </div>
  )
}
