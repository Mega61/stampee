// DEV ONLY (/dev/advent) — not routed in production builds.
// The public card with a mock advent calendar on its back, on a simulated
// clock, to review every state of the approved prototype without the API.
//
//   /dev/advent?s=b          scenario (a…f, see mockAdvent.ts)
//   &rm=1                    reduced-motion path for the calendar
//   &panel=0                 hide the control panel (screenshots)
//   &stamps=5                stamps on the front
import React, { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { templates } from '../../data/templates';
import type { IssuedCard, Template } from '../../types';
import { SCENARIOS, useMockAdvent, type AdventScenario } from './advent/mockAdvent';

const PublicCardView = lazy(() => import('../card/PublicCardView'));

// A cream-and-gold card close to the studio's campaign.
const TEMPLATE_OVERRIDES: Partial<Template> = {
  name: 'Golden Beauty Studio',
  rewardName: '15% en tu siguiente servicio',
  tagline: 'Reúne 8 sellos y reclama 15% en tu siguiente servicio',
  totalStamps: 8,
  fxStyle: 'elegant',
  gameEnabled: false,
  social: { whatsapp: '+57 300 000 0000' },
  colors: {
    background: '#fbfaf8',
    cardBackground: '#ffffff',
    text: '#7a5400',
    muted: '#715544',
    stampActive: '#e7aa51',
    stampInactive: '#ffe499',
    iconActive: '#ffffff',
    iconInactive: '#5b2b08',
    button: '#e7aa51',
    buttonText: '#ffffff',
    border: '#ece6dc',
  },
};

export const DevAdventPage: React.FC = () => {
  const [params] = useSearchParams();
  const sc = SCENARIOS.find((s) => s.id === params.get('s')) ?? SCENARIOS[1]!;
  return <DevAdvent key={params.toString()} sc={sc} params={params} />;
};

const DevAdvent: React.FC<{ sc: AdventScenario; params: URLSearchParams }> = ({ sc, params }) => {
  const base = templates.find((t) => t.id === 'cookie-classic') ?? templates[0]!;
  const template = useMemo<Template>(() => ({ ...base, ...TEMPLATE_OVERRIDES, id: 'dev-advent' }), [base]);
  const [card, setCard] = useState<IssuedCard>(() => ({
    id: 'dev-advent-card',
    uniqueId: '00000000-0000-4000-8000-00000advent',
    campaignId: template.id,
    campaignName: template.name,
    stamps: Number(params.get('stamps') ?? 5),
    lastVisit: new Date().toISOString().slice(0, 10),
    status: 'Active',
    history: [],
  }));
  const advent = useMockAdvent(sc, card.uniqueId, card.stamps);
  const showPanel = params.get('panel') !== '0';
  const rm = params.get('rm') === '1';
  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/dev/advent?${next.toString()}`;
  };

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
          newStampEvents={[]}
          acknowledge={() => {}}
          rewardRevealed={false}
          markRewardRevealed={() => {}}
          game={null}
          refresh={async () => {}}
          applyCardUpdate={(patch) => setCard((prev) => ({ ...prev, ...patch }))}
          advent={advent}
          adventReducedMotion={rm || undefined}
        />
      </Suspense>
      {showPanel && (
        <div className="fixed bottom-2 left-2 z-[140] flex max-w-[95vw] flex-wrap gap-1 rounded-xl bg-black/75 p-2 text-xs text-white backdrop-blur">
          {SCENARIOS.map((s) => (
            <Link key={s.id} title={s.desc} className={`rounded px-2 py-1 ${s.id === sc.id ? 'bg-amber-500 text-black' : 'bg-white/15'}`} to={link({ s: s.id })}>
              {s.label}
            </Link>
          ))}
          <Link className={`rounded px-2 py-1 ${rm ? 'bg-amber-500 text-black' : 'bg-white/15'}`} to={link({ rm: rm ? null : '1' })}>
            reduced motion
          </Link>
          <button
            className="rounded bg-white/15 px-2 py-1"
            onClick={() => {
              try {
                Object.keys(localStorage).filter((k) => k.startsWith('stampee:advent-peek')).forEach((k) => localStorage.removeItem(k));
              } catch {
                // ignore
              }
              window.location.reload();
            }}
          >
            reset peek
          </button>
        </div>
      )}
    </div>
  );
};

export default DevAdventPage;
