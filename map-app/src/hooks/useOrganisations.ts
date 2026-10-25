import { useCallback, useEffect, useState } from 'react';
import { listMyOrganisations, type Organisation } from '../auth';
import { errorMessage } from '../errors';
import { useAuth } from './useAuth';

export interface OrganisationsState {
  organisations: Organisation[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** The signed-in user's organisations, reloaded when the user changes. */
export function useOrganisations(): OrganisationsState {
  const user = useAuth();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyOrganisations()
      .then((orgs) => {
        if (!cancelled) setOrganisations(orgs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { organisations, loading, error, reload };
}
