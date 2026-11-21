import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  cancelInvite,
  createInvite,
  getOrganisationDetails,
  inviteLink,
  leaveOrganisation,
  removeMember,
  updateMemberRole,
  type OrgInvite,
  type OrganisationDetails,
} from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from '../hooks/useAuth';
import { useOrganisations } from '../hooks/useOrganisations';
import { ROLE_LABELS } from '../roles';
import { CopyText } from './CopyText';
import { Dialog } from './Dialog';
import { useNotice } from './Notices';
import { OrganisationPhotos, type PhotoToAlign } from './OrganisationPhotos';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const messageDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}

/**
 * The message an inviter copies and sends by hand (email, WhatsApp). Neon
 * Auth's own invitation email is turned off, so this is the only invite
 * people get. The steps match the button names in AcceptInviteDialog.
 */
function inviteMessage(organisationName: string, invite: OrgInvite): string {
  return [
    `You’ve been invited to join ${organisationName} on the Earthlings Learning map as ${withArticle(ROLE_LABELS[invite.role].toLowerCase())}.`,
    '',
    `1. Open this link: ${inviteLink(invite.id)}`,
    `2. Sign in, or create an account, using ${invite.email}. The invite only works with this email address.`,
    `3. Choose “Join ${organisationName}”.`,
    '',
    `The invite expires on ${messageDateFormat.format(new Date(invite.expiresAt))}.`,
  ].join('\n');
}

interface OrganisationsDialogProps {
  onClose: () => void;
  /** Opens with this organisation selected, e.g. when coming back from lining up a photo. */
  initialOrganisationId?: string;
  onAlignPhoto: (organisationId: string, photo: PhotoToAlign) => void;
}

/**
 * The signed-in user's organisations, with members and invites for the one
 * selected. Controls are hidden by role, but the auth server makes the decision.
 */
export function OrganisationsDialog({ onClose, initialOrganisationId, onAlignPhoto }: OrganisationsDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialOrganisationId ?? null);

  return (
    <Dialog title="Organisations" onClose={onClose}>
      {selectedId ? (
        <OrganisationDetail
          organisationId={selectedId}
          onBack={() => setSelectedId(null)}
          onAlignPhoto={(photo) => onAlignPhoto(selectedId, photo)}
        />
      ) : (
        <OrganisationList onSelect={setSelectedId} />
      )}
    </Dialog>
  );
}

function OrganisationList({ onSelect }: { onSelect: (id: string) => void }) {
  const { organisations, loading, error } = useOrganisations();

  if (loading) return <p>Loading your organisations…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (organisations.length === 0) {
    return (
      <p>
        You’re not in any organisations yet. To join one, ask its owner or an admin for an invite link.
      </p>
    );
  }

  return (
    <ul className="org-list">
      {organisations.map((org) => (
        <li key={org.id}>
          <button type="button" className="org-list__item" onClick={() => onSelect(org.id)}>
            {org.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface OrganisationDetailProps {
  organisationId: string;
  onBack: () => void;
  onAlignPhoto: (photo: PhotoToAlign) => void;
}

function OrganisationDetail({ organisationId, onBack, onAlignPhoto }: OrganisationDetailProps) {
  const user = useAuth();
  const notice = useNotice();
  const [details, setDetails] = useState<OrganisationDetails | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDetails(await getOrganisationDetails(organisationId));
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Runs an action, reports failures, and refreshes the members and invites.
  async function run(action: () => Promise<void>, success?: string) {
    try {
      await action();
      if (success) notice(success);
    } catch (err) {
      notice(errorMessage(err), 'error');
    }
    await load();
  }

  if (error && !details) {
    return (
      <>
        <p className="form-error" role="alert">{error}</p>
        <BackButton onBack={onBack} />
      </>
    );
  }
  if (!details) return <p>Loading…</p>;

  const me = details.members.find((member) => member.userId === user?.id);
  const canManage = me?.role === 'owner' || me?.role === 'admin';

  return (
    <div className="org-detail">
      <BackButton onBack={onBack} />
      <h3 className="org-detail__name">{details.name}</h3>
      {me && <p className="org-detail__role">Your role: {ROLE_LABELS[me.role]}</p>}

      <section>
        <h4>Members</h4>
        <ul className="member-list">
          {details.members.map((member) => {
            // Owners can't be changed from here, and nobody edits their own role.
            const editable = canManage && member.role !== 'owner' && member.userId !== user?.id;
            return (
              <li key={member.id} className="member-list__item">
                <span className="member-list__name">
                  {member.name || member.email}
                  {member.name && <span className="member-list__email">{member.email}</span>}
                </span>
                {editable ? (
                  <>
                    <select
                      aria-label={`Role for ${member.name || member.email}`}
                      value={member.role}
                      onChange={(e) =>
                        run(
                          () => updateMemberRole(details.id, member.id, e.target.value as 'admin' | 'member'),
                          'Role updated.',
                        )
                      }
                    >
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="member">{ROLE_LABELS.member}</option>
                    </select>
                    <button
                      type="button"
                      className="button button--small button--danger"
                      onClick={() => {
                        if (window.confirm(`Remove ${member.name || member.email} from ${details.name}?`)) {
                          void run(() => removeMember(details.id, member.id), 'Member removed.');
                        }
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="member-list__role">{ROLE_LABELS[member.role]}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <>
          <section>
            <h4>Pending invites</h4>
            {details.invites.length === 0 ? (
              <p className="org-detail__empty">No pending invites.</p>
            ) : (
              <ul className="invite-list">
                {details.invites.map((invite) => (
                  <li key={invite.id} className="invite-list__item">
                    <p className="invite-list__summary">
                      {invite.email} · {ROLE_LABELS[invite.role]} · expires {dateFormat.format(new Date(invite.expiresAt))}
                    </p>
                    <CopyText text={inviteMessage(details.name, invite)} label="Invite message" />
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => run(() => cancelInvite(invite.id), 'Invite cancelled.')}
                    >
                      Cancel invite
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <InviteForm
            organisationId={details.id}
            organisationName={details.name}
            invites={details.invites}
            onInvited={load}
          />

          <OrganisationPhotos organisationId={details.id} onAlign={onAlignPhoto} />
        </>
      )}

      {me && me.role !== 'owner' && (
        <p>
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              if (!window.confirm(`Leave ${details.name}? You’ll need a new invite to rejoin.`)) return;
              try {
                await leaveOrganisation(details.id);
                notice(`You’ve left ${details.name}.`);
                onBack();
              } catch (err) {
                notice(errorMessage(err), 'error');
              }
            }}
          >
            Leave this organisation
          </button>
        </p>
      )}
    </div>
  );
}

interface InviteFormProps {
  organisationId: string;
  organisationName: string;
  /** Pending invites, used to show the new invite's message once the list has reloaded. */
  invites: OrgInvite[];
  onInvited: () => Promise<void>;
}

function InviteForm({ organisationId, organisationName, invites, onInvited }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [createdId, setCreatedId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setCreatedId('');
    setBusy(true);
    try {
      const inviteId = await createInvite(organisationId, email.trim(), role);
      setCreatedId(inviteId);
      setEmail('');
      await onInvited();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // The new invite's expiry date only arrives with the reloaded list.
  const created = invites.find((invite) => invite.id === createdId);

  return (
    <section>
      <h4>Invite someone</h4>
      <form className="form" onSubmit={handleSubmit}>
        <label className="form-field">
          <span className="form-field__label">Their email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="form-field__hint">They’ll need to sign in or create an account with this address.</span>
        </label>
        <label className="form-field">
          <span className="form-field__label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
            <option value="member">{ROLE_LABELS.member}: can add pins to the organisation</option>
            <option value="admin">{ROLE_LABELS.admin}: can also edit any pin and manage members</option>
          </select>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>
            Create invite link
          </button>
        </div>
      </form>
      {created && (
        <div className="invite-created">
          <p>Invite created. Copy this message and send it to them yourself, by email or WhatsApp for example:</p>
          <CopyText text={inviteMessage(organisationName, created)} label="Invite message" />
        </div>
      )}
    </section>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="link-button" onClick={onBack}>
      ← All organisations
    </button>
  );
}
