import type { Locale } from '@gym/shared';
import type { MailMessage } from '../mail.service';

export interface InviteMailData {
  to: string;
  firstName: string;
  gymName: string;
  link: string;
}

const templates: Record<Locale, (d: InviteMailData) => Omit<MailMessage, 'to'>> = {
  el: (d) => ({
    subject: `Πρόσκληση στο ${d.gymName}`,
    text: [
      `Γεια σου ${d.firstName},`,
      '',
      `Σε προσκάλεσαν στο ${d.gymName}. Άνοιξε τον παρακάτω σύνδεσμο για να ενεργοποιήσεις τον λογαριασμό σου:`,
      d.link,
      '',
      'Ο σύνδεσμος λήγει σε 72 ώρες.',
    ].join('\n'),
  }),
  en: (d) => ({
    subject: `Invitation to ${d.gymName}`,
    text: [
      `Hi ${d.firstName},`,
      '',
      `You have been invited to ${d.gymName}. Open this link to activate your account:`,
      d.link,
      '',
      'The link expires in 72 hours.',
    ].join('\n'),
  }),
};

export function inviteMail(locale: Locale, data: InviteMailData): MailMessage {
  return { to: data.to, ...templates[locale](data) };
}
