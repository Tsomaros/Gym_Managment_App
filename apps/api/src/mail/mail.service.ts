import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Connection settings for the mail server. The library waits minutes for a silent server; a send
 * that holds a database connection (see NotificationService) must give up within seconds.
 */
export function transportOptions(url: string) {
  return { url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 };
}

const FROM = 'Gym <no-reply@gym.local>';

/** Sends email over SMTP_URL (Mailpit locally). Tests replace this provider with a fake. */
@Injectable()
export class MailService {
  private transporter?: Transporter;

  async send(msg: MailMessage): Promise<void> {
    this.transporter ??= nodemailer.createTransport(transportOptions(getEnv().SMTP_URL));
    await this.transporter.sendMail({ from: FROM, ...msg });
  }
}
