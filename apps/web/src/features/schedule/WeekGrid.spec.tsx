import type { ExpandedShift, ScheduleStaff } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { weekDates } from './dates';
import { WeekGrid } from './WeekGrid';

const NIKOS: ScheduleStaff = {
  userId: '2b2b2b2b-2222-4222-8222-222222222222',
  firstName: 'Νίκος',
  lastName: 'Γυμναστής',
  roles: ['trainer'],
};
const MARIA: ScheduleStaff = {
  userId: '1a1a1a1a-1111-4111-8111-111111111111',
  firstName: 'Μαρία',
  lastName: 'Υποδοχή',
  roles: ['reception'],
};
const shift = (over: Partial<ExpandedShift>): ExpandedShift => ({
  staffId: NIKOS.userId,
  date: '2027-05-03',
  startsAt: '06:00',
  endsAt: '14:00',
  seriesId: 's1',
  shiftId: null,
  note: null,
  ...over,
});
const days = weekDates('2027-05-03'); // Monday 3 May … Sunday 9 May 2027

function renderGrid(over: Partial<Parameters<typeof WeekGrid>[0]> = {}) {
  const onAdd = vi.fn();
  const onOpen = vi.fn();
  render(
    <WeekGrid
      days={days}
      staff={[NIKOS, MARIA]}
      shifts={[shift({}), shift({ date: '2027-05-05', startsAt: '08:00', endsAt: '16:00' })]}
      today="2027-05-04"
      editable
      narrow={false}
      onAdd={onAdd}
      onOpen={onOpen}
      {...over}
    />,
  );
  return { onAdd, onOpen };
}

describe('WeekGrid', () => {
  it('places a Monday 06:00–14:00 shift under Monday, in the row of its person', () => {
    renderGrid({ today: '2027-05-03' });
    const row = screen.getByRole('row', { name: /Νίκος Γυμναστής/ });
    const cells = within(row).getAllByRole('cell');
    expect(within(cells[0]!).getByText('06:00–14:00')).toBeInTheDocument();
    expect(within(cells[1]!).queryByText(/\d\d:\d\d/)).not.toBeInTheDocument();
    expect(within(cells[2]!).getByText('08:00–16:00')).toBeInTheDocument();
    const maria = screen.getByRole('row', { name: /Μαρία Υποδοχή/ });
    expect(within(maria).queryByText(/\d\d:\d\d/)).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Δευτέρα/ })).toBeInTheDocument();
  });

  it('opens a future shift and adds to an empty future cell; past days offer nothing', async () => {
    const user = userEvent.setup();
    const { onAdd, onOpen } = renderGrid(); // today is Tuesday 4 May: Monday is past
    expect(
      screen.queryByRole('button', { name: /06:00–14:00/ }), // Monday's shift: past, plain text
    ).not.toBeInTheDocument();
    expect(screen.getByText('06:00–14:00')).toBeInTheDocument();
    // the table has a column per day and add buttons only for Tuesday to Sunday
    expect(screen.getAllByRole('button', { name: /Προσθήκη βάρδιας.*Μαρία Υποδοχή/ })).toHaveLength(
      6,
    );
    await user.click(screen.getByRole('button', { name: /08:00–16:00/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ date: '2027-05-05' }), NIKOS);

    // no add button on the past Monday, one on the future Thursday
    expect(
      screen.queryByRole('button', { name: /Προσθήκη βάρδιας.*Νίκος Γυμναστής.*Δευτέρα/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /Προσθήκη βάρδιας.*Μαρία Υποδοχή.*Πέμπτη/ }),
    );
    expect(onAdd).toHaveBeenCalledWith(MARIA.userId, '2027-05-06');
  });

  it('shows no action at all when the viewer cannot edit', () => {
    renderGrid({ editable: false });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('08:00–16:00')).toBeInTheDocument();
  });

  it('becomes a day list on a narrow screen, with an add button per future day', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderGrid({ narrow: true });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
    const wednesday = screen.getByRole('heading', { name: /Τετάρτη/ }).closest('section')!;
    expect(within(wednesday).getByText(/Νίκος Γυμναστής/)).toBeInTheDocument();
    expect(within(wednesday).getByText(/08:00–16:00/)).toBeInTheDocument();
    const monday = screen.getByRole('heading', { name: /Δευτέρα/ }).closest('section')!;
    expect(within(monday).queryByRole('button', { name: /Προσθήκη/ })).not.toBeInTheDocument();
    await user.click(within(wednesday).getByRole('button', { name: /Προσθήκη βάρδιας/ }));
    expect(onAdd).toHaveBeenCalledWith(null, '2027-05-05');
  });

  it('marks today for assistive technology and no other day', () => {
    renderGrid();
    const header = screen.getByRole('columnheader', { name: /Τρίτη/ });
    expect(header).toHaveAttribute('aria-current', 'date');
    expect(screen.getByRole('columnheader', { name: /Δευτέρα/ })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('columnheader', { name: /Τετάρτη/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('keeps today itself editable: only days before today are read-only', async () => {
    const user = userEvent.setup();
    // today is Wednesday 5 May, the day of Nikos' 08:00 shift
    const { onAdd, onOpen } = renderGrid({ today: '2027-05-05' });
    await user.click(screen.getByRole('button', { name: /08:00–16:00/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ date: '2027-05-05' }), NIKOS);
    await user.click(
      screen.getByRole('button', { name: /Προσθήκη βάρδιας.*Μαρία Υποδοχή.*Τετάρτη/ }),
    );
    expect(onAdd).toHaveBeenCalledWith(MARIA.userId, '2027-05-05');
    // Tuesday is past: no add button
    expect(
      screen.queryByRole('button', { name: /Προσθήκη βάρδιας.*Μαρία Υποδοχή.*Τρίτη/ }),
    ).not.toBeInTheDocument();
  });

  it('on the day list: past shifts are plain text, future ones open, today is marked', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderGrid({ narrow: true });
    const monday = screen.getByRole('heading', { name: /Δευτέρα/ }).closest('section')!;
    expect(within(monday).getByText(/06:00–14:00/)).toBeInTheDocument();
    expect(within(monday).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Τρίτη/ }).closest('section')).toHaveAttribute(
      'aria-current',
      'date',
    );
    expect(monday).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: /Νίκος Γυμναστής.*08:00–16:00/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ date: '2027-05-05' }), NIKOS);
  });

  it('on the day list a viewer who cannot edit gets no buttons', () => {
    renderGrid({ narrow: true, editable: false });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(7);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/08:00–16:00/)).toBeInTheDocument();
  });
});
