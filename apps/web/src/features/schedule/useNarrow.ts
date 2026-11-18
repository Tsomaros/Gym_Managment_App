import { useEffect, useState } from 'react';

const QUERY = '(max-width: 639px)';

/** True on phone widths (< 640 px): the week grid becomes a day list there. */
export function useNarrow(query: string = QUERY): boolean {
  const read = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setNarrow(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}
