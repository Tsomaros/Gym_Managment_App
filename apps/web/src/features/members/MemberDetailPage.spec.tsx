import type { MemberDetail } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, MEMBER, membership, monthlyType, payment } from '../../test/fixtures';
import { MemberDetailPage } from './MemberDetailPage';

const detail = (over: Partial<MemberDetail> = {}): MemberDetail => ({
  userId: MEMBER,
  photoUrl: null,
  firstName: 'Γιώργος',
  lastName: 'Παπαδόπουλος',
  email: 'g@x.gr',
  emailVerified: true,
  phone: '+306912345678',
  joinedAt: '2027-05-01T09:00:00Z',
  status: 'active',
  currentEndsOn: '2027-05-31',
  visitsLeft: null,
  dateOfBirth: '1990-05-17',
  emergencyContactName: 'Ελένη',
  emergencyContactPhone: '+306987654321',
  memberships: [membership()],
  payments: [],
  freezes: [],
  ...over,
});

describe('MemberDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  afterEach(() => vi.unstubAllGlobals());
  const setup = (d: MemberDetail) => {
    fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('membership-types') ? json(200, [monthlyType]) : json(200, d),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/members/${MEMBER}`]}>
        <Routes>
          <Route path="/g/:gymId/members/:memberId" element={<MemberDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };
  beforeEach(() => undefined);

  it('shows the person, their memberships with status, and freeze for a time membership', async () => {
    setup(detail());
    expect(
      await screen.findByRole('heading', { name: 'Γιώργος Παπαδόπουλος' }),
    ).toBeInTheDocument();
    expect(screen.getByText('+306912345678')).toBeInTheDocument();
    const m = screen.getByText('Μηνιαία').closest('li')!;
    expect(within(m).getByText('Ενεργή')).toBeInTheDocument();
    expect(within(m).getByRole('button', { name: /Πάγωμα/ })).toBeInTheDocument();
  });

  it.each([
    ['a visit pack', { kind: 'visits' as const, maxFreezeDays: 14 }],
    ['a type that allows no freezing', { maxFreezeDays: 0 }],
    ['an expired membership', { status: 'expired' as const }],
  ])('offers no freeze for %s', async (_name, over) => {
    setup(detail({ memberships: [membership(over)] }));
    const m = (await screen.findByText('Μηνιαία')).closest('li')!;
    expect(within(m).queryByRole('button', { name: /Πάγωμα/ })).toBeNull();
  });

  it('hides the payments section when the API sends none (reception)', async () => {
    setup(detail());
    await screen.findByRole('heading', { name: 'Γιώργος Παπαδόπουλος' });
    expect(screen.queryByRole('heading', { name: 'Πληρωμές' })).toBeNull();
  });

  it('shows payments to the owner', async () => {
    setup(detail({ payments: [payment()] }));
    expect(await screen.findByRole('heading', { name: 'Πληρωμές' })).toBeInTheDocument();
    expect(screen.getByText(/40,00 €/)).toBeInTheDocument();
  });

  it('opens the sell dialog', async () => {
    setup(detail());
    await userEvent.click(await screen.findByRole('button', { name: 'Νέα συνδρομή' }));
    expect(await screen.findByRole('dialog', { name: /Νέα συνδρομή/ })).toBeInTheDocument();
  });

  it('keeps the page and the sale confirmation when the refresh after a sale fails', async () => {
    let memberCalls = 0;
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('membership-types')) return json(200, [monthlyType]);
      if (init?.method === 'POST') return json(201, membership({ id: 'new' }));
      memberCalls++;
      return memberCalls === 1 ? json(200, detail()) : json(500, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/members/${MEMBER}`]}>
        <Routes>
          <Route path="/g/:gymId/members/:memberId" element={<MemberDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Νέα συνδρομή' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Μηνιαία/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Πώληση' }));

    expect(await screen.findByText('Η πώληση έγινε')).toBeInTheDocument();
    await waitFor(() => expect(memberCalls).toBe(2));
    // The member is still shown; the failed refresh doesn't replace the page with an error.
    expect(screen.getByRole('heading', { name: 'Γιώργος Παπαδόπουλος' })).toBeInTheDocument();
    expect(screen.getByText('Η πώληση έγινε')).toBeInTheDocument();
  });
});
