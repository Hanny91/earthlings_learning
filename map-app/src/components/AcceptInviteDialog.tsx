import { useEffect, useState } from 'react';
import { acceptInvite, declineInvite, getInvite, type InviteSummary } from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from '../hooks/useAuth';
import { ROLE_LABELS } from '../roles';
import { Dialog } from './Dialog';

interface AcceptInviteDialogProps {
  inviteId: string;
  onSignIn: () => void;
  onClose: () => void;
  /** Called once the invite is accepted or declined. */
  onDone: (accepted: boolean, organisationName: string) => void;
}

/** Shown when the page is opened from an invite link (?invite=…). */
export function AcceptInviteDialog({ inviteId, onSignIn, onClose, onDone }: AcceptInviteDialogProps) {
  const user = useAuth();
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The invite can only be read by the signed-in invitee, so wait for sign-in.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError('');
    getInvite(inviteId)
      .then((summary) => {
        if (!cancelled) setInvite(summary);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [inviteId, user?.id]);

  async function respond(accept: boolean) {
    if (!invite) return;
    setBusy(true);
    setError('');
    try {
      if (accept) await acceptInvite(invite.id);
      else await declineInvite(invite.id);
      onDone(accept, invite.organisationName);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  let body;
  if (!user) {
    body = (
      <>
        <p>You’ve been invited to join an organisation on the survey map.</p>
        <p>Sign in or create an account using the email address the invite was sent to.</p>
        <div className="form-actions">
          <button type="button" className="button" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </>
    );
  } else if (error && !invite) {
    body = (
      <>
        <p className="form-error" role="alert">{error}</p>
        <p>
          The invite may have expired or been cancelled, or it was sent to a different email address than the one
          you’re signed in with ({user.email}). Ask whoever invited you for a new link.
        </p>
      </>
    );
  } else if (!invite) {
    body = <p>Loading invite…</p>;
  } else {
    body = (
      <>
        <p>
          <strong>{invite.inviterEmail}</strong> has invited you to join <strong>{invite.organisationName}</strong> as{' '}
          {invite.role === 'member' ? 'a' : 'an'} {ROLE_LABELS[invite.role]}.
        </p>
        <p>Members can add pins for the organisation and see pins shared only with its members.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions form-actions--spread">
          <button type="button" className="link-button" disabled={busy} onClick={() => respond(false)}>
            Decline
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => respond(true)}>
            Join {invite.organisationName}
          </button>
        </div>
      </>
    );
  }

  return (
    <Dialog title="Organisation invite" onClose={onClose}>
      <div className="form">{body}</div>
    </Dialog>
  );
}
