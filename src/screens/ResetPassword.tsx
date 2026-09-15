import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type LinkState = 'checking' | 'ready' | 'invalid'

function readLinkError(): string | null {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
  const search = new URLSearchParams(location.search)
  const desc = hash.get('error_description') ?? search.get('error_description')
  return desc ? decodeURIComponent(desc.replace(/\+/g, ' ')) : null
}

export function ResetPassword() {
  const { updatePassword, session, loading } = useAuth(); const nav = useNavigate()
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<LinkState>('checking'); const [linkMsg, setLinkMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const linkErr = readLinkError()
    if (linkErr) { setLink('invalid'); setLinkMsg(linkErr); return }
    const code = new URLSearchParams(location.search).get('code')
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (cancelled) return
        if (error) { setLink('invalid'); setLinkMsg(error.message) }
      })
    }
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (session) { setLink('ready'); return }
    if (loading || link === 'invalid') return
    const t = setTimeout(() => { if (!session) { setLink('invalid'); setLinkMsg('No recovery session was found for this link.') } }, 4000)
    return () => clearTimeout(t)
  }, [session, loading, link])

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true)
    const err = await updatePassword(pw); setBusy(false)
    if (err) setError(err); else nav('/', { replace: true })
  }

  return (
    <main className="screen auth">
      <header>
        <p className="auth__brand">Europe 2026</p>
        <h1 className="auth__title">Set a new password</h1>
        <p className="auth__lede">At least 8 characters. You'll stay signed in on this phone afterwards.</p>
      </header>
      {link === 'checking' && <p className="form__msg form__msg--info">Verifying your reset link…</p>}
      {link === 'invalid' && (
        <div className="form">
          <p role="alert" className="form__msg form__msg--error">
            This reset link can't be used{linkMsg ? ` (${linkMsg})` : ''}. Links expire after an hour and work once.
          </p>
          <p className="form__msg form__msg--info">Go back to sign in and request a new link, then open it on the same device.</p>
          <Link className="btn btn--text" to="/signin">Back to sign in</Link>
        </div>
      )}
      {link === 'ready' && (
        <form onSubmit={submit} className="form">
          <div className="field">
            <label className="field__label" htmlFor="new-password">New password</label>
            <input id="new-password" className="field__input" type="password" autoComplete="new-password" minLength={8}
              placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} required autoFocus />
          </div>
          {error && <p role="alert" className="form__msg form__msg--error">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy || pw.length < 8}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      )}
    </main>
  )
}
