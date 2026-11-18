import type { AttendancePoint, ExerciseProgressPoint, Measurement, VolumePoint } from '@gym/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { viewerLanguage } from '../exercises/exerciseName';
import { ChartFrame, LegendItem } from './ChartFrame';
import { CHART, MARGIN, num, RANGES, shortDate } from './chartTheme';

/** "the last 3 months" for the ranges on offer, "the last N weeks" for anything else. */
function useRangeLabel(weeks: number): string {
  const { t } = useTranslation();
  const r = RANGES.find((x) => x.weeks === weeks);
  return r
    ? t('progress.rangeMonths', { count: r.months })
    : t('progress.rangeWeeks', { count: weeks });
}

const axisProps = {
  tick: { fill: CHART.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;

/** Top set and estimated one-rep max of one exercise over time (two lines, one unit: kg). */
export function ExerciseChart({
  points,
  weeks,
  name,
  loading,
}: {
  points: ExerciseProgressPoint[];
  weeks: number;
  name: string;
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const range = useRangeLabel(weeks);
  const first = points[0];
  const last = points.at(-1);
  const summary =
    first && last && points.length === 1
      ? t('progress.summaryExerciseOne', { kg: num(first.topSetKg, lang), reps: first.topSetReps })
      : first && last
        ? t('progress.summaryExercise', {
            name,
            from: num(first.topSetKg, lang),
            to: num(last.topSetKg, lang),
            range,
          })
        : null;
  return (
    <ChartFrame
      title={t('progress.exerciseTitle', { name })}
      summary={summary}
      empty={points.length === 0}
      loading={loading}
      legend={
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <LegendItem color={CHART.series1} label={t('progress.topSet')} />
          <LegendItem color={CHART.series2} label={t('progress.e1rm')} dashed />
        </div>
      }
      table={{
        head: [t('progress.date'), t('progress.topSet'), t('progress.reps'), t('progress.e1rm')],
        rows: points.map((p) => [
          shortDate(p.date, lang),
          `${num(p.topSetKg, lang)} kg`,
          String(p.topSetReps),
          p.e1rmKg === null ? '–' : `${num(p.e1rmKg, lang)} kg`,
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={MARGIN}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => shortDate(d, lang)}
            minTickGap={24}
            {...axisProps}
          />
          <YAxis
            width={44}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => num(v, lang)}
            {...axisProps}
          />
          <Tooltip
            formatter={(v, key) => [
              `${num(Number(v), lang)} kg`,
              key === 'topSetKg' ? t('progress.topSet') : t('progress.e1rm'),
            ]}
            labelFormatter={(d) => shortDate(String(d), lang)}
          />
          <Line
            type="monotone"
            dataKey="topSetKg"
            stroke={CHART.series1}
            strokeWidth={2}
            dot={{ r: 4, fill: CHART.series1, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="e1rmKg"
            stroke={CHART.series2}
            strokeWidth={2}
            strokeDasharray="5 4"
            connectNulls
            dot={{ r: 4, fill: CHART.series2, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Kilos lifted per week (weight × reps of the done sets). */
export function VolumeChart({
  points,
  weeks,
  loading,
}: {
  points: VolumePoint[];
  weeks: number;
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const range = useRangeLabel(weeks);
  const total = points.reduce((n, p) => n + p.volumeKg, 0);
  const active = points.filter((p) => p.volumeKg > 0).length;
  return (
    <ChartFrame
      title={t('progress.volumeTitle')}
      summary={
        total > 0
          ? t('progress.summaryVolume', { total: num(total, lang, 0), count: active, range })
          : null
      }
      empty={total === 0}
      loading={loading}
      table={{
        head: [t('progress.week'), t('progress.volume')],
        rows: points.map((p) => [shortDate(p.weekStart, lang), `${num(p.volumeKg, lang, 0)} kg`]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={MARGIN} barCategoryGap="20%">
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={(d: string) => shortDate(d, lang)}
            minTickGap={24}
            {...axisProps}
          />
          <YAxis width={56} tickFormatter={(v: number) => num(v, lang, 0)} {...axisProps} />
          <Tooltip
            formatter={(v) => [`${num(Number(v), lang, 0)} kg`, t('progress.volume')]}
            labelFormatter={(d) => t('progress.weekOf', { date: shortDate(String(d), lang) })}
          />
          <Bar
            dataKey="volumeKg"
            fill={CHART.series1}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Gym days per week. */
export function AttendanceChart({
  points,
  weeks,
  loading,
}: {
  points: AttendancePoint[];
  weeks: number;
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const range = useRangeLabel(weeks);
  const total = points.reduce((n, p) => n + p.days, 0);
  return (
    <ChartFrame
      title={t('progress.attendanceTitle')}
      summary={
        total > 0
          ? t('progress.summaryAttendance', {
              count: total,
              average: num(total / Math.max(1, points.length), lang),
              range,
            })
          : null
      }
      empty={total === 0}
      loading={loading}
      table={{
        head: [t('progress.week'), t('progress.days')],
        rows: points.map((p) => [shortDate(p.weekStart, lang), String(p.days)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={MARGIN} barCategoryGap="20%">
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={(d: string) => shortDate(d, lang)}
            minTickGap={24}
            {...axisProps}
          />
          <YAxis
            width={28}
            allowDecimals={false}
            domain={[0, 7]}
            ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
            {...axisProps}
          />
          <Tooltip
            formatter={(v) => [String(v), t('progress.days')]}
            labelFormatter={(d) => t('progress.weekOf', { date: shortDate(String(d), lang) })}
          />
          <Bar
            dataKey="days"
            fill={CHART.series1}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function MeasureLine({
  data,
  dataKey,
  title,
  unit,
  color,
}: {
  data: { date: string; value: number }[];
  dataKey: 'value';
  title: string;
  unit: string;
  color: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const first = data[0];
  const last = data.at(-1);
  return (
    <ChartFrame
      title={title}
      summary={
        first && last
          ? t('progress.summaryMeasure', {
              from: `${num(first.value, lang)} ${unit}`,
              to: `${num(last.value, lang)} ${unit}`,
            })
          : null
      }
      empty={data.length === 0}
      table={{
        head: [t('progress.date'), title],
        rows: data.map((d) => [shortDate(d.date, lang), `${num(d.value, lang)} ${unit}`]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => shortDate(d, lang)}
            minTickGap={24}
            {...axisProps}
          />
          <YAxis width={44} domain={['auto', 'auto']} {...axisProps} />
          <Tooltip
            formatter={(v) => [`${num(Number(v), lang)} ${unit}`, title]}
            labelFormatter={(d) => shortDate(String(d), lang)}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, fill: color, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Body weight and body fat: two charts, never one with two scales. Oldest day first. */
export function MeasurementsChart({ measurements }: { measurements: Measurement[] }) {
  const { t } = useTranslation();
  const oldestFirst = [...measurements].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  const series = (pick: (m: Measurement) => number | null) =>
    oldestFirst.flatMap((m) => {
      const v = pick(m);
      return v === null ? [] : [{ date: m.measuredOn, value: v }];
    });
  const weight = series((m) => m.weightKg);
  const fat = series((m) => m.bodyFatPct);
  return (
    <div className="flex flex-col gap-4">
      {weight.length > 0 && (
        <MeasureLine
          data={weight}
          dataKey="value"
          title={t('progress.weight')}
          unit="kg"
          color={CHART.series1}
        />
      )}
      {fat.length > 0 && (
        <MeasureLine
          data={fat}
          dataKey="value"
          title={t('progress.bodyFat')}
          unit="%"
          color={CHART.series1}
        />
      )}
    </div>
  );
}
