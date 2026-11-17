import QRCode from 'qrcode';
import { useMemo } from 'react';

/** White modules around the code: scanners need them, so they are part of the image. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as one SVG path, generated locally (the token never leaves the device). Always
 * black on white, with its own quiet zone, so dark mode cannot invert it into something a
 * scanner cannot read.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { path, modules } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let d = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { path: d, modules: size };
  }, [value]);
  const full = modules + QUIET_ZONE * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      data-modules={modules}
      viewBox={`0 0 ${full} ${full}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full min-w-[260px] max-w-[22rem]"
    >
      <rect width={full} height={full} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
