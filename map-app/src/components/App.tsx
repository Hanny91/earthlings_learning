import { useEffect, useState } from 'react';
import { loadSession } from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from '../hooks/useAuth';
import { deletePin, type Pin } from '../pinsApi';
import { Header } from './Header';
import { MapView } from './MapView';
import { useNotice } from './Notices';
import { PinForm } from './PinForm';
import { SignInDialog } from './SignInDialog';

type PinFormState = { lat: number; lng: number; pin?: Pin };

// At most one dialog is open at a time. Sign-in can carry a pin form to open
// afterwards, for "sign in to add a pin here".
type Modal =
  | { kind: 'signIn'; intro?: string; next?: PinFormState }
  | ({ kind: 'pinForm' } & PinFormState)
  | null;

export function App() {
  const user = useAuth();
  const notice = useNotice();
  const [modal, setModal] = useState<Modal>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    loadSession().catch((error) => console.error('Failed to load session:', error));
  }, []);

  const reloadPins = () => setReloadKey((key) => key + 1);
  const closeModal = () => setModal(null);

  function handleAddPin(latlng: { lat: number; lng: number }) {
    const form: PinFormState = { lat: latlng.lat, lng: latlng.lng };
    if (user) setModal({ kind: 'pinForm', ...form });
    else setModal({ kind: 'signIn', intro: 'Sign in or create an account to add survey pins.', next: form });
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
      <Header onSignIn={() => setModal({ kind: 'signIn' })} />
      <MapView
        reloadKey={reloadKey}
        onAddPin={handleAddPin}
        onEditPin={(pin) => setModal({ kind: 'pinForm', lat: pin.lat, lng: pin.lng, pin })}
        onDeletePin={handleDeletePin}
      />

      {modal?.kind === 'signIn' && (
        <SignInDialog
          intro={modal.intro}
          onClose={closeModal}
          onSignedIn={() => setModal(modal.next ? { kind: 'pinForm', ...modal.next } : null)}
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
    </>
  );
}
