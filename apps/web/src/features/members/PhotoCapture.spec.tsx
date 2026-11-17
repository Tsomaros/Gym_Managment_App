import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { GYM, json, MEMBER } from '../../test/fixtures';
import { PhotoCapture } from './PhotoCapture';
import { resizeImage } from './resizeImage';

/** Canvas is not implemented in jsdom: record what would be drawn and encoded. */
function mockCanvas() {
  const encoded: { width: number; height: number; type?: string; quality?: unknown }[] = [];
  const drawn: [number, number, number, number][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) =>
          drawn.push([_x, _y, w, h]),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
    type?: string,
    quality?: unknown,
  ) {
    encoded.push({ width: this.width, height: this.height, type, quality });
    cb(new Blob(['jpeg-bytes'], { type: type ?? 'image/jpeg' }));
  });
  return { encoded, drawn };
}

function mockDecode(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close })),
  );
  return close;
}

const photo = (name = 'selfie.png') => new File(['raw'], name, { type: 'image/png' });

describe('resizeImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shrinks a 2000×1500 picture to 800×600 and encodes it as JPEG at quality 0.85', async () => {
    const { encoded, drawn } = mockCanvas();
    const close = mockDecode(2000, 1500);
    const blob = await resizeImage(photo());
    expect(encoded).toEqual([{ width: 800, height: 600, type: 'image/jpeg', quality: 0.85 }]);
    expect(drawn).toEqual([[0, 0, 800, 600]]);
    expect(blob.type).toBe('image/jpeg');
    expect(close).toHaveBeenCalled();
  });

  it('keeps the proportions of a portrait picture: 1500×2000 becomes 600×800', async () => {
    const { encoded } = mockCanvas();
    mockDecode(1500, 2000);
    await resizeImage(photo());
    expect(encoded[0]).toMatchObject({ width: 600, height: 800 });
  });

  it('never enlarges a small picture', async () => {
    const { encoded } = mockCanvas();
    mockDecode(500, 400);
    await resizeImage(photo());
    expect(encoded[0]).toMatchObject({ width: 500, height: 400 });
  });

  it('leaves a picture of exactly 800 px as it is', async () => {
    const { encoded } = mockCanvas();
    mockDecode(800, 800);
    await resizeImage(photo());
    expect(encoded[0]).toMatchObject({ width: 800, height: 800 });
  });

  it('rejects when the file cannot be read as a picture', async () => {
    mockCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('not an image')));
    await expect(resizeImage(photo('notes.txt'))).rejects.toThrow('not an image');
  });

  it('rejects when the browser cannot encode the picture', async () => {
    mockDecode(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(resizeImage(photo())).rejects.toThrow('could not encode');
  });

  it('rounds the shorter side to the nearest pixel: 1000×667 becomes 800×534', async () => {
    const { encoded } = mockCanvas();
    mockDecode(1000, 667);
    await resizeImage(photo());
    // 667 × 0.8 = 533.6, which is 534 rounded (533 if it were cut off)
    expect(encoded[0]).toMatchObject({ width: 800, height: 534 });
  });
});

describe('PhotoCapture', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onChanged: ReturnType<typeof vi.fn<() => void>>;
  let uploadStatus: number;

  beforeEach(() => {
    onChanged = vi.fn<() => void>();
    uploadStatus = 200;
    fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'PUT'
        ? uploadStatus === 200
          ? new Response(null, { status: 200 })
          : json(uploadStatus, {})
        : new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderIt = (photoUrl: string | null = null) =>
    render(
      <PhotoCapture
        gymId={GYM}
        memberId={MEMBER}
        name="Γιώργος Παπαδόπουλος"
        photoUrl={photoUrl}
        onChanged={onChanged}
      />,
    );
  const puts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT');

  it('asks for the camera on a phone and any picture on a computer', () => {
    renderIt();
    const input = screen.getByLabelText('Προσθήκη φωτογραφίας');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).toHaveAttribute('capture', 'user');
  });

  it('shows initials without a photo and the picture with one, and offers the right action', () => {
    const { unmount } = renderIt();
    expect(screen.getByText('ΓΠ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Αφαίρεση φωτογραφίας' })).not.toBeInTheDocument();
    unmount();

    renderIt('https://f.test/g.jpg');
    expect(screen.getByRole('img', { name: 'Φωτογραφία: Γιώργος Παπαδόπουλος' })).toHaveAttribute(
      'src',
      'https://f.test/g.jpg',
    );
    expect(screen.getByLabelText('Αλλαγή φωτογραφίας')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Αφαίρεση φωτογραφίας' })).toBeInTheDocument();
  });

  it('resizes a 2000×1500 picture to 800×600 and uploads that, not the original', async () => {
    const { encoded } = mockCanvas();
    mockDecode(2000, 1500);
    renderIt();
    await userEvent.upload(screen.getByLabelText('Προσθήκη φωτογραφίας'), photo());

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(encoded[0]).toMatchObject({ width: 800, height: 600 });
    const [url, init] = puts()[0]!;
    expect(url).toBe(`/api/gyms/${GYM}/members/${MEMBER}/photo`);
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const sent = body.get('photo') as File;
    expect(sent.size).toBe('jpeg-bytes'.length); // the resized bytes, not 'raw'
    expect(sent.type).toBe('image/jpeg');
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('shows a preview of the new picture while it uploads', async () => {
    mockCanvas();
    mockDecode(100, 100);
    const createUrl = vi.fn(() => 'blob:preview');
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 200 }));
        }),
    );
    renderIt();
    await userEvent.upload(screen.getByLabelText('Προσθήκη φωτογραφίας'), photo());
    expect(await screen.findByRole('img', { name: /Φωτογραφία/ })).toHaveAttribute(
      'src',
      'blob:preview',
    );
    expect(screen.getByText('Ανέβασμα…')).toBeInTheDocument();
    release();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it.each([415, 413, 500])(
    'says the photo did not go up when the server answers %s',
    async (status) => {
      mockCanvas();
      mockDecode(100, 100);
      uploadStatus = status;
      renderIt();
      await userEvent.upload(screen.getByLabelText('Προσθήκη φωτογραφίας'), photo());
      expect(await screen.findByRole('alert')).toHaveTextContent('Η φωτογραφία δεν ανέβηκε');
      expect(onChanged).not.toHaveBeenCalled();
    },
  );

  it('says so, and uploads nothing, when the file is not a picture', async () => {
    mockCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad')));
    renderIt();
    await userEvent.upload(screen.getByLabelText('Προσθήκη φωτογραφίας'), photo('x.txt'), {
      applyAccept: false,
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Η φωτογραφία δεν ανέβηκε');
    expect(puts()).toHaveLength(0);
  });

  it('removes the photo only after confirmation', async () => {
    renderIt('https://f.test/g.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Αφαίρεση φωτογραφίας' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Άκυρο' }));
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Αφαίρεση φωτογραφίας' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Αφαίρεση' }),
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, i]) => i?.method === 'DELETE')).toHaveLength(1),
    );
    expect(String(fetchMock.mock.calls.find(([, i]) => i?.method === 'DELETE')![0])).toBe(
      `/api/gyms/${GYM}/members/${MEMBER}/photo`,
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
