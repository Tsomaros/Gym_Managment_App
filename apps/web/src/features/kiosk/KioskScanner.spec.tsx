import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { KioskScanner } from './KioskScanner';

/** jsdom has no camera, so this covers the camera lifecycle; decoding is checked on real devices. */
describe('KioskScanner', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let tracks: { stop: ReturnType<typeof vi.fn> }[];

  const stream = () => {
    const track = { stop: vi.fn() };
    tracks.push(track);
    return { getTracks: () => [track] } as unknown as MediaStream;
  };
  const settle = () => act(async () => undefined);

  beforeEach(() => {
    tracks = [];
    getUserMedia = vi.fn(async () => stream());
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    // jsdom does not implement playing media
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('opens the rear camera without sound', async () => {
    render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('switches to the front camera and stops the rear one', async () => {
    render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Αλλαγή κάμερας' }));
    await settle();
    expect(tracks[0]!.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { facingMode: { ideal: 'user' } },
      audio: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Αλλαγή κάμερας' }));
    await settle();
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('releases the camera when it goes away', async () => {
    const { unmount } = render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    unmount();
    expect(tracks[0]!.stop).toHaveBeenCalled();
  });

  it('stops every camera it opened, including the front one, when it goes away', async () => {
    const { unmount } = render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Αλλαγή κάμερας' }));
    await settle();
    expect(tracks).toHaveLength(2);
    expect(tracks[1]!.stop).not.toHaveBeenCalled();
    unmount();
    expect(tracks[1]!.stop).toHaveBeenCalled();
  });

  it('stops a camera that was granted after the screen had already gone away', async () => {
    let grant!: () => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          grant = () => resolve(stream());
        }),
    );
    const { unmount } = render(<KioskScanner onToken={vi.fn()} paused={false} />);
    unmount();
    await act(async () => grant());
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.stop).toHaveBeenCalled();
  });

  it('shows a message and a retry button when the camera is refused, and retries', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Η κάμερα δεν είναι διαθέσιμη');

    fireEvent.click(screen.getByRole('button', { name: 'Δοκίμασε ξανά' }));
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // the video element survived the failure, so the new stream is attached to it
    const video = document.querySelector('video')!;
    expect(video).not.toBeNull();
    expect(video.srcObject).not.toBeNull();
  });

  it('shows the caption it is given', async () => {
    render(<KioskScanner onToken={vi.fn()} paused={false} caption="Γυμναστήριο · Είσοδος" />);
    await settle();
    expect(screen.getByText('Γυμναστήριο · Είσοδος')).toBeInTheDocument();
  });

  it('shows the same message when the browser has no camera API (not a secure page)', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Η κάμερα δεν είναι διαθέσιμη');
  });

  it('keeps the camera open while paused (a result is showing) so scanning resumes at once', async () => {
    const { rerender } = render(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    rerender(<KioskScanner onToken={vi.fn()} paused />);
    await settle();
    rerender(<KioskScanner onToken={vi.fn()} paused={false} />);
    await settle();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).not.toHaveBeenCalled();
  });
});
