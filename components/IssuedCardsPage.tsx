import { withCardSource } from '../lib/whatsappMessages';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Plus, Search, MonitorPlay, MoreHorizontal, Trash, ExternalLink, Lock, QrCode, X, Download, MessageCircle, ChevronDown, Gift
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn, formatGiftRemark, getBonusStamps } from "../lib/utils";
import { Customer, Template, IssuedCard, Transaction } from '../types';
import { KioskMode } from './KioskMode';
import { IssueCardDialog } from './IssueCardDialog';
import { WinBackDialog } from './WinBackDialog';
import { resolveCardTemplate, toStoredTemplate } from '../lib/templateSerialization';
import { useAuth } from './AuthProvider';
import { buildPublicCardUrl } from '../lib/links';
import { ScanDetectionResult, ScanQrDialog } from './ScanQrDialog';
import { insertIssuedCard, updateIssuedCard, deleteIssuedCard, insertTransaction, inspectScannedCard } from '../lib/db/issuedCards';
import { upsertCustomer } from '../lib/db/customers';
import {
  buildCardInsights, buildWhatsAppUrl, downloadCsv, formatRelativeDays, formatShortDate,
  STAGE_LABELS, type CardInsight, type CardStage,
} from '../lib/cardInsights';

const PAGE_SIZE = 50;
const AT_RISK_DAYS = 30;

type StageFilter = 'all' | 'open' | 'at_risk' | CardStage;
type RecencyFilter = 'any' | 'today' | '7d' | '30d' | 'inactive30' | 'inactive60' | 'inactive90';
type SortKey = 'recent' | 'oldest' | 'progress_desc' | 'progress_asc' | 'remaining' | 'issued_desc' | 'name';

const isAtRisk = (row: CardInsight) =>
  row.stage !== 'redeemed' && row.daysSinceActivity !== null && row.daysSinceActivity >= AT_RISK_DAYS;

const matchesRecency = (filter: RecencyFilter, days: number | null) => {
  if (filter === 'any') return true;
  if (days === null) return false;
  switch (filter) {
    case 'today': return days === 0;
    case '7d': return days <= 7;
    case '30d': return days <= 30;
    case 'inactive30': return days > 30;
    case 'inactive60': return days > 60;
    case 'inactive90': return days > 90;
  }
};

const STAGE_CHIPS: { value: StageFilter; label: string; dot: string; hint: string }[] = [
  { value: 'open', label: 'Active', dot: 'bg-primary', hint: 'All cards not yet redeemed' },
  { value: 'ready', label: 'Ready to redeem', dot: 'bg-green-500', hint: 'All stamps collected' },
  { value: 'almost', label: 'Almost there', dot: 'bg-emerald-300', hint: '1–2 stamps from the reward' },
  { value: 'in_progress', label: 'In progress', dot: 'bg-sky-400', hint: 'Has visits, 3+ stamps to go' },
  { value: 'not_started', label: 'No visits yet', dot: 'bg-gray-300', hint: 'Issued but never stamped' },
  { value: 'at_risk', label: `Inactive ${AT_RISK_DAYS}+ days`, dot: 'bg-rose-500', hint: `Active cards with no activity in ${AT_RISK_DAYS}+ days` },
  { value: 'redeemed', label: 'Redeemed', dot: 'bg-gray-500', hint: 'Reward already claimed' },
  { value: 'all', label: 'All', dot: 'bg-foreground', hint: 'Every card' },
];

const RECENCY_OPTIONS: { value: RecencyFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'inactive30', label: 'Inactive 30+ days' },
  { value: 'inactive60', label: 'Inactive 60+ days' },
  { value: 'inactive90', label: 'Inactive 90+ days' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Most recent activity' },
  { value: 'oldest', label: 'Longest without activity' },
  { value: 'remaining', label: 'Closest to reward' },
  { value: 'progress_desc', label: 'Most progress' },
  { value: 'progress_asc', label: 'Least progress' },
  { value: 'issued_desc', label: 'Newest cards' },
  { value: 'name', label: 'Customer A–Z' },
];

// Nulls (no activity / unknown dates) always sink to the bottom.
const byTimestamp = (pick: (r: CardInsight) => number | null, dir: 1 | -1) =>
  (a: CardInsight, b: CardInsight) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * dir;
  };

const SORTERS: Record<SortKey, (a: CardInsight, b: CardInsight) => number> = {
  recent: byTimestamp((r) => r.lastActivityAt, -1),
  oldest: byTimestamp((r) => r.lastActivityAt, 1),
  progress_desc: (a, b) => b.progress - a.progress || a.remaining - b.remaining,
  progress_asc: (a, b) => a.progress - b.progress || b.remaining - a.remaining,
  remaining: (a, b) =>
    Number(a.stage === 'redeemed') - Number(b.stage === 'redeemed') || a.remaining - b.remaining,
  issued_desc: byTimestamp((r) => r.issuedAt, -1),
  name: (a, b) => a.customer.name.localeCompare(b.customer.name),
};

const STAGE_STYLES: Record<CardStage, string> = {
  ready: 'bg-green-100 text-green-800',
  almost: 'bg-emerald-50 text-emerald-700',
  in_progress: 'bg-sky-50 text-sky-700',
  not_started: 'bg-gray-100 text-gray-600',
  redeemed: 'bg-gray-200 text-gray-600',
};

const StageBadge: React.FC<{ stage: CardStage }> = ({ stage }) => (
  <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", STAGE_STYLES[stage])}>
    {STAGE_LABELS[stage]}
  </span>
);

/** One pip per stamp: gift (amber), earned (primary / green when ready), empty. */
const StampTrack: React.FC<{ row: CardInsight }> = ({ row }) => {
  const isReady = row.stage === 'ready';
  const isRedeemed = row.stage === 'redeemed';
  return (
    <div className="flex gap-0.5" aria-label={`${row.card.stamps} of ${row.totalStamps} stamps`}>
      {Array.from({ length: row.totalStamps }).map((_, index) => {
        const filled = index < row.card.stamps;
        // Signup gift fills the first slots; win-back gifts are the most recent.
        const gifted = filled && (index < row.bonusStamps || index >= row.card.stamps - row.winbackStamps);
        return (
          <span
            key={index}
            className={cn(
              "h-2 flex-1 rounded-full",
              !filled && "bg-gray-100",
              filled && isRedeemed && "bg-gray-300",
              filled && !isRedeemed && gifted && "bg-amber-400",
              filled && !isRedeemed && !gifted && (isReady ? "bg-green-500" : "bg-primary"),
            )}
          />
        );
      })}
    </div>
  );
};

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, value, onChange, options }) => (
  <label className="relative flex items-center">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full appearance-none rounded-lg border bg-white pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring lg:w-auto lg:max-w-[200px]",
        value !== options[0]?.value && "border-foreground/40 font-medium"
      )}
      title={label}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-muted-foreground" />
  </label>
);

interface IssuedCardsPageProps {
  customers: Customer[];
  campaigns: Template[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  refreshData?: () => Promise<void>;
  dataReady?: boolean;
}

export const IssuedCardsPage: React.FC<IssuedCardsPageProps> = ({ customers, campaigns, setCustomers, refreshData, dataReady = false }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const { currentOwner, isEmailVerified, isStaff, currentUser } = useAuth();
  const canIssue = isEmailVerified;
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");

  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [activeKioskData, setActiveKioskData] = useState<{ customer: Customer, card: IssuedCard, template: Template } | null>(null);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const isWinBackOpen = searchParams.get('winback') === '1' && !isStaff;
  const setWinBackOpen = (open: boolean) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (open) next.set('winback', '1');
      else next.delete('winback');
      return next;
    }, { replace: true });

  useEffect(() => {
    const handler = () => setIsScanOpen(true);
    window.addEventListener('open-qr-scan', handler);
    return () => window.removeEventListener('open-qr-scan', handler);
  }, []);

  const [preSelectedCampaign, setPreSelectedCampaign] = useState<Template | null>(null);
  const [preSelectedCustomer, setPreSelectedCustomer] = useState<Customer | null>(null);

  const findKioskMatch = useCallback((cardId: string) => {
    for (const customer of customers) {
      const found = customer.cards.find((card) => card.uniqueId === cardId);
      if (!found) continue;
      const template = resolveCardTemplate(found, campaigns);
      if (!template) return null;
      return { customer, card: found, template };
    }
    return null;
  }, [campaigns, customers]);

  const handleUpdateCard = async (customerId: string, cardId: string, updates: Partial<IssuedCard>) => {
    setMutationBusy(true);
    setMutationError("");
    const dbUpdates: Parameters<typeof updateIssuedCard>[1] = {};
    const knownStamps = customers.find(c => c.id === customerId)?.cards.find(c => c.id === cardId)?.stamps;
    // Send stamp changes as a delta: the client may have won a scratch-game
    // stamp since this screen loaded, and an absolute count would erase it.
    if (updates.stamps !== undefined && knownStamps !== undefined) dbUpdates.stampsDelta = updates.stamps - knownStamps;
    else if (updates.stamps !== undefined) dbUpdates.stamps = updates.stamps;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.completedDate !== undefined) dbUpdates.completedDate = updates.completedDate;
    if (updates.lastVisit !== undefined) dbUpdates.lastVisit = updates.lastVisit;

    let wroteData = false;
    try {
      if (Object.keys(dbUpdates).length > 0) {
        const updateResult = await updateIssuedCard(cardId, dbUpdates);
        if (!updateResult.ok) {
          throw new Error(updateResult.error ?? "Failed to update the card.");
        }
        // The server's count is authoritative (includes concurrent changes).
        if (updates.stamps !== undefined && updateResult.stamps !== undefined) {
          updates = { ...updates, stamps: updateResult.stamps };
        }
        wroteData = true;
      }

      if (updates.history) {
        const existingCard = customers
          .find(c => c.id === customerId)?.cards
          .find(c => c.id === cardId);
        const existingIds = new Set((existingCard?.history ?? []).map(t => t.id));
        const newTxs = updates.history.filter(t => !existingIds.has(t.id));
        for (const tx of newTxs) {
          const txResult = await insertTransaction(cardId, tx);
          if (!txResult.ok) {
            throw new Error(txResult.error ?? "Failed to record the card activity.");
          }
          wroteData = true;
        }
      }

      setCustomers(prev => prev.map(c => {
        if (c.id === customerId) {
          return {
            ...c,
            cards: c.cards.map(card => card.id === cardId ? { ...card, ...updates } : card)
          };
        }
        return c;
      }));

      if (activeKioskData && activeKioskData.customer.id === customerId) {
        setActiveKioskData(prev => {
          if (!prev) return null;
          return { ...prev, card: { ...prev.card, ...updates } };
        });
      }
    } catch (error) {
      if (wroteData) {
        await refreshData?.();
      }
      setMutationError("Unable to update this card right now. Please try again.");
      throw error;
    } finally {
      setMutationBusy(false);
    }
  };

  const handleRevokeCard = async (customerId: string, cardId: string) => {
    if (confirm("Are you sure you want to revoke this card? This cannot be undone.")) {
      setMutationBusy(true);
      setMutationError("");
      try {
        const result = await deleteIssuedCard(cardId);
        if (!result.ok) {
          throw new Error(result.error ?? "Failed to revoke the card.");
        }
        setCustomers(prev => prev.map(c => {
          if (c.id === customerId) {
            return { ...c, cards: c.cards.filter(card => card.id !== cardId) };
          }
          return c;
        }));
      } catch (error) {
        setMutationError("Unable to revoke this card right now. Please try again.");
      } finally {
        setMutationBusy(false);
      }
    }
  };

  const handleKioskIssueNew = (customer: Customer, template: Template) => {
    if (!canIssue) return;
    if (template.isEnabled === false) {
      setMutationError("This campaign is disabled and cannot issue new cards.");
      return;
    }
    setPreSelectedCampaign(template);
    setPreSelectedCustomer(customer);
    setIsIssueOpen(true);
  };

  const openIssueWizard = () => {
    if (!canIssue) return;
    setPreSelectedCampaign(null);
    setPreSelectedCustomer(null);
    setIsIssueOpen(true);
  };

  const handleIssueCard = async (campaign: Template, customer: Customer | null, newCustomerData: { name: string, email: string, mobile: string }): Promise<IssuedCard> => {
    if (!currentOwner) {
      throw new Error("You must be signed in as an owner or staff member to issue cards.");
    }
    if (campaign.isEnabled === false) {
      throw new Error("This campaign is disabled and cannot issue new cards.");
    }

    const actorName = currentUser?.businessName ?? "Owner";
    const actorRole = currentUser?.role ?? "owner";
    const actorId = currentUser?.id;

    let targetCustomer = customer;

    if (!targetCustomer) {
      const newId = `cust-${Date.now()}`;
      targetCustomer = {
        id: newId,
        name: newCustomerData.name,
        email: newCustomerData.email,
        mobile: newCustomerData.mobile,
        status: "Active",
        cards: []
      };
      const customerResult = await upsertCustomer(
        { id: newId, name: newCustomerData.name, email: newCustomerData.email, mobile: newCustomerData.mobile, status: 'Active' },
        currentOwner.id
      );
      if (!customerResult.ok) {
        throw new Error(customerResult.error ?? "Failed to create the customer record.");
      }
    }

    const bonusStamps = getBonusStamps(campaign);
    const now = new Date();
    const initialTransaction: Transaction = {
      id: `tx-init-${Date.now()}`,
      type: 'issued',
      // Gift stamps ride on the 'issued' row (not 'stamp_add') so visit
      // analytics only count real visits.
      amount: bonusStamps,
      remarks: bonusStamps > 0 ? formatGiftRemark(bonusStamps) : undefined,
      date: now.toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      }),
      timestamp: now.getTime(),
      title: "Card Issued",
      actorName,
      actorRole,
      actorId
    };

    const newCard: IssuedCard = {
      id: `card-${Date.now()}`,
      uniqueId: crypto.randomUUID(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      stamps: bonusStamps,
      lastVisit: new Date().toISOString().split('T')[0],
      status: 'Active',
      history: [initialTransaction],
      templateSnapshot: toStoredTemplate(campaign)
    };

    const cardResult = await insertIssuedCard({
      id: newCard.id,
      uniqueId: newCard.uniqueId,
      customerId: targetCustomer.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      templateSnapshot: toStoredTemplate(campaign),
    }, currentOwner.id);
    if (!cardResult.ok) {
      throw new Error(cardResult.error ?? "Failed to create the card.");
    }

    const txResult = await insertTransaction(newCard.id, initialTransaction);
    if (!txResult.ok) {
      throw new Error(txResult.error ?? "Failed to record the initial transaction.");
    }

    const targetId = targetCustomer.id;
    const customerToAdd = targetCustomer;

    setCustomers(prev => {
      const exists = prev.find(c => c.id === targetId);
      if (exists) {
        return prev.map(c => c.id === targetId
          ? { ...c, cards: [...c.cards, newCard] }
          : c
        );
      } else {
        return [...prev, { ...customerToAdd, cards: [newCard] }];
      }
    });

    return newCard;
  };

  const extractCardId = (value: string) => {
    let raw = value.trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      raw = parts[parts.length - 1] ?? raw;
    } catch {
      // not a URL
    }
    raw = raw.replace(/^#/, '');
    raw = raw.replace(/\/+$/, '');
    const segments = raw.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? raw;
  };

  const clearKioskQuery = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('kiosk');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const kioskId = searchParams.get('kiosk');
    if (!kioskId || !dataReady || activeKioskData) return;

    const match = findKioskMatch(kioskId);
    clearKioskQuery();

    if (!match) {
      setMutationError("Card not found. Try scanning again.");
      return;
    }

    setMutationError("");
    setActiveKioskData(match);
  }, [activeKioskData, clearKioskQuery, dataReady, findKioskMatch, searchParams]);

  const handleScanResult = useCallback(async (value: string): Promise<ScanDetectionResult> => {
    const cardId = extractCardId(value);
    if (!cardId) {
      return { ok: false, message: "QR code is invalid. Try scanning again." };
    }

    const match = findKioskMatch(cardId);
    if (match) {
      setMutationError("");
      setActiveKioskData(match);
      return { ok: true };
    }

    const inspection = await inspectScannedCard(cardId);
    if (inspection.status === 'foreign') {
      return { ok: false, message: "This card is not part of your business." };
    }

    if (inspection.status === 'owned') {
      if (refreshData) {
        await refreshData();
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('kiosk', cardId);
        return next;
      }, { replace: true });
      return { ok: true };
    }

    return { ok: false, message: "Card not found. Try scanning again." };
  }, [findKioskMatch, refreshData, setSearchParams]);

  const nowTs = Date.now();
  const insights = useMemo(
    () => buildCardInsights(customers, campaigns, nowTs),
    // nowTs intentionally excluded: recomputing every render would defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customers, campaigns],
  );

  const stageFilter = (searchParams.get('stage') ?? 'open') as StageFilter;
  const campaignFilter = searchParams.get('campaign') ?? 'all';
  const recencyFilter = (searchParams.get('recency') ?? 'any') as RecencyFilter;
  const sortKey = (searchParams.get('sort') ?? 'recent') as SortKey;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const setFilterParam = useCallback((key: string, value: string, fallback: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === fallback) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
    setVisibleCount(PAGE_SIZE);
  }, [setSearchParams]);

  const clearFilters = () => {
    setSearchQuery("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      ['stage', 'campaign', 'recency', 'sort'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
    setVisibleCount(PAGE_SIZE);
  };

  const campaignOptions = useMemo(() => {
    const options = new Map<string, string>();
    campaigns.forEach((c) => options.set(c.id, c.name));
    insights.forEach(({ card }) => {
      if (card.campaignId && !options.has(card.campaignId)) options.set(card.campaignId, card.campaignName);
      if (!card.campaignId) options.set(`archived:${card.campaignName}`, `${card.campaignName} (archived)`);
    });
    return Array.from(options, ([id, name]) => ({ id, name }));
  }, [campaigns, insights]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  // Everything except the stage filter, so the stage chips can show counts.
  const baseRows = useMemo(() => insights.filter(({ customer, card, daysSinceActivity }) => {
    if (campaignFilter !== 'all') {
      const key = card.campaignId ?? `archived:${card.campaignName}`;
      if (key !== campaignFilter) return false;
    }
    if (!matchesRecency(recencyFilter, daysSinceActivity)) return false;
    if (!normalizedQuery) return true;
    return [customer.name, customer.email, customer.mobile, card.campaignName, card.uniqueId, card.id]
      .some((value) => (value || "").toLowerCase().includes(normalizedQuery));
  }), [insights, campaignFilter, recencyFilter, normalizedQuery]);

  const stageCounts = useMemo(() => {
    const counts: Record<StageFilter, number> = {
      all: baseRows.length, open: 0, ready: 0, almost: 0, in_progress: 0, not_started: 0, at_risk: 0, redeemed: 0,
    };
    baseRows.forEach((row) => {
      counts[row.stage] += 1;
      if (row.stage !== 'redeemed') counts.open += 1;
      if (isAtRisk(row)) counts.at_risk += 1;
    });
    return counts;
  }, [baseRows]);

  const cardRows = useMemo(() => {
    const filtered = baseRows.filter((row) => {
      if (stageFilter === 'all') return true;
      if (stageFilter === 'open') return row.stage !== 'redeemed';
      if (stageFilter === 'at_risk') return isAtRisk(row);
      return row.stage === stageFilter;
    });
    return [...filtered].sort(SORTERS[sortKey] ?? SORTERS.recent);
  }, [baseRows, stageFilter, sortKey]);

  const hasActiveFilters = stageFilter !== 'open' || campaignFilter !== 'all' || recencyFilter !== 'any' || sortKey !== 'recent' || normalizedQuery !== '';
  const visibleRows = cardRows.slice(0, visibleCount);

  const exportCsv = () => {
    downloadCsv(`issued-cards-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Customer', 'Email', 'Mobile', 'Campaign', 'Stamps', 'Total stamps', 'Gift stamps', 'Stamps to go', 'Stage', 'Last visit', 'Last activity', 'Issued', 'Card ID'],
      ...cardRows.map((row) => [
        row.customer.name,
        row.customer.email,
        row.customer.mobile ?? '',
        row.card.campaignName,
        row.card.stamps,
        row.totalStamps,
        row.bonusStamps + row.winbackStamps,
        row.remaining,
        STAGE_LABELS[row.stage],
        formatShortDate(row.lastStampAt),
        formatShortDate(row.lastActivityAt),
        formatShortDate(row.issuedAt),
        row.card.uniqueId,
      ]),
    ]);
  };

  const openPublicLink = (uniqueId: string) => {
    const slug = currentOwner?.slug;
    if (!slug) return;
    window.open(buildPublicCardUrl(slug, uniqueId), '_blank');
  };

  const buildNudgeMessage = (row: CardInsight) => {
    const firstName = row.customer.name.split(' ')[0] ?? '';
    const link = currentOwner?.slug ? ` ${withCardSource(buildPublicCardUrl(currentOwner.slug, row.card.uniqueId), 'whatsapp')}` : '';
    if (row.stage === 'ready') {
      return `¡Hola ${firstName}! Ya completaste tu tarjeta ${row.card.campaignName}. Tu ${row.template.rewardName} te espera en Golden Beauty Studio.${link}`;
    }
    return `¡Hola ${firstName}! Te faltan solo ${row.remaining} ${row.remaining === 1 ? 'sello' : 'sellos'} para tu ${row.template.rewardName} en Golden Beauty Studio.${link}`;
  };

  // Render function (not a component) so the open menu survives re-renders.
  const renderActionsMenu = (row: CardInsight) => {
    const whatsAppUrl = row.stage !== 'redeemed' ? buildWhatsAppUrl(row.customer.mobile, buildNudgeMessage(row)) : null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 w-8 shrink-0 p-0" disabled={mutationBusy}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Manage Card</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => openPublicLink(row.card.uniqueId)}>
            <ExternalLink className="mr-2 h-4 w-4" /> Public Link
          </DropdownMenuItem>
          {whatsAppUrl && (
            <DropdownMenuItem onClick={() => window.open(whatsAppUrl, '_blank')}>
              <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp reminder
            </DropdownMenuItem>
          )}
          {!isStaff && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => handleRevokeCard(row.customer.id, row.card.id)}
              >
                <Trash className="mr-2 h-4 w-4" /> Revoke
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="min-h-full space-y-6 bg-gray-50/50 p-4 md:h-full md:overflow-y-auto md:p-8">

      {activeKioskData && (
        <KioskMode
          customer={activeKioskData.customer}
          card={activeKioskData.card}
          template={activeKioskData.template}
          onClose={() => setActiveKioskData(null)}
          onUpdateCard={handleUpdateCard}
          onIssueNew={handleKioskIssueNew}
          canIssue={canIssue}
          allowRedeem={true}
          actorName={currentUser?.businessName ?? "Owner"}
          actorRole={currentUser?.role ?? "owner"}
          actorId={currentUser?.id}
          onScanRequest={() => setIsScanOpen(true)}
          mutationBusy={mutationBusy}
        />
      )}

      <IssueCardDialog
        isOpen={isIssueOpen}
        onClose={() => setIsIssueOpen(false)}
        campaigns={campaigns}
        customers={customers}
        onIssue={handleIssueCard}
        preSelectedCampaign={preSelectedCampaign}
        preSelectedCustomer={preSelectedCustomer}
      />

      <WinBackDialog
        isOpen={isWinBackOpen}
        onClose={() => setWinBackOpen(false)}
        customers={customers}
        campaigns={campaigns}
        slug={currentOwner?.slug}
        onGifted={async () => { await refreshData?.(); }}
      />

      <ScanQrDialog
        isOpen={isScanOpen}
        onClose={() => setIsScanOpen(false)}
        onDetected={handleScanResult}
      />

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Issued Cards</h1>
          <p className="text-sm text-muted-foreground md:text-base">Monitor active cards and open Kiosk Mode for stamping.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <Button variant="outline" className="w-full gap-2 rounded-full sm:w-auto" onClick={() => setIsScanOpen(true)}>
            <QrCode size={16} /> Scan QR
          </Button>
          {!isStaff && (
            <Button
              variant="outline"
              className="w-full gap-2 rounded-full border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 sm:w-auto"
              onClick={() => setWinBackOpen(true)}
            >
              <Gift size={16} /> Win-back gift
            </Button>
          )}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <Button onClick={openIssueWizard} className="w-full gap-2 rounded-full px-6 shadow-sm sm:w-auto" disabled={!canIssue}>
              <Plus size={16} /> Issue New Card
            </Button>
            {!canIssue && (
              <div className="flex items-center gap-2 text-xs text-amber-600 sm:justify-end">
                <Lock size={12} /> Confirm your email to issue cards.
              </div>
            )}
          </div>
        </div>
      </div>

      {mutationError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mutationError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STAGE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setFilterParam('stage', chip.value, 'open')}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              stageFilter === chip.value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-white text-foreground hover:bg-muted/60"
            )}
            title={chip.hint}
          >
            <span className={cn("h-2 w-2 rounded-full", chip.dot)} />
            {chip.label}
            <span className={cn("tabular-nums", stageFilter === chip.value ? "text-background/70" : "text-muted-foreground")}>
              {stageCounts[chip.value]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-white p-3 shadow-sm lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center space-x-2 rounded-lg border bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <Search className="shrink-0 text-gray-400" size={18} />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search customer, phone, email, campaign or card ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
          <FilterSelect
            label="Campaign"
            value={campaignFilter}
            onChange={(v) => setFilterParam('campaign', v, 'all')}
            options={[{ value: 'all', label: 'All campaigns' }, ...campaignOptions.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <FilterSelect
            label="Last activity"
            value={recencyFilter}
            onChange={(v) => setFilterParam('recency', v, 'any')}
            options={RECENCY_OPTIONS}
          />
          <FilterSelect
            label="Sort by"
            value={sortKey}
            onChange={(v) => setFilterParam('sort', v, 'recent')}
            options={SORT_OPTIONS}
          />
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={clearFilters}>
              <X size={14} /> Clear
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv} disabled={cardRows.length === 0}>
            <Download size={14} /> CSV
          </Button>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Showing <span className="font-semibold text-foreground tabular-nums">{Math.min(visibleCount, cardRows.length)}</span> of{' '}
        <span className="font-semibold text-foreground tabular-nums">{cardRows.length}</span> cards
        {cardRows.length !== insights.length && <> (filtered from {insights.length})</>}
      </div>

      <div className="rounded-xl border bg-white shadow-sm">
        {cardRows.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            {insights.length === 0 ? "No cards yet. Issue one to get started." : "No cards match these filters."}
            {hasActiveFilters && insights.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {visibleRows.map((row) => (
                <div
                  key={row.card.id}
                  className={cn(
                    "rounded-2xl border p-4 shadow-sm",
                    row.stage === 'redeemed' ? "border-gray-200 bg-gray-50/70" : "border-border bg-white"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn("min-w-0", row.stage === 'redeemed' && "opacity-60")}>
                      <p className="truncate text-sm font-semibold text-foreground">{row.customer.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.customer.mobile || row.customer.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground/80">{row.card.campaignName}</span>
                        {row.isArchivedCampaign && <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">Archived</Badge>}
                        <StageBadge stage={row.stage} />
                      </div>
                    </div>
                    {renderActionsMenu(row)}
                  </div>

                  <div className="mt-4 space-y-2">
                    <StampTrack row={row} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        <span className="font-semibold text-foreground tabular-nums">{row.card.stamps}</span>/{row.totalStamps}
                        {row.stage !== 'redeemed' && row.remaining > 0 && <> · {row.remaining} to go</>}
                      </span>
                      <span title={formatShortDate(row.lastStampAt)}>Last visit {formatRelativeDays(row.lastStampAt, nowTs).toLowerCase()}</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={row.stage === 'redeemed' ? "outline" : "default"}
                    className={cn("mt-4 w-full gap-2 rounded-full", row.stage === 'ready' && "bg-green-600 hover:bg-green-700")}
                    onClick={() => setActiveKioskData({ customer: row.customer, card: row.card, template: row.template })}
                  >
                    {row.stage === 'redeemed' ? <Lock size={14} /> : <MonitorPlay size={14} />}
                    {row.stage === 'redeemed' ? "View Card" : (row.stage === 'ready' ? "Redeem Reward" : "Open Kiosk")}
                  </Button>
                </div>
              ))}
            </div>

            <div className="hidden overflow-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead>Customer</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="w-[220px]">Progress</TableHead>
                    <TableHead>Last visit</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const isRedeemed = row.stage === 'redeemed';
                    return (
                      <TableRow key={row.card.id} className={cn("transition-colors", isRedeemed ? "bg-gray-50/50 hover:bg-gray-50" : "hover:bg-muted/30")}>
                        <TableCell>
                          <div className={cn("flex items-center gap-3", isRedeemed && "opacity-60")}>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                              {row.customer.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{row.customer.name}</div>
                              <div className="truncate text-xs text-muted-foreground">{row.customer.mobile || row.customer.email || '—'}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={cn("space-y-1", isRedeemed && "opacity-60")}>
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {row.card.campaignName}
                              {row.isArchivedCampaign && <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">Archived</Badge>}
                            </div>
                            <div className="flex items-center gap-2">
                              <StageBadge stage={row.stage} />
                              <span className="font-mono text-[11px] text-muted-foreground">{row.card.uniqueId.slice(0, 8)}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1.5">
                            <StampTrack row={row} />
                            <div className="text-xs text-muted-foreground">
                              <span className="font-semibold text-foreground tabular-nums">{row.card.stamps}</span>/{row.totalStamps}
                              {!isRedeemed && row.remaining > 0 && <> · <span className="tabular-nums">{row.remaining}</span> to go</>}
                              {row.bonusStamps + row.winbackStamps > 0 && <> · <span className="text-amber-700">{row.bonusStamps + row.winbackStamps} gifted</span></>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{formatRelativeDays(row.lastStampAt, nowTs)}</div>
                          <div className={cn(
                            "text-xs",
                            isAtRisk(row) ? "font-medium text-rose-600" : "text-muted-foreground"
                          )}>
                            {row.lastStampAt === null
                              ? 'No visits yet'
                              : formatShortDate(row.lastStampAt)}
                            {isAtRisk(row) && ' · inactive'}
                          </div>
                          {row.lastGiftAt !== null && (
                            <div className={cn("mt-0.5 flex items-center gap-1 text-[11px]", row.cameBackAfterGift ? "text-emerald-700" : "text-amber-700")}>
                              <Gift size={11} />
                              {row.cameBackAfterGift ? 'Came back after gift' : `Gift sent ${formatRelativeDays(row.lastGiftAt, nowTs).toLowerCase()}`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatShortDate(row.issuedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-9 w-9 rounded-full"
                              onClick={() => openPublicLink(row.card.uniqueId)}
                              aria-label="Open public link"
                              title="Open public link"
                            >
                              <ExternalLink size={14} />
                            </Button>
                            <Button
                              size="sm"
                              variant={isRedeemed ? "outline" : "default"}
                              className={cn("gap-2 rounded-full", row.stage === 'ready' && "bg-green-600 hover:bg-green-700")}
                              onClick={() => setActiveKioskData({ customer: row.customer, card: row.card, template: row.template })}
                            >
                              {isRedeemed ? <Lock size={14} /> : <MonitorPlay size={14} />}
                              {isRedeemed ? "View" : (row.stage === 'ready' ? "Redeem" : "Kiosk")}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          {renderActionsMenu(row)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {visibleCount < cardRows.length && (
              <div className="flex justify-center border-t p-3">
                <Button variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, cardRows.length - visibleCount)} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
