import { useSyncExternalStore } from 'react';
import { getUser, onAuthChange, type AuthUser } from '../auth';

/** The signed-in user, or null. Re-renders on sign-in and sign-out. */
export function useAuth(): AuthUser | null {
  return useSyncExternalStore((notify) => {
    const unsubscribe = onAuthChange(() => notify());
    return () => void unsubscribe();
  }, getUser);
}
