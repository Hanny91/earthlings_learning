// Phase 1 test page for aerial photos (photos.md): uploads real JPEGs through
// the Data API, downloads them again and reports sizes and timings, to find
// Neon's upload limit before the rest is built. Development only; open
// /map/photo-test.html after signing in on the map. Remove after phase 1.

import './style.css';
import { StrictMode, useEffect, useState, type ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { listMyOrganisations, loadSession, type AuthUser, type Organisation } from './auth';
import { ApiError } from './dataApi';
import { errorMessage } from './errors';
import { deleteMapImage, forgetImageUrl, getImageUrl, uploadMapImage } from './imagesApi';

interface Result {
  key: number;
  name: string;
  bytes: number;
  status: 'working' | 'done' | 'failed';
  id?: number;
  uploadMs?: number;
  downloadMs?: number;
  downloadedBytes?: number;
  url?: string;
  error?: string;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function PhotoTest() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [orgId, setOrgId] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    loadSession()
      .then(async (signedIn) => {
        setUser(signedIn);
        if (!signedIn) return;
        const orgs = await listMyOrganisations();
        setOrganisations(orgs);
        if (orgs[0]) setOrgId(orgs[0].id);
      })
      .catch((error) => {
        console.error(error);
        setUser(null);
      });
  }, []);

  const update = (key: number, changes: Partial<Result>) =>
    setResults((all) => all.map((r) => (r.key === key ? { ...r, ...changes } : r)));

  async function testFile(file: File) {
    const key = Date.now() + Math.random();
    setResults((all) => [...all, { key, name: file.name, bytes: file.size, status: 'working' }]);
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();

      let start = performance.now();
      const id = await uploadMapImage({
        organisationId: orgId,
        title: `Upload test: ${file.name}`.slice(0, 120),
        capturedOn: null,
        file,
        width,
        height,
      });
      const uploadMs = performance.now() - start;
      update(key, { id, uploadMs });

      start = performance.now();
      const url = await getImageUrl(id);
      const downloadMs = performance.now() - start;
      const downloadedBytes = (await (await fetch(url)).blob()).size;
      update(key, { status: 'done', downloadMs, downloadedBytes, url });
    } catch (error) {
      const code = error instanceof ApiError && error.code ? ` (code ${error.code})` : '';
      update(key, { status: 'failed', error: errorMessage(error) + code });
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    // One at a time, so timings aren't skewed by uploads competing.
    for (const file of files) await testFile(file);
  }

  async function handleDelete(result: Result) {
    if (result.id === undefined) return;
    try {
      await deleteMapImage(result.id);
      forgetImageUrl(result.id);
      setResults((all) => all.filter((r) => r.key !== result.key));
    } catch (error) {
      update(result.key, { error: errorMessage(error) });
    }
  }

  if (user === undefined) return <p>Checking sign-in…</p>;
  if (user === null) return <p>Sign in on the map first (same address and port), then reload this page.</p>;

  return (
    <main style={{ padding: 16, maxWidth: 960 }}>
      <h1>Photo upload test</h1>
      <p>
        Pick compressed JPEGs of about 1, 2 and 4 MB, and one just over 4 MB. The database refuses files over 4 MB,
        so that one should fail with code 23514. A failure on a smaller file, or a 413, means Neon's own limit is lower.
      </p>
      <p>
        <label>
          Organisation (you must be an owner or admin):{' '}
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <input type="file" accept="image/jpeg" multiple disabled={!orgId} onChange={handleFiles} />
      </p>

      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Upload</th>
            <th>Download</th>
            <th>Same size back?</th>
            <th>Result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td>{mb(r.bytes)}</td>
              <td>{r.uploadMs === undefined ? '–' : `${(r.uploadMs / 1000).toFixed(1)} s`}</td>
              <td>{r.downloadMs === undefined ? '–' : `${(r.downloadMs / 1000).toFixed(1)} s`}</td>
              <td>{r.downloadedBytes === undefined ? '–' : r.downloadedBytes === r.bytes ? 'Yes' : `No: ${mb(r.downloadedBytes)}`}</td>
              <td>
                {r.status === 'working' && 'Working…'}
                {r.url && <img src={r.url} alt="" style={{ height: 60 }} />}
                {r.error && <span className="form-error">{r.error}</span>}
              </td>
              <td>
                {r.id !== undefined && (
                  <button type="button" className="button button--small" onClick={() => handleDelete(r)}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhotoTest />
  </StrictMode>,
);
