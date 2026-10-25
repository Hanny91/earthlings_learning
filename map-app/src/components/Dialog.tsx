import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  /** Called when the user dismisses the dialog (close button, Escape or backdrop). */
  onClose: () => void;
  children: ReactNode;
}

/** A modal native <dialog>. The parent controls it by mounting and unmounting it. */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // Guarded because StrictMode runs effects twice in development.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog element itself (not its contents) is a click on the backdrop.
        if (event.target === event.currentTarget) ref.current?.close();
      }}
    >
      <div className="dialog__header">
        <h2 className="dialog__title">{title}</h2>
        <button type="button" className="dialog__close" aria-label="Close" onClick={() => ref.current?.close()}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
