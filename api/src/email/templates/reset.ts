import { env } from '../../config.js';
import type { EmailMessage } from '../types.js';

export const resetTemplate = (params: { to: string; token: string }): EmailMessage => {
  const url = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(params.token)}`;
  const subject = 'Reset your Stampee password';
  const text = `Someone requested a password reset for your Stampee account.

Reset it here (link valid for 1 hour):

${url}

If this wasn't you, ignore this email — your password stays unchanged.`;
  const html = `<p>Someone requested a password reset for your Stampee account.</p>
<p><a href="${url}">Reset password</a> (link valid for 1 hour)</p>
<p>If this wasn't you, ignore this email — your password stays unchanged.</p>`;
  return { to: params.to, subject, text, html };
};
