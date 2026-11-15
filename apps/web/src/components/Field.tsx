import { type InputHTMLAttributes, useId } from 'react';

/** A labelled text input. */
export function Field({
  label,
  ...input
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        {...input}
        className="min-h-11 rounded-md border border-slate-300 px-3 text-base text-slate-900 focus-visible:border-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900"
      />
    </div>
  );
}

export function SubmitButton({ children, busy }: { children: string; busy?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
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
