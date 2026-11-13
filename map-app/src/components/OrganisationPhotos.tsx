import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { errorMessage } from '../errors';
import { compressImage, formatBytes, type CompressedImage } from '../imageCompress';
import { deleteMapImage, listOrganisationImages, uploadMapImage, type MapImageSummary } from '../imagesApi';
import { useNotice } from './Notices';

/** Matches the limit in 008_map_images.sql. */
const MAX_PHOTOS = 10;

// captured_on is a plain date, which new Date() reads as midnight UTC, so format it in UTC too.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * An organisation's aerial photos, with upload and delete. Shown to owners and
 * admins only; the database's RLS makes the real decision.
 */
export function OrganisationPhotos({ organisationId }: { organisationId: string }) {
  const notice = useNotice();
  const [photos, setPhotos] = useState<MapImageSummary[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setPhotos(await listOrganisationImages(organisationId));
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(photo: MapImageSummary) {
    if (!window.confirm(`Delete “${photo.title}”? This can’t be undone.`)) return;
    try {
      await deleteMapImage(photo.id);
      notice('Photo deleted.');
    } catch (err) {
      notice(errorMessage(err), 'error');
    }
    await load();
  }

  return (
    <section>
      <h4>Aerial photos</h4>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!photos && !error && <p className="org-detail__empty">Loading photos…</p>}
      {photos && (
        <>
          {photos.length === 0 ? (
            <p className="org-detail__empty">No photos yet.</p>
          ) : (
            <ul className="photo-list">
              {photos.map((photo) => (
                <li key={photo.id} className="photo-list__item">
                  <span className="photo-list__details">
                    {photo.title}
                    <span className="photo-list__meta">
                      {photo.capturedOn ? `Taken ${dateFormat.format(new Date(photo.capturedOn))} · ` : ''}
                      {formatBytes(photo.byteSize)}
                      {photo.aligned ? '' : ' · Not lined up with the map yet'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="button button--small button--danger"
                    onClick={() => handleDelete(photo)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="org-detail__empty">
            {photos.length} of {MAX_PHOTOS} photos used.
          </p>
          {photos.length < MAX_PHOTOS && <UploadPhotoForm organisationId={organisationId} onUploaded={load} />}
        </>
      )}
    </section>
  );
}

function UploadPhotoForm({ organisationId, onUploaded }: { organisationId: string; onUploaded: () => Promise<void> }) {
  const notice = useNotice();
  const [compressed, setCompressed] = useState<CompressedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [title, setTitle] = useState('');
  const [capturedOn, setCapturedOn] = useState('');
  const [status, setStatus] = useState<'idle' | 'preparing' | 'uploading'>('idle');
  const [error, setError] = useState('');
  // Changing the key clears the file input after an upload.
  const [inputKey, setInputKey] = useState(0);

  // The preview is a local copy of the compressed photo; free it when it's replaced.
  useEffect(() => {
    if (!compressed) return;
    const url = URL.createObjectURL(compressed.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [compressed]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCompressed(null);
    setPreviewUrl('');
    setError('');
    if (!file) return;

    setStatus('preparing');
    try {
      setCompressed(await compressImage(file));
      // A starting title from the file name, e.g. "east-meadow.jpg" -> "east-meadow".
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').slice(0, 120));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatus('idle');
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!compressed) return;
    setError('');
    setStatus('uploading');
    try {
      await uploadMapImage({
        organisationId,
        title: title.trim(),
        capturedOn: capturedOn || null,
        file: compressed.blob,
        width: compressed.width,
        height: compressed.height,
      });
      notice('Photo uploaded.');
      setCompressed(null);
      setPreviewUrl('');
      setTitle('');
      setCapturedOn('');
      setInputKey((key) => key + 1);
      await onUploaded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatus('idle');
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form className="form" onSubmit={handleSubmit}>
      <label className="form-field">
        <span className="form-field__label">Add a photo</span>
        <input key={inputKey} type="file" accept="image/*" onChange={handleFile} disabled={status !== 'idle'} />
        <span className="form-field__hint">
          A straight-down drone photo works best. It’s shrunk before uploading, and its location data is removed.
        </span>
      </label>

      {status === 'preparing' && <p className="org-detail__empty">Preparing photo…</p>}

      {compressed && (
        <>
          <div className="photo-preview">
            {previewUrl && <img src={previewUrl} alt="" />}
            <p className="org-detail__empty">
              {formatBytes(compressed.originalBytes)} → {formatBytes(compressed.blob.size)} · {compressed.width} ×{' '}
              {compressed.height} px
            </p>
          </div>
          <label className="form-field">
            <span className="form-field__label">Title</span>
            <input type="text" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-field__label">Date taken (optional)</span>
            <input
              type="date"
              min="1900-01-01"
              max={today}
              value={capturedOn}
              onChange={(e) => setCapturedOn(e.target.value)}
            />
          </label>
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {compressed && (
        <div className="form-actions">
          <button type="submit" className="button" disabled={status !== 'idle' || !title.trim()}>
            {status === 'uploading' ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}
    </form>
  );
}
