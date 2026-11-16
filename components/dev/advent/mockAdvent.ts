// DEV ONLY (/dev/advent): a fake advent API that follows the contract
// (docs/ADVENT_CONTRACT.md) on a simulated clock. Placeholder gifts only: the
// real door contents are private and seeded at deploy time.
import { useCallback, useMemo, useRef, useState } from 'react';
import { bogotaYmd } from '../../../lib/advent/viewModel';
import {
  AdventOpenError,
  type AdventController,
  type AdventDoor,
  type AdventOpenResult,
  type AdventReward,
  type AdventRewardKind,
  type AdventState,
  type CustomerGiftCard,
} from '../../../lib/advent/types';

const at = (d: string, h = 7, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).getTime();
const dec = (day: number) => `2026-12-${String(day).padStart(2, '0')}`;

export interface AdventScenario {
  id: string;
  label: string;
  desc: string;
  now: number;
  /** Day labels already opened. */
  opened: number[];
  /** Day labels whose coupon was used at the studio. */
  used?: number[];
  eligible?: boolean;
  /** Add a gift card received from someone else, still unconfirmed. */
  lockedGiftCard?: boolean;
}

export const SCENARIOS: AdventScenario[] = [
  { id: 'a', label: '2 dic · 6:59 a. m.', desc: 'Faltan segundos para la primera puerta.', now: at(dec(2), 6, 59), opened: [] },
  { id: 'b', label: '9 dic · 10:00 a. m.', desc: 'Ya abrió 3 puertas. La del 8 está lista.', now: at(dec(9), 10), opened: [2, 4, 6] },
  { id: 'c', label: '14 dic · 8:00 p. m.', desc: 'Puerta flash del 14 (48 h). También le quedó la del 12.', now: at(dec(14), 20), opened: [2, 4, 6, 8, 10] },
  { id: 'd', label: '24 dic · 7:00 a. m.', desc: 'Nochebuena: la gift card. Se le pasó la flash.', now: at(dec(24), 7), opened: [2, 4, 6, 8, 10, 12, 16, 18, 20, 22] },
  {
    id: 'e',
    label: '3 ene · 11:00 a. m.',
    desc: 'El calendario cerró: usados, vencidos, guardados para después y una gift card recibida sin confirmar.',
    now: at('2027-01-03', 11),
    opened: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
    used: [4, 8],
    lockedGiftCard: true,
  },
  { id: 'f', label: 'Sin visitas', desc: 'Calendario bloqueado: "Tu calendario te espera".', now: at(dec(9), 10), opened: [], eligible: false },
];

const KINDS: AdventRewardKind[] = ['coupon', 'coupon', 'bonus_stamps', 'coupon', 'coupon', 'coupon', 'coupon', 'coupon', 'coupon', 'link', 'double_stamps', 'gift_card'];
const FLASH_DOOR = 7;
const OPENS_UNTIL = new Date('2026-12-31T23:59:59-05:00').getTime();
const GIFT_CARD_ID = 'dev-gift-card';

const COMMON_TERMS = [
  'Condición común de ejemplo 1: un regalo por visita.',
  'Condición común de ejemplo 2: muestra el código en recepción antes de pagar.',
  'Condición común de ejemplo 3: no se cambia por dinero.',
];

const doorsSpec = Array.from({ length: 12 }, (_, i) => {
  const no = i + 1;
  const day = no * 2;
  return {
    no,
    day,
    kind: KINDS[i]!,
    unlockAt: at(dec(day)),
    flashUntil: no === FLASH_DOOR ? at(dec(day + 2)) : null,
  };
});

const rewardFor = (spec: (typeof doorsSpec)[number], openedAt: number, used: boolean, today: string): AdventReward => {
  const n = spec.no;
  const dated = spec.kind === 'coupon' || spec.kind === 'double_stamps';
  // Some gifts are usable only in January ("Guardada para después" in December).
  const validFrom = spec.kind === 'double_stamps' ? '2027-01-01' : dated ? (n % 4 === 0 ? '2027-01-02' : dec(spec.day)) : null;
  const validTo = dated ? (n === 2 ? '2027-01-02' : '2027-01-31') : null;
  const expired = !!validTo && today > validTo;
  return {
    id: `dev-reward-${n}`,
    doorNo: n,
    dayLabel: spec.day,
    kind: spec.kind,
    title: spec.kind === 'gift_card' ? 'Gift card de ejemplo' : `Regalo de ejemplo ${n}`,
    subtitle: `Texto de ejemplo del regalo ${n}.`,
    terms: [`Condición de ejemplo 1 del regalo ${n}.`, `Condición de ejemplo 2 del regalo ${n}.`],
    code: spec.kind === 'coupon' ? `GB-EJ${String(n).padStart(2, '0')}` : null,
    status: used ? 'redeemed' : expired ? 'expired' : 'available',
    validFrom,
    validTo,
    openedAt: new Date(openedAt).toISOString(),
    url: spec.kind === 'link' ? 'https://example.com/regalar?ref=adviento' : null,
    stamps: spec.kind === 'bonus_stamps' ? 1 : null,
    giftCardId: spec.kind === 'gift_card' ? GIFT_CARD_ID : null,
  };
};

const ADVENT_GIFT_CARD: CustomerGiftCard = {
  id: GIFT_CARD_ID,
  uniqueId: 'dev-gift-card-unique',
  code: 'TR-EJEM-PLO1',
  publicUrl: 'https://example.com/dev/regalo/dev-gift-card-unique',
  role: 'buyer',
  locked: false,
  amountCop: 25000,
  tierName: 'Adviento',
  effectiveStatus: 'active',
  funded: false,
  source: 'advent',
  buyerFirstName: 'Cliente',
  recipientName: null,
  message: '',
  validFrom: '2027-01-15',
  validTo: '2027-02-15',
  minTicketCop: 90000,
  transferable: true,
  terms: ['Término de ejemplo 1 de la gift card.', 'Término de ejemplo 2 de la gift card.', 'No se cambia por dinero.'],
};

const LOCKED_GIFT_CARD: CustomerGiftCard = {
  ...ADVENT_GIFT_CARD,
  id: 'dev-gift-card-received',
  code: null,
  uniqueId: null,
  publicUrl: null,
  role: 'recipient',
  locked: true,
  lockedHint: 'Ábrela con el link que te llegó por WhatsApp.',
  amountCop: 50000,
  tierName: 'Detalle',
  source: 'sale',
  funded: true,
  validFrom: '2026-12-20',
  validTo: '2027-12-20',
  minTicketCop: null,
  buyerFirstName: 'Persona de ejemplo',
};

interface MockDb {
  opened: Map<number, number>; // door no → openedAt
  used: Set<number>;
}

const buildState = (sc: AdventScenario, db: MockDb, now: number): AdventState => {
  const eligible = sc.eligible !== false;
  const today = bogotaYmd(now);
  const doors: AdventDoor[] = doorsSpec.map((spec) => {
    const openedAt = db.opened.get(spec.no);
    let state: AdventDoor['state'];
    if (openedAt !== undefined) state = 'opened';
    else if (now < spec.unlockAt) state = 'locked';
    else if ((spec.flashUntil && now >= spec.flashUntil) || now >= OPENS_UNTIL) state = 'missed';
    else state = eligible ? 'ready' : 'locked';
    return {
      no: spec.no,
      dayLabel: spec.day,
      unlockAt: new Date(spec.unlockAt).toISOString(),
      flashUntil: spec.flashUntil ? new Date(spec.flashUntil).toISOString() : null,
      state,
      reward: openedAt !== undefined ? rewardFor(spec, openedAt, db.used.has(spec.no), today) : null,
    };
  });
  const rewards = doors
    .filter((d) => d.reward)
    .map((d) => d.reward!)
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt) || b.doorNo - a.doorNo);
  const giftCards: CustomerGiftCard[] = [];
  if (db.opened.has(12)) giftCards.push(ADVENT_GIFT_CARD);
  if (sc.lockedGiftCard) giftCards.push(LOCKED_GIFT_CARD);
  const next = doorsSpec.find((s) => s.unlockAt > now);
  return {
    serverNow: new Date(now).toISOString(),
    year: 2026,
    eligible,
    opensUntil: new Date(OPENS_UNTIL).toISOString(),
    commonTerms: COMMON_TERMS,
    doors,
    nextUnlockAt: next ? new Date(next.unlockAt).toISOString() : null,
    readyCount: doors.filter((d) => d.state === 'ready').length,
    rewards,
    giftCards,
  };
};

/** A controller for PublicCardView's `advent` prop, on the scenario's clock. */
export const useMockAdvent = (sc: AdventScenario, cardUniqueId: string, cardStamps: number): AdventController => {
  const offset = useRef(sc.now - Date.now());
  const db = useRef<MockDb>({
    opened: new Map(sc.opened.map((day) => [day / 2, at(dec(day), 9)])),
    used: new Set((sc.used ?? []).map((day) => day / 2)),
  });
  const now = useCallback(() => Date.now() + offset.current, []);
  const [state, setState] = useState<AdventState>(() => buildState(sc, db.current, now()));
  const stampsRef = useRef(cardStamps);
  stampsRef.current = cardStamps;

  const openDoor = useCallback(
    async (no: number): Promise<AdventOpenResult> => {
      await new Promise((r) => setTimeout(r, 450));
      const t = now();
      const spec = doorsSpec.find((s) => s.no === no);
      if (!spec) throw new AdventOpenError('NOT_FOUND', 'No door');
      if (sc.eligible === false) throw new AdventOpenError('NOT_ELIGIBLE', 'Not eligible');
      if (t < spec.unlockAt) throw new AdventOpenError('NOT_YET', 'Not yet');
      if (!db.current.opened.has(no)) {
        if ((spec.flashUntil && t >= spec.flashUntil) || t >= OPENS_UNTIL) throw new AdventOpenError('CLOSED', 'Closed');
        db.current.opened.set(no, t);
      }
      const next = buildState(sc, db.current, t);
      const reward = next.doors.find((d) => d.no === no)!.reward!;
      return { reward, state: next, card: spec.kind === 'bonus_stamps' ? { uniqueId: cardUniqueId, stamps: stampsRef.current + 1 } : null };
    },
    [now, sc, cardUniqueId],
  );

  const refresh = useCallback(async () => setState(buildState(sc, db.current, now())), [sc, now]);

  return useMemo(() => ({ state, loading: false, now, openDoor, apply: setState, refresh }), [state, now, openDoor, refresh]);
};
