import { forwardRef, type InputHTMLAttributes, useId } from 'react';

type FieldProps = {
  label: string;
  /** Shown under the input and announced with it; marks the input invalid. */
  error?: string | null;
  /** Help text under the input, announced with it. */
  hint?: string;
} & InputHTMLAttributes<HTMLInputElement>;

/** A labelled input with its own error and hint, wired up for screen readers. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, ...input },
  ref,
) {
  const id = useId();
  const descId = `${id}-desc`;
  const description = error ?? hint;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        {...input}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? descId : undefined}
        className={`min-h-11 rounded-md border px-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 read-only:bg-slate-50 ${
          error ? 'border-red-700' : 'border-slate-500'
        }`}
      />
      {description && (
        <p id={descId} className={`text-sm ${error ? 'text-red-700' : 'text-slate-600'}`}>
          {description}
        </p>
      )}
    </div>
  );
});

export function SubmitButton({ children, busy }: { children: string; busy?: boolean }) {
  return (
    <button
      type="submit"
      aria-disabled={busy || undefined}
      onClick={(e) => busy && e.preventDefault()}
      className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" className="min-h-5 text-sm text-red-700">
      {message}
    </p>
  );
}
