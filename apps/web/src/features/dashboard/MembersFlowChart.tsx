import type { DashboardMemberMonth } from '@gym/shared';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { viewerLanguage } from '../exercises/exerciseName';
import { ChartFrame, LegendItem } from '../progress/ChartFrame';
import { CHART, GREEN_STRONG, MARGIN, SERIES } from '../progress/chartTheme';
import { monthAxisLabel, monthLabel } from './dashboardFormat';

const NEW_COLOR = GREEN_STRONG;
const LOST_COLOR = SERIES[1]; // orange

const axisProps = {
  tick: { fill: CHART.axis, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART.grid },
} as const;

/**
 * Active members as a line, new and not-renewed members as bars, all counts on one axis. Months
 * that are not over yet (a member may still renew) are drawn lighter and marked in the table.
 */
export function MembersFlowChart({ members }: { members: DashboardMemberMonth[] }) {
  const { t, i18n } = useTranslation();
  const lang = viewerLanguage(i18n.language);
  const last = members.at(-1);
  const previous = members.at(-2);
  const empty = members.every((m) => m.active === 0 && m.new === 0 && m.notRenewed === 0);
  const anyProvisional = members.some((m) => m.provisional);
  const data = members.map((m) => ({ ...m, label: monthAxisLabel(m.month, lang) }));
  const names = {
    active: t('dashboard.active'),
    new: t('dashboard.new'),
    notRenewed: t('dashboard.notRenewed'),
  };

  return (
    <ChartFrame
      title={t('dashboard.membersTitle')}
      summary={
        last && previous
          ? t('dashboard.membersSummary', {
              active: last.active,
              month: monthLabel(last.month, lang),
              previous: previous.active,
            })
          : null
      }
      empty={empty}
      emptyText={t('dashboard.empty')}
      legend={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <LegendItem color={CHART.series1} label={names.active} />
            <LegendItem color={NEW_COLOR} label={names.new} />
            <LegendItem color={LOST_COLOR} label={names.notRenewed} />
          </div>
          {anyProvisional && (
            <p className="text-sm text-slate-700">{t('dashboard.provisionalNote')}</p>
          )}
        </div>
      }
      table={{
        head: [t('dashboard.month'), names.active, names.new, names.notRenewed],
        rows: members.map((m) => [
          m.provisional
            ? `${monthLabel(m.month, lang)} · ${t('dashboard.provisional')}`
            : monthLabel(m.month, lang),
          String(m.active),
          String(m.new),
          String(m.notRenewed),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={MARGIN}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
          <YAxis {...axisProps} width={32} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="new" name={names.new} fill={NEW_COLOR} isAnimationActive={false}>
            {data.map((m) => (
              <Cell
                key={m.month}
                fill={NEW_COLOR}
                fillOpacity={m.provisional ? 0.55 : 1}
                stroke={m.provisional ? NEW_COLOR : 'none'}
                strokeWidth={2}
                strokeDasharray={m.provisional ? '4 3' : undefined}
              />
            ))}
          </Bar>
          <Bar
            dataKey="notRenewed"
            name={names.notRenewed}
            fill={LOST_COLOR}
            isAnimationActive={false}
          >
            {data.map((m) => (
              <Cell
                key={m.month}
                fill={LOST_COLOR}
                fillOpacity={m.provisional ? 0.55 : 1}
                stroke={m.provisional ? LOST_COLOR : 'none'}
                strokeWidth={2}
                strokeDasharray={m.provisional ? '4 3' : undefined}
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="active"
            name={names.active}
            stroke={CHART.series1}
            strokeWidth={2}
            dot={{ r: 4, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
