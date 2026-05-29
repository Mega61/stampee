import { env } from '../../config.js';
import type { EmailMessage } from '../types.js';

export const verifyTemplate = (params: {
  to: string;
  businessName: string;
  token: string;
}): EmailMessage => {
  const url = `${env.API_PUBLIC_URL.replace(/\/$/, '')}/auth/verify-email?token=${encodeURIComponent(params.token)}`;
  const subject = 'Verify your Stampee account';
  const text = `Hi ${params.businessName || 'there'},

Confirm your email to finish setting up your Stampee account:

${url}

If you didn't sign up, ignore this email.`;
  const html = `<p>Hi ${escapeHtml(params.businessName || 'there')},</p>
<p>Confirm your email to finish setting up your Stampee account:</p>
<p><a href="${url}">Verify email</a></p>
<p>If you didn't sign up, ignore this email.</p>`;
  return { to: params.to, subject, text, html };
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
