import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('shows the photo with the person named for screen readers', () => {
    render(<Avatar firstName="Μαρία" lastName="Νικολάου" photoUrl="https://f.test/m.jpg" />);
    expect(screen.getByRole('img', { name: 'Φωτογραφία: Μαρία Νικολάου' })).toHaveAttribute(
      'src',
      'https://f.test/m.jpg',
    );
  });

  it('says nothing about the picture when the name is written next to it', () => {
    render(
      <Avatar firstName="Μαρία" lastName="Νικολάου" photoUrl="https://f.test/m.jpg" decorative />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('shows initials without a photo', () => {
    render(<Avatar firstName="ελένη" lastName="Νικολάου" photoUrl={null} />);
    expect(screen.getByText('ΕΝ')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to initials when the signed link has expired and the picture is refused', () => {
    render(<Avatar firstName="Μαρία" lastName="Νικολάου" photoUrl="https://f.test/old.jpg" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('ΜΝ')).toBeInTheDocument();
  });

  it('tries again when a fresh link arrives after a refused one', () => {
    const { rerender } = render(
      <Avatar firstName="Μαρία" lastName="Νικολάου" photoUrl="https://f.test/old.jpg" />,
    );
    fireEvent.error(screen.getByRole('img'));
    rerender(<Avatar firstName="Μαρία" lastName="Νικολάου" photoUrl="https://f.test/new.jpg" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://f.test/new.jpg');
  });
});
