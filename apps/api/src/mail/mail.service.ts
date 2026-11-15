import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

const FROM = 'Gym <no-reply@gym.local>';

/** Sends email over SMTP_URL (Mailpit locally). Tests replace this provider with a fake. */
@Injectable()
export class MailService {
  private transporter?: Transporter;

  async send(msg: MailMessage): Promise<void> {
    this.transporter ??= nodemailer.createTransport(getEnv().SMTP_URL);
    await this.transporter.sendMail({ from: FROM, ...msg });
  }
}
