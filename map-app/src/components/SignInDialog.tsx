import { useState, type FormEvent } from 'react';
import { signIn, signUp } from '../auth';
import { errorMessage } from '../errors';
import { Dialog } from './Dialog';

type Mode = 'signIn' | 'signUp';

interface SignInDialogProps {
  /** Optional explanation shown above the form, e.g. why sign-in is needed. */
  intro?: string;
  onClose: () => void;
  onSignedIn: () => void;
}

export function SignInDialog({ intro, onClose, onSignedIn }: SignInDialogProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === 'signUp';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isSignUp) await signUp(name.trim(), email.trim(), password);
      else await signIn(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={isSignUp ? 'Create an account' : 'Sign in'} onClose={onClose}>
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
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(isSignUp ? 'signIn' : 'signUp');
              setError('');
            }}
          >
            {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </p>
      </form>
    </Dialog>
  );
}
