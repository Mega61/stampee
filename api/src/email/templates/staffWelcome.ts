import { env } from '../../config.js';
import type { EmailMessage } from '../types.js';

// Phase 4 uses this when an owner creates a staff account.
export const staffWelcomeTemplate = (params: {
  to: string;
  staffName: string;
  ownerSlug: string;
  ownerBusinessName: string;
  pin: string;
}): EmailMessage => {
  const loginUrl = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/${params.ownerSlug}/staff`;
  const subject = `You've been added as staff at ${params.ownerBusinessName}`;
  const text = `Hi ${params.staffName},

${params.ownerBusinessName} has added you as a staff member on Stampee.

Sign in at: ${loginUrl}
Email:      ${params.to}
PIN:        ${params.pin}

Keep this PIN private. The owner can change it from their dashboard.`;
  const html = `<p>Hi ${escapeHtml(params.staffName)},</p>
<p><strong>${escapeHtml(params.ownerBusinessName)}</strong> has added you as a staff member on Stampee.</p>
<p>
  Sign in at: <a href="${loginUrl}">${loginUrl}</a><br/>
  Email: <code>${escapeHtml(params.to)}</code><br/>
  PIN: <code>${escapeHtml(params.pin)}</code>
</p>
<p>Keep this PIN private. The owner can change it from their dashboard.</p>`;
  return { to: params.to, subject, text, html };
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
