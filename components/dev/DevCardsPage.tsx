// DEV ONLY (/dev/cards) — not routed in production builds.
// Renders the animated public card with mock data so every preset, fxStyle,
// background upload and moment can be checked without the API.
//
//   /dev/cards                         index of presets × styles
//   /dev/cards?t=midnight-brew&style=playful&stamps=6
//     &bg=/image_1.jpg&opacity=40      background upload at 40 % overlay
//     &events=stamp,gift               pending moments on load
//     &game=available|played|locked|disabled|holdout
//     &redeemed=1  &panel=0 (hide the control panel, for screenshots)
//     &social=0 (drop the mock business contact / social links)
import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { templates } from '../../data/templates';
import type { FxStyle, GameState, GameStateKind, IssuedCard, SocialLinks, Transaction } from '../../types';
import type { NewStampEvent } from '../../lib/card/types';

const PublicCardView = lazy(() => import('../card/PublicCardView'));

const STYLES: FxStyle[] = ['elegant', 'playful', 'minimal'];

// Golden Beauty Studio's real contact (CardEditor › Social › Business contact).
const MOCK_SOCIAL: SocialLinks = {
  instagram: '@goldenbeautystudio',
  whatsapp: '+57 301 464 8943',
  phone: '+57 301 464 8943',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Calle%2069%20Sur%20%2343a%20-%2041%2C%20Primer%20Piso%2C%20Sabaneta%20%C2%B7%20Antioquia%20%C2%B7%20Colombia&query_place_id=ChIJWy7PWB-DRo4RatmsIAbFvBU',
  hours: 'Lun–Sáb 13:00–19:00 · Domingos y festivos cerrado',
};

const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

let txSeq = 0;
const tx = (type: Transaction['type'], amount: number, daysAgo: number): Transaction => {
  const ts = Date.now() - daysAgo * 86_400_000;
  return {
    id: `dev-tx-${++txSeq}`,
    type,
    amount,
    timestamp: ts,
    date: new Date(ts).toLocaleString('es-CO'),
    title: type === 'stamp_add' ? 'Stamp Collected' : type === 'gift' ? 'Gift Stamps' : type === 'bonus' ? 'Bonus Stamp' : 'Card Issued',
  };
};

const Index: React.FC = () => (
  <div className="min-h-screen bg-neutral-100 p-6 font-sans">
    <h1 className="text-2xl font-bold">Card fx playground</h1>
    <p className="mb-6 text-sm text-neutral-500">Dev only. Presets × fxStyle, plus background uploads.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => (
        <div key={t.id} className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-2 font-semibold">{t.name}</div>
          <div className="flex flex-wrap gap-2 text-sm">
            {STYLES.map((style) => (
              <Link key={style} className="rounded-full bg-neutral-100 px-3 py-1 hover:bg-neutral-200" to={`/dev/cards?t=${t.id}&style=${style}&stamps=${Math.max(1, t.totalStamps - 3)}`}>
                {style}
              </Link>
            ))}
            <Link className="rounded-full bg-amber-100 px-3 py-1" to={`/dev/cards?t=${t.id}&style=elegant&stamps=${Math.max(1, t.totalStamps - 3)}&bg=/image_1.jpg&opacity=40`}>photo 40 %</Link>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const DevCardsPage: React.FC = () => {
  const [params] = useSearchParams();
  const templateId = params.get('t');
  if (!templateId) return <Index />;
  return <DevCard key={params.toString()} params={params} />;
};

const DevCard: React.FC<{ params: URLSearchParams }> = ({ params }) => {
  const base = templates.find((t) => t.id === params.get('t')) ?? templates[0]!;
  const template = useMemo(() => ({
    ...base,
    fxStyle: (params.get('style') as FxStyle) ?? 'elegant',
    backgroundImage: params.get('bg') ?? base.backgroundImage,
    backgroundOpacity: params.has('opacity') ? Number(params.get('opacity')) : base.backgroundOpacity,
    gameEnabled: true,
    social: params.get('social') === '0' ? undefined : { ...base.social, ...MOCK_SOCIAL },
  }), [base, params]);

  const initialStamps = Math.min(template.totalStamps, Number(params.get('stamps') ?? 3));
  const [card, setCard] = useState<IssuedCard>(() => ({
    id: 'dev-card',
    uniqueId: '00000000-0000-4000-8000-000000000dev',
    campaignId: template.id,
    campaignName: template.name,
    stamps: initialStamps,
    lastVisit: new Date().toISOString().slice(0, 10),
    status: params.get('redeemed') ? 'Redeemed' : 'Active',
    history: [
      tx('issued', 0, 40),
      ...Array.from({ length: initialStamps }, (_, i) => tx('stamp_add', 1, 30 - i * 3)),
    ].reverse(),
  }));

  const makeEvent = useCallback((kind: NewStampEvent['kind'], from: number, amount: number): NewStampEvent => ({
    id: `dev-ev-${++txSeq}`,
    kind,
    amount,
    slots: Array.from({ length: amount }, (_, i) => from + i),
    timestamp: Date.now(),
  }), []);

  const [events, setEvents] = useState<NewStampEvent[]>(() => {
    const kinds = (params.get('events') ?? '').split(',').filter(Boolean) as NewStampEvent['kind'][];
    let cursor = initialStamps - kinds.length;
    return kinds.map((kind) => makeEvent(kind, cursor++, 1));
  });
  const [rewardRevealed, setRewardRevealed] = useState(false);
  const [gameKind, setGameKind] = useState<GameStateKind | null>((params.get('game') as GameStateKind) ?? 'available');
  const game: GameState | null = gameKind
    ? {
        state: gameKind,
        nextPlayAt: nextMonday(),
        reason: gameKind === 'locked' ? 'NO_RECENT_VISIT' : undefined,
        lastResult: gameKind === 'played' ? { won: false, stampsAwarded: 0, playedAt: new Date().toISOString() } : undefined,
      }
    : null;

  const add = (kind: NewStampEvent['kind'], amount = 1) => {
    if (card.stamps + amount > template.totalStamps) return;
    const type = kind === 'gift' ? 'gift' : kind === 'bonus' ? 'bonus' : 'stamp_add';
    setEvents((prev) => [...prev, makeEvent(kind, card.stamps, amount)]);
    setCard((prev) => ({ ...prev, stamps: prev.stamps + amount, history: [tx(type, amount, 0), ...prev.history] }));
  };

  const showPanel = params.get('panel') !== '0';

  return (
    <div className="relative">
      <Suspense fallback={null}>
        <PublicCardView
          slug="dev"
          card={card}
          customerName="Cliente Demo"
          template={template}
          variant="fx"
          trackInteraction={(kind) => console.debug('[fx] interaction', kind)}
          newStampEvents={events}
          acknowledge={(ids) => setEvents((prev) => prev.filter((e) => !ids.includes(e.id)))}
          rewardRevealed={rewardRevealed}
          markRewardRevealed={() => setRewardRevealed(true)}
          game={game}
          refresh={async () => {}}
          applyCardUpdate={(patch) => setCard((prev) => ({ ...prev, ...patch }))}
        />
      </Suspense>
      {showPanel && (
        <div className="fixed bottom-2 left-2 z-[100] flex max-w-[95vw] flex-wrap gap-1 rounded-xl bg-black/75 p-2 text-xs text-white backdrop-blur">
          <Link className="rounded bg-white/15 px-2 py-1" to="/dev/cards">←</Link>
          <button className="rounded bg-white/15 px-2 py-1" onClick={() => add('stamp')}>+stamp</button>
          <button className="rounded bg-white/15 px-2 py-1" onClick={() => add('gift', 2)}>+gift 2</button>
          <button className="rounded bg-white/15 px-2 py-1" onClick={() => add('bonus')}>+bonus</button>
          <button className="rounded bg-white/15 px-2 py-1" onClick={() => { setCard((p) => ({ ...p, stamps: template.totalStamps })); setRewardRevealed(false); }}>complete</button>
          <button className="rounded bg-white/15 px-2 py-1" onClick={() => setCard((p) => ({ ...p, stamps: 0, history: [] }))}>reset</button>
          <select className="rounded bg-white/15 px-1 py-1" value={gameKind ?? ''} onChange={(e) => setGameKind((e.target.value || null) as GameStateKind | null)}>
            <option value="">game: none</option>
            {(['available', 'played', 'locked', 'disabled', 'holdout'] as GameStateKind[]).map((k) => <option key={k} value={k}>game: {k}</option>)}
          </select>
        </div>
      )}
    </div>
  );
};

export default DevCardsPage;
