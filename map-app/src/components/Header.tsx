// Imported from the main site's assets so Vite bundles it: this works in
// `npm run dev` (where the site's /assets/ isn't served) and in the build.
import logoUrl from '../../../assets/images/Logo.png';
import { signOut } from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from '../hooks/useAuth';
import { useNotice } from './Notices';

interface HeaderProps {
  onSignIn: () => void;
}

/** Link back to the main site, title, and sign-in state. */
export function Header({ onSignIn }: HeaderProps) {
  const user = useAuth();
  const notice = useNotice();

  return (
    <header className="site-header">
      <a className="site-header__home" href="/">
        <img src={logoUrl} alt="" className="site-header__logo" />
        <span>Earthlings Learning</span>
      </a>
      <h1 className="site-header__title">Survey Map</h1>
      <div className="site-header__account">
        {user ? (
          <>
            <span className="site-header__user">{user.name || user.email}</span>
            <button
              type="button"
              className="button button--small"
              onClick={() => signOut().catch((error) => notice(errorMessage(error), 'error'))}
            >
              Sign out
            </button>
          </>
        ) : (
          <button type="button" className="button button--small" onClick={onSignIn}>
            Sign in
          </button>
        )}
      </div>
    </header>
  );
}
