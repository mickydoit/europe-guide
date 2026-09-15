import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function SignIn() {
  const { signIn, requestReset } = useAuth(); const nav = useNavigate(); const loc = useLocation()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null)
    const err = await signIn(email, password)
    if (err) setError(err); else nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true })
  }
  async function forgot() { setError(null); const err = await requestReset(email); setInfo(err ?? 'Reset email sent. Check your inbox.') }
  return (
    <main className="screen" style={{ display: 'grid', alignContent: 'center', gap: 16, maxWidth: 400, margin: '0 auto' }}>
      <h1 className="h5">Sign in</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p role="alert" style={{ color: 'var(--salmon)' }}>{error}</p>}
        {info && <p className="caption">{info}</p>}
        <button type="submit">Sign in</button>
        <button type="button" onClick={forgot} disabled={!email} style={{ background: 'none', border: 0, color: 'var(--accent)' }}>Forgot password</button>
      </form>
    </main>
  )
}
