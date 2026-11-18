import type { OccupancyLevel } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import { useOccupancy } from './useOccupancy';

/** One, two or three bars: the level is in the icon and the words, never in colour alone. */
function LevelIcon({ level }: { level: OccupancyLevel }) {
  const bars = level === 'quiet' ? 1 : level === 'moderate' ? 2 : 3;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0" fill="currentColor">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1 + i * 5}
          y={11 - i * 4}
          width="4"
          height={4 + i * 4}
          rx="1"
          opacity={i < bars ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}

const TONE: Record<OccupancyLevel, string> = {
  quiet: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  moderate: 'border-amber-700 bg-amber-50 text-amber-900',
  busy: 'border-red-700 bg-red-50 text-red-900',
};

/**
 * "Ήσυχα / Μέτρια / Πολύς κόσμος", and "· 23 άτομα" when the owner allowed the number. Nothing at
 * all when the gym has not set a capacity or the answer is not available.
 */
export function OccupancyBadge({ gymId }: { gymId: string }) {
  const { t } = useTranslation();
  const { occupancy } = useOccupancy(gymId);
  if (!occupancy || occupancy.level === null) return null;
  const { level } = occupancy;
  const count = 'count' in occupancy ? occupancy.count : undefined;
  return (
    <p
      data-testid="occupancy-badge"
      className={`inline-flex min-h-8 items-center gap-2 self-center rounded-full border px-3 py-1 text-sm font-semibold ${TONE[level]}`}
    >
      <LevelIcon level={level} />
      <span className="sr-only">{t('occupancy.label')}: </span>
      <span>
        {t(`occupancy.${level}`)}
        {count !== undefined && `, ${t('occupancy.people', { count })}`}
      </span>
    </p>
  );
}
