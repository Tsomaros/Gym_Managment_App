import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { StatusBadge } from './StatusBadge';

const GREEK: Record<string, string> = {
  new: 'Νέο μέλος',
  active: 'Ενεργή',
  frozen: 'Σε πάγωμα',
  expiring: 'Λήγει σύντομα',
  expired: 'Έληξε',
  upcoming: 'Ξεκινά αργότερα',
  used_up: 'Εξαντλήθηκε',
  voided: 'Ακυρώθηκε',
};

describe('StatusBadge', () => {
  it.each(Object.entries(GREEK))('shows visible text for %s, not colour alone', (status, text) => {
    render(<StatusBadge status={status as never} />);
    expect(screen.getByText(text)).toBeVisible();
  });
});
