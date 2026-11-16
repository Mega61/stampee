// Admin: "Tarjetas regalo" (/gift-cards). Owner/admin manage; staff read only.
// Payment confirmation and redemption live in the studio panel (Caja), where
// the money is booked — this page only shows, edits, voids and issues cards.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Gift, Info, Loader2, MessageCircle, Plus, Search, Settings2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { useAuth } from '../AuthProvider';
import { cn } from '../../lib/utils';
import { buildWhatsAppUrl } from '../../lib/whatsapp';
import {
  ApiError,
  createGiftCardTier,
  fetchGiftCard,
  fetchGiftCards,
  fetchGiftCardStats,
  fetchGiftCardTiers,
  formatCop,
  formatGiftDate,
  GIFT_STATUS_LABEL,
  issueManualGiftCard,
  updateGiftCard,
  updateGiftCardTier,
  voidGiftCard,
  type GiftCard,
  type GiftCardDetail,
  type GiftCardEffectiveStatus,
  type GiftCardEvent,
  type GiftCardSource,
  type GiftCardStats,
  type GiftCardTier,
} from '../../lib/db/giftCards';
import { GiftCardFace, useGiftFonts } from './GiftCardFace';

const STATUS_CLASS: Record<GiftCardEffectiveStatus, string> = {
  pending_payment: 'bg-amber-50 text-amber-800 border-amber-200',
  active: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  redeemed: 'bg-stone-100 text-stone-700 border-stone-200',
  expired: 'bg-stone-50 text-stone-500 border-stone-200',
  void: 'bg-red-50 text-red-700 border-red-200',
};

const SOURCE_LABEL: Record<GiftCardSource, string> = { sale: 'Venta', advent: 'Adviento', manual: 'Manual' };

const EVENT_LABEL: Record<GiftCardEvent['type'], string> = {
  created: 'Creada',
  paid: 'Pago confirmado',
  recipient_set: 'Destinatario escrito desde el enlace',
  redeemed: 'Canjeada',
  unredeemed: 'Canje revertido',
  voided: 'Anulada',
  updated: 'Editada',
  viewed: 'Enlace abierto',
};

const StatusPill: React.FC<{ status: GiftCardEffectiveStatus }> = ({ status }) => (
  <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', STATUS_CLASS[status])}>
    {GIFT_STATUS_LABEL[status]}
  </span>
);

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }).format(new Date(iso));

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Algo salió mal. Inténtalo de nuevo.');

// ---------------------------------------------------------------- stats

const StatTile: React.FC<{ label: string; value: string; hint?: string; accent?: boolean }> = ({ label, value, hint, accent }) => (
  <div className={cn('rounded-xl border bg-white p-4 shadow-sm', accent && 'border-[#AC8231]/40 bg-[#FBF6F4]')}>
    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const StatsHeader: React.FC<{ stats: GiftCardStats | null }> = ({ stats }) => {
  if (!stats) return <div className="h-[92px] animate-pulse rounded-xl border bg-white" />;
  const n = (c: { count: number; amountCop: number }) => `${c.count} · ${formatCop(c.amountCop)}`;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Vendidas" value={formatCop(stats.sold.amountCop)} hint={`${stats.sold.count} tarjetas pagadas`} />
        <StatTile label="Esperando pago" value={String(stats.pending.count)} hint={formatCop(stats.pending.amountCop)} />
        <StatTile label="Activas" value={String(stats.active.count)} hint={formatCop(stats.active.amountCop)} />
        <StatTile label="Disfrutadas" value={String(stats.redeemed.count)} hint={formatCop(stats.redeemed.amountCop)} />
        <StatTile label="Vencidas" value={String(stats.expired.count)} hint={formatCop(stats.expired.amountCop)} />
        <StatTile label="Saldo por redimir" value={formatCop(stats.outstandingLiabilityCop)} hint="Pagadas y vigentes" accent />
      </div>
      <p className="text-xs text-muted-foreground">
        {stats.avgDaysToRedeem !== null ? `Se usan en promedio ${stats.avgDaysToRedeem} días después del pago. ` : ''}
        {stats.viewsWithoutRecipient > 0 ? `${stats.viewsWithoutRecipient} enlaces abiertos sin destinatario. ` : ''}
        {stats.byTier.length > 0 ? `Por nivel: ${stats.byTier.map((t) => `${t.name || 'Otro'} ${n(t)}`).join(' · ')}` : ''}
      </p>
    </div>
  );
};

// ---------------------------------------------------------------- tiers

const TierRow: React.FC<{ tier: GiftCardTier; onSaved: () => void }> = ({ tier, onSaved }) => {
  const [name, setName] = useState(tier.name);
  const [amount, setAmount] = useState(String(tier.amountCop));
  const [days, setDays] = useState(String(tier.validityDays));
  const [description, setDescription] = useState(tier.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== tier.name || amount !== String(tier.amountCop) || days !== String(tier.validityDays) || description !== tier.description;

  const save = async (patch: Partial<GiftCardTier>) => {
    setBusy(true);
    setError(null);
    try {
      await updateGiftCardTier(tier.id, patch);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', !tier.isEnabled && 'bg-muted/40')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_130px_90px_auto]">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre" className="col-span-2 sm:col-span-1" />
        <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Monto" />
        <Input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Días de vigencia" />
        <div className="flex items-center gap-2">
          <Switch checked={tier.isEnabled} onCheckedChange={(v) => void save({ isEnabled: v })} disabled={busy} aria-label="A la venta" />
          <span className="text-xs text-muted-foreground">{tier.isEnabled ? 'A la venta' : 'Oculto'}</span>
        </div>
      </div>
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué alcanza (ej. semi manos)" aria-label="Descripción" />
      <div className="flex items-center justify-between">
        <p className="text-xs text-red-600">{error}</p>
        {dirty && (
          <Button
            size="sm"
            disabled={busy || !name.trim() || !Number(amount) || !Number(days)}
            onClick={() => void save({ name: name.trim(), amountCop: Number(amount), validityDays: Number(days), description: description.trim() })}
          >
            Guardar
          </Button>
        )}
      </div>
    </div>
  );
};

const TierManager: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; tiers: GiftCardTier[]; onChanged: () => void }> = ({ open, onOpenChange, tiers, onChanged }) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await createGiftCardTier({ name: name.trim(), amountCop: Number(amount), sort: tiers.length + 1 });
      setName('');
      setAmount('');
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Niveles de tarjeta regalo</DialogTitle>
          <DialogDescription>Los montos que se venden en la web. Ocultar un nivel no afecta las tarjetas ya emitidas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {tiers.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay niveles.</p>}
          {tiers.length > 0 && (
            <div className="hidden grid-cols-[1fr_130px_90px_auto] gap-2 px-3 text-xs text-muted-foreground sm:grid">
              <span>Nombre</span><span>Monto COP</span><span>Días</span><span className="w-[120px]" />
            </div>
          )}
          {tiers.map((t) => (
            <TierRow key={`${t.id}:${t.name}:${t.amountCop}:${t.validityDays}:${t.description}:${t.isEnabled}`} tier={t} onSaved={onChanged} />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm font-medium">Nuevo nivel</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Detalle)" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="Monto COP" inputMode="numeric" className="sm:w-40" />
            <Button onClick={() => void add()} disabled={busy || !name.trim() || !Number(amount)}>
              <Plus className="mr-1 h-4 w-4" /> Agregar
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- issue

const IssueDialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; tiers: GiftCardTier[]; onIssued: (card: GiftCard) => void }> = ({ open, onOpenChange, tiers, onIssued }) => {
  const [tierId, setTierId] = useState('');
  const [amount, setAmount] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [courtesy, setCourtesy] = useState(true);
  const [minTicket, setMinTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTierId(tiers.find((t) => t.isEnabled)?.id ?? '');
    setAmount('');
    setBuyerName('');
    setBuyerPhone('');
    setRecipient('');
    setMessage('');
    setCourtesy(true);
    setMinTicket('');
    setError(null);
  }, [open, tiers]);

  const tier = tiers.find((t) => t.id === tierId);
  const finalAmount = amount ? Number(amount) : tier?.amountCop ?? 0;
  const valid = finalAmount > 0 && buyerName.trim() && buyerPhone.replace(/\D/g, '').length >= 7;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const card = await issueManualGiftCard({
        tierId: tierId || undefined,
        amountCop: amount ? Number(amount) : undefined,
        buyer: { name: buyerName.trim(), phone: buyerPhone.trim() },
        recipientName: recipient.trim() || undefined,
        message: message.trim() || undefined,
        funded: !courtesy,
        minTicketCop: minTicket ? Number(minTicket) : null,
      });
      onIssued(card);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Emitir tarjeta</DialogTitle>
          <DialogDescription>Para cortesías y casos especiales. Las ventas de la web llegan solas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nivel</Label>
              <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={tierId} onChange={(e) => setTierId(e.target.value)}>
                <option value="">Sin nivel</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {formatCop(t.amountCop)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Monto (opcional)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder={tier ? String(tier.amountCop) : 'COP'} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quién la da</Label>
              <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Nombre" />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp</Label>
              <Input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} inputMode="tel" placeholder="300 123 4567" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Para (opcional)</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value.slice(0, 40))} placeholder="Nombre de quien la recibe" />
          </div>
          <div className="space-y-1.5">
            <Label>Mensaje (opcional)</Label>
            <Input value={message} onChange={(e) => setMessage(e.target.value.slice(0, 140))} placeholder="Hasta 140 caracteres" />
          </div>
          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={courtesy} onCheckedChange={setCourtesy} className="mt-0.5" />
            <span className="text-sm">
              <span className="font-medium">Cortesía (no se pagó)</span>
              <span className="block text-xs text-muted-foreground">
                {courtesy
                  ? 'Queda activa de inmediato. Al usarla cuenta como descuento y compite con las promos.'
                  : 'Queda esperando pago. Confirma el pago en el panel (Caja → Regalos).'}
              </span>
            </span>
          </label>
          {courtesy && (
            <div className="space-y-1.5">
              <Label>Compra mínima (opcional)</Label>
              <Input value={minTicket} onChange={(e) => setMinTicket(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="COP" />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button className="w-full" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `Emitir ${finalAmount ? formatCop(finalAmount) : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- detail

const eventDetail = (e: GiftCardEvent) => {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'paid':
      return [d['method'], typeof d['paidAmountCop'] === 'number' ? formatCop(d['paidAmountCop'] as number) : null, d['paidRef']].filter(Boolean).join(' · ');
    case 'redeemed':
      return [d['externalRef'], typeof d['amountUsedCop'] === 'number' ? formatCop(d['amountUsedCop'] as number) : null].filter(Boolean).join(' · ');
    case 'unredeemed':
      return String(d['externalRef'] ?? '');
    case 'voided':
      return String(d['reason'] ?? '');
    case 'recipient_set':
      return String(d['name'] ?? '');
    case 'updated':
      return Object.keys(d).map((k) => k.replace(/_/g, ' ')).join(', ');
    default:
      return '';
  }
};

const DetailDrawer: React.FC<{
  cardId: string | null;
  canEdit: boolean;
  businessName: string;
  onClose: () => void;
  onChanged: () => void;
}> = ({ cardId, canEdit, businessName, onClose, onChanged }) => {
  const [card, setCard] = useState<GiftCardDetail | null>(null);
  const [recipient, setRecipient] = useState('');
  const [validTo, setValidTo] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!cardId) return;
    const c = await fetchGiftCard(cardId);
    setCard(c);
    setRecipient(c.recipientName ?? '');
    setValidTo(c.validTo ?? '');
  }, [cardId]);

  useEffect(() => {
    setCard(null);
    setConfirmVoid(false);
    setVoidReason('');
    setError(null);
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const open = cardId !== null;
  const editable = card && canEdit && card.status !== 'void';
  const whatsapp = card?.publicUrl
    ? buildWhatsAppUrl(card.buyerPhone, `Hola ${card.buyerName.split(' ')[0]} ✨ Aquí está tu tarjeta regalo de ${businessName}: ${card.publicUrl}`)
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-xl overflow-y-auto p-0">
        {!card ? (
          <div className="flex h-64 items-center justify-center"><DialogTitle className="sr-only">Tarjeta regalo</DialogTitle><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5 p-5 sm:p-6">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono tracking-wider">{card.code}</span> <StatusPill status={card.effectiveStatus} />
              </DialogTitle>
              <DialogDescription>
                {SOURCE_LABEL[card.source]} · {card.funded ? 'Pagada por el cliente' : 'Promocional (descuento)'} · creada {dateTime(card.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="mx-auto max-w-[360px]">
              <GiftCardFace amountCop={card.amountCop} tierName={card.tierName} code={card.code} validTo={card.validTo} status={card.effectiveStatus} businessName={businessName} />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">De</dt><dd className="font-medium">{card.buyerName || '—'}</dd><dd className="text-xs text-muted-foreground">{card.buyerPhone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Para</dt><dd className="font-medium">{card.recipientName || '—'}</dd><dd className="text-xs text-muted-foreground">{card.recipientPhone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Vigencia</dt><dd>{card.validFrom ? `${formatGiftDate(card.validFrom)} – ${formatGiftDate(card.validTo)}` : 'Empieza al confirmar el pago'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Pago</dt><dd>{card.paidAt ? `${card.paidMethod} · ${formatCop(card.paidAmountCop ?? 0)}` : card.funded ? 'Pendiente' : 'No aplica'}</dd></div>
              {card.redeemedAt && <div><dt className="text-xs text-muted-foreground">Canje</dt><dd>{dateTime(card.redeemedAt)} · {formatCop(card.redeemedAmountCop ?? 0)}</dd><dd className="text-xs text-muted-foreground">{card.redeemedRef}</dd></div>}
              {card.minTicketCop ? <div><dt className="text-xs text-muted-foreground">Compra mínima</dt><dd>{formatCop(card.minTicketCop)}</dd></div> : null}
              {card.message && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Mensaje</dt><dd className="italic">“{card.message}”</dd></div>}
              {card.voidReason && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Motivo de anulación</dt><dd>{card.voidReason}</dd></div>}
            </dl>

            {card.publicUrl && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(card.publicUrl!).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  <Copy className="mr-1.5 h-4 w-4" /> {copied ? 'Copiado' : 'Copiar enlace'}
                </Button>
                {whatsapp && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" /> Enviar al comprador</a>
                  </Button>
                )}
              </div>
            )}

            {editable && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Editar</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Para</Label>
                    <Input value={recipient} onChange={(e) => setRecipient(e.target.value.slice(0, 40))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Válida hasta</Label>
                    <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} disabled={!card.validFrom} />
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={busy || (recipient === (card.recipientName ?? '') && validTo === (card.validTo ?? ''))}
                  onClick={() =>
                    void run(() =>
                      updateGiftCard(card.id, {
                        ...(recipient !== (card.recipientName ?? '') ? { recipientName: recipient.trim() || null } : {}),
                        ...(validTo && validTo !== card.validTo ? { validTo } : {}),
                      }),
                    )
                  }
                >
                  Guardar cambios
                </Button>
              </div>
            )}

            {editable && card.status !== 'redeemed' && (
              <div className="space-y-2">
                {!confirmVoid ? (
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setConfirmVoid(true)}>
                    Anular tarjeta
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
                    <Label>Motivo de la anulación</Label>
                    <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Ej. el cliente desistió" />
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" disabled={busy || !voidReason.trim()} onClick={() => void run(() => voidGiftCard(card.id, voidReason.trim()))}>
                        Anular
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmVoid(false)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div>
              <p className="mb-2 text-sm font-medium">Historial</p>
              <ol className="relative space-y-3 border-l pl-4">
                {card.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#AC8231]" />
                    <span className="font-medium">{EVENT_LABEL[e.type]}</span>
                    <span className="text-muted-foreground"> · {dateTime(e.createdAt)}</span>
                    {eventDetail(e) && <span className="block text-xs text-muted-foreground">{eventDetail(e)}</span>}
                    {e.actorName && <span className="block text-xs text-muted-foreground">por {e.actorName}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------- page

const STATUS_FILTERS: Array<{ value: GiftCardEffectiveStatus | ''; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'pending_payment', label: 'Esperando pago' },
  { value: 'active', label: 'Activas' },
  { value: 'redeemed', label: 'Disfrutadas' },
  { value: 'expired', label: 'Vencidas' },
  { value: 'void', label: 'Anuladas' },
];

export const GiftCardsPage: React.FC = () => {
  const { isStaff, currentOwner } = useAuth();
  const canEdit = !isStaff;
  useGiftFonts();
  const businessName = currentOwner?.businessName ?? 'Golden Beauty Studio';
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [stats, setStats] = useState<GiftCardStats | null>(null);
  const [tiers, setTiers] = useState<GiftCardTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GiftCardEffectiveStatus | ''>('');
  const [source, setSource] = useState<GiftCardSource | ''>('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tiersOpen, setTiersOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadCards = useCallback(async () => {
    try {
      setCards(await fetchGiftCards({ status, source, q: debounced }));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [status, source, debounced]);

  const loadMeta = useCallback(async () => {
    const [s, t] = await Promise.allSettled([fetchGiftCardStats(), fetchGiftCardTiers()]);
    if (s.status === 'fulfilled') setStats(s.value);
    if (t.status === 'fulfilled') setTiers(t.value);
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);
  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const refresh = () => {
    void loadCards();
    void loadMeta();
  };

  const empty = useMemo(() => !loading && cards.length === 0, [loading, cards.length]);

  return (
    <div className="flex h-full flex-col space-y-6 overflow-y-auto bg-gray-50/50 p-4 md:p-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Tarjetas regalo</h1>
          <p className="text-muted-foreground">Ventas, cortesías y canjes de tarjetas regalo.</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setTiersOpen(true)}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Niveles
            </Button>
            <Button onClick={() => setIssueOpen(true)}>
              <Gift className="mr-1.5 h-4 w-4" /> Emitir tarjeta
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-[#AC8231]/30 bg-[#FBF6F4] p-4 text-sm text-[#4A3426]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#AC8231]" />
        <p>
          El <strong>pago</strong> y el <strong>canje</strong> se registran en el panel del estudio (Caja), donde vive el dinero:
          al confirmar el pago la tarjeta se activa y al cerrar la cuenta con el código se marca como disfrutada.
        </p>
      </div>

      <StatsHeader stats={stats} />

      <div className="flex flex-col gap-3 rounded-xl border bg-white p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex w-full items-center gap-2 rounded-lg border bg-white px-3 focus-within:ring-2 focus-within:ring-ring sm:max-w-sm">
          <Search className="h-4 w-4 text-gray-400" />
          <Input className="border-none bg-transparent px-0 shadow-none focus-visible:ring-0" placeholder="Código, nombre o teléfono" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Limpiar"><X className="h-4 w-4 text-gray-400" /></button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              onClick={() => setStatus(f.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                status === f.value ? 'border-[#4A3426] bg-[#4A3426] text-white' : 'bg-white text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select className="h-9 rounded-md border bg-white px-2 text-sm sm:ml-auto" value={source} onChange={(e) => setSource(e.target.value as GiftCardSource | '')} aria-label="Origen">
          <option value="">Todo origen</option>
          <option value="sale">Venta</option>
          <option value="manual">Manual</option>
          <option value="advent">Adviento</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : empty ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-sm text-muted-foreground">
          No hay tarjetas con estos filtros.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border bg-white shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-gray-50/80 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Monto</th>
                  <th className="px-4 py-3 font-medium">De → Para</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Vigencia</th>
                  <th className="px-4 py-3 font-medium">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cards.map((c) => (
                  <tr key={c.id} className="cursor-pointer transition hover:bg-[#FBF6F4]" onClick={() => setSelected(c.id)} data-testid="gift-row">
                    <td className="px-4 py-3 font-mono text-xs tracking-wider">{c.code}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium tabular-nums">{formatCop(c.amountCop)}</span>
                      {c.tierName && <span className="block text-xs text-muted-foreground">{c.tierName}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.buyerName || '—'} <span className="text-muted-foreground">→</span> {c.recipientName || <span className="text-muted-foreground">sin nombre</span>}
                    </td>
                    <td className="px-4 py-3"><StatusPill status={c.effectiveStatus} /></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.validTo ? `hasta ${formatGiftDate(c.validTo)}` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{SOURCE_LABEL[c.source]}{!c.funded && ' · promo'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile list */}
          <div className="space-y-2 md:hidden">
            {cards.map((c) => (
              <button key={c.id} onClick={() => setSelected(c.id)} className="w-full rounded-xl border bg-white p-4 text-left shadow-sm" data-testid="gift-row-mobile">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs tracking-wider">{c.code}</span>
                  <StatusPill status={c.effectiveStatus} />
                </div>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <span className="text-sm">{c.buyerName || '—'} → {c.recipientName || 'sin nombre'}</span>
                  <span className="font-semibold tabular-nums">{formatCop(c.amountCop)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <DetailDrawer cardId={selected} canEdit={canEdit} businessName={businessName} onClose={() => setSelected(null)} onChanged={refresh} />
      {canEdit && <TierManager open={tiersOpen} onOpenChange={setTiersOpen} tiers={tiers} onChanged={() => void loadMeta()} />}
      {canEdit && (
        <IssueDialog
          open={issueOpen}
          onOpenChange={setIssueOpen}
          tiers={tiers}
          onIssued={(card) => {
            refresh();
            setSelected(card.id);
          }}
        />
      )}
    </div>
  );
};

export default GiftCardsPage;
