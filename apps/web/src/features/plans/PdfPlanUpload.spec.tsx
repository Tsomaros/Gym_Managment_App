import type { Plan } from '@gym/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { PdfPlanUpload } from './PdfPlanUpload';

const created = { id: 'p1', kind: 'pdf', title: 'Πρόγραμμα Νοεμβρίου' } as Plan;
const pdf = (name = 'plan.pdf', size = 2000) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });

describe('PdfPlanUpload', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  const onCreated = vi.fn<(p: Plan) => void>();

  beforeEach(async () => {
    await i18n.changeLanguage('el');
    onCreated.mockClear();
    fetchMock = vi.fn<typeof fetch>(async () => json(201, created));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderUpload = () =>
    render(<PdfPlanUpload gymId={GYM} memberId={MEMBER} onCreated={onCreated} />);

  it('sends the file and its title as one multipart request', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.type(screen.getByLabelText('Τίτλος'), '  Πρόγραμμα Νοεμβρίου ');
    await user.upload(screen.getByLabelText('Αρχείο PDF'), pdf('nov.pdf'));
    await user.click(screen.getByLabelText('Ενεργοποίηση αμέσως'));
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/gyms/${GYM}/members/${MEMBER}/plans/pdf`);
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('title')).toBe('Πρόγραμμα Νοεμβρίου');
    expect(form.get('activate')).toBe('true');
    expect((form.get('file') as File).name).toBe('nov.pdf');
    // The browser sets the multipart boundary itself.
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
  });

  it('does not activate unless asked', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.type(screen.getByLabelText('Τίτλος'), 'Χ');
    await user.upload(screen.getByLabelText('Αρχείο PDF'), pdf());
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0]![1]?.body as FormData).get('activate')).toBe('false');
  });

  it('needs a title and a file, and sends nothing without them', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Δώσε τίτλο.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Τίτλος'), 'Χ');
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Διάλεξε αρχείο PDF.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a file over 10 MB before sending it', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.type(screen.getByLabelText('Τίτλος'), 'Χ');
    await user.upload(screen.getByLabelText('Αρχείο PDF'), pdf('big.pdf', 10 * 1024 * 1024 + 1));
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Το αρχείο ξεπερνά τα 10 MB.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 10 MB', async () => {
    const user = userEvent.setup();
    renderUpload();
    await user.type(screen.getByLabelText('Τίτλος'), 'Χ');
    await user.upload(screen.getByLabelText('Αρχείο PDF'), pdf('edge.pdf', 10 * 1024 * 1024));
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('says what went wrong when the server refuses the file', async () => {
    fetchMock.mockImplementationOnce(async () => json(415, {}));
    const user = userEvent.setup();
    renderUpload();
    await user.type(screen.getByLabelText('Τίτλος'), 'Χ');
    await user.upload(screen.getByLabelText('Αρχείο PDF'), pdf());
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Το αρχείο δεν είναι έγκυρο PDF.')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();

    fetchMock.mockImplementationOnce(async () => json(413, {}));
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Το αρχείο ξεπερνά τα 10 MB.')).toBeInTheDocument();

    fetchMock.mockImplementationOnce(async () => json(500, {}));
    await user.click(screen.getByRole('button', { name: 'Αποστολή' }));
    expect(await screen.findByText('Δεν στάλθηκε το αρχείο. Δοκίμασε ξανά.')).toBeInTheDocument();
  });

  it('asks only for PDF files', () => {
    renderUpload();
    expect(screen.getByLabelText('Αρχείο PDF')).toHaveAttribute('accept', 'application/pdf');
  });
});
