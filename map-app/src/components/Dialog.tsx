import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  /** Called when the user dismisses the dialog (close button, Escape or backdrop). */
  onClose: () => void;
  /** Asked before dismissing; return false to keep the dialog open, e.g. after "Leave without saving?". */
  confirmClose?: () => boolean;
  /** Fills the screen, for work that needs the space (lining up photos). */
  fullScreen?: boolean;
  children: ReactNode;
}

/** A modal native <dialog>. The parent controls it by mounting and unmounting it. */
export function Dialog({ title, onClose, confirmClose, fullScreen, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // Guarded because StrictMode runs effects twice in development.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function requestClose() {
    if (confirmClose && !confirmClose()) return;
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      className={fullScreen ? 'dialog dialog--full' : 'dialog'}
      onClose={onClose}
      onCancel={(event) => {
        // Escape: keep the dialog open if the user wants to stay.
        if (confirmClose && !confirmClose()) event.preventDefault();
      }}
      onClick={(event) => {
        // A click on the dialog element itself (not its contents) is a click on the backdrop.
        // A full-screen dialog has no backdrop to click, only its own padding.
        if (event.target === event.currentTarget && !fullScreen) requestClose();
      }}
    >
      <div className="dialog__header">
        <h2 className="dialog__title">{title}</h2>
        <button type="button" className="dialog__close" aria-label="Close" onClick={requestClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
