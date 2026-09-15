import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function ResetPassword() {
  const { updatePassword } = useAuth(); const nav = useNavigate()
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
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
      <form onSubmit={submit} className="form">
        <div className="field">
          <label className="field__label" htmlFor="new-password">New password</label>
          <input id="new-password" className="field__input" type="password" autoComplete="new-password" minLength={8}
            placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} required />
        </div>
        {error && <p role="alert" className="form__msg form__msg--error">{error}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || pw.length < 8}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </main>
  )
}
