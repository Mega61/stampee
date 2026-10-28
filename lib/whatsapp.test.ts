import { describe, expect, it } from 'vitest';
import { buildBookingWhatsAppUrl, buildWhatsAppUrl, whatsAppDigits } from './whatsapp';

describe('whatsapp links', () => {
  it('adds 57 to Colombian 10-digit mobiles, keeps international numbers', () => {
    expect(whatsAppDigits('+57 301 464 8943')).toBe('573014648943');
    expect(whatsAppDigits('301 464 8943')).toBe('573014648943');
    expect(whatsAppDigits('+1 (415) 555-0100')).toBe('14155550100');
    expect(whatsAppDigits('123')).toBeNull();
    expect(whatsAppDigits(undefined)).toBeNull();
  });

  it('booking link: prefilled "Hola. Quiero agendar!"', () => {
    expect(buildBookingWhatsAppUrl('+57 301 464 8943')).toBe(
      'https://api.whatsapp.com/send?phone=573014648943&text=Hola.%20Quiero%20agendar!',
    );
    expect(buildBookingWhatsAppUrl('')).toBeNull();
    expect(buildWhatsAppUrl('3014648943')).toBe('https://api.whatsapp.com/send?phone=573014648943');
  });
});
