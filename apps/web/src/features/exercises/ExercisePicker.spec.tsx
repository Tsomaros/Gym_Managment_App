import type { Exercise } from '@gym/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json } from '../../test/fixtures';
import { ExercisePicker } from './ExercisePicker';

const make = (
  n: number,
  nameEl: string,
  nameEn: string | null,
  group: Exercise['muscleGroup'],
): Exercise => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  nameEl,
  nameEn,
  muscleGroup: group,
  measure: 'weight_reps',
  archived: false,
  createdBy: null,
});
const BENCH = make(1, 'Πιέσεις στήθους', 'Bench press', 'chest');
const SQUAT = make(2, 'Βαθύ κάθισμα', 'Squat', 'legs');
const PLANK = make(3, 'Σανίδα', null, 'core');

describe('ExercisePicker', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const onPick = vi.fn<(e: Exercise) => void>();
  const onClose = vi.fn<() => void>();
  const urls = () => fetchMock.mock.calls.map(([u]) => decodeURIComponent(String(u)));

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    onPick.mockClear();
    onClose.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input), 'http://x');
      const q = url.searchParams.get('q');
      const group = url.searchParams.get('muscleGroup');
      const all = [BENCH, SQUAT, PLANK];
      return json(
        200,
        all.filter((e) => (!q || e.nameEl.includes(q)) && (!group || e.muscleGroup === group)),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPicker = () =>
    render(<ExercisePicker gymId={GYM} onPick={onPick} onClose={onClose} />);

  it('lists the library and focuses the search box', async () => {
    renderPicker();
    expect(await screen.findByRole('option', { name: /Πιέσεις στήθους/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Βαθύ κάθισμα/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Αναζήτηση άσκησης' })).toHaveFocus();
  });

  it('asks the API with the typed text after a short pause, not on every key', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    const before = fetchMock.mock.calls.length;
    await user.type(screen.getByRole('combobox'), 'Σαν');
    expect(fetchMock.mock.calls.length).toBe(before); // still waiting for the pause
    await waitFor(() => expect(urls().at(-1)).toContain('q=Σαν'), { timeout: 2000 });
    expect(fetchMock.mock.calls.length).toBe(before + 1); // one request for three keys
    await waitFor(() => expect(screen.queryByRole('option', { name: /Βαθύ κάθισμα/ })).toBeNull());
    expect(screen.getByRole('option', { name: /Σανίδα/ })).toBeInTheDocument();
  });

  it('never asks for archived exercises', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    await user.type(screen.getByRole('combobox'), 'α');
    await waitFor(() => expect(urls().some((u) => u.includes('q=α'))).toBe(true), {
      timeout: 2000,
    });
    expect(urls().every((u) => !u.includes('includeArchived'))).toBe(true);
  });

  it('filters by muscle group with a chip that says whether it is on', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    const chip = screen.getByRole('button', { name: 'Πόδια' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(urls().at(-1)).toContain('muscleGroup=legs'), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByRole('option', { name: /Σανίδα/ })).toBeNull());
    await user.click(chip); // off again
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(urls().at(-1)).not.toContain('muscleGroup'), { timeout: 2000 });
  });

  it('Enter picks the highlighted exercise; the arrows move the highlight', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    const input = screen.getByRole('combobox');
    const options = () => screen.getAllByRole('option');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options()[1]!.id);
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}'); // stops at the last one
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(SQUAT); // second of three
  });

  it('clicking an exercise picks it', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByRole('option', { name: /Βαθύ κάθισμα/ }));
    expect(onPick).toHaveBeenCalledWith(SQUAT);
  });

  it('shows names in the viewer language, English falling back to Greek', async () => {
    await i18n.changeLanguage('en');
    renderPicker();
    expect(await screen.findByRole('option', { name: /Bench press/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Σανίδα/ })).toBeInTheDocument(); // no English name
    await i18n.changeLanguage('el');
  });

  it('says so when nothing matches, and when the library cannot be loaded', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    await user.type(screen.getByRole('combobox'), 'ζζζ');
    expect((await screen.findAllByText('Καμία άσκηση δεν ταιριάζει.')).length).toBeGreaterThan(0);
    fetchMock.mockImplementation(async () => json(500, {}));
    await user.type(screen.getByRole('combobox'), 'ξ');
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
  });

  it('ignores Enter while the list is out of date, then picks from the fresh list', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (new URL(String(input), 'http://x').searchParams.get('q')) await gate; // the slow answer
      return base(input, init);
    });
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Βαθύ κάθισμα/ });
    await user.type(screen.getByRole('combobox'), 'Σαν');
    await user.keyboard('{Enter}'); // the old list still shows Πιέσεις στήθους first
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(urls().at(-1)).toContain('q=Σαν'), { timeout: 2000 });
    await user.keyboard('{Enter}'); // the request is in flight, still not fresh
    expect(onPick).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false'));
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(PLANK);
  });

  it('ignores Enter right after a muscle group is switched, until its list arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (new URL(String(input), 'http://x').searchParams.get('muscleGroup')) await gate;
      return base(input, init);
    });
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    await user.click(screen.getByRole('button', { name: 'Πόδια' }));
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(screen.queryByRole('option', { name: /Σανίδα/ })).toBeNull());
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(SQUAT);
  });

  it('announces how many exercises match, and has no empty listbox when none do', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    expect(screen.getByRole('status')).toHaveTextContent('3 ασκήσεις');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByRole('combobox'), 'ζζζ');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getAllByText('Καμία άσκηση δεν ταιριάζει.').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('Καμία άσκηση δεν ταιριάζει.');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('never sends a query longer than the API accepts (80 characters)', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    await user.click(screen.getByRole('combobox'));
    await user.paste('α'.repeat(120));
    await waitFor(() => expect(urls().some((u) => u.includes('q='))).toBe(true), { timeout: 2000 });
    const sent = urls()
      .filter((u) => u.includes('q='))
      .at(-1)!;
    expect(new URL(sent, 'http://x').searchParams.get('q')!.length).toBeLessThanOrEqual(80);
  });

  it('mouse hover moves the highlight, so only one row looks selected', async () => {
    const user = userEvent.setup();
    renderPicker();
    const options = await screen.findAllByRole('option');
    await user.hover(options[2]!);
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    renderPicker();
    await screen.findByRole('option', { name: /Σανίδα/ });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
