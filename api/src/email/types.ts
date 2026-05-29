export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}
