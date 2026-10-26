import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { inputClass } from '../components/inbox/shared'
import { buttonClass } from '../components/ui/buttonClass'
import { AuthCard, Spinner } from './AdminApp'
import { friendlyError, MIN_PASSWORD } from './context'

/**
 * Where invitation and password-reset emails land (/admin/reset). Supabase signs the
 * person in from the link; they then choose a password.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState<boolean | null>(supabase ? null : false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const db = supabase
    // The link's tokens are read from the URL as the client starts; give it a moment to finish.
    const { data } = db.auth.onAuthStateChange((_e, session) => session && setReady(true))
    const timer = setTimeout(() => void db.auth.getSession().then(({ data: d }) => setReady(Boolean(d.session))), 1500)
    return () => {
      clearTimeout(timer)
      data.subscription.unsubscribe()
    }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(friendlyError(err))
    navigate('/admin', { replace: true })
  }

  if (ready === null) return <AuthCard title="Choose a password"><Spinner label="Checking your link…" /></AuthCard>
  if (!ready)
    return (
      <AuthCard title="This link has expired">
        <p className="text-muted">Invitation and reset links work once and expire after a while. Ask the owner for a new invitation, or request a new reset link from the sign-in page.</p>
        <Link to="/admin" className={buttonClass('primary', 'md', 'mt-6')}>
          Go to sign in
        </Link>
      </AuthCard>
    )

  return (
    <AuthCard title="Choose a password">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="font-semibold">New password</span>
          <input type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={`${inputClass} mt-1.5 min-h-12`} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <span className="mt-1 block text-sm text-muted">At least {MIN_PASSWORD} characters. Use one you don’t use anywhere else.</span>
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || password.length < MIN_PASSWORD} className={buttonClass('primary', 'lg', 'w-full')}>
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </AuthCard>
  )
}
