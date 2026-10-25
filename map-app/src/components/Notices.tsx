import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type NoticeKind = 'info' | 'error';
type ShowNotice = (text: string, kind?: NoticeKind) => void;

const VISIBLE_MS = 6000;

const NoticeContext = createContext<ShowNotice>(() => {});

/** Shows a short message at the bottom of the screen, replacing any previous one. */
export function useNotice(): ShowNotice {
  return useContext(NoticeContext);
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ id: number; text: string; kind: NoticeKind } | null>(null);

  const show = useCallback<ShowNotice>((text, kind = 'info') => {
    setNotice({ id: Date.now(), text, kind });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <NoticeContext.Provider value={show}>
      {children}
      {notice && (
        <div
          key={notice.id}
          className={`notice notice--${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </div>
      )}
    </NoticeContext.Provider>
  );
}
