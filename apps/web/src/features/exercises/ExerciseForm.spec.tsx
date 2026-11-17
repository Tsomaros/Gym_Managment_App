import type { Exercise } from '@gym/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ExerciseForm } from './ExerciseForm';

const bench: Exercise = {
  id: '5a5a5a5a-5555-4555-8555-555555555555',
  nameEl: 'Πιέσεις στήθους',
  nameEn: 'Bench press',
  muscleGroup: 'chest',
  measure: 'weight_reps',
  archived: false,
  createdBy: null,
};

describe('ExerciseForm', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const onSaved = vi.fn<(e: Exercise) => void>();
  const onClose = vi.fn<() => void>();

  beforeEach(() => {
    onSaved.mockClear();
    onClose.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      json(init?.method === 'PATCH' ? 200 : 201, { ...bench, nameEl: 'Νέα κίνηση' }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderForm = (exercise?: Exercise) =>
    render(<ExerciseForm gymId={GYM} exercise={exercise} onSaved={onSaved} onClose={onClose} />);

  it('needs the Greek name and sends nothing without it', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Συμπλήρωσε αυτό το πεδίο.')).toBeInTheDocument();
    expect(screen.getByLabelText('Όνομα (ελληνικά)')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a name of only spaces as missing', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), '   ');
    await user.type(screen.getByLabelText('Όνομα (αγγλικά)'), 'Only English');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Συμπλήρωσε αυτό το πεδίο.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('adds an exercise: sends the trimmed names, group and measure, then reports it', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), '  Νέα κίνηση ');
    await user.type(screen.getByLabelText('Όνομα (αγγλικά)'), ' New move ');
    await user.selectOptions(screen.getByLabelText('Μυϊκή ομάδα'), 'legs');
    await user.selectOptions(screen.getByLabelText('Καταγραφή ως'), 'duration');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/exercises`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      nameEl: 'Νέα κίνηση',
      nameEn: 'New move',
      muscleGroup: 'legs',
      measure: 'duration',
    });
  });

  it('edits an exercise: starts from its values and sends a PATCH to its id', async () => {
    const user = userEvent.setup();
    renderForm(bench);
    expect(screen.getByLabelText('Όνομα (ελληνικά)')).toHaveValue('Πιέσεις στήθους');
    expect(screen.getByLabelText('Όνομα (αγγλικά)')).toHaveValue('Bench press');
    expect(screen.getByLabelText('Μυϊκή ομάδα')).toHaveValue('chest');
    await user.clear(screen.getByLabelText('Όνομα (αγγλικά)'));
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/exercises/${bench.id}`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      nameEl: 'Πιέσεις στήθους',
      nameEn: null,
    });
  });

  it('says so when the name is taken (409) and stays open', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), 'Σανίδα');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Υπάρχει ήδη άσκηση με αυτό το όνομα.')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('drops the name-taken message as soon as the name is changed', async () => {
    fetchMock.mockImplementationOnce(async () => json(409, {}));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), 'Σανίδα');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Υπάρχει ήδη άσκηση με αυτό το όνομα.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), '2');
    expect(screen.queryByText('Υπάρχει ήδη άσκηση με αυτό το όνομα.')).toBeNull();
  });

  it('shows a generic error when the API fails', async () => {
    fetchMock.mockImplementationOnce(async () => json(500, {}));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Όνομα (ελληνικά)'), 'Κάτι');
    await user.click(screen.getByRole('button', { name: 'Αποθήκευση' }));
    expect(await screen.findByText('Κάτι πήγε στραβά. Δοκίμασε ξανά.')).toBeInTheDocument();
  });
});
