// DEV ONLY (/dev/ticket) — not routed in production builds.
// Playground for the weekly scratch ticket and the reward reveal (§8.1a):
// the real public card with a mocked play call, force win/lose, network
// latency, presets × fxStyle × backgrounds, and live sliders for every
// timing / spring / particle value. Approve the feel on a phone here.
//
//   /dev/ticket?t=midnight-brew&style=playful&result=win&latency=300
//     &stamps=4&game=available|played|locked&bg=/image_1.jpg&opacity=40
//     &reveal=1 (complete card → reward reveal)   &panel=0 (hide controls)
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { templates } from '../../data/templates';
import type { FxStyle, GameState, IssuedCard, PlayResult, Transaction } from '../../types';
import type { FxBus, NewStampEvent } from '../../lib/card/types';
import { PlayError, setPlayOverride } from '../../lib/card/gameApi';
import { DEFAULT_TUNING, getTuning, onTuningChange, setTuningOverride, type TicketTuning } from '../card/game/tuning';

const PublicCardView = lazy(() => import('../card/PublicCardView'));

const STYLES: FxStyle[] = ['elegant', 'playful', 'minimal'];

const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

let seq = 0;
const tx = (type: Transaction['type'], amount: number, daysAgo: number): Transaction => {
  const ts = Date.now() - daysAgo * 86_400_000;
  return {
    id: `dev-tx-${++seq}`,
    type,
    amount,
    timestamp: ts,
    date: new Date(ts).toLocaleString('es-CO'),
    title: type === 'stamp_add' ? 'Stamp Collected' : type === 'bonus' ? 'Bonus Stamp' : 'Card Issued',
  };
};

type NumKey = { [K in keyof TicketTuning]: TicketTuning[K] extends number ? K : never }[keyof TicketTuning];
const SLIDERS: Array<{ group: string; items: Array<[NumKey, number, number, number]> }> = [
  { group: 'Idle', items: [['sweepEveryMs', 0, 8000, 100], ['sweepMs', 300, 3000, 50], ['floatPx', 0, 10, 0.5]] },
  { group: 'Open', items: [['openMs', 200, 1500, 10], ['openTiltDeg', 0, 50, 1], ['backdropBlurPx', 0, 20, 1], ['cardScale', 0.85, 1, 0.005]] },
  { group: 'Scratch', items: [['brushPx', 14, 60, 1], ['grainPx', 10, 120, 5], ['autoCompletePct', 0.2, 0.9, 0.01], ['scratchAllDelayMs', 0, 6000, 100]] },
  { group: 'Flakes', items: [['flakesPer100px', 0, 40, 1], ['flakeMax', 0, 120, 1], ['flakeGravity', 200, 3000, 50], ['flakeSpin', 0, 30, 1]] },
  { group: 'Shatter', items: [['shatterMs', 100, 1200, 10], ['shardCols', 0, 14, 1], ['shardSpeed', 100, 1400, 10]] },
  { group: 'Win', items: [['winIconDelayMs', 0, 800, 10], ['winWordsDelayMs', 100, 1500, 10], ['winWordStaggerMs', 0, 300, 5], ['winShockwaveScale', 1, 5, 0.1], ['winFlightDelayMs', 600, 4000, 50], ['flightMs', 200, 1500, 10], ['flightArc', -0.6, 0.8, 0.01], ['trailSparkles', 0, 100, 1]] },
  { group: 'Lose', items: [['loseFoldDelayMs', 400, 4000, 50], ['foldMs', 200, 1500, 10], ['tuckMs', 200, 1500, 10]] },
];

let tuneVersion = 0;
onTuningChange(() => {
  tuneVersion++;
});

export const DevTicketPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const base = templates.find((t) => t.id === params.get('t')) ?? templates[1]!;
  const style = (params.get('style') as FxStyle) ?? 'elegant';
  const result = (['win', 'lose', 'error'] as const).find((r) => r === params.get('result')) ?? 'win';
  const latency = Number(params.get('latency') ?? 250);
  const showPanel = params.get('panel') !== '0';
  const setMany = (values: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };
  const set = (key: string, value: string | null) => setMany({ [key]: value });

  const template = useMemo(() => ({
    ...base,
    fxStyle: style,
    backgroundImage: params.get('bg') ?? base.backgroundImage,
    backgroundOpacity: params.has('opacity') ? Number(params.get('opacity')) : base.backgroundOpacity,
    gameEnabled: true,
  }), [base, style, params]);

  // Remount the card when the scene changes.
  const sceneKey = ['t', 'style', 'bg', 'opacity', 'stamps', 'game', 'reveal'].map((k) => params.get(k)).join('|');
  const [nonce, setNonce] = useState(0);

  return (
    <div className="relative">
      <Scene key={`${sceneKey}#${nonce}`} template={template} params={params} result={result} latency={latency} />
      {showPanel && (
        <Panel
          style={style}
          params={params}
          set={set}
          setMany={setMany}
          result={result}
          latency={latency}
          onReset={() => setNonce((n) => n + 1)}
        />
      )}
    </div>
  );
};

const Scene: React.FC<{ template: typeof templates[number] & { fxStyle: FxStyle }; params: URLSearchParams; result: 'win' | 'lose' | 'error'; latency: number }> = ({ template, params, result, latency }) => {
  const reveal = params.get('reveal') === '1';
  const initialStamps = reveal ? template.totalStamps : Math.min(template.totalStamps - 2, Number(params.get('stamps') ?? 3));
  const [card, setCard] = useState<IssuedCard>(() => ({
    id: 'dev-card',
    uniqueId: '7c1e9a40-55d2-4f0b-9a3e-2b8d4a9f3c21',
    campaignId: template.id,
    campaignName: template.name,
    stamps: initialStamps,
    lastVisit: new Date().toISOString().slice(0, 10),
    status: 'Active',
    history: [tx('issued', 0, 40), ...Array.from({ length: initialStamps }, (_, i) => tx('stamp_add', 1, 30 - i * 3))].reverse(),
  }));
  const [events, setEvents] = useState<NewStampEvent[]>([]);
  const [rewardRevealed, setRewardRevealed] = useState(false);
  const gameParam = params.get('game') ?? 'available';
  const [game, setGame] = useState<GameState | null>(() => ({
    state: gameParam as GameState['state'],
    nextPlayAt: nextMonday(),
    reason: gameParam === 'locked' ? 'NO_RECENT_VISIT' : undefined,
    lastResult: gameParam === 'played' ? { won: false, stampsAwarded: 0, playedAt: new Date().toISOString() } : undefined,
  }));
  const played = useRef<PlayResult | null>(null);

  // Mocked server: decides on "open", replays the same answer.
  const resultRef = useRef(result);
  resultRef.current = result;
  const cardRef = useRef(card);
  cardRef.current = card;
  useEffect(() => {
    setPlayOverride(async () => {
      await new Promise((r) => setTimeout(r, latency));
      if (played.current) return played.current;
      if (resultRef.current === 'error') throw new PlayError('network', 'Mock network error');
      const won = resultRef.current === 'win';
      const stamps = cardRef.current.stamps + (won ? 1 : 0);
      const transaction: Transaction | undefined = won
        ? { ...tx('bonus', 1, 0), remarks: 'Raspa y gana', actorName: 'Raspa y gana', actorRole: undefined }
        : undefined;
      played.current = { won, stampsAwarded: won ? 1 : 0, stamps, nextPlayAt: nextMonday(), periodKey: '2026-W44', transaction };
      return played.current;
    });
    return () => setPlayOverride(null);
  }, [latency]);

  // Stand-in for the seen-state diff: a new bonus tx becomes a 'bonus' event.
  const applyCardUpdate = useCallback((patch: Partial<IssuedCard>) => {
    const prev = cardRef.current;
    const fresh = (patch.history ?? []).filter((h) => !prev.history.some((p) => p.id === h.id) && h.type === 'bonus');
    if (fresh.length) {
      setEvents((ev) => [...ev, ...fresh.map((h, i) => ({ id: h.id, kind: 'bonus' as const, amount: 1, slots: [prev.stamps + i], timestamp: h.timestamp }))]);
    }
    setCard((p) => ({ ...p, ...patch }));
  }, []);

  // Stand-in for the moments layer (agent E): slam new events if nobody else does.
  useEffect(() => {
    const ev = events[0];
    if (!ev) return;
    const w = window as unknown as { __fxBus?: FxBus; __fxSetSlotState?: (i: number, s: null) => void };
    const bus = w.__fxBus;
    if (!bus) return;
    const index = ev.slots[0]!;
    let slammed = false;
    const offSlam = bus.on('stamp:slam', () => {
      slammed = true;
    });
    const offLanded = bus.on('stamp:landed', (p) => {
      if (p.index !== index) return;
      w.__fxSetSlotState?.(index, null);
      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
    });
    const id = window.setTimeout(() => {
      if (!slammed) bus.emit('stamp:slam', { index, kind: ev.kind });
    }, 60);
    return () => {
      window.clearTimeout(id);
      offSlam();
      offLanded();
    };
  }, [events]);

  const refresh = useCallback(async () => {
    const p = played.current;
    if (p) setGame({ state: 'played', nextPlayAt: p.nextPlayAt, lastResult: { won: p.won, stampsAwarded: p.stampsAwarded, playedAt: new Date().toISOString() } });
  }, []);

  // DEV handle for Playwright.
  useEffect(() => {
    (window as unknown as { __devTicket?: unknown }).__devTicket = {
      setGame: (state: GameState['state']) => {
        played.current = null;
        setGame({ state, nextPlayAt: state === 'played' ? new Date(Date.now() + 3_000).toISOString() : nextMonday(), lastResult: state === 'played' ? { won: true, stampsAwarded: 1, playedAt: new Date().toISOString() } : undefined });
      },
      card: () => cardRef.current,
    };
  });

  return (
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
        refresh={refresh}
        applyCardUpdate={applyCardUpdate}
      />
    </Suspense>
  );
};

const Panel: React.FC<{
  style: FxStyle;
  params: URLSearchParams;
  set: (k: string, v: string | null) => void;
  setMany: (values: Record<string, string | null>) => void;
  result: 'win' | 'lose' | 'error';
  latency: number;
  onReset: () => void;
}> = ({ style, params, set, setMany, result, latency, onReset }) => {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(onTuningChange, () => tuneVersion);
  const tuning = getTuning(style);
  const [copied, setCopied] = useState(false);

  const btn = 'rounded bg-white/15 px-2 py-1 hover:bg-white/25';
  const on = 'rounded bg-white px-2 py-1 text-black';

  return (
    <div className="fixed bottom-2 left-2 right-2 z-[100] mx-auto max-w-[420px] rounded-xl bg-black/80 p-2 text-[11px] text-white shadow-2xl backdrop-blur">
      <div className="flex flex-wrap items-center gap-1">
        <button className={result === 'win' ? on : btn} onClick={() => set('result', 'win')}>win</button>
        <button className={result === 'lose' ? on : btn} onClick={() => set('result', 'lose')}>lose</button>
        <button className={result === 'error' ? on : btn} onClick={() => set('result', 'error')}>error</button>
        <select className="rounded bg-white/15 px-1 py-1" value={params.get('t') ?? templates[1]!.id} onChange={(e) => set('t', e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id} className="text-black">{t.id}</option>)}
        </select>
        {STYLES.map((s) => (
          <button key={s} className={s === style ? on : btn} onClick={() => set('style', s)}>{s}</button>
        ))}
        <button className={btn} onClick={onReset}>↻ reset</button>
        <button className={btn} onClick={() => setOpen((o) => !o)}>{open ? '▾ tune' : '▸ tune'}</button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <select className="rounded bg-white/15 px-1 py-1" value={params.get('game') ?? 'available'} onChange={(e) => set('game', e.target.value)}>
          {['available', 'played', 'locked'].map((g) => <option key={g} value={g} className="text-black">game: {g}</option>)}
        </select>
        <select className="rounded bg-white/15 px-1 py-1" value={params.get('bg') ? `${params.get('bg')}|${params.get('opacity') ?? 40}` : ''} onChange={(e) => {
          const [bg, op] = e.target.value.split('|');
          setMany({ bg: bg || null, opacity: bg ? op ?? '40' : null });
        }}>
          <option value="" className="text-black">bg: palette</option>
          <option value="/image_1.jpg|40" className="text-black">bg: photo 40 %</option>
          <option value="/image_3.jpg|40" className="text-black">bg: light photo</option>
          <option value="/image_4.jpg|20" className="text-black">bg: busy 20 %</option>
        </select>
        <label className="flex items-center gap-1">latency
          <input type="range" min={0} max={2500} step={50} value={latency} onChange={(e) => set('latency', e.target.value)} />
          {latency}ms
        </label>
        <button className={params.get('reveal') === '1' ? on : btn} onClick={() => set('reveal', params.get('reveal') === '1' ? null : '1')}>reward reveal</button>
      </div>
      {open && (
        <div className="mt-2 max-h-[45vh] overflow-y-auto pr-1">
          {SLIDERS.map(({ group, items }) => (
            <div key={group} className="mb-2">
              <div className="mb-1 font-semibold uppercase tracking-wider text-white/60">{group}</div>
              {items.map(([key, min, max, step]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate">{key}</span>
                  <input className="flex-1" type="range" min={min} max={max} step={step} value={tuning[key]} onChange={(e) => setTuningOverride(style, { [key]: Number(e.target.value) })} />
                  <span className="w-12 text-right tabular-nums">{tuning[key]}</span>
                </label>
              ))}
            </div>
          ))}
          <div className="mb-2">
            <div className="mb-1 font-semibold uppercase tracking-wider text-white/60">Open spring</div>
            {(['stiffness', 'damping'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="w-32 shrink-0">{k}</span>
                <input className="flex-1" type="range" min={k === 'stiffness' ? 60 : 5} max={k === 'stiffness' ? 600 : 60} step={1} value={tuning.openSpring[k]} onChange={(e) => setTuningOverride(style, { openSpring: { ...tuning.openSpring, [k]: Number(e.target.value) } })} />
                <span className="w-12 text-right tabular-nums">{tuning.openSpring[k]}</span>
              </label>
            ))}
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={tuning.holo} onChange={(e) => setTuningOverride(style, { holo: e.target.checked })} /> holographic foil</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={tuning.flightBounce} onChange={(e) => setTuningOverride(style, { flightBounce: e.target.checked })} /> flight bounce</label>
            <label className="flex items-center gap-2">win burst
              <select className="rounded bg-white/15 px-1" value={tuning.winBurst} onChange={(e) => setTuningOverride(style, { winBurst: e.target.value as TicketTuning['winBurst'] })}>
                {['theme', 'confetti', 'none'].map((b) => <option key={b} value={b} className="text-black">{b}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-1">
            <button className={btn} onClick={() => setTuningOverride(style, null)}>defaults</button>
            <button className={btn} onClick={() => {
              const diff = Object.fromEntries(Object.entries(tuning).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULT_TUNING[style][k as keyof TicketTuning])));
              void navigator.clipboard?.writeText(JSON.stringify({ [style]: diff }, null, 2));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}>{copied ? 'copied ✓' : 'copy changes'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevTicketPage;
