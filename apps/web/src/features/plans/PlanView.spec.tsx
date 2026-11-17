import type { Plan, PlanExercise } from '@gym/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { PlanView } from './PlanView';

const exercise = (over: Partial<PlanExercise> = {}): PlanExercise => ({
  id: 'e1',
  exerciseId: 'x1',
  exercise: {
    nameEl: 'Πιέσεις στήθους',
    nameEn: 'Bench press',
    muscleGroup: 'chest',
    measure: 'weight_reps',
    archived: false,
  },
  sets: 4,
  repsMin: 8,
  repsMax: 10,
  toFailure: false,
  weightKg: 50,
  restSeconds: 90,
  durationSeconds: null,
  notes: 'Αργά η κάθοδος',
  ...over,
});

const plan: Plan = {
  id: 'p1',
  memberId: 'm1',
  authorId: 't1',
  author: { firstName: 'Νίκος', lastName: 'Γυμναστής' },
  isTemplate: false,
  kind: 'interactive',
  title: 'Πάνω σώμα',
  notes: 'Τρεις φορές την εβδομάδα',
  status: 'active',
  pdfUrl: null,
  activatedAt: '2027-05-12T09:00:00.000Z',
  days: [
    {
      id: 'd1',
      title: 'Ημέρα Α – Στήθος',
      exercises: [
        exercise(),
        exercise({
          id: 'e2',
          exerciseId: 'x2',
          exercise: {
            nameEl: 'Έλξεις',
            nameEn: null,
            muscleGroup: 'back',
            measure: 'reps',
            archived: true,
          },
          toFailure: true,
          repsMin: null,
          repsMax: null,
          weightKg: null,
          restSeconds: null,
          notes: null,
        }),
      ],
    },
    { id: 'd2', title: 'Ημέρα Β – Πόδια', exercises: [] },
  ],
};

describe('PlanView', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('el');
  });
  afterEach(async () => {
    await i18n.changeLanguage('el');
  });

  it('shows the title, the notes and every day with its exercises, targets, rest and notes', () => {
    render(<PlanView plan={plan} />);
    expect(screen.getByRole('heading', { name: 'Πάνω σώμα' })).toBeInTheDocument();
    expect(screen.getByText('Τρεις φορές την εβδομάδα')).toBeInTheDocument();
    const dayA = screen.getByRole('region', { name: 'Ημέρα Α – Στήθος' });
    expect(within(dayA).getByText('Πιέσεις στήθους')).toBeInTheDocument();
    expect(within(dayA).getByText('4 × 8–10 @ 50 kg')).toBeInTheDocument();
    expect(within(dayA).getByText('ανάπαυση 90″')).toBeInTheDocument();
    expect(within(dayA).getByText('Αργά η κάθοδος')).toBeInTheDocument();
    expect(within(dayA).getByText('4 × max')).toBeInTheDocument(); // to failure
    expect(screen.getByRole('region', { name: 'Ημέρα Β – Πόδια' })).toHaveTextContent(
      'Χωρίς ασκήσεις.',
    );
  });

  it('marks an archived exercise that stays in the plan', () => {
    render(<PlanView plan={plan} />);
    expect(screen.getByText('Έλξεις')).toBeInTheDocument();
    expect(screen.getByText('(αρχειοθετημένη)')).toBeInTheDocument();
  });

  it('shows names in English, falling back to Greek when there is no English name', async () => {
    await i18n.changeLanguage('en');
    render(<PlanView plan={plan} />);
    expect(screen.getByText('Bench press')).toBeInTheDocument();
    expect(screen.getByText('Έλξεις')).toBeInTheDocument();
    expect(screen.getByText('rest 90″')).toBeInTheDocument();
  });

  it('as tabs: one panel at a time, the first day first, and arrows move between the days', async () => {
    const user = userEvent.setup();
    render(<PlanView plan={plan} layout="tabs" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Ημέρα Α – Στήθος', 'Ημέρα Β – Πόδια']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Πιέσεις στήθους');
    expect(screen.queryByText('Χωρίς ασκήσεις.')).toBeNull();
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')[1]).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Χωρίς ασκήσεις.');
    await user.click(screen.getAllByRole('tab')[0]!);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Πιέσεις στήθους');
  });

  it('a PDF plan offers a big open button (new tab, signed link) and a download', () => {
    const pdfPlan: Plan = {
      ...plan,
      kind: 'pdf',
      days: [],
      pdfUrl: 'https://files.example/plan.pdf?X-Amz-Signature=abc',
    };
    render(<PlanView plan={pdfPlan} />);
    const open = screen.getByRole('link', { name: 'Άνοιγμα PDF' });
    expect(open).toHaveAttribute('href', pdfPlan.pdfUrl);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('link', { name: 'Λήψη' })).toHaveAttribute('download');
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
