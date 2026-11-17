import type { MemberSummary } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { MembersPage } from './MembersPage';

const giorgos: MemberSummary = {
  userId: MEMBER,
  photoUrl: null,
  firstName: 'Γιώργος',
  lastName: 'Παπαδόπουλος',
  email: 'g@x.gr',
  emailVerified: false,
  phone: '+306912345678',
  joinedAt: '2027-05-01T09:00:00Z',
  status: 'new',
  currentEndsOn: null,
  visitsLeft: null,
};

describe('MembersPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async () => json(200, [giorgos]));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/members`]}>
        <Routes>
          <Route path="/g/:gymId/members" element={<MembersPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('lists members with their status in words and whether the email is confirmed', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /Γιώργος Παπαδόπουλος/ });
    expect(link).toHaveAttribute('href', `/g/${GYM}/members/${MEMBER}`);
    expect(within(link).getByText('Νέο μέλος')).toBeInTheDocument();
    expect(within(link).getByText('Email χωρίς επιβεβαίωση')).toBeInTheDocument();
  });

  it('searches and filters through the API', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Γιώργος/ });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Αναζήτηση' }), 'γιωργ');
    await userEvent.selectOptions(screen.getByLabelText('Κατάσταση'), 'Λήγει σύντομα');
    await waitFor(() => {
      const last = String(fetchMock.mock.calls.at(-1)![0]);
      expect(last).toContain(`q=${encodeURIComponent('γιωργ')}`);
      expect(last).toContain('status=expiring');
    });
  });
});
