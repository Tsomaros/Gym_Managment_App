import { type KeyboardEvent, useEffect, useId, useRef } from 'react';
import { Modal } from './modal';

/**
 * A modal question with a cancel and a confirm button (role="alertdialog"). Focus starts on
 * cancel, so Enter never confirms by accident, stays inside the dialog (Tab cycles), and returns
 * to the opener when it closes. Escape cancels.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy,
  busyLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  /** Shown on the confirm button while `busy`. */
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The latest onCancel without re-running the mount effect (callers pass inline arrows).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCancelRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  return (
    <Modal>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={messageId}
          onKeyDown={trapTab}
          className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        >
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <p id={messageId} className="mt-2 break-words text-slate-700">
            {message}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-md border border-slate-300 px-4 font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => !busy && onConfirm()}
              aria-disabled={busy || undefined}
              className="min-h-11 rounded-md bg-red-700 px-4 font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 aria-disabled:opacity-60"
            >
              {busy && busyLabel ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
