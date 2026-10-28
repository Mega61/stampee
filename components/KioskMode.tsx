import React, { useEffect, useState } from 'react';
import { Customer, IssuedCard, Template, Transaction } from '../types';
import { LoyaltyCard } from './LoyaltyCard';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Plus, Gift, History, User, ChevronLeft, Minus, Lock, CheckCircle, RefreshCcw, ShieldCheck, Clock3, MessageCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from './AuthProvider';
import { buildPublicCardUrl } from '../lib/links';
import { buildWhatsAppUrl } from '../lib/cardInsights';
import { buildKioskWhatsAppMessage, kioskNoticeKindForStamp, type KioskNoticeKind } from '../lib/whatsappMessages';

interface KioskModeProps {
  customer: Customer;
  card: IssuedCard;
  template: Template;
  onClose: () => void;
  onUpdateCard: (customerId: string, cardId: string, updates: Partial<IssuedCard>) => Promise<void>;
  onIssueNew: (customer: Customer, template: Template) => void;
  canIssue: boolean;
  allowRedeem: boolean;
  actorId?: string;
  actorName: string;
  actorRole: 'owner' | 'staff';
  onScanRequest?: () => void;
  mutationBusy?: boolean;
}

// Helper to create timestamped transaction
const createTransaction = (
    type: Transaction['type'],
    amount: number,
    title: string,
    remarks?: string,
    actor?: { id?: string; name: string; role: 'owner' | 'staff' }
): Transaction => {
    const now = new Date();
    return {
        id: `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        amount,
        date: now.toLocaleString(undefined, { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
        }),
        timestamp: now.getTime(),
        title,
        remarks,
        actorId: actor?.id,
        actorName: actor?.name,
        actorRole: actor?.role
    };
};

const formatKioskAction = (type: Transaction['type']) => {
    switch (type) {
        case 'issued':
            return 'Card issued';
        case 'redeem':
            return 'Reward redeemed';
        case 'stamp_remove':
            return 'Stamp removed';
        case 'gift':
            return 'Gift stamps';
        case 'bonus':
            return 'Bonus stamp (game)';
        default:
            return 'Stamp added';
    }
};

const formatKioskTimestamp = (timestamp: number) =>
    new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });

export const KioskMode: React.FC<KioskModeProps> = ({
  customer,
  card,
  template,
  onClose,
  onUpdateCard,
  onIssueNew,
  canIssue,
  allowRedeem,
  actorId,
  actorName,
  actorRole,
  mutationBusy = false
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [actionError, setActionError] = useState("");
  
  // Confirmation States
  const [confirmAction, setConfirmAction] = useState<'stamp' | 'remove' | 'redeem' | null>(null);
  const [redemptionRemarks, setRedemptionRemarks] = useState("");
  // Last successful stamp/redeem, offered as a WhatsApp ping to the client.
  const [notice, setNotice] = useState<{ kind: KioskNoticeKind; stamps: number } | null>(null);
  const { currentOwner } = useAuth();
  useEffect(() => setNotice(null), [card.id]);

  const canAdd = card.status === 'Active' && card.stamps < template.totalStamps;
  const canRedeem = allowRedeem && card.status === 'Active' && card.stamps >= template.totalStamps;
  const canRemove = card.status === 'Active' && card.stamps > 0;
  const isLocked = card.status === 'Redeemed';
  const remainingStamps = Math.max(template.totalStamps - card.stamps, 0);
  const recentHistory = [...card.history]
    .sort((a, b) => b.timestamp - a.timestamp);
  const customerMeta = customer.mobile || customer.email || 'No contact details';
  const operatorLabel = actorRole === 'staff' ? 'Staff session' : 'Owner session';
  const confirmCopy = (() => {
      switch (confirmAction) {
          case 'stamp':
              return {
                  title: 'Confirm Stamp',
                  description: `Add 1 stamp to ${customer.name}'s card?`,
                  buttonLabel: 'Add Stamp',
                  icon: Plus,
                  accentClassName: 'bg-[#eef5e8] text-[#4c7a2b]',
                  buttonClassName: 'bg-[#1d1d1f] hover:bg-black',
              };
          case 'remove':
              return {
                  title: 'Remove Stamp',
                  description: `Remove 1 stamp from ${customer.name}'s card?`,
                  buttonLabel: 'Remove Stamp',
                  icon: Minus,
                  accentClassName: 'bg-rose-100 text-rose-600',
                  buttonClassName: '',
              };
          case 'redeem':
              return {
                  title: 'Confirm Redemption',
                  description: `Complete ${customer.name}'s card and mark the reward as claimed.`,
                  buttonLabel: 'Confirm & Redeem',
                  icon: Gift,
                  accentClassName: 'bg-[#fff2de] text-[#cf6d1b]',
                  buttonClassName: 'bg-[#cf6d1b] hover:bg-[#b75e14]',
              };
          default:
              return null;
      }
  })();

  const noticeWhatsAppUrl = (() => {
      if (!notice) return null;
      const slug = currentOwner?.slug;
      const text = buildKioskWhatsAppMessage({
          kind: notice.kind,
          businessName: currentOwner?.businessName,
          stamps: notice.stamps,
          totalStamps: template.totalStamps,
          rewardName: template.rewardName,
          // After a redeem the card is closed, so don't send them to it.
          cardUrl: slug && notice.kind !== 'redeem' ? buildPublicCardUrl(slug, card.uniqueId) : null,
      });
      return buildWhatsAppUrl(customer.mobile, text);
  })();
  const noticeCopy = notice && {
      stamp: { title: 'Stamp added', detail: `${notice.stamps}/${template.totalStamps} stamps. Let ${customer.name.split(' ')[0]} know it landed.` },
      complete: { title: 'Card complete', detail: `${template.rewardName} is unlocked. Tell ${customer.name.split(' ')[0]} it's ready.` },
      redeem: { title: 'Reward redeemed', detail: `Send ${customer.name.split(' ')[0]} a thank-you.` },
  }[notice.kind];

  // --- Handlers ---

  const handleConfirmAction = async () => {
      setActionError("");
      setNotice(null);
      try {
          if (confirmAction === 'stamp') {
              await performAddStamp();
          } else if (confirmAction === 'remove') {
              await performRemoveStamp();
          } else if (confirmAction === 'redeem') {
              await performRedeem();
          }
          setConfirmAction(null);
          setRedemptionRemarks("");
      } catch {
          setActionError("Unable to update this card right now. Please try again.");
      }
  };

  const performAddStamp = async () => {
      setIsAnimating(true);
      const tx = createTransaction('stamp_add', 1, 'Stamp Collected', undefined, { id: actorId, name: actorName, role: actorRole });

      try {
          await onUpdateCard(customer.id, card.id, {
              stamps: card.stamps + 1,
              lastVisit: new Date().toISOString().split('T')[0],
              history: [tx, ...card.history]
          });
          setNotice({ kind: kioskNoticeKindForStamp(card.stamps + 1, template.totalStamps), stamps: card.stamps + 1 });
      } finally {
          setTimeout(() => setIsAnimating(false), 300);
      }
  };

  const performRemoveStamp = async () => {
      const tx = createTransaction('stamp_remove', -1, 'Stamp Removed', 'Manual Correction', { id: actorId, name: actorName, role: actorRole });

      await onUpdateCard(customer.id, card.id, {
          stamps: Math.max(0, card.stamps - 1),
          history: [tx, ...card.history]
      });
  };

  const performRedeem = async () => {
      const tx = createTransaction('redeem', 0, 'Reward Redeemed', redemptionRemarks, { id: actorId, name: actorName, role: actorRole });

      // Lock the card by setting status to Redeemed
      await onUpdateCard(customer.id, card.id, {
          status: 'Redeemed',
          completedDate: new Date().toISOString().split('T')[0],
          history: [tx, ...card.history]
      });
      setNotice({ kind: 'redeem', stamps: card.stamps });
  };

  const handleIssueNext = () => {
      if (!canIssue) return;
      onClose(); // Close kiosk
      // Small delay to allow close animation then trigger parent wizard
      setTimeout(() => onIssueNew(customer, template), 100);
  };

  const handlePreviewStampAddTap = () => {
    if (mutationBusy || !canAdd) return;
    setConfirmAction('stamp');
  };

  const handlePreviewStampRemoveTap = () => {
    if (mutationBusy || !canRemove) return;
    setConfirmAction('remove');
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#f5f4ef] animate-fade-in overscroll-y-contain md:overflow-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-[#d8ef5a]/45 blur-3xl" />
        <div className="absolute bottom-[-10rem] right-[-6rem] h-80 w-80 rounded-full bg-[#f7bf7c]/40 blur-3xl" />
      </div>
      <div className="relative flex min-h-screen flex-col md:h-full md:min-h-0 md:flex-row">
      {/* LEFT: Card Visual */}
      <div className="relative flex min-h-screen w-full shrink-0 flex-col border-b border-black/5 bg-[linear-gradient(180deg,#f9f7f0_0%,#efece1_100%)] px-4 pb-6 pt-4 md:h-full md:min-h-0 md:w-1/2 md:border-b-0 md:border-r md:px-6 md:pb-8 md:pt-6 lg:w-5/12">
        <div className="mb-4 flex items-center md:mb-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-full border-black/10 bg-white/80 px-4 backdrop-blur hover:bg-white"
          >
            <ChevronLeft size={18} className="mr-2" />
            Back
          </Button>
        </div>

        <div className="flex flex-1 items-start justify-center pt-2 sm:pt-4 md:items-center md:pt-0">
          <div className="relative mx-auto w-full max-w-[26rem] sm:max-w-[28rem] md:mt-4 md:max-w-[380px]">
            <div className="absolute inset-x-8 bottom-[-1.25rem] h-16 rounded-full bg-black/10 blur-2xl" />
            <div className="relative aspect-[340/600] overflow-hidden rounded-[2.6rem] bg-white shadow-[0_32px_80px_-36px_rgba(0,0,0,0.42)] ring-1 ring-black/5 md:aspect-[420/780]">
                <LoyaltyCard 
                    template={template}
                    mode="active"
                    currentStamps={card.stamps}
                    readOnly={true} 
                    onStampAddTap={handlePreviewStampAddTap}
                    onStampRemoveTap={handlePreviewStampRemoveTap}
                    className={cn("w-full h-full transition-opacity", isLocked && "opacity-50 grayscale-[0.5]")}
                    history={card.history}
                    isRedeemed={isLocked}
                    sizeVariant="compact"
                />
                
                {/* Stamp Animation Overlay */}
                {isAnimating && (
                    <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                        <div className="animate-zoom-in-95 rounded-full bg-[#1d1d1f] p-6 text-white shadow-xl">
                            <Plus size={48} />
                        </div>
                    </div>
                )}

                {/* Locked Overlay */}
                {isLocked && (
                    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10 backdrop-blur-[2px]">
                        <div className="flex flex-col items-center rounded-[28px] bg-white/90 p-6 text-center shadow-xl">
                            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                                <CheckCircle size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-[#1d1d1f]">Reward claimed</h3>
                            <p className="mt-1 text-sm text-[#5f6368]">This card is closed.</p>
                        </div>
                    </div>
                )}
            </div>
            {!isLocked && (
              <p className="mt-3 text-center text-xs font-medium tracking-wide text-[#5f6368] sm:text-sm">
                Tap the next empty stamp to add. Tap a filled stamp to remove.
              </p>
            )}
          </div>
        </div>

      </div>

      {/* RIGHT: Controls */}
      <div className="flex flex-1 flex-col bg-transparent md:min-h-0">
        {/* Main Actions */}
        <div className="md:flex-1 md:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 md:gap-6 md:p-8">
            <div className="rounded-[20px] border border-black/5 bg-white/85 px-4 py-3 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.3)] backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Card ID</p>
                <p className="mt-1 break-all font-mono text-sm text-[#1d1d1f]">{card.uniqueId}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.3)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Customer</p>
                            <p className="mt-3 text-lg font-semibold text-[#1d1d1f]">{customer.name}</p>
                            <p className="mt-1 break-all text-sm text-[#5f6368]">{customerMeta}</p>
                        </div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f5f4ef] text-[#1d1d1f]">
                            <User size={18} />
                        </div>
                    </div>
                </div>

                <div className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.3)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Reward status</p>
                            <p className="mt-3 text-lg font-semibold text-[#1d1d1f]">{isLocked ? 'Completed' : canRedeem ? 'Claim now' : `${remainingStamps} remaining`}</p>
                            <p className="mt-1 text-sm text-[#5f6368]">{template.rewardName}</p>
                        </div>
                        <div className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-2xl",
                            isLocked ? "bg-emerald-50 text-emerald-600" : canRedeem ? "bg-[#fff2de] text-[#cf6d1b]" : "bg-[#f5f4ef] text-[#1d1d1f]"
                        )}>
                            <Gift size={18} />
                        </div>
                    </div>
                </div>

                <div className="rounded-[24px] border border-black/5 bg-white p-5 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.3)]">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Session</p>
                            <p className="mt-3 text-lg font-semibold text-[#1d1d1f]">{operatorLabel}</p>
                            <p className="mt-1 text-sm text-[#5f6368]">{actorName}</p>
                        </div>
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef5e8] text-[#4c7a2b]">
                            <ShieldCheck size={18} />
                        </div>
                    </div>
                </div>
            </div>

            {actionError && (
                <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {actionError}
                </div>
            )}

            {noticeWhatsAppUrl && noticeCopy && (
                <div className="flex flex-col gap-4 rounded-[24px] border border-[#cfe6bf] bg-[#f3f9ee] p-4 shadow-[0_18px_45px_-34px_rgba(0,0,0,0.3)] animate-fade-in sm:flex-row sm:items-center sm:p-5">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e2f0d6] text-[#4c7a2b]">
                            <CheckCircle size={20} />
                        </div>
                        <div className="min-w-0">
                            <p className="text-base font-semibold text-[#1d1d1f]">{noticeCopy.title}</p>
                            <p className="mt-0.5 text-sm text-[#5f6368]">{noticeCopy.detail}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={noticeWhatsAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#25d366] px-5 text-sm font-semibold text-[#0b3d1e] shadow-[0_14px_30px_-18px_rgba(37,211,102,0.9)] transition-colors hover:bg-[#1fbe5b] sm:flex-none"
                        >
                            <MessageCircle size={18} />
                            Avisar por WhatsApp
                        </a>
                        <button
                            type="button"
                            onClick={() => setNotice(null)}
                            aria-label="Dismiss"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#6e6e73] transition-colors hover:bg-black/5"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}
            
            {isLocked ? (
                // LOCKED STATE ACTIONS
                <div className="rounded-[30px] border border-black/5 bg-white p-6 shadow-[0_28px_60px_-40px_rgba(0,0,0,0.32)]">
                    <div className="flex h-full flex-col items-center justify-center gap-6 py-2 text-center">
                        <div className="space-y-2">
                        <Lock size={48} className="mx-auto text-gray-300" />
                        <h2 className="text-xl font-bold text-[#1d1d1f] sm:text-2xl">Reward Redeemed</h2>
                        <p className="mx-auto max-w-md text-sm text-[#5f6368] sm:text-base">
                            This card has been completed and redeemed on {card.completedDate || 'today'}. To continue collecting stamps, issue a new card.
                        </p>
                        </div>
                    <Button size="lg" onClick={handleIssueNext} className="h-12 w-full gap-2 rounded-full bg-[#1d1d1f] px-6 text-base text-white shadow-lg hover:bg-black sm:h-14 sm:w-auto sm:px-8 sm:text-lg" disabled={!canIssue}>
                        <RefreshCcw size={20} /> Issue New Card
                    </Button>
                    {!canIssue && (
                        <div className="text-xs text-amber-700">Verify your email to issue cards.</div>
                    )}
                </div>
                </div>
            ) : (
                // ACTIVE STATE ACTIONS
                <div className="rounded-[30px] border border-black/5 bg-white p-4 shadow-[0_28px_60px_-40px_rgba(0,0,0,0.32)] sm:p-6">
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b705c]">Actions</p>
                        <h2 className="mt-2 text-2xl font-bold tracking-tight text-[#1d1d1f]">Fast counter controls</h2>
                    </div>
                    <p className="max-w-md text-sm text-[#5f6368]">
                        Prioritize the add-stamp flow. Redeem stays highlighted only when the reward is actually unlocked.
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                    {/* Stamp Button */}
                    <button
                        onClick={() => setConfirmAction('stamp')}
                        disabled={mutationBusy || !canAdd}
                        className={cn(
                            "group relative overflow-hidden rounded-[30px] border p-6 text-left transition-all duration-200",
                            !canAdd 
                                ? "cursor-not-allowed border-black/5 bg-[#f3f2ec] opacity-55" 
                                : "border-black/5 bg-[linear-gradient(145deg,#1d1d1f_0%,#303033_100%)] text-white shadow-[0_28px_65px_-34px_rgba(0,0,0,0.55)] hover:-translate-y-0.5"
                        )}
                    >
                        <div className="absolute right-[-1.5rem] top-[-1.5rem] h-24 w-24 rounded-full bg-white/10 blur-2xl" />
                        <div className="relative flex min-h-[220px] flex-col justify-between gap-6">
                          <div className="flex items-start justify-between gap-3">
                            <div className={cn(
                              "flex h-14 w-14 items-center justify-center rounded-2xl",
                              !canAdd ? "bg-white/60 text-[#6e6e73]" : "bg-white/15 text-white"
                            )}>
                              <Plus size={28} strokeWidth={2.8} />
                            </div>
                            <span className={cn(
                              "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                              !canAdd ? "bg-white text-[#6e6e73]" : "bg-white/15 text-white"
                            )}>
                              Primary
                            </span>
                          </div>
                          <div>
                            <span className={cn("block text-2xl font-bold tracking-tight", !canAdd && "text-[#4c4c52]")}>Add Stamp</span>
                            <span className={cn("mt-2 block text-sm leading-6", !canAdd ? "text-[#6e6e73]" : "text-white/78")}>Record a completed visit instantly and keep the customer moving through the queue.</span>
                          </div>
                          <div className={cn("text-sm font-medium", !canAdd ? "text-[#6e6e73]" : "text-white/84")}>
                            {canAdd ? `${remainingStamps} more until reward` : 'Card already reached max stamps'}
                          </div>
                        </div>
                    </button>

                    {/* Redeem Button */}
                    {allowRedeem ? (
                        <button
                            onClick={() => setConfirmAction('redeem')}
                            disabled={mutationBusy || !canRedeem}
                            className={cn(
                                "group relative overflow-hidden rounded-[30px] border p-6 text-left transition-all duration-200",
                                !canRedeem 
                                    ? "cursor-not-allowed border-black/5 bg-[#f8f7f2] opacity-60" 
                                    : "border-[#f0c48e] bg-[linear-gradient(145deg,#fff6e8_0%,#ffe8c5_100%)] shadow-[0_28px_60px_-38px_rgba(207,109,27,0.45)] hover:-translate-y-0.5"
                            )}
                        >
                            <div className="absolute bottom-[-2rem] right-[-2rem] h-28 w-28 rounded-full bg-white/30 blur-2xl" />
                            <div className="relative flex min-h-[220px] flex-col justify-between gap-6">
                              <div className="flex items-start justify-between gap-3">
                                <div className={cn(
                                  "flex h-14 w-14 items-center justify-center rounded-2xl",
                                  canRedeem ? "bg-[#cf6d1b] text-white" : "bg-white text-[#a8a29e]"
                                )}>
                                  <Gift size={28} strokeWidth={2.6} />
                                </div>
                                <span className={cn(
                                  "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                                  canRedeem ? "bg-white/70 text-[#8a4a11]" : "bg-white text-[#8c8c91]"
                                )}>
                                  {canRedeem ? 'Unlocked' : 'Standby'}
                                </span>
                              </div>
                              <div>
                                <span className={cn("block text-2xl font-bold tracking-tight", canRedeem ? "text-[#8a4a11]" : "text-[#4c4c52]")}>Redeem Reward</span>
                                <span className="mt-2 block text-sm leading-6 text-[#6b5b49]">Close the card and confirm the reward once the customer has completed all required stamps.</span>
                              </div>
                              <div className={cn("text-sm font-medium", canRedeem ? "text-[#8a4a11]" : "text-[#6e6e73]")}>
                                {canRedeem ? template.rewardName : `Need ${remainingStamps} more stamp${remainingStamps === 1 ? '' : 's'}`}
                              </div>
                            </div>
                        </button>
                    ) : (
                        <div className="rounded-[30px] border border-dashed border-black/10 bg-[#f8f7f2] p-6">
                            <div className="flex min-h-[220px] flex-col justify-between gap-6">
                              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[#6e6e73]">
                                  <Lock size={26} />
                              </div>
                              <div>
                                  <span className="block text-2xl font-bold tracking-tight text-[#4c4c52]">Redeem locked</span>
                                  <span className="mt-2 block text-sm leading-6 text-[#6e6e73]">Reward redemption is limited for this session. An owner can complete the reward flow.</span>
                              </div>
                              <div className="text-sm font-medium text-[#6e6e73]">Owner approval required</div>
                            </div>
                        </div>
                    )}
                </div>
                </div>
            )}

            {/* Bottom Tools */}
            {!isLocked && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                     {/* Remove Stamp Button */}
                     <button 
                        onClick={() => setConfirmAction('remove')}
                        disabled={mutationBusy || !canRemove}
                        className={cn(
                            "rounded-[24px] border p-5 text-left transition-colors",
                            canRemove
                              ? "border-black/5 bg-white hover:border-rose-200 hover:bg-rose-50"
                              : "cursor-not-allowed border-black/5 bg-[#f8f7f2] opacity-55"
                        )}
                    >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Correction</p>
                            <p className={cn("mt-2 text-lg font-semibold", canRemove ? "text-[#7a1f1f]" : "text-[#6e6e73]")}>Remove Stamp</p>
                            <p className="mt-2 text-sm text-[#5f6368]">Use when a visit was added by mistake and the balance needs manual correction.</p>
                          </div>
                          <div className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-2xl",
                            canRemove ? "bg-rose-100 text-rose-600" : "bg-white text-[#9ca3af]"
                          )}>
                            <Minus size={18} />
                          </div>
                        </div>
                    </button>
                    
                    <div className="rounded-[24px] border border-black/5 bg-[#f8f7f2] p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Today</p>
                            <p className="mt-2 text-lg font-semibold text-[#1d1d1f]">Last visit</p>
                            <p className="mt-2 text-sm text-[#5f6368]">{card.lastVisit || 'Today'}</p>
                          </div>
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#5f6368]">
                            <Clock3 size={18} />
                          </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_28px_60px_-40px_rgba(0,0,0,0.32)] sm:p-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b705c]">Recent activity</p>
                        <h2 className="mt-2 text-xl font-bold tracking-tight text-[#1d1d1f]">Card timeline</h2>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f5f4ef] text-[#1d1d1f]">
                        <History size={18} />
                    </div>
                </div>

                {recentHistory.length === 0 ? (
                    <div className="mt-6 rounded-[24px] border border-dashed border-black/10 bg-[#f8f7f2] px-4 py-10 text-center text-sm text-[#5f6368]">
                        No activity recorded yet.
                    </div>
                ) : (
                    <div className="mt-6 space-y-3">
                        {recentHistory.map((entry, index) => (
                            <div key={entry.id} className="relative rounded-[22px] border border-black/5 bg-[#fcfbf7] p-4">
                                {index !== recentHistory.length - 1 && (
                                    <div className="absolute bottom-[-0.75rem] left-[1.35rem] top-[3.7rem] w-px bg-black/6" />
                                )}
                                <div className="flex items-start gap-3">
                                    <div className={cn(
                                        "relative z-[1] mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                        entry.type === 'redeem'
                                            ? "bg-emerald-100 text-emerald-600"
                                            : entry.type === 'stamp_remove'
                                                ? "bg-rose-100 text-rose-600"
                                                : "bg-[#eef5e8] text-[#4c7a2b]"
                                    )}>
                                        {entry.type === 'redeem' ? <Gift size={16} /> : entry.type === 'stamp_remove' ? <Minus size={16} /> : <Plus size={16} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold text-[#1d1d1f]">{formatKioskAction(entry.type)}</p>
                                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#6e6e73] ring-1 ring-black/5">
                                                {formatKioskTimestamp(entry.timestamp)}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-sm text-[#5f6368]">
                                            {entry.actorName ? `${entry.actorName} • ${entry.actorRole ?? 'owner'}` : operatorLabel}
                                        </p>
                                        {entry.remarks && <p className="mt-2 text-sm text-[#6b705c]">{entry.remarks}</p>}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

        </div>
        </div>
      </div>
      </div>

      {/* CONFIRMATION DIALOG */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && !mutationBusy && setConfirmAction(null)}>
        <DialogContent className="max-w-md rounded-[28px] border-black/5 bg-[#fcfbf7] p-0 shadow-[0_28px_80px_-40px_rgba(0,0,0,0.4)]">
            {confirmCopy && (
            <div className="border-b border-black/5 px-6 py-5">
            <DialogHeader>
                <div className="flex items-start gap-4">
                    <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", confirmCopy.accentClassName)}>
                        <confirmCopy.icon size={22} />
                    </div>
                    <div className="min-w-0">
                        <DialogTitle>{confirmCopy.title}</DialogTitle>
                        <DialogDescription className="mt-1 text-sm text-[#5f6368]">
                            {confirmCopy.description}
                        </DialogDescription>
                    </div>
                </div>
            </DialogHeader>
            </div>
            )}

            {confirmCopy && (
                <div className="space-y-4 px-6 py-5">
                    <div className="rounded-[24px] border border-black/5 bg-white/80 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b705c]">Customer</p>
                                <p className="mt-1 text-base font-semibold text-[#1d1d1f]">{customer.name}</p>
                            </div>
                            <p className="text-sm text-[#5f6368]">{card.stamps}/{template.totalStamps} stamps</p>
                        </div>
                        <p className="mt-3 text-sm text-[#5f6368]">
                            Reward: <span className="font-medium text-[#1d1d1f]">{template.rewardName}</span>
                        </p>
                    </div>

                    {confirmAction === 'redeem' && (
                        <div className="space-y-3">
                            <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                This will complete the card and lock it permanently. A new card will be needed for future visits.
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="remarks">Redemption Remarks (Optional)</Label>
                                <Input 
                                    id="remarks" 
                                    placeholder="e.g. Verified ID, Coupon code used..."
                                    value={redemptionRemarks}
                                    onChange={(e) => setRedemptionRemarks(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            <DialogFooter className="gap-2 border-t border-black/5 bg-white/70 px-6 py-4 sm:gap-2">
                <Button variant="outline" className="rounded-full border-black/10" onClick={() => setConfirmAction(null)} disabled={mutationBusy}>Cancel</Button>
                
                {confirmAction === 'remove' ? (
                    <Button variant="destructive" className="rounded-full" onClick={handleConfirmAction} disabled={mutationBusy}>
                        {mutationBusy ? "Saving..." : confirmCopy?.buttonLabel}
                    </Button>
                ) : (
                    <Button className={cn("rounded-full", confirmCopy?.buttonClassName)} onClick={handleConfirmAction} disabled={mutationBusy}>
                        {mutationBusy ? "Saving..." : confirmCopy?.buttonLabel}
                    </Button>
                )}
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
