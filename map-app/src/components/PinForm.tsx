import { useState, type FormEvent } from 'react';
import { errorMessage } from '../errors';
import { useOrganisations } from '../hooks/useOrganisations';
import { createPin, updatePin, type Pin, type PinInput, type Visibility } from '../pinsApi';
import { Dialog } from './Dialog';

// Mirrors the length checks in db/migrations/001_pins.sql.
const TITLE_MAX = 120;
const NOTES_MAX = 2000;

const INDIVIDUAL = '';

interface PinFormProps {
  lat: number;
  lng: number;
  /** The pin being edited; omit to add a new one. */
  pin?: Pin;
  onClose: () => void;
  onSaved: () => void;
}

export function PinForm({ lat, lng, pin, onClose, onSaved }: PinFormProps) {
  const { organisations, loading, error: orgError } = useOrganisations();
  const [title, setTitle] = useState(pin?.title ?? '');
  const [notes, setNotes] = useState(pin?.notes ?? '');
  const [organisationId, setOrganisationId] = useState(pin?.organisationId ?? INDIVIDUAL);
  const [visibility, setVisibility] = useState<Visibility>(pin?.visibility ?? 'public');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Keep the pin's current organisation selectable even if it isn't in the list.
  const options = [...organisations];
  if (pin?.organisationId && !options.some((org) => org.id === pin.organisationId)) {
    options.push({ id: pin.organisationId, name: pin.organisationName ?? 'Current organisation' });
  }

  // Members-only only makes sense for organisation pins (enforced in the database too).
  const individual = organisationId === INDIVIDUAL;
  const effectiveVisibility: Visibility = individual ? 'public' : visibility;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const input: PinInput = {
      lat,
      lng,
      title: title.trim(),
      notes: notes.trim() || null,
      organisationId: organisationId || null,
      visibility: effectiveVisibility,
    };
    if (!input.title) {
      setError('Please give the pin a title.');
      return;
    }

    setBusy(true);
    try {
      if (pin) await updatePin(pin.id, input);
      else await createPin(input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={pin ? 'Edit pin' : 'Add a survey pin'} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <p className="form-advice">
          Please only record pins on private land if you have the landowner’s permission. Public pins can be seen by
          anyone, including people who aren’t signed in.
        </p>
        <p className="form-location">
          Location: {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>

        <label className="form-field">
          <span className="form-field__label">Title</span>
          <input type="text" required maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="form-field">
          <span className="form-field__label">Notes</span>
          <textarea rows={4} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className="form-field__hint">Optional</span>
        </label>

        <label className="form-field">
          <span className="form-field__label">Organisation</span>
          <select value={organisationId} disabled={loading} onChange={(e) => setOrganisationId(e.target.value)}>
            <option value={INDIVIDUAL}>Individual (no organisation)</option>
            {options.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span className="form-field__label">Who can see it</span>
          <select
            value={effectiveVisibility}
            disabled={individual}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
          >
            <option value="public">Public: anyone can see it</option>
            <option value="org_only">Organisation members only</option>
          </select>
        </label>

        {orgError && <p className="form-error" role="alert">Couldn’t load your organisations: {orgError}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-actions">
          {/* Disabled until organisations load, so an edit can't silently drop the pin's organisation. */}
          <button type="submit" className="button" disabled={busy || loading}>
            {pin ? 'Save changes' : 'Add pin'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
