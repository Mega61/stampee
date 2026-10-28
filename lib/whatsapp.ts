// WhatsApp links (api.whatsapp.com — not wa.me: its redirect mangles emoji
// into U+FFFD). The API's wallet passes build the same booking link
// (api/src/lib/wallet/passContent.ts); keep the two in step.

/**
 * International digits for a phone number. Colombian mobiles are stored as
 * 10 digits starting with 3, so those get the 57 prefix; anything else is
 * used as-is. Null when it can't be a phone number.
 */
export const whatsAppDigits = (phone?: string | null): string | null => {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (digits.length < 7) return null;
  return digits.length === 10 && digits.startsWith('3') ? `57${digits}` : digits;
};

/** Best-effort chat link to `phone`, optionally prefilled with `text`. */
export const buildWhatsAppUrl = (phone?: string | null, text?: string) => {
  const international = whatsAppDigits(phone);
  if (!international) return null;
  const query = text ? `&text=${encodeURIComponent(text)}` : '';
  return `https://api.whatsapp.com/send?phone=${international}${query}`;
};

/** What a client sends when tapping the business's WhatsApp on the card. */
export const BOOKING_MESSAGE = 'Hola. Quiero agendar!';

/** The business's "book by WhatsApp" link (card social row, wallet passes). */
export const buildBookingWhatsAppUrl = (phone?: string | null) => buildWhatsAppUrl(phone, BOOKING_MESSAGE);
