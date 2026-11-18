import type { ConsentState, Measurement, ProgressPhoto } from '@gym/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { ConsentCard } from './ConsentCard';
import { HealthTab } from './HealthTab';
import { MeasurementForm } from './MeasurementForm';
import { PrivacyPage } from './PrivacyPage';
import { ProgressPhotos } from './ProgressPhotos';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const consent = (measurements: boolean, photos = false): ConsentState => ({
  measurements: { granted: measurements, at: measurements ? '2027-05-01T08:00:00.000Z' : null },
  photos: { granted: photos, at: photos ? '2027-05-02T08:00:00.000Z' : null },
});

const measurement = (
  id: string,
  measuredOn: string,
  over: Partial<Measurement> = {},
): Measurement => ({
  id,
  measuredOn,
  weightKg: 82.5,
  bodyFatPct: 18,
  waistCm: null,
  hipsCm: null,
  chestCm: null,
  armCm: null,
  thighCm: null,
  notes: null,
  recordedBy: null,
  ...over,
});

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

describe('health UI', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('el');
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('ConsentCard', () => {
    const renderCard = (state: ConsentState['measurements'], count = 3, onChanged = vi.fn()) =>
      render(
        <ConsentCard
          gymId={GYM}
          kind="measurements"
          state={state}
          itemCount={count}
          onChanged={onChanged}
        />,
      );

    it('explains what is stored and who sees it, and gives consent with "Συμφωνώ"', async () => {
      const calls = mockApi(() => undefined);
      const onChanged = vi.fn();
      renderCard({ granted: false, at: null }, 0, onChanged);
      expect(screen.getByText(/Δεν τα βλέπει ο ιδιοκτήτης ούτε η υποδοχή/)).toBeInTheDocument();
      expect(screen.getByText(/όποτε θέλεις/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ανάκληση' })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Συμφωνώ' }));
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(calls).toEqual([
        { method: 'POST', path: '/me/consents/measurements', body: undefined },
      ]);
    });

    it('withdrawing asks first, says how many will be deleted, and deletes only after confirming', async () => {
      const calls = mockApi(() => undefined);
      const onChanged = vi.fn();
      const user = userEvent.setup();
      renderCard({ granted: true, at: '2027-05-01T08:00:00.000Z' }, 3, onChanged);
      expect(screen.getByText(/Έδωσες τη συγκατάθεσή σου στις 1 Μαΐου 2027/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Ανάκληση' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Θα διαγραφούν οριστικά 3 μετρήσεις.')).toBeInTheDocument();
      expect(within(dialog).getByText(/δεν μπορεί να αναιρεθεί/)).toBeInTheDocument();
      expect(calls).toHaveLength(0); // nothing yet
      // cancelling keeps everything
      await user.click(within(dialog).getByRole('button', { name: 'Άκυρο' }));
      expect(calls).toHaveLength(0);
      expect(onChanged).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Ανάκληση' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ανάκληση' }),
      );
      await waitFor(() => expect(onChanged).toHaveBeenCalled());
      expect(calls).toEqual([
        { method: 'DELETE', path: '/me/consents/measurements', body: undefined },
      ]);
    });

    it('uses the singular for one item', async () => {
      mockApi(() => undefined);
      renderCard({ granted: true, at: '2027-05-01T08:00:00.000Z' }, 1);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Ανάκληση' }));
      expect(await screen.findByText('Θα διαγραφεί οριστικά 1 μέτρηση.')).toBeInTheDocument();
    });

    it('keeps the dialog open and says so when the withdrawal fails', async () => {
      mockApi(() => json(500, {}));
      const onChanged = vi.fn();
      const user = userEvent.setup();
      renderCard({ granted: true, at: '2027-05-01T08:00:00.000Z' }, 2, onChanged);
      await user.click(screen.getByRole('button', { name: 'Ανάκληση' }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Ανάκληση' }),
      );
      expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
        'Κάτι πήγε στραβά',
      );
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('MeasurementForm', () => {
    it('is off with a note when the member has not consented', async () => {
      const calls = mockApi(() => undefined);
      render(
        <MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted={false} onSaved={vi.fn()} />,
      );
      expect(screen.getByText('Δεν έχει δοθεί συγκατάθεση.')).toBeInTheDocument();
      expect(screen.getByLabelText('Βάρος (kg)')).toBeDisabled();
      expect(screen.getByLabelText('Ημέρα')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' })).toBeDisabled();
      expect(calls).toHaveLength(0);
    });

    it('sends the values with a Greek comma read as a decimal point, and clears the form', async () => {
      const calls = mockApi(() => json(201, {}));
      const onSaved = vi.fn();
      const user = userEvent.setup();
      render(<MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted onSaved={onSaved} />);
      await user.type(screen.getByLabelText('Βάρος (kg)'), '82,5');
      await user.type(screen.getByLabelText('Λίπος (%)'), '18');
      await user.click(screen.getByText('Περισσότερα'));
      await user.type(screen.getByLabelText('Μέση (cm)'), '84,5');
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: 'POST',
        path: `/members/${MEMBER}/measurements`,
        body: { weightKg: 82.5, bodyFatPct: 18, waistCm: 84.5 },
      });
      expect((calls[0]!.body as { measuredOn: string }).measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(screen.getByLabelText('Βάρος (kg)')).toHaveValue('');
      expect(screen.getByRole('status')).toHaveTextContent('Η μέτρηση αποθηκεύτηκε.');
    });

    it('checks the ranges before sending and names the field', async () => {
      const calls = mockApi(() => json(201, {}));
      const user = userEvent.setup();
      render(<MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted onSaved={vi.fn()} />);
      await user.type(screen.getByLabelText('Βάρος (kg)'), '19');
      await user.type(screen.getByLabelText('Λίπος (%)'), '18,25');
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      expect(screen.getByLabelText('Βάρος (kg)')).toHaveAccessibleDescription(
        'Βάλε αριθμό από 20 έως 400.',
      );
      expect(screen.getByLabelText('Λίπος (%)')).toHaveAccessibleDescription(
        'Βάλε αριθμό από 2 έως 70.',
      );
      expect(calls).toHaveLength(0);
    });

    it('asks for at least one value, and shows the server’s "no consent" answer', async () => {
      const user = userEvent.setup();
      let answer = json(409, { message: 'No consent' });
      mockApi(() => answer);
      render(<MeasurementForm gymId={GYM} memberId={MEMBER} consentGranted onSaved={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Βάλε τουλάχιστον μία τιμή.');
      await user.type(screen.getByLabelText('Βάρος (kg)'), '80');
      await user.click(screen.getByRole('button', { name: 'Αποθήκευση μέτρησης' }));
      expect(await screen.findByText('Δεν έχει δοθεί συγκατάθεση.')).toBeInTheDocument();
      answer = json(500, {});
    });
  });

  describe('ProgressPhotos', () => {
    const photo = (id: string, takenOn: string): ProgressPhoto => ({
      id,
      takenOn,
      url: `https://files.test/${id}?sig=1`,
      uploadedBy: null,
    });

    /** Canvas is not implemented in jsdom: record what would be drawn and encoded. */
    function mockCanvas() {
      const encoded: { width: number; height: number; type?: string; quality?: unknown }[] = [];
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
        () => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
        type?: string,
        quality?: unknown,
      ) {
        encoded.push({ width: this.width, height: this.height, type, quality });
        cb(new Blob(['jpeg'], { type: type ?? 'image/jpeg' }));
      });
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({ width: 3000, height: 2000, close: vi.fn() })),
      );
      return encoded;
    }

    it('resizes a 3000×2000 photo to 1200×800 before uploading it, with today as the day', async () => {
      const encoded = mockCanvas();
      let list = [photo('p1', '2027-05-10')];
      const calls = mockApi((c) => {
        if (c.method === 'GET') return json(200, list);
        if (c.method === 'POST') {
          list = [...list, photo('p2', '2027-05-12')];
          return json(201, list.at(-1));
        }
        return undefined;
      });
      const user = userEvent.setup();
      render(<ProgressPhotos gymId={GYM} memberId={MEMBER} canWrite consentGranted />);
      await screen.findByRole('button', { name: 'Άνοιγμα φωτογραφίας 10 Μαΐ' });
      const input = screen.getByLabelText('Προσθήκη φωτογραφίας');
      await user.upload(input, new File(['x'], 'big.jpg', { type: 'image/jpeg' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
      expect(encoded).toEqual([{ width: 1200, height: 800, type: 'image/jpeg', quality: 0.85 }]);
      const post = calls.find((c) => c.method === 'POST')!;
      expect(post.path).toBe(`/members/${MEMBER}/progress-photos`);
      const form = post.body as FormData;
      expect(form.get('takenOn')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((form.get('photo') as File).name).toBe('photo.jpg');
      expect(
        await screen.findByRole('button', { name: 'Άνοιγμα φωτογραφίας 12 Μαΐ' }),
      ).toBeInTheDocument();
    });

    it('a cover trainer sees the photos but no upload and no delete', async () => {
      mockApi(() => json(200, [photo('p1', '2027-05-10')]));
      render(<ProgressPhotos gymId={GYM} memberId={MEMBER} canWrite={false} consentGranted />);
      await screen.findByRole('button', { name: 'Άνοιγμα φωτογραφίας 10 Μαΐ' });
      expect(screen.queryByLabelText('Προσθήκη φωτογραφίας')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Διαγραφή φωτογραφίας/ }),
      ).not.toBeInTheDocument();
    });

    it('without consent the upload is off and says why', async () => {
      mockApi(() => json(200, []));
      render(<ProgressPhotos gymId={GYM} memberId={MEMBER} canWrite consentGranted={false} />);
      expect(await screen.findByText('Δεν υπάρχουν φωτογραφίες ακόμη.')).toBeInTheDocument();
      expect(screen.getByText('Δεν έχει δοθεί συγκατάθεση για φωτογραφίες.')).toBeInTheDocument();
      expect(screen.getByLabelText('Προσθήκη φωτογραφίας')).toBeDisabled();
    });

    it('deleting asks first and calls DELETE only after confirming', async () => {
      let list = [photo('p1', '2027-05-10')];
      const calls = mockApi((c) => {
        if (c.method === 'GET') return json(200, list);
        if (c.method === 'DELETE') {
          list = [];
          return new Response(null, { status: 204 });
        }
        return undefined;
      });
      const user = userEvent.setup();
      render(<ProgressPhotos gymId={GYM} canWrite consentGranted />);
      await user.click(await screen.findByRole('button', { name: 'Διαγραφή φωτογραφίας 10 Μαΐ' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
      await user.click(within(dialog).getByRole('button', { name: 'Διαγραφή' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
      // the member's own photos use the /me routes
      expect(calls.find((c) => c.method === 'DELETE')!.path).toBe('/me/progress-photos/p1');
      expect(await screen.findByText('Δεν υπάρχουν φωτογραφίες ακόμη.')).toBeInTheDocument();
    });

    it('shows the limit message when the server says there are too many photos', async () => {
      mockCanvas();
      mockApi((c) =>
        c.method === 'POST' ? json(409, { message: 'Too many photos' }) : json(200, []),
      );
      render(<ProgressPhotos gymId={GYM} canWrite consentGranted />);
      await screen.findByText('Δεν υπάρχουν φωτογραφίες ακόμη.');
      await userEvent
        .setup()
        .upload(
          screen.getByLabelText('Προσθήκη φωτογραφίας'),
          new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
        );
      expect(await screen.findByRole('alert')).toHaveTextContent('όριο των 200 φωτογραφιών');
    });

    it('asks for fresh links before the signed ones expire', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const calls = mockApi(() => json(200, [photo('p1', '2027-05-10')]));
      render(<ProgressPhotos gymId={GYM} canWrite={false} consentGranted />);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => void vi.advanceTimersByTime(4 * 60_000 + 100));
      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
      vi.useRealTimers();
    });
  });

  describe('HealthTab (the trainer’s view of a client)', () => {
    function api(consents: ConsentState, measurements: Measurement[]) {
      return mockApi((c) => {
        if (c.path.endsWith('/consents')) return json(200, consents);
        if (c.path.endsWith('/measurements')) return json(200, measurements);
        if (c.path.endsWith('/progress-photos')) return json(200, []);
        return undefined;
      });
    }
    const renderTab = (canWrite: boolean) =>
      render(<HealthTab gymId={GYM} memberId={MEMBER} canWrite={canWrite} />);

    it('the primary trainer sees the form (off without consent), the list and the photos', async () => {
      api(consent(false), []);
      renderTab(true);
      expect(await screen.findByRole('form', { name: 'Νέα μέτρηση' })).toBeInTheDocument();
      expect(screen.getByLabelText('Βάρος (kg)')).toBeDisabled();
      expect(screen.getByText('Δεν υπάρχουν μετρήσεις ακόμη.')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Φωτογραφίες προόδου' })).toBeInTheDocument();
    });

    it('with consent the form works and the measurements are listed newest first with delete', async () => {
      api(consent(true, true), [
        measurement('b', '2027-05-10'),
        measurement('a', '2027-04-01', { weightKg: 84 }),
      ]);
      renderTab(true);
      expect(await screen.findByLabelText('Βάρος (kg)')).toBeEnabled();
      const items = within(screen.getByRole('region', { name: 'Μετρήσεις' })).getAllByRole(
        'listitem',
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('10 Μαΐ · 82,5 kg · 18 %');
      expect(screen.getAllByRole('button', { name: /Διαγραφή μέτρησης/ })).toHaveLength(2);
      expect(screen.getByLabelText('Προσθήκη φωτογραφίας')).toBeEnabled();
    });

    it('a cover trainer sees the measurements but no form, no delete and no upload', async () => {
      api(consent(true, true), [measurement('b', '2027-05-10')]);
      renderTab(false);
      expect(await screen.findByText(/82,5 kg/)).toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Νέα μέτρηση' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Διαγραφή μέτρησης/ })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Προσθήκη φωτογραφίας')).not.toBeInTheDocument();
    });

    it('says so and offers a retry when the client’s data cannot be loaded', async () => {
      mockApi(() => json(500, {}));
      renderTab(true);
      const alert = await screen.findByRole('alert');
      expect(within(alert).getByRole('button', { name: 'Δοκίμασε ξανά' })).toBeInTheDocument();
    });
  });

  describe('PrivacyPage', () => {
    it('lists both consents, counts what withdrawing would delete, and reloads after a change', async () => {
      let state = consent(true, true);
      const calls = mockApi((c) => {
        if (c.method === 'DELETE') {
          state = consent(false, true);
          return new Response(null, { status: 204 });
        }
        if (c.path === '/me/consents') return json(200, state);
        if (c.path === '/me/measurements')
          return json(200, [measurement('a', '2027-05-10'), measurement('b', '2027-05-11')]);
        if (c.path === '/me/progress-photos') return json(200, []);
        return undefined;
      });
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={[`/g/${GYM}/privacy`]}>
          <Routes>
            <Route path="/g/:gymId/*" element={<PrivacyPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(
        await screen.findByRole('heading', { name: 'Ρυθμίσεις απορρήτου' }),
      ).toBeInTheDocument();
      const measurements = await screen.findByRole('region', { name: 'Μετρήσεις σώματος' });
      const photos = screen.getByRole('region', { name: 'Φωτογραφίες προόδου' });
      await user.click(within(measurements).getByRole('button', { name: 'Ανάκληση' }));
      expect(await screen.findByText('Θα διαγραφούν οριστικά 2 μετρήσεις.')).toBeInTheDocument();
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ανάκληση' }),
      );
      await waitFor(() =>
        expect(within(measurements).getByRole('button', { name: 'Συμφωνώ' })).toBeInTheDocument(),
      );
      // the photo consent was not touched
      expect(within(photos).getByRole('button', { name: 'Ανάκληση' })).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
        '/me/consents/measurements',
      ]);
    });
  });
});
