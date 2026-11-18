import type { ProgressPhoto } from '@gym/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { ConsentCard } from './ConsentCard';
import { MeasurementForm } from './MeasurementForm';
import { MeasurementsList } from './MeasurementsList';
import { ProgressPhotos } from './ProgressPhotos';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function mockApi(handler: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input).replace(`/api/gyms/${GYM}`, '');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const call = { method: init?.method ?? 'GET', path, body };
      calls.push(call);
      return handler(call) ?? json(200, {});
    }),
  );
  return calls;
}

const photo = (id: string): ProgressPhoto => ({
  id,
  takenOn: '2027-05-10',
  url: `https://files.test/${id}?sig=${Math.random()}`,
  uploadedBy: null,
});

describe('health UI: what the reviews found', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('el');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('ConsentCard', () => {
    /** A parent that keeps the count, as PrivacyPage does. */
    function WithCount({ initial, fresh }: { initial: number; fresh: number }) {
      const [count, setCount] = useState(initial);
      return (
        <ConsentCard
          gymId={GYM}
          kind="photos"
          state={{ granted: true, at: '2027-05-02T08:00:00.000Z' }}
          itemCount={count}
          refreshCount={async () => setCount(fresh)}
          onChanged={vi.fn()}
        />
      );
    }

    it('reads the count again when the question opens, so the number is the one that will go', async () => {
      mockApi(() => undefined);
      render(<WithCount initial={3} fresh={5} />);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Ανάκληση συγκατάθεσης' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Θα διαγραφούν οριστικά 5 φωτογραφίες.')).toBeInTheDocument();
      expect(
        within(dialog).getByText(/ο γυμναστής σου δεν θα έχει πια πρόσβαση/),
      ).toBeInTheDocument();
    });

    it('says plainly when there is nothing to delete', async () => {
      mockApi(() => undefined);
      render(<WithCount initial={0} fresh={0} />);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Ανάκληση συγκατάθεσης' }));
      expect(
        await screen.findByText('Δεν έχεις αποθηκευμένες φωτογραφίες να διαγραφούν.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Θα διαγραφούν οριστικά 0/)).not.toBeInTheDocument();
    });

    it('a double tap on "I agree" sends one request, then focus goes to the card and the result is announced', async () => {
      const calls = mockApi(() => undefined);
      const onChanged = vi.fn();
      render(
        <ConsentCard
          gymId={GYM}
          kind="measurements"
          state={{ granted: false, at: null }}
          itemCount={0}
          onChanged={onChanged}
        />,
      );
      const agree = screen.getByRole('button', { name: 'Συμφωνώ να αποθηκεύονται' });
      fireEvent.click(agree);
      fireEvent.click(agree);
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Μετρήσεις σώματος' })).toHaveFocus(),
      );
      expect(
        screen.getByText('Συμφώνησες: οι μετρήσεις σου θα αποθηκεύονται.'),
      ).toBeInTheDocument();
    });
  });

  describe('MeasurementForm', () => {
    it('sends the day only when the trainer picked one', async () => {
      const calls = mockApi(() => json(201, {}));
      const user = userEvent.setup();
      render(<MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted onSaved={vi.fn()} />);
      await user.type(screen.getByLabelText('Βάρος (kg)'), '80');
      fireEvent.change(screen.getByLabelText('Ημέρα'), { target: { value: '2027-05-03' } });
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.body).toMatchObject({ measuredOn: '2027-05-03', weightKg: 80 });
    });

    it('an invalid value inside the closed "More" opens it, shows the message and moves focus there', async () => {
      const calls = mockApi(() => json(201, {}));
      const user = userEvent.setup();
      render(<MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted onSaved={vi.fn()} />);
      await user.type(screen.getByLabelText('Βάρος (kg)'), '80');
      await user.click(screen.getByText('Περισσότερα')); // open, type, close again
      await user.type(screen.getByLabelText('Μέση (cm)'), '5');
      await user.click(screen.getByText('Περισσότερα'));
      expect(screen.getByText('Περισσότερα').closest('details')).not.toHaveAttribute('open');
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      expect(screen.getByText('Περισσότερα').closest('details')).toHaveAttribute('open');
      const waist = screen.getByLabelText('Μέση (cm)');
      expect(waist).toHaveAccessibleDescription('Βάλε αριθμό από 10 έως 300.');
      await waitFor(() => expect(waist).toHaveFocus());
      expect(screen.getByRole('alert')).toHaveTextContent('Έλεγξε τα στοιχεία της φόρμας.');
      expect(calls).toHaveLength(0);
    });

    it('asks the parent to look again when the server says there is no consent (withdrawn elsewhere)', async () => {
      mockApi(() => json(409, { message: 'No consent' }));
      const onRejected = vi.fn();
      const user = userEvent.setup();
      render(
        <MeasurementForm
          gymId={GYM}
          memberId={MEMBER}
          consentGranted
          onSaved={vi.fn()}
          onRejected={onRejected}
        />,
      );
      await user.type(screen.getByLabelText('Βάρος (kg)'), '80');
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      await waitFor(() => expect(onRejected).toHaveBeenCalled());
    });
  });

  describe('ProgressPhotos', () => {
    it('a thumbnail that keeps failing does not make the list reload without end', async () => {
      const calls = mockApi(() => json(200, [photo('p1'), photo('p2'), photo('p3')]));
      render(<ProgressPhotos gymId={GYM} memberId={MEMBER} canWrite={false} consentGranted />);
      const images = await waitFor(() => {
        const found = document.querySelectorAll('img');
        expect(found).toHaveLength(3);
        return [...found];
      });
      const gets = () => calls.filter((c) => c.method === 'GET').length;
      expect(gets()).toBe(1);
      for (let round = 0; round < 5; round++) {
        for (const img of images) fireEvent.error(img);
      }
      await waitFor(() => expect(gets()).toBe(2)); // one reload for the first failure, none after
      for (const img of images) fireEvent.error(img);
      expect(gets()).toBe(2);
    });

    it('a read-only trainer is told when the client has not consented, not that there are no photos', async () => {
      mockApi(() => json(200, []));
      render(
        <ProgressPhotos gymId={GYM} memberId={MEMBER} canWrite={false} consentGranted={false} />,
      );
      expect(
        await screen.findByText('Ο πελάτης δεν έχει δώσει συγκατάθεση για φωτογραφίες.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Δεν υπάρχουν φωτογραφίες ακόμη.')).not.toBeInTheDocument();
    });

    it('the add button keeps keyboard focus while a photo uploads, and the result is announced', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
        cb(new Blob(['x'], { type: 'image/jpeg' })),
      );
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() })),
      );
      mockApi((c) => (c.method === 'POST' ? json(201, photo('new')) : json(200, [])));
      const user = userEvent.setup();
      render(<ProgressPhotos gymId={GYM} canWrite consentGranted />);
      const add = await screen.findByRole('button', { name: 'Προσθήκη φωτογραφίας' });
      add.focus();
      await user.upload(
        screen.getByLabelText('Προσθήκη φωτογραφίας', { selector: 'input' }),
        new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
      );
      expect(await screen.findByText('Η φωτογραφία προστέθηκε.')).toBeInTheDocument();
      expect(add).toBeEnabled(); // aria-disabled, never `disabled`: focus is never dropped
      vi.restoreAllMocks();
    });
  });

  describe('MeasurementsList', () => {
    it('without consent a read-only viewer sees why there is nothing, and with consent the empty note', () => {
      const { rerender } = render(
        <MeasurementsList
          gymId={GYM}
          memberId={MEMBER}
          measurements={[]}
          canDelete={false}
          consentGranted={false}
          onChanged={vi.fn()}
        />,
      );
      expect(
        screen.getByText('Ο πελάτης δεν έχει δώσει συγκατάθεση για μετρήσεις.'),
      ).toBeInTheDocument();
      rerender(
        <MeasurementsList
          gymId={GYM}
          memberId={MEMBER}
          measurements={[]}
          canDelete={false}
          onChanged={vi.fn()}
        />,
      );
      expect(screen.getByText(/Δεν υπάρχουν μετρήσεις ακόμη/)).toBeInTheDocument();
    });
  });
});
