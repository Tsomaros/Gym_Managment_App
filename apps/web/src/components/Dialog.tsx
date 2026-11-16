import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { Modal } from './modal';

/**
 * A titled modal dialog: rendered outside the app (which becomes inert), Tab stays inside,
 * Escape and the close button call `onClose`, and focus returns to the opener afterwards.
 */
export function Dialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('h2')?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, a[href]',
      ) ?? []),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement?.tagName === 'H2')
    ) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  return (
    <Modal>
      <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={trapTab}
          className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
        >
          <div className="mb-4 flex items-start gap-3">
            <h2
              id={titleId}
              tabIndex={-1}
              className="mr-auto text-lg font-semibold break-words text-slate-900 focus:outline-none"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
            >
              {closeLabel}
            </button>
          </div>
          {children}
        </div>
      </div>
    </Modal>
  );
}
