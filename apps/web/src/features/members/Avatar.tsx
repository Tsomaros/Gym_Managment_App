import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SIZE = {
  small: 'size-10 text-sm',
  medium: 'size-16 text-xl',
  large: 'size-28 text-4xl sm:size-36',
} as const;

/** A member's photo, or their initials on a neutral disc when there is none. */
export function Avatar({
  firstName,
  lastName,
  photoUrl,
  size = 'medium',
  decorative = false,
}: {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  size?: keyof typeof SIZE;
  /** The name is written next to the picture: say nothing twice to a screen reader. */
  decorative?: boolean;
}) {
  const { t } = useTranslation();
  const name = `${firstName} ${lastName}`;
  // A signed link lasts 5 minutes: on a desk left open a remounted image can be refused.
  // Show the initials then, never a broken picture.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photoUrl]);
  if (photoUrl && !broken) {
    return (
      <img
        src={photoUrl}
        alt={decorative ? '' : t('photo.alt', { name })}
        onError={() => setBroken(true)}
        className={`${SIZE[size]} shrink-0 rounded-full object-cover`}
      />
    );
  }
  const initials = `${[...firstName][0] ?? ''}${[...lastName][0] ?? ''}`.toLocaleUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`${SIZE[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700`}
    >
      {initials}
    </span>
  );
}
