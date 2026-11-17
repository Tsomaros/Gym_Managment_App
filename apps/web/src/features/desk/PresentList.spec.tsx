import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { presentMember, visitorRow } from '../../test/fixtures';
import { PresentList } from './PresentList';
import { VisitorsList } from './VisitorsList';

describe('PresentList', () => {
  it('lists who is inside with the count, the time and the status in words', () => {
    render(
      <PresentList
        members={[
          presentMember({ checkInId: 'a', firstName: 'Νίκος', lastName: 'Αλεξίου' }),
          presentMember({
            checkInId: 'b',
            memberId: 'm2',
            firstName: 'Ελένη',
            lastName: 'Νικολάου',
            membershipStatus: 'expiring',
            at: '2027-05-02T08:30:00.000Z',
          }),
        ]}
        onCheckOut={vi.fn()}
        timeZone="Europe/Athens"
      />,
    );
    expect(screen.getByRole('heading', { name: /Μέσα τώρα/ })).toHaveTextContent('2');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[1]!).getByText('Ελένη Νικολάου')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Λήγει σύντομα')).toBeInTheDocument();
    expect(within(items[1]!).getByText('11:30')).toBeInTheDocument(); // 08:30Z in Athens (summer)
  });

  it('checks a member out with the button named after them', async () => {
    const onCheckOut = vi.fn();
    render(
      <PresentList
        members={[presentMember({ checkInId: 'abc', firstName: 'Νίκος', lastName: 'Αλεξίου' })]}
        onCheckOut={onCheckOut}
        timeZone="Europe/Athens"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Έξοδος: Νίκος Αλεξίου' }));
    expect(onCheckOut).toHaveBeenCalledWith('abc');
  });

  it('says so when nobody is inside', () => {
    render(<PresentList members={[]} onCheckOut={vi.fn()} timeZone="Europe/Athens" />);
    expect(screen.getByText('Δεν υπάρχει κανείς μέσα.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Μέσα τώρα/ })).toHaveTextContent('0');
  });
});

describe('VisitorsList', () => {
  it("shows today's attempts: time, name, how, and refusals with their reason in words", () => {
    render(
      <VisitorsList
        timeZone="Europe/Athens"
        rows={[
          visitorRow({ checkInId: 'a', method: 'kiosk' }),
          visitorRow({
            checkInId: 'b',
            firstName: 'Ελένη',
            lastName: 'Νικολάου',
            method: 'manual',
            valid: false,
            reason: 'frozen',
          }),
          visitorRow({
            checkInId: 'c',
            firstName: 'Νίκος',
            lastName: 'Αλεξίου',
            checkedOutAt: '2027-05-02T09:00:00.000Z',
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Tablet')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Χειροκίνητα')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Η συνδρομή είναι σε πάγωμα')).toBeInTheDocument();
    expect(within(items[1]!).getByText(/Δεν επιτρέπεται/)).toBeInTheDocument();
    expect(within(items[2]!).getByText(/έξοδος 12:00/)).toBeInTheDocument();
    expect(items[1]!.textContent).not.toContain('frozen');
  });

  it('says so when nobody came', () => {
    render(<VisitorsList timeZone="Europe/Athens" rows={[]} />);
    expect(screen.getByText('Κανείς δεν πέρασε σήμερα.')).toBeInTheDocument();
  });
});
