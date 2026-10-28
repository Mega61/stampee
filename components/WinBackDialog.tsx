import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Gift, Loader2, MessageCircle, PhoneOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import type { Customer, Template } from '../types';
import { buildCardInsights, buildWhatsAppUrl, type CardInsight } from '../lib/cardInsights';
import { giftStamps } from '../lib/db/issuedCards';
import { buildPublicCardUrl } from '../lib/links';
import { withCardSource } from '../lib/whatsappMessages';

interface WinBackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  campaigns: Template[];
  slug?: string | null;
  /** Called after stamps were gifted so the page can reload card data. */
  onGifted: () => Promise<void> | void;
}

type SentRow = {
  row: CardInsight;
  added: number;
  stampsAfter: number;
};

const MESSAGE_STORAGE_KEY = 'gbs.winback.message';
const DEFAULT_MESSAGE =
  '¡Hola {nombre}! 💛 Te extrañamos en Golden Beauty Studio. Para que vuelvas, te regalamos {regalo} en tu tarjeta {tarjeta}: ya llevas {sellos} de {total} y solo te faltan {faltan} para tu {recompensa}. Mira tu tarjeta aquí: {link}';

const PLACEHOLDERS: { key: string; hint: string }[] = [
  { key: '{nombre}', hint: 'first name' },
  { key: '{regalo}', hint: '"2 sellos"' },
  { key: '{sellos}', hint: 'stamps after gift' },
  { key: '{total}', hint: 'card size' },
  { key: '{faltan}', hint: 'stamps to go' },
  { key: '{recompensa}', hint: 'reward' },
  { key: '{tarjeta}', hint: 'campaign' },
  { key: '{link}', hint: 'card link' },
];

const INACTIVE_OPTIONS = [21, 30, 45, 60, 90];
const MIN_VISIT_OPTIONS = [1, 2, 3, 4];

const readStoredMessage = () => {
  try {
    return localStorage.getItem(MESSAGE_STORAGE_KEY) || DEFAULT_MESSAGE;
  } catch {
    return DEFAULT_MESSAGE;
  }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How many stamps the gift actually adds — never fills the card. */
const giftableStamps = (row: CardInsight, gift: number) =>
  Math.max(0, Math.min(gift, row.totalStamps - 1 - row.card.stamps));

export const renderWinBackMessage = (
  template: string,
  row: CardInsight,
  added: number,
  stampsAfter: number,
  slug?: string | null,
) => {
  const values: Record<string, string> = {
    '{nombre}': row.customer.name.split(' ')[0] ?? row.customer.name,
    '{regalo}': plural(added, 'sello', 'sellos'),
    '{sellos}': String(stampsAfter),
    '{total}': String(row.totalStamps),
    '{faltan}': plural(row.totalStamps - stampsAfter, 'sello', 'sellos'),
    '{recompensa}': row.template.rewardName || 'recompensa',
    '{tarjeta}': row.card.campaignName,
    // `src` lets the engagement beacon attribute the open to this message.
    '{link}': slug ? withCardSource(buildPublicCardUrl(slug, row.card.uniqueId), 'whatsapp') : '',
  };
  return template.replace(/\{[a-z]+\}/g, (token) => values[token] ?? token).trim();
};

export const WinBackDialog: React.FC<WinBackDialogProps> = ({
  isOpen,
  onClose,
  customers,
  campaigns,
  slug,
  onGifted,
}) => {
  const [step, setStep] = useState<'setup' | 'send'>('setup');
  const [inactiveDays, setInactiveDays] = useState(30);
  const [minVisits, setMinVisits] = useState(1);
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [gift, setGift] = useState(2);
  const [message, setMessage] = useState(readStoredMessage);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentRows, setSentRows] = useState<SentRow[]>([]);
  const [messaged, setMessaged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setStep('setup');
    setError('');
    setExcluded(new Set());
    setSentRows([]);
    setMessaged(new Set());
  }, [isOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(MESSAGE_STORAGE_KEY, message);
    } catch {
      // per-viewer convenience only
    }
  }, [message]);

  const insights = useMemo(() => buildCardInsights(customers, campaigns), [customers, campaigns]);

  const { candidates, nearlyFull } = useMemo(() => {
    const matching = insights.filter(
      (row) =>
        row.stage !== 'redeemed' &&
        row.daysSinceActivity !== null &&
        row.daysSinceActivity >= inactiveDays &&
        row.earnedStamps >= minVisits &&
        (campaignFilter === 'all' || row.card.campaignId === campaignFilter)
    );
    const ok = matching.filter((row) => giftableStamps(row, gift) > 0);
    // Most invested first: they have the most to lose.
    ok.sort((a, b) => b.progress - a.progress || (b.daysSinceActivity ?? 0) - (a.daysSinceActivity ?? 0));
    return { candidates: ok, nearlyFull: matching.length - ok.length };
  }, [insights, inactiveDays, minVisits, campaignFilter, gift]);

  const selected = candidates.filter((row) => !excluded.has(row.card.id));
  const withoutPhone = selected.filter((row) => !buildWhatsAppUrl(row.customer.mobile)).length;
  const previewRow = selected[0];

  const toggle = (cardId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });

  const toggleAll = () =>
    setExcluded(selected.length === candidates.length ? new Set(candidates.map((r) => r.card.id)) : new Set());

  const handleGift = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError('');
    const result = await giftStamps(
      selected.map((row) => row.card.id),
      gift,
      'Regalo para que vuelvas'
    );
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const byId = new Map(result.results.map((r) => [r.cardId, r]));
    setSentRows(
      selected
        .map((row) => ({ row, added: byId.get(row.card.id)?.added ?? 0, stampsAfter: byId.get(row.card.id)?.stamps ?? row.card.stamps }))
        .filter((r) => r.added > 0)
    );
    setStep('send');
    await onGifted();
  };

  const markMessaged = (cardId: string) => setMessaged((prev) => new Set(prev).add(cardId));

  const copyMessage = async (text: string, cardId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      markMessaged(cardId);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  const selectClass = 'h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-amber-600" />
            {step === 'setup' ? 'Win-back gift' : 'Send the WhatsApp messages'}
          </DialogTitle>
          <DialogDescription>
            {step === 'setup'
              ? 'Gift stamps to clients who started a card but stopped coming, then message them so they come back to finish it.'
              : `Stamps are on their cards. Now let them know: one tap per client opens WhatsApp with the message ready.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'setup' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inactive for</span>
                  <select className={selectClass} value={inactiveDays} onChange={(e) => setInactiveDays(Number(e.target.value))}>
                    {INACTIVE_OPTIONS.map((d) => <option key={d} value={d}>{d}+ days</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Real visits on card</span>
                  <select className={selectClass} value={minVisits} onChange={(e) => setMinVisits(Number(e.target.value))}>
                    {MIN_VISIT_OPTIONS.map((v) => <option key={v} value={v}>At least {v}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campaign</span>
                  <select className={selectClass} value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
                    <option value="all">All campaigns</option>
                    {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="text-sm font-medium text-amber-950">Stamps to gift</div>
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGift(n)}
                      className={cn(
                        'h-10 w-12 rounded-lg border text-sm font-semibold transition-colors',
                        gift === n ? 'border-amber-600 bg-amber-500 text-white' : 'border-amber-200 bg-white text-amber-900 hover:bg-amber-100'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs leading-5 text-amber-900/80">
                  A gift never completes a card: clients always need at least one more visit to earn the reward.
                  Gifts don't count as visits in Analytics.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">WhatsApp message</span>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMessage(DEFAULT_MESSAGE)}>
                    Reset to default
                  </button>
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring"
                />
                <div className="flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.hint}
                      onClick={() => setMessage((m) => `${m}${m.endsWith(' ') ? '' : ' '}${p.key}`)}
                      className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {p.key}
                    </button>
                  ))}
                </div>
                {previewRow && (
                  <div className="rounded-xl bg-[#e7fcd9] px-3.5 py-2.5 text-sm leading-6 text-[#1f2c1a] shadow-sm">
                    {renderWinBackMessage(
                      message,
                      previewRow,
                      giftableStamps(previewRow, gift),
                      previewRow.card.stamps + giftableStamps(previewRow, gift),
                      slug
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {selected.length} of {plural(candidates.length, 'client', 'clients')} selected
                  </span>
                  {candidates.length > 0 && (
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={toggleAll}>
                      {selected.length === candidates.length ? 'Select none' : 'Select all'}
                    </button>
                  )}
                </div>
                {candidates.length === 0 ? (
                  <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
                    No inactive clients with progress match these filters.
                  </p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {candidates.map((row) => {
                      const added = giftableStamps(row, gift);
                      const checked = !excluded.has(row.card.id);
                      const hasPhone = Boolean(buildWhatsAppUrl(row.customer.mobile));
                      return (
                        <li key={row.card.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/30">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(row.card.id)}
                              className="h-4 w-4 accent-amber-600"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <span className="truncate">{row.customer.name}</span>
                                {!hasPhone && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-rose-600" title="No valid mobile: you'll need to copy the message">
                                    <PhoneOff className="h-3 w-3" /> no WhatsApp
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {row.card.campaignName} · last seen {row.daysSinceActivity} days ago
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-xs">
                              <div className="tabular-nums text-muted-foreground">
                                {row.card.stamps}/{row.totalStamps} →{' '}
                                <span className="font-semibold text-foreground">{row.card.stamps + added}/{row.totalStamps}</span>
                              </div>
                              <div className="text-amber-700">+{added} gift</div>
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {(nearlyFull > 0 || withoutPhone > 0) && (
                  <p className="text-xs text-muted-foreground">
                    {nearlyFull > 0 && <>{plural(nearlyFull, 'card is', 'cards are')} one stamp from the reward, so a gift can't apply. They're on the "Almost there" list instead. </>}
                    {withoutPhone > 0 && <>{plural(withoutPhone, 'selected client has', 'selected clients have')} no valid mobile; you'll be able to copy their message.</>}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <span>
                  Gifted stamps to {plural(sentRows.length, 'card', 'cards')}.
                </span>
                <span className="font-semibold tabular-nums">
                  {messaged.size}/{sentRows.length} messaged
                </span>
              </div>
              <ul className="divide-y rounded-xl border">
                {sentRows.map(({ row, added, stampsAfter }) => {
                  const text = renderWinBackMessage(message, row, added, stampsAfter, slug);
                  const url = buildWhatsAppUrl(row.customer.mobile, text);
                  const done = messaged.has(row.card.id);
                  return (
                    <li key={row.card.id} className={cn('flex items-center gap-3 px-3 py-3', done && 'bg-muted/30')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {done && <Check className="h-4 w-4 text-emerald-600" />}
                          <span className="truncate">{row.customer.name}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          +{added} gift · now {stampsAfter}/{row.totalStamps} · {row.customer.mobile || 'no mobile'}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 shrink-0 rounded-full"
                        onClick={() => void copyMessage(text, row.card.id)}
                        title="Copy message"
                        aria-label={`Copy message for ${row.customer.name}`}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {url && (
                        <Button
                          size="sm"
                          className={cn('shrink-0 gap-1.5 rounded-full', done ? 'bg-muted text-foreground hover:bg-muted/80' : 'bg-[#25D366] text-white hover:bg-[#1ebe5a]')}
                          onClick={() => {
                            window.open(url, '_blank', 'noopener');
                            markMessaged(row.card.id);
                          }}
                        >
                          <MessageCircle className="h-4 w-4" />
                          {done ? 'Again' : 'WhatsApp'}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          {step === 'setup' ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button
                onClick={() => void handleGift()}
                disabled={busy || selected.length === 0}
                className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                Gift {plural(gift, 'stamp', 'stamps')} to {plural(selected.length, 'client', 'clients')}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
