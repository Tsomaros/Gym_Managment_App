import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Facing = 'environment' | 'user';

/** Looks at the video about 8 times a second: enough for a code held up for a moment. */
const FRAME_MS = 120;
/** Frames are shrunk before decoding; a code held at the door is large in the picture. */
const MAX_DECODE_WIDTH = 640;

/**
 * The tablet's camera, scanning QR codes continuously with jsQR (a pure-JS decoder that also works
 * in iPad Safari, which has no BarcodeDetector). The camera stays open while `paused` (a result is
 * showing), so scanning resumes at once; decoded text goes to `onToken`.
 */
export function KioskScanner({
  onToken,
  paused,
  caption,
}: {
  onToken: (token: string) => void;
  paused: boolean;
  /** A line under the controls, e.g. which gym and tablet this is. */
  caption?: string;
}) {
  const { t } = useTranslation();
  const [facing, setFacing] = useState<Facing>('environment');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  const onTokenRef = useRef(onToken);
  pausedRef.current = paused;
  onTokenRef.current = onToken;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    setFailed(false);

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [facing, attempt]);

  useEffect(() => {
    if (!ready || typeof requestAnimationFrame !== 'function') return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (pausedRef.current || now - last < FRAME_MS) return;
      last = now;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: 'dontInvert',
      });
      if (found?.data) onTokenRef.current(found.data);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="relative mx-auto flex h-dvh max-w-3xl flex-col items-center gap-3 p-4">
      <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">{t('kiosk.scanTitle')}</h1>
      <p className="text-lg text-slate-700 sm:text-xl">{t('kiosk.scanHint')}</p>

      {failed && (
        <div
          role="alert"
          className="flex w-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-amber-700 bg-amber-50 p-8 text-center text-xl text-amber-950"
        >
          <p>{t('kiosk.cameraDenied')}</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-14 rounded-lg bg-slate-900 px-6 text-xl font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {t('app.retry')}
          </button>
        </div>
      )}
      {/* Always mounted: a retry may get the camera before React shows it again. */}
      <div
        className={`relative min-h-0 w-full flex-1 overflow-hidden rounded-2xl bg-black ${failed ? 'hidden' : ''}`}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[12%] rounded-3xl border-4 border-white/80"
        />
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <button
        type="button"
        onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
        className="min-h-14 shrink-0 rounded-lg border-2 border-slate-500 px-6 text-lg font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {t('kiosk.switchCamera')}
      </button>
      {caption && <p className="shrink-0 text-sm text-slate-500">{caption}</p>}
    </div>
  );
}
