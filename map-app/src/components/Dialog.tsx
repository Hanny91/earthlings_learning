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

  // Set once the user has agreed to close, so the close event doesn't ask again.
  const closeConfirmed = useRef(false);

  function requestClose() {
    if (confirmClose && !confirmClose()) return;
    closeConfirmed.current = true;
    ref.current?.close();
  }

  return (
    <dialog
      ref={ref}
      className={fullScreen ? 'dialog dialog--full' : 'dialog'}
      onClose={() => {
        // Browsers don't always let Escape be cancelled (Chrome ignores
        // preventDefault on a repeated Escape with no click in between), so a
        // close nobody confirmed is checked here, and undone by reopening.
        if (!closeConfirmed.current && confirmClose && !confirmClose()) {
          ref.current?.showModal();
          return;
        }
        closeConfirmed.current = false;
        onClose();
      }}
      onCancel={(event) => {
        // Escape: ask now, while it can still be cancelled. If it can't, the close handler asks instead.
        if (!confirmClose || !event.cancelable) return;
        if (confirmClose()) closeConfirmed.current = true;
        else event.preventDefault();
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
