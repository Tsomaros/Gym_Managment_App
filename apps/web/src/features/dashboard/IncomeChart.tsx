import type { DashboardIncomeMonth } from '@gym/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../../lib/format';
import { viewerLanguage } from '../exercises/exerciseName';
import { ChartFrame, LegendItem } from '../progress/ChartFrame';
import { CHART, MARGIN, OTHER_COLOR, SERIES } from '../progress/chartTheme';
import { monthAxisLabel, monthLabel } from './dashboardFormat';

type Mode = 'method' | 'type';

/** 12500 → "12,5 χιλ. €" / "€12.5K": short enough for the axis. */
const compactEuros = (euros: number, lang: 'el' | 'en') =>
  new Intl.NumberFormat(lang === 'el' ? 'el-GR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(euros);

const axisProps = {
  tick: { fill: CHART.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;

/**
 * Money per month for the last 12 months: stacked bars by payment method, or by membership type
 * (the eight biggest types, the rest folded into "Other"). The last bar is the month in progress.
 */
export function IncomeChart({ income }: { income: DashboardIncomeMonth[] }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const [mode, setMode] = useState<Mode>('method');
  const money = (cents: number) => formatMoney(cents, lang);

  /** Types by total over the whole range, biggest first; they keep their colour in every month. */
  const types = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of income)
      for (const x of m.byType) totals.set(x.name, (totals.get(x.name) ?? 0) + x.cents);
    const names = [...totals]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([n]) => n);
    return { shown: names.slice(0, SERIES.length), folded: names.slice(SERIES.length) };
  }, [income]);

  const other = t('dashboard.other');
  const series =
    mode === 'method'
      ? [
          {
            key: 'cash',
            id: 'cash' as string | null,
            name: t('dashboard.cash'),
            color: CHART.series1,
          },
          {
            key: 'card',
            id: 'card' as string | null,
            name: t('dashboard.card'),
            color: CHART.series2,
          },
        ]
      : [
          // Keys are positions, never the type's name: a type called "label" or "Άλλες" is harmless.
          ...types.shown.map((name, i) => ({
            key: `t${i}`,
            id: name as string | null,
            name,
            color: SERIES[i]!,
          })),
          ...(types.folded.length
            ? [{ key: 'other', id: null as string | null, name: other, color: OTHER_COLOR }]
            : []),
        ];

  const cents = (m: DashboardIncomeMonth, s: { id: string | null }): number => {
    if (mode === 'method') return m.byMethod[s.id as 'cash' | 'card'];
    if (s.id === null) {
      return m.byType
        .filter((x) => types.folded.includes(x.name))
        .reduce((sum, x) => sum + x.cents, 0);
    }
    return m.byType.find((x) => x.name === s.id)?.cents ?? 0;
  };

  const last = income.at(-1);
  const previous = income.at(-2);
  const empty = income.every((m) => m.totalCents === 0);
  const data = income.map((m) => ({
    ...Object.fromEntries(series.map((s) => [s.key, cents(m, s) / 100])),
    label: monthAxisLabel(m.month, lang),
  }));

  return (
    <ChartFrame
      title={t('dashboard.incomeTitle')}
      summary={
        last && previous
          ? t('dashboard.incomeSummary', {
              current: money(last.totalCents),
              month: monthLabel(last.month, lang),
              previous: money(previous.totalCents),
            })
          : null
      }
      empty={empty}
      emptyText={t('dashboard.empty')}
      legend={
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label={t('dashboard.incomeTitle')}
            className="flex flex-wrap gap-2"
          >
            {(['method', 'type'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-11 rounded-md border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
                  mode === m
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-400 text-slate-900 hover:bg-slate-100'
                }`}
              >
                {t(m === 'method' ? 'dashboard.byMethod' : 'dashboard.byType')}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {series.map((s) => (
              <LegendItem key={s.key} color={s.color} label={s.name} />
            ))}
          </div>
        </div>
      }
      table={{
        head: [t('dashboard.month'), t('dashboard.total'), ...series.map((s) => s.name)],
        rows: income.map((m, i) => [
          i === income.length - 1
            ? `${monthLabel(m.month, lang)} · ${t('dashboard.currentMonth')}`
            : monthLabel(m.month, lang),
          money(m.totalCents),
          ...series.map((s) => money(cents(m, s))),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={MARGIN}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={52} tickFormatter={(v: number) => compactEuros(v, lang)} />
          <Tooltip formatter={(v) => money(Math.round(Number(v) * 100))} />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="income"
              fill={s.color}
              stroke={CHART.surface}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
