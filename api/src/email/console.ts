import type { EmailAdapter, EmailMessage } from './types.js';

// Writes the full email to stdout in a grep-friendly format.
// `EMAIL ▶▶▶` markers bracket each message so tests can pluck them
// out of the log file deterministically.
export const consoleAdapter: EmailAdapter = {
  async send(msg: EmailMessage) {
    const line = '─'.repeat(60);
    // eslint-disable-next-line no-console
    console.log(
      [
        `EMAIL ▶▶▶ ${line}`,
        `to: ${msg.to}`,
        `subject: ${msg.subject}`,
        '',
        msg.text,
        `EMAIL ◀◀◀ ${line}`,
      ].join('\n'),
    );
  },
};
