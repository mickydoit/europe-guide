import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function SignIn() {
  const { signIn, requestReset } = useAuth(); const nav = useNavigate(); const loc = useLocation()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setInfo(null); setBusy(true)
    const err = await signIn(email, password); setBusy(false)
    if (err) setError(err); else nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true })
  }
  async function forgot() {
    setError(null); setInfo(null)
    const err = await requestReset(email)
    if (err) setError(err); else setInfo(`Reset link sent to ${email}. Open it on this phone.`)
  }
  return (
    <main className="screen auth">
      <header>
        <p className="auth__brand">Europe 2026</p>
        <h1 className="auth__title">Sign in</h1>
        <p className="auth__lede">Your itinerary, bookings and maps. One sign-in per device.</p>
      </header>
      <form onSubmit={submit} className="form" noValidate>
        <div className="field">
          <label className="field__label" htmlFor="email">Email</label>
          <input id="email" className="field__input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
            placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="password">Password</label>
          <input id="password" className="field__input" type="password" autoComplete="current-password"
            placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {error && <p role="alert" className="form__msg form__msg--error">{error}</p>}
        {info && <p className="form__msg form__msg--info">{info}</p>}
        <button type="submit" className="btn btn--primary" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="btn btn--text" onClick={forgot} disabled={!email}>Forgot password? Email me a reset link</button>
      </form>
    </main>
  )
}
