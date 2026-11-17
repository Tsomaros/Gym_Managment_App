import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { InviteStaffDialog } from './InviteStaffDialog';

describe('InviteStaffDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onInvited: ReturnType<typeof vi.fn<(r: { mailSent: boolean }) => void>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async () => json(201, { invitationId: 'x', mailSent: true }));
    vi.stubGlobal('fetch', fetchMock);
    onInvited = vi.fn();
    onClose = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = () =>
    render(<InviteStaffDialog gymId={GYM} onClose={onClose} onInvited={onInvited} />);
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Όνομα'), 'Ελένη');
    await user.type(screen.getByLabelText('Επώνυμο'), 'Νέα');
    await user.type(screen.getByLabelText('Email'), ' New@X.gr ');
  }

  it('needs at least one role and sends nothing without it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    expect(await screen.findByText('Διάλεξε τουλάχιστον έναν ρόλο.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the chosen roles and normalised email, then reports success', async () => {
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    await user.click(screen.getByRole('checkbox', { name: 'Γυμναστής' }));
    await user.click(screen.getByRole('checkbox', { name: 'Υποδοχή' }));
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    await waitFor(() => expect(onInvited).toHaveBeenCalledTimes(1));
    expect(onInvited).toHaveBeenCalledWith({ mailSent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/invitations`);
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'new@x.gr',
      firstName: 'Ελένη',
      lastName: 'Νέα',
      roles: ['reception', 'trainer'],
    });
  });

  it('shows an error and stays open when the API refuses', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    await user.click(screen.getByRole('checkbox', { name: 'Ιδιοκτήτης' }));
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(onInvited).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('passes on that the email did not go out', async () => {
    fetchMock.mockImplementationOnce(async () => json(201, { invitationId: 'x', mailSent: false }));
    const user = userEvent.setup();
    renderDialog();
    await fill(user);
    await user.click(screen.getByRole('checkbox', { name: 'Υποδοχή' }));
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    await waitFor(() => expect(onInvited).toHaveBeenCalledWith({ mailSent: false }));
  });

  it.each(['not-an-email', ''])('sends nothing for the email %j', async (email) => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Όνομα'), 'Ελένη');
    await user.type(screen.getByLabelText('Επώνυμο'), 'Νέα');
    if (email) await user.type(screen.getByLabelText('Email'), email);
    await user.click(screen.getByRole('checkbox', { name: 'Υποδοχή' }));
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    expect(await screen.findByText('Δώσε έγκυρο email.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks each invalid field with its own message and moves focus to the first one', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Επώνυμο'), 'Νέα');
    await user.click(screen.getByRole('checkbox', { name: 'Γυμναστής' }));
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    const first = screen.getByLabelText('Όνομα');
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveFocus();
    expect(screen.getByLabelText('Επώνυμο')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a missing role together with the field errors in one submit', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Αποστολή πρόσκλησης' }));
    expect(screen.getByLabelText('Όνομα')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Διάλεξε τουλάχιστον έναν ρόλο.')).toBeInTheDocument();
  });
});
