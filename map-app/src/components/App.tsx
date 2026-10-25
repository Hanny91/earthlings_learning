import { useEffect, useState } from 'react';
import { loadSession, onOrganisationsChange } from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from '../hooks/useAuth';
import { deletePin, type Pin } from '../pinsApi';
import { AcceptInviteDialog } from './AcceptInviteDialog';
import { Header } from './Header';
import { MapView } from './MapView';
import { useNotice } from './Notices';
import { OrganisationsDialog } from './OrganisationsDialog';
import { PinForm } from './PinForm';
import { SignInDialog } from './SignInDialog';

type PinFormState = { lat: number; lng: number; pin?: Pin };

// At most one dialog is open at a time. Sign-in can carry a dialog to open
// afterwards, e.g. "sign in to add a pin here" or accepting an invite.
type Modal =
  | { kind: 'signIn'; intro?: string; next?: Modal }
  | ({ kind: 'pinForm' } & PinFormState)
  | { kind: 'organisations' }
  | { kind: 'invite'; inviteId: string };

// Invite links look like /map/?invite=<id> (see inviteLink in auth.ts).
const INVITE_PARAM = 'invite';

function clearInviteParam(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(INVITE_PARAM);
  window.history.replaceState(null, '', url);
}

export function App() {
  const user = useAuth();
  const notice = useNotice();
  const [modal, setModal] = useState<Modal | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reloadPins = () => setReloadKey((key) => key + 1);
  const closeModal = () => setModal(null);

  useEffect(() => {
    const inviteId = new URLSearchParams(window.location.search).get(INVITE_PARAM);
    loadSession()
      .catch((error) => console.error('Failed to load session:', error))
      // Wait for the session so the invite dialog knows whether to ask for sign-in.
      .finally(() => {
        if (inviteId) setModal({ kind: 'invite', inviteId });
      });
  }, []);

  // Joining or leaving an organisation changes which pins RLS returns.
  useEffect(() => {
    const unsubscribe = onOrganisationsChange(() => setReloadKey((key) => key + 1));
    return () => void unsubscribe();
  }, []);

  function handleAddPin(latlng: { lat: number; lng: number }) {
    const form: PinFormState = { lat: latlng.lat, lng: latlng.lng };
    if (user) setModal({ kind: 'pinForm', ...form });
    else setModal({ kind: 'signIn', intro: 'Sign in or create an account to add survey pins.', next: { kind: 'pinForm', ...form } });
  }

  async function handleDeletePin(pin: Pin) {
    if (!window.confirm(`Delete “${pin.title}”? This can’t be undone.`)) return;
    try {
      await deletePin(pin.id);
      notice('Pin deleted.');
      reloadPins();
    } catch (error) {
      notice(errorMessage(error), 'error');
    }
  }

  return (
    <>
      <Header
        onSignIn={() => setModal({ kind: 'signIn' })}
        onOrganisations={() => setModal({ kind: 'organisations' })}
      />
      <MapView
        reloadKey={reloadKey}
        onAddPin={handleAddPin}
        onEditPin={(pin) => setModal({ kind: 'pinForm', lat: pin.lat, lng: pin.lng, pin })}
        onDeletePin={handleDeletePin}
      />

      {modal?.kind === 'signIn' && (
        <SignInDialog
          intro={modal.intro}
          onClose={() => {
            if (modal.next?.kind === 'invite') clearInviteParam();
            closeModal();
          }}
          onSignedIn={() => setModal(modal.next ?? null)}
        />
      )}

      {modal?.kind === 'pinForm' && (
        <PinForm
          lat={modal.lat}
          lng={modal.lng}
          pin={modal.pin}
          onClose={closeModal}
          onSaved={() => {
            notice(modal.pin ? 'Pin updated.' : 'Pin added.');
            closeModal();
            reloadPins();
          }}
        />
      )}

      {modal?.kind === 'organisations' && <OrganisationsDialog onClose={closeModal} />}

      {modal?.kind === 'invite' && (
        <AcceptInviteDialog
          inviteId={modal.inviteId}
          onSignIn={() =>
            setModal({
              kind: 'signIn',
              intro: 'Use the email address your invite was sent to.',
              next: modal,
            })
          }
          onClose={() => {
            // Dismissing also clears the link from the address bar; opening the link again brings it back.
            clearInviteParam();
            closeModal();
          }}
          onDone={(accepted, organisationName) => {
            clearInviteParam();
            closeModal();
            notice(accepted ? `You’ve joined ${organisationName}.` : 'Invite declined.');
          }}
        />
      )}
    </>
  );
}
