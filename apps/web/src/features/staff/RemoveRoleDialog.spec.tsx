import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { RemoveRoleDialog } from './RemoveRoleDialog';

const USER = '2b2b2b2b-2222-4222-8222-222222222222';

describe('RemoveRoleDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onRemoved: ReturnType<typeof vi.fn<() => void>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    onRemoved = vi.fn();
    onCancel = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = (role: 'owner' | 'reception' | 'trainer') =>
    render(
      <RemoveRoleDialog
        gymId={GYM}
        person={{ userId: USER, name: 'Νίκος Γυμναστής' }}
        role={role}
        onRemoved={onRemoved}
        onCancel={onCancel}
      />,
    );

  it('warns about clients and shifts for a trainer before anything is sent', async () => {
    renderDialog('trainer');
    expect(
      await screen.findByText(/οι πελάτες που έχει θα μείνουν χωρίς γυμναστή/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not show the trainer warning for another role', async () => {
    renderDialog('reception');
    const dialog = await screen.findByRole('alertdialog');
    // The question itself is shown (so the dialog is rendered), without the trainer warning.
    expect(dialog).toHaveTextContent('Να αφαιρεθεί ο ρόλος «Υποδοχή» από τον/την Νίκος Γυμναστής;');
    expect(dialog).not.toHaveTextContent(/πελάτες|βάρδιες/);
  });

  it('deletes the role on confirm and reports it', async () => {
    const user = userEvent.setup();
    renderDialog('trainer');
    await user.click(await screen.findByRole('button', { name: 'Αφαίρεση' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/staff/${USER}/roles/trainer`);
    expect(init?.method).toBe('DELETE');
  });

  it('explains a 409 for the last owner and stays open', async () => {
    fetchMock.mockImplementationOnce(async () =>
      json(409, { message: 'A gym needs at least one owner' }),
    );
    const user = userEvent.setup();
    renderDialog('owner');
    await user.click(await screen.findByRole('button', { name: 'Αφαίρεση' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Το γυμναστήριο χρειάζεται τουλάχιστον έναν ιδιοκτήτη.',
    );
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('shows the generic error, not the last-owner text, for a 409 on another role', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderDialog('trainer');
    await user.click(await screen.findByRole('button', { name: 'Αφαίρεση' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Κάτι πήγε στραβά');
    expect(alert).not.toHaveTextContent('ιδιοκτήτη');
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('cancels without calling the API', async () => {
    const user = userEvent.setup();
    renderDialog('trainer');
    await user.click(await screen.findByRole('button', { name: 'Άκυρο' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRemoved).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets the trainer warning apart from the question and links it to the dialog', async () => {
    renderDialog('trainer');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveAccessibleDescription(/Προσοχή: οι πελάτες που έχει/);
  });
});
