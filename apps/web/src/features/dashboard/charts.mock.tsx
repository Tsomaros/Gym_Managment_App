import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * Recharts draws SVG with measured sizes, which jsdom cannot do: a stand-in that keeps the data,
 * the keys and the colours each chart passes in, so what the charts decide can be checked.
 * Use as `vi.mock('recharts', () => rechartsMock())`.
 */
export function rechartsMock() {
  const Box =
    (name: string) =>
    ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid={name} data-points={JSON.stringify(data ?? [])}>
        {children}
      </div>
    );
  const Mark = (name: string) => (props: Record<string, unknown>) => (
    <i
      data-testid={name}
      data-key={String(props.dataKey)}
      data-name={String(props.name ?? '')}
      data-color={String(props.fill ?? props.stroke)}
      data-stack={String(props.stackId ?? '')}
    />
  );
  return {
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    BarChart: Box('bar-chart'),
    ComposedChart: Box('composed-chart'),
    Bar: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => (
      <>
        {Mark('bar')(props)}
        {children}
      </>
    ),
    Cell: (props: Record<string, unknown>) => (
      <i data-testid="cell" data-opacity={String(props.fillOpacity ?? 1)} />
    ),
    Line: Mark('line'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
}

export const noop = vi.fn();
