import type { CheckInResult, MemberSummary } from '@gym/shared';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api/client';
import { Avatar } from '../members/Avatar';

/**
 * Check in by name when the QR code is not an option: type a name, the matching members appear,
 * Enter checks in the highlighted one (arrow keys move, Escape closes).
 */
export function ManualCheckIn({
  gymId,
  onResult,
}: {
  gymId: string;
  onResult: (result: CheckInResult) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [options, setOptions] = useState<MemberSummary[]>([]);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // True from the first keystroke until the search for it answers: Enter must not act on the
  // results of an older query (that would check in the wrong person).
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const q = text.trim();
    if (!q) {
      setOptions([]);
      setSearched(false);
      setOpen(false);
      return;
    }
    let current = true;
    // A short pause so typing a name does not send a request per letter.
    const timer = setTimeout(() => {
      apiFetch<MemberSummary[]>(`/gyms/${gymId}/members?q=${encodeURIComponent(q)}`)
        .then((found) => {
          if (!current) return;
          setOptions(found.slice(0, 8));
          setSearched(true);
          setActive(0);
          setOpen(true);
          setStale(false);
        })
        .catch(() => {
          if (!current) return;
          setFailed(true);
          setStale(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [gymId, text]);

  async function checkIn(member: MemberSummary) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await apiFetch<CheckInResult>(
        `/gyms/${gymId}/members/${member.userId}/check-ins`,
        { method: 'POST' },
      );
      setText('');
      setOptions([]);
      setOpen(false);
      onResult(result);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = open && !stale ? options[active] : undefined;
      if (chosen) void checkIn(chosen);
    }
  }

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {t('desk.manualLabel')}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && options[active] ? `${id}-${options[active].userId}` : undefined
        }
        autoComplete="off"
        value={text}
        placeholder={t('desk.manualPlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          setFailed(false);
          setStale(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        className="min-h-12 rounded-md border border-slate-500 px-3 text-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      />
      {failed && (
        <p role="alert" className="text-red-700">
          {t('common.genericError')}
        </p>
      )}
      <p role="status" className="text-slate-700">
        {open && searched && !stale && options.length === 0 ? t('desk.noMatch') : ''}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={t('desk.manualLabel')}
        hidden={!open || options.length === 0}
        className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-300 bg-white shadow-lg"
      >
        {options.map((m, i) => (
          <li
            key={m.userId}
            id={`${id}-${m.userId}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void checkIn(m)}
            className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 ${
              i === active ? 'bg-slate-100' : ''
            }`}
          >
            <Avatar
              firstName={m.firstName}
              lastName={m.lastName}
              photoUrl={m.photoUrl}
              size="small"
              decorative
            />
            <span className="font-medium text-slate-900">
              {m.firstName} {m.lastName}
            </span>
            <span className="ml-auto text-sm text-slate-600">{m.phone ?? m.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
