import type { Pin } from '../pinsApi';

interface PinPopupProps {
  pin: Pin;
  onEdit: (pin: Pin) => void;
  onDelete: (pin: Pin) => void;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Popup content for a pin. Edit and delete only appear when the database says
 * the viewer may use them (can_edit); RLS still checks on the actual request.
 */
export function PinPopup({ pin, onEdit, onDelete }: PinPopupProps) {
  const meta = [
    pin.organisationName ?? 'Individual',
    pin.visibility === 'org_only' ? 'Members only' : null,
    `Added ${dateFormat.format(new Date(pin.createdAt))}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="pin-popup">
      <h3 className="pin-popup__title">{pin.title}</h3>
      <p className="pin-popup__meta">{meta}</p>
      {pin.notes && <p className="pin-popup__notes">{pin.notes}</p>}
      {pin.canEdit && (
        <div className="pin-popup__actions">
          <button type="button" className="button button--small" onClick={() => onEdit(pin)}>
            Edit
          </button>
          <button type="button" className="button button--small button--danger" onClick={() => onDelete(pin)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
