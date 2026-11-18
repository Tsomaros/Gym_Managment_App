import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { presentMember } from '../../test/fixtures';
import { PresentList } from './PresentList';

const two = [presentMember({ checkInId: 'a' }), presentMember({ checkInId: 'b' })];

describe('PresentList and the gym capacity', () => {
  const heading = () => screen.getByRole('heading', { name: /Μέσα τώρα/ });

  it('shows how many are inside out of the capacity when one is set', () => {
    render(
      <PresentList members={two} capacity={30} onCheckOut={vi.fn()} timeZone="Europe/Athens" />,
    );
    expect(heading()).toHaveTextContent('2 / 30');
  });

  it('shows just the count when the gym has no capacity', () => {
    render(
      <PresentList members={two} capacity={null} onCheckOut={vi.fn()} timeZone="Europe/Athens" />,
    );
    expect(heading()).toHaveTextContent('2');
    expect(heading().textContent).not.toContain('/');
  });

  it('keeps working when no capacity is passed at all', () => {
    render(<PresentList members={two} onCheckOut={vi.fn()} timeZone="Europe/Athens" />);
    expect(heading()).toHaveTextContent('2');
  });

  it('says "out of" to a screen reader, not just a slash', () => {
    render(
      <PresentList members={two} capacity={30} onCheckOut={vi.fn()} timeZone="Europe/Athens" />,
    );
    expect(screen.getByText('από 30 άτομα', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('says "1 άτομο", not "1 άτομα", for a gym that holds one person', () => {
    render(
      <PresentList members={two} capacity={1} onCheckOut={vi.fn()} timeZone="Europe/Athens" />,
    );
    expect(screen.getByText('από 1 άτομο', { selector: '.sr-only' })).toBeInTheDocument();
  });
});
