import { useState, type FormEvent } from 'react';
import { AuthError, EMAIL_NOT_VERIFIED, sendVerificationCode, signIn, signUp, verifyEmailCode } from '../auth';
import { errorMessage } from '../errors';
import { Dialog } from './Dialog';

type Mode = 'signIn' | 'signUp' | 'enterCode';

interface SignInDialogProps {
  /** Optional explanation shown above the form, e.g. why sign-in is needed. */
  intro?: string;
  onClose: () => void;
  onSignedIn: () => void;
}

const TITLES: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Create an account',
  enterCode: 'Check your email',
};

export function SignInDialog({ intro, onClose, onSignedIn }: SignInDialogProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === 'signUp';

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setInfo('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isSignUp) {
        const result = await signUp(name.trim(), email.trim(), password);
        if (result.status === 'signedIn') return onSignedIn();
        setCode('');
        switchMode('enterCode');
      } else {
        await signIn(email.trim(), password);
        return onSignedIn();
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === EMAIL_NOT_VERIFIED) {
        // Signed up earlier but never entered the code: send a fresh one.
        await resendCode('Your email address isn’t verified yet, so we’ve sent you a new code.');
      } else {
        setError(errorMessage(err));
      }
    }
    setBusy(false);
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await verifyEmailCode(email.trim(), code.trim());
      // If verifying didn't start a session, sign in with the password they just typed.
      if (!user) await signIn(email.trim(), password);
      return onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  async function resendCode(message = 'We’ve sent you a new code.') {
    setError('');
    try {
      await sendVerificationCode(email.trim());
      setCode('');
      setMode('enterCode');
      setInfo(message);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (mode === 'enterCode') {
    return (
      <Dialog title={TITLES.enterCode} onClose={onClose}>
        <form className="form" onSubmit={handleCode}>
          <p>
            We’ve emailed a verification code to <strong>{email.trim()}</strong>. Enter it below to finish signing in.
          </p>
          {info && <p className="form-field__hint">{info}</p>}
          <label className="form-field">
            <span className="form-field__label">Verification code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <span className="form-field__hint">It can take a minute or two. Check your spam folder if it doesn’t arrive.</span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions form-actions--spread">
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await resendCode();
                setBusy(false);
              }}
            >
              Send a new code
            </button>
            <button type="submit" className="button" disabled={busy}>
              Verify
            </button>
          </div>
          <p className="form-switch">
            <button type="button" className="link-button" onClick={() => switchMode('signIn')}>
              Back to sign in
            </button>
          </p>
        </form>
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
