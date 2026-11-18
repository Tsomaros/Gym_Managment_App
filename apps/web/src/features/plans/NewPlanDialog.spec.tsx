import type { Plan, PlanSummary } from '@gym/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { NewPlanDialog } from './NewPlanDialog';

const TEMPLATES: PlanSummary[] = [
  {
    id: 'tpl-1',
    title: 'Ολόκληρο σώμα',
    kind: 'interactive',
    status: 'draft',
    activatedAt: null,
    archivedAt: null,
    authorName: 'Νίκος Γυμναστής',
    authorId: 'a',
  },
  {
    id: 'tpl-2',
    title: 'Πάνω σώμα',
    kind: 'interactive',
    status: 'draft',
    activatedAt: null,
    archivedAt: null,
    authorName: null,
    authorId: null,
  },
];

describe('NewPlanDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const onBlank = vi.fn<() => void>();
  const onCreated = vi.fn<(p: Plan) => void>();
  const onClose = vi.fn<() => void>();

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    onBlank.mockClear();
    onCreated.mockClear();
    onClose.mockClear();
    fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/plan-templates')) return json(200, TEMPLATES);
      if (url.endsWith('/from-template') && init?.method === 'POST')
        return json(201, { id: 'new-plan', title: 'Ολόκληρο σώμα' });
      return json(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderDialog = () =>
    render(
      <NewPlanDialog
        gymId={GYM}
        memberId={MEMBER}
        onBlank={onBlank}
        onCreated={onCreated}
        onClose={onClose}
      />,
    );

  it('offers a blank plan, a template or a PDF', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /Κενό πρόγραμμα/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Από πρότυπο/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Αρχείο PDF/ })).toBeInTheDocument();
  });

  it('a blank plan hands over to the editor and closes the dialog', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Κενό πρόγραμμα/ }));
    expect(onBlank).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('from a template: lists them, copies the chosen one, optionally activating it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Από πρότυπο/ }));
    const select = await screen.findByLabelText('Πρότυπο');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ολόκληρο σώμα — Νίκος Γυμναστής', 'Πάνω σώμα']);
    await user.click(screen.getByLabelText('Ενεργοποίηση αμέσως'));
    await user.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/from-template'))!;
    expect(String(call[0])).toBe(`/api/gyms/${GYM}/members/${MEMBER}/plans/from-template`);
    expect(JSON.parse(String(call[1]?.body))).toEqual({ templateId: 'tpl-1', activate: true });
  });

  it('copies the template that was picked, not just the first one', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Από πρότυπο/ }));
    await user.selectOptions(await screen.findByLabelText('Πρότυπο'), 'tpl-2');
    await user.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/from-template'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ templateId: 'tpl-2', activate: false });
  });

  it('says so when there are no templates', async () => {
    fetchMock.mockImplementationOnce(async () => json(200, []));
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Από πρότυπο/ }));
    expect(await screen.findByText('Δεν υπάρχουν πρότυπα ακόμα.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Δημιουργία' })).toBeNull();
  });

  it('reports a failed copy and stays open', async () => {
    fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/plan-templates')
        ? json(200, TEMPLATES)
        : init?.method === 'POST'
          ? json(500, {})
          : json(404, {}),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Από πρότυπο/ }));
    await screen.findByLabelText('Πρότυπο');
    await user.click(screen.getByRole('button', { name: 'Δημιουργία' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Κάτι πήγε στραβά');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('the PDF choice shows the upload form, and Back returns to the choices', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /Αρχείο PDF/ }));
    expect(screen.getByLabelText('Αρχείο PDF')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Πίσω' }));
    expect(screen.getByRole('button', { name: /Κενό πρόγραμμα/ })).toBeInTheDocument();
  });
});
