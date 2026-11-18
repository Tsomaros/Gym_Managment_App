import type { ClassTypeView } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ClassTypesPage } from './ClassTypesPage';
import { PILATES, SPINNING } from './test-data';

describe('ClassTypesPage', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let types: ClassTypeView[];

  beforeEach(() => {
    types = [SPINNING, PILATES, { ...SPINNING, id: 'z', name: 'Παλιό', nameEn: null, archived: true }];
    fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' || init?.method === 'PATCH' ? json(200, {}) : json(200, types),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={[`/g/${GYM}/classes`]}>
        <Routes>
          <Route path="/g/:gymId/classes" element={<ClassTypesPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const writes = () =>
    fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST' || i?.method === 'PATCH');

  it('lists the types with capacity and length; an archived one has no actions', async () => {
    renderPage();
    expect(await screen.findByText('Σπινινγκ')).toBeVisible();
    expect(screen.getAllByText('12 θέσεις · 45 λεπτά')).toHaveLength(2);
    const archived = screen.getByText('Παλιό').closest('li')!;
    expect(within(archived).getByText(/αρχειοθετημένο/)).toBeVisible();
    expect(within(archived).queryByRole('button')).not.toBeInTheDocument();
  });

  it('creates a type: blank fields are refused, then the values are sent', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέο είδος' }));
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(writes()).toHaveLength(0);
    const name = screen.getByLabelText('Όνομα');
    expect(name).toBeInvalid();
    await userEvent.type(name, 'Γιόγκα');
    await userEvent.clear(screen.getByLabelText(/Θέσεις/));
    await userEvent.type(screen.getByLabelText(/Θέσεις/), '15');
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(String(writes()[0]![0])).toBe(`/api/gyms/${GYM}/class-types`);
    expect(JSON.parse(String(writes()[0]![1]!.body))).toEqual({
      name: 'Γιόγκα',
      nameEn: null,
      description: null,
      defaultCapacity: 15,
      defaultDurationMinutes: 45,
    });
  });

  it('rejects a capacity of 0 and a length of 10 minutes', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέο είδος' }));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Χ');
    await userEvent.clear(screen.getByLabelText(/Θέσεις/));
    await userEvent.type(screen.getByLabelText(/Θέσεις/), '0');
    await userEvent.clear(screen.getByLabelText(/Διάρκεια/));
    await userEvent.type(screen.getByLabelText(/Διάρκεια/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(writes()).toHaveLength(0);
    expect(screen.getByLabelText(/Θέσεις/)).toBeInvalid();
    expect(screen.getByLabelText(/Διάρκεια/)).toBeInvalid();
  });

  // Limits from the shared schema: 1-200 spots, 15-240 minutes.
  it.each([
    ['201', '45'],
    ['12', '14'],
    ['12', '241'],
    ['1.5', '45'],
  ])('refuses %s spots with %s minutes', async (spots, minutes) => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέο είδος' }));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Χ');
    await userEvent.clear(screen.getByLabelText(/Θέσεις/));
    await userEvent.type(screen.getByLabelText(/Θέσεις/), spots);
    await userEvent.clear(screen.getByLabelText(/Διάρκεια/));
    await userEvent.type(screen.getByLabelText(/Διάρκεια/), minutes);
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(writes()).toHaveLength(0);
  });

  it.each([
    [1, 15],
    [200, 240],
  ])('accepts the limits %i spots and %i minutes', async (spots, minutes) => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Νέο είδος' }));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Χ');
    await userEvent.clear(screen.getByLabelText(/Θέσεις/));
    await userEvent.type(screen.getByLabelText(/Θέσεις/), String(spots));
    await userEvent.clear(screen.getByLabelText(/Διάρκεια/));
    await userEvent.type(screen.getByLabelText(/Διάρκεια/), String(minutes));
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0]![1]!.body))).toMatchObject({
      defaultCapacity: spots,
      defaultDurationMinutes: minutes,
    });
  });

  it('edits with a PATCH and archives only after a confirmation', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Επεξεργασία: Πιλάτες' }));
    expect(screen.getByLabelText('Περιγραφή')).toHaveValue('Mat');
    await userEvent.clear(screen.getByLabelText('Όνομα'));
    await userEvent.type(screen.getByLabelText('Όνομα'), 'Πιλάτες 2');
    await userEvent.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(String(writes()[0]![0])).toBe(`/api/gyms/${GYM}/class-types/${PILATES.id}`);
    expect(writes()[0]![1]!.method).toBe('PATCH');
    // Only the name changed; the rest is Pilates' own values (test-data.ts), sent back as they were.
    expect(JSON.parse(String(writes()[0]![1]!.body))).toEqual({
      name: 'Πιλάτες 2',
      nameEn: null,
      description: 'Mat',
      defaultCapacity: 10,
      defaultDurationMinutes: 50,
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Αρχειοθέτηση: Σπινινγκ' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(writes()).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
    expect(writes()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Αρχειοθέτηση: Σπινινγκ' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Αρχειοθέτηση' }),
    );
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(String(writes()[1]![0])).toBe(`/api/gyms/${GYM}/class-types/${SPINNING.id}/archive`);
  });
});
