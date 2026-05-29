import { env } from '../config.js';
import type { EmailAdapter, EmailMessage } from './types.js';

export const resendAdapter: EmailAdapter = {
  async send(msg: EmailMessage) {
    if (!env.RESEND_API_KEY) {
      throw new Error('EMAIL_ADAPTER=resend but RESEND_API_KEY is empty');
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Resend send failed: ${response.status} ${detail}`);
    }
  },
};
