import { useTranslation } from 'react-i18next';

export type KioskOutcome =
  | { kind: 'ok'; firstName: string | null }
  | { kind: 'reception' }
  | { kind: 'codeExpired' }
  | { kind: 'connection' };

const STYLE = {
  ok: { background: 'bg-green-700', symbol: '✓' },
  reception: { background: 'bg-red-800', symbol: '!' },
  connection: { background: 'bg-red-800', symbol: '!' },
  codeExpired: { background: 'bg-slate-700', symbol: '↻' },
} as const;

/**
 * The verdict, full screen, readable from arm's length: colour, a symbol and words together.
 * Refusals never say why (privacy: the tablet faces the queue); reception sees the reason.
 */
export function KioskResult({ outcome }: { outcome: KioskOutcome }) {
  const { t } = useTranslation();
  const { background, symbol } = STYLE[outcome.kind];
  const text =
    outcome.kind === 'ok'
      ? outcome.firstName
        ? t('kiosk.welcome', { name: outcome.firstName })
        : t('kiosk.welcomeNoName')
      : outcome.kind === 'reception'
        ? t('kiosk.toReception')
        : outcome.kind === 'codeExpired'
          ? t('kiosk.codeExpired')
          : t('kiosk.connectionProblem');

  return (
    <div
      role="status"
      className={`fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 p-8 text-center text-white ${background}`}
    >
      <p className="text-8xl font-bold sm:text-9xl">
        <span aria-hidden="true">{symbol}</span>
      </p>
      <p className="max-w-3xl text-4xl font-bold break-words sm:text-6xl">{text}</p>
    </div>
  );
}
