import { describe, expect, it } from 'vitest';
import { buildKioskWhatsAppMessage, kioskNoticeKindForStamp, withCardSource } from './whatsappMessages';

const card = 'https://app.test/golden/abc';

describe('withCardSource', () => {
  it('appends src as the first or an extra query param', () => {
    expect(withCardSource(card, 'whatsapp')).toBe(`${card}?src=whatsapp`);
    expect(withCardSource(`${card}?a=1`, 'whatsapp')).toBe(`${card}?a=1&src=whatsapp`);
    expect(withCardSource(`${card}#x`, 'pwa')).toBe(`${card}?src=pwa#x`);
    expect(withCardSource('', 'whatsapp')).toBe('');
  });
});

describe('buildKioskWhatsAppMessage', () => {
  it('stamp: progress + tracked card link', () => {
    expect(
      buildKioskWhatsAppMessage({ kind: 'stamp', businessName: 'Golden Beauty Studio', stamps: 4, totalStamps: 10, cardUrl: card }),
    ).toBe(`¡Sumaste un sello en Golden Beauty Studio! Llevas 4/10 💛 Mira tu tarjeta: ${card}?src=whatsapp`);
  });

  it('complete: reward ready', () => {
    const text = buildKioskWhatsAppMessage({
      kind: 'complete', businessName: 'GBS', stamps: 10, totalStamps: 10, rewardName: 'Manicure gratis', cardUrl: card,
    });
    expect(text).toContain('¡Completaste tu tarjeta en GBS!');
    expect(text).toContain('Manicure gratis');
    expect(text).toContain('?src=whatsapp');
  });

  it('redeem: thanks, works without a link or business name', () => {
    const text = buildKioskWhatsAppMessage({ kind: 'redeem', stamps: 10, totalStamps: 10, rewardName: 'Corte' });
    expect(text).toBe('¡Tu Corte ya es tuyo! 🎁 Gracias por tu fidelidad 💛 En tu próxima visita empezamos una tarjeta nueva.');
  });

  it('picks complete when the stamp fills the card', () => {
    expect(kioskNoticeKindForStamp(9, 10)).toBe('stamp');
    expect(kioskNoticeKindForStamp(10, 10)).toBe('complete');
  });
});
