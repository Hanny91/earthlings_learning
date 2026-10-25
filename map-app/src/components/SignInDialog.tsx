import { useState, type FormEvent } from 'react';
import { AuthError, EMAIL_NOT_VERIFIED, resendVerificationEmail, signIn, signUp } from '../auth';
import { errorMessage } from '../errors';
import { Dialog } from './Dialog';

type Mode = 'signIn' | 'signUp' | 'checkEmail';

interface SignInDialogProps {
  /** Optional explanation shown above the form, e.g. why sign-in is needed. */
  intro?: string;
  onClose: () => void;
  onSignedIn: () => void;
}

const TITLES: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Create an account',
  checkEmail: 'Check your email',
};

export function SignInDialog({ intro, onClose, onSignedIn }: SignInDialogProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === 'signUp';

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setUnverified(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setUnverified(false);
    setBusy(true);
    try {
      if (isSignUp) {
        const result = await signUp(name.trim(), email.trim(), password);
        if (result.status === 'signedIn') return onSignedIn();
        setMode('checkEmail');
      } else {
        await signIn(email.trim(), password);
        return onSignedIn();
      }
    } catch (err) {
      setError(errorMessage(err));
      setUnverified(err instanceof AuthError && err.code === EMAIL_NOT_VERIFIED);
    }
    setBusy(false);
  }

  async function resend() {
    setBusy(true);
    setError('');
    try {
      await resendVerificationEmail(email.trim());
      setUnverified(false);
      setMode('checkEmail');
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  if (mode === 'checkEmail') {
    return (
      <Dialog title={TITLES.checkEmail} onClose={onClose}>
        <div className="form">
          <p>
            We’ve sent a link to <strong>{email.trim()}</strong>. Open it to verify your email address and you’ll be
            brought back here, signed in.
          </p>
          <p className="form-field__hint">It can take a minute or two. Check your spam folder if it doesn’t arrive.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions form-actions--spread">
            <button type="button" className="link-button" disabled={busy} onClick={resend}>
              Send it again
            </button>
            <button type="button" className="button" onClick={() => switchMode('signIn')}>
              Back to sign in
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={TITLES[mode]} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        {intro && <p className="form-intro">{intro}</p>}
        {isSignUp && (
          <label className="form-field">
            <span className="form-field__label">Name</span>
            <input type="text" autoComplete="name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="form-field">
          <span className="form-field__label">Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-field__label">Password</span>
          <input
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {unverified && (
          <p className="form-switch">
            <button type="button" className="link-button" disabled={busy} onClick={resend}>
              Resend the verification email
            </button>
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            {isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </div>
        <p className="form-switch">
          <button type="button" className="link-button" onClick={() => switchMode(isSignUp ? 'signIn' : 'signUp')}>
            {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </p>
      </form>
    </Dialog>
  );
}
