import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
export function ResetPassword() {
  const { updatePassword } = useAuth(); const nav = useNavigate()
  const [pw, setPw] = useState(''); const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) { e.preventDefault(); const err = await updatePassword(pw); if (err) setError(err); else nav('/', { replace: true }) }
  return (
    <main className="screen" style={{ maxWidth: 400, margin: '0 auto' }}>
      <h1 className="h5">Set a new password</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={e => setPw(e.target.value)} required /></label>
        {error && <p role="alert" style={{ color: 'var(--salmon)' }}>{error}</p>}
        <button type="submit">Save</button>
      </form>
    </main>
  )
}
