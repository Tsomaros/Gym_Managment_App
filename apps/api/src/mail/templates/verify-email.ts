import type { Locale } from '@gym/shared';
import type { MailMessage } from '../mail.service';

export interface VerifyEmailMailData {
  to: string;
  firstName: string;
  link: string;
}

const templates: Record<Locale, (d: VerifyEmailMailData) => Omit<MailMessage, 'to'>> = {
  el: (d) => ({
    subject: 'Επιβεβαίωσε το email σου',
    text: [
      `Γεια σου ${d.firstName},`,
      '',
      'Άνοιξε τον παρακάτω σύνδεσμο για να επιβεβαιώσεις το email σου:',
      d.link,
      '',
      'Ο σύνδεσμος λήγει σε 72 ώρες.',
    ].join('\n'),
  }),
  en: (d) => ({
    subject: 'Confirm your email',
    text: [
      `Hi ${d.firstName},`,
      '',
      'Open this link to confirm your email address:',
      d.link,
      '',
      'The link expires in 72 hours.',
    ].join('\n'),
  }),
};

export function verifyEmailMail(locale: Locale, data: VerifyEmailMailData): MailMessage {
  return { to: data.to, ...templates[locale](data) };
}
