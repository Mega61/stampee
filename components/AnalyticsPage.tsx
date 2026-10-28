import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { EngagementSection } from "./analytics/EngagementSection";
import { Customer, Template } from "../types";
import { cn } from "../lib/utils";
import {
  buildCardInsights,
  buildWhatsAppUrl,
  DAY_MS,
  formatRelativeDays,
  type CardInsight,
} from "../lib/cardInsights";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Clock,
  Gift,
  MessageCircle,
  Minus,
  Repeat,
  Stamp,
  UserPlus,
  Users,
} from "lucide-react";

interface AnalyticsPageProps {
  customers: Customer[];
  campaigns: Template[];
}

type Visit = {
  customerId: string;
  cardId: string;
  campaignKey: string;
  timestamp: number;
  amount: number;
  actorName: string;
};

type RangeStats = {
  visits: number;
  stamps: number;
  visitingClients: number;
  returningClients: number;
  newCards: number;
  redemptions: number;
  medianDaysBetweenVisits: number | null;
};

const DEFAULT_DAY_COUNT = 30;
const AT_RISK_DAYS = 30;
const LIST_LIMIT = 8;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const formatDecimal = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const formatPercent = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateInputToTimestamp = (value: string, endOfDay = false) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    : new Date(year, month - 1, day).getTime();
};

const getDateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const inRange = (ts: number, start: number, end: number) => ts >= start && ts <= end;
const campaignKeyOf = (card: { campaignId: string | null; campaignName: string }) =>
  card.campaignId ?? `archived:${card.campaignName}`;

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const formatDateRangeLabel = (startDate: string, endDate: string) => {
  const start = parseDateInputToTimestamp(startDate);
  const end = parseDateInputToTimestamp(endDate);
  if (start === null || end === null) return "Custom range";
  const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
};

// Resolve live theme tokens so charts track the design system.
const useChartColors = () =>
  useMemo(() => {
    const fallback = {
      foreground: "hsl(220 18% 12%)",
      muted: "hsl(220 10% 42%)",
      border: "hsl(220 14% 88%)",
    };
    if (typeof window === "undefined") return fallback;
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fb: string) => {
      const raw = styles.getPropertyValue(name).trim();
      return raw ? `hsl(${raw})` : fb;
    };
    return {
      foreground: read("--foreground", fallback.foreground),
      muted: read("--muted-foreground", fallback.muted),
      border: read("--border", fallback.border),
    };
  }, []);

const describeDelta = (current: number, previous: number, lowerIsBetter = false) => {
  if (previous === 0) {
    if (current === 0) return { dir: "flat" as const, text: "No change", good: true };
    return { dir: "up" as const, text: "New", good: !lowerIsBetter };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { dir: "flat" as const, text: "No change", good: true };
  const dir = change > 0 ? ("up" as const) : ("down" as const);
  return {
    dir,
    text: `${change > 0 ? "+" : ""}${formatPercent(change)}% vs prev`,
    good: lowerIsBetter ? dir === "down" : dir === "up",
  };
};

const KpiCard: React.FC<{
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  delta?: ReturnType<typeof describeDelta>;
}> = ({ label, value, sub, icon: Icon, delta }) => {
  const DeltaIcon = delta?.dir === "up" ? ArrowUpRight : delta?.dir === "down" ? ArrowDownRight : Minus;
  return (
    <Card className="border-border/80 bg-card shadow-subtle">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/70">
          <Icon className="h-4 w-4 text-foreground/70" />
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                delta.dir === "flat"
                  ? "bg-muted text-muted-foreground"
                  : delta.good
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
              )}
            >
              <DeltaIcon className="h-3 w-3" />
              {delta.text}
            </span>
          )}
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
};

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/80 bg-card px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1.5 font-medium text-foreground">{label}</div>}
      <div className="space-y-1">
        {payload.map((entry: any) => (
          <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color || entry.payload?.fill }} />
              {entry.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatNumber(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SectionTitle: React.FC<{ title: string; sub: string; action?: React.ReactNode }> = ({ title, sub, action }) => (
  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
    <div className="space-y-1">
      <CardTitle className="text-lg">{title}</CardTitle>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
    {action}
  </CardHeader>
);

const nudgeText = (row: CardInsight) => {
  const firstName = row.customer.name.split(" ")[0] ?? "";
  if (row.stage === "ready") {
    return `¡Hola ${firstName}! Ya completaste tu tarjeta ${row.card.campaignName}. Tu ${row.template.rewardName} te espera en Golden Beauty Studio.`;
  }
  if (row.remaining <= 2) {
    return `¡Hola ${firstName}! Te faltan solo ${row.remaining} ${row.remaining === 1 ? "sello" : "sellos"} para tu ${row.template.rewardName} en Golden Beauty Studio.`;
  }
  return `¡Hola ${firstName}! Te extrañamos en Golden Beauty Studio. Ya llevas ${row.card.stamps} de ${row.totalStamps} sellos para tu ${row.template.rewardName}.`;
};

const ActionList: React.FC<{
  rows: CardInsight[];
  empty: string;
  detail: (row: CardInsight) => React.ReactNode;
}> = ({ rows, empty, detail }) => {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-border/70">
      {rows.map((row) => {
        const whatsApp = buildWhatsAppUrl(row.customer.mobile, nudgeText(row));
        return (
          <li key={row.card.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{row.customer.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.card.campaignName} · {detail(row)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex w-20 gap-0.5" aria-hidden>
                {Array.from({ length: row.totalStamps }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 flex-1 rounded-full",
                      i >= row.card.stamps
                        ? "bg-muted"
                        : i < row.bonusStamps || i >= row.card.stamps - row.winbackStamps
                          ? "bg-amber-400"
                          : "bg-foreground/80"
                    )}
                  />
                ))}
              </div>
              {whatsApp ? (
                <a
                  href={whatsApp}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Send WhatsApp reminder"
                  aria-label={`Send WhatsApp reminder to ${row.customer.name}`}
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              ) : (
                <span className="h-8 w-8" />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ customers, campaigns }) => {
  const colors = useChartColors();
  const now = useMemo(() => Date.now(), []);

  const [startDate, setStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - (DEFAULT_DAY_COUNT - 1));
    return toDateInputValue(start);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));
  const [campaignFilter, setCampaignFilter] = useState("all");

  const { rangeStart, rangeEnd } = useMemo(() => {
    const fallbackEnd = new Date();
    fallbackEnd.setHours(23, 59, 59, 999);
    const fallbackStart = new Date();
    fallbackStart.setDate(fallbackStart.getDate() - (DEFAULT_DAY_COUNT - 1));
    fallbackStart.setHours(0, 0, 0, 0);
    let nextStart = parseDateInputToTimestamp(startDate) ?? fallbackStart.getTime();
    let nextEnd = parseDateInputToTimestamp(endDate, true) ?? fallbackEnd.getTime();
    if (nextStart > nextEnd) [nextStart, nextEnd] = [nextEnd, nextStart];
    return { rangeStart: nextStart, rangeEnd: nextEnd };
  }, [startDate, endDate]);

  const applyPresetRange = (dayCount: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (dayCount - 1));
    setStartDate(toDateInputValue(start));
    setEndDate(toDateInputValue(end));
  };

  const selectedDayCount = Math.floor(
    (new Date(rangeEnd).setHours(0, 0, 0, 0) - new Date(rangeStart).setHours(0, 0, 0, 0)) / DAY_MS
  ) + 1;
  const activePreset =
    endDate === toDateInputValue(new Date()) && [7, 30, 90, 365].includes(selectedDayCount) ? selectedDayCount : null;
  const rangeLabel = formatDateRangeLabel(startDate, endDate);

  // ---------- base data (campaign-filtered) ----------
  const allInsights = useMemo(() => buildCardInsights(customers, campaigns, now), [customers, campaigns, now]);
  const insights = useMemo(
    () => (campaignFilter === "all" ? allInsights : allInsights.filter((r) => campaignKeyOf(r.card) === campaignFilter)),
    [allInsights, campaignFilter]
  );

  const campaignOptions = useMemo(() => {
    const options = new Map<string, string>();
    campaigns.forEach((c) => options.set(c.id, c.name));
    allInsights.forEach(({ card }) => {
      const key = campaignKeyOf(card);
      if (!options.has(key)) options.set(key, `${card.campaignName} (archived)`);
    });
    return Array.from(options, ([id, name]) => ({ id, name }));
  }, [campaigns, allInsights]);

  const visits = useMemo<Visit[]>(
    () =>
      insights.flatMap(({ customer, card }) =>
        (card.history ?? [])
          .filter((tx) => tx.type === "stamp_add" && typeof tx.timestamp === "number")
          .map((tx) => ({
            customerId: customer.id,
            cardId: card.id,
            campaignKey: campaignKeyOf(card),
            timestamp: tx.timestamp,
            amount: tx.amount || 1,
            actorName: tx.actorName || "Unknown",
          }))
      ),
    [insights]
  );

  // Per customer: sorted distinct visit days, for cadence + returning metrics.
  const visitDaysByCustomer = useMemo(() => {
    const map = new Map<string, number[]>();
    visits.forEach((v) => {
      const day = new Date(v.timestamp).setHours(0, 0, 0, 0);
      const list = map.get(v.customerId) ?? [];
      list.push(day);
      map.set(v.customerId, list);
    });
    map.forEach((list, key) => map.set(key, Array.from(new Set(list)).sort((a, b) => a - b)));
    return map;
  }, [visits]);

  const computeRangeStats = (start: number, end: number): RangeStats => {
    let visitCount = 0;
    let stamps = 0;
    const clients = new Set<string>();
    visits.forEach((v) => {
      if (!inRange(v.timestamp, start, end)) return;
      visitCount += 1;
      stamps += v.amount;
      clients.add(v.customerId);
    });

    let returningClients = 0;
    const gaps: number[] = [];
    visitDaysByCustomer.forEach((days, customerId) => {
      if (clients.has(customerId) && days[0]! < start) returningClients += 1;
      for (let i = 1; i < days.length; i += 1) {
        if (inRange(days[i]!, start, end)) gaps.push((days[i]! - days[i - 1]!) / DAY_MS);
      }
    });

    let newCards = 0;
    let redemptions = 0;
    insights.forEach(({ card, issuedAt }) => {
      if (issuedAt !== null && inRange(issuedAt, start, end)) newCards += 1;
      (card.history ?? []).forEach((tx) => {
        if (tx.type === "redeem" && inRange(tx.timestamp, start, end)) redemptions += 1;
      });
    });

    return {
      visits: visitCount,
      stamps,
      visitingClients: clients.size,
      returningClients,
      newCards,
      redemptions,
      medianDaysBetweenVisits: median(gaps),
    };
  };

  const stats = useMemo(() => computeRangeStats(rangeStart, rangeEnd), [visits, visitDaysByCustomer, insights, rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevStats = useMemo(() => {
    const span = rangeEnd - rangeStart;
    return computeRangeStats(rangeStart - 1 - span, rangeStart - 1);
  }, [visits, visitDaysByCustomer, insights, rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const returningShare = stats.visitingClients > 0 ? (stats.returningClients / stats.visitingClients) * 100 : 0;
  const prevReturningShare =
    prevStats.visitingClients > 0 ? (prevStats.returningClients / prevStats.visitingClients) * 100 : 0;

  // ---------- activity over time (weekly buckets for long ranges) ----------
  const activitySeries = useMemo(() => {
    const weekly = selectedDayCount > 45;
    const buckets: { label: string; visits: number; redemptions: number; newCards: number }[] = [];
    const index = new Map<string, (typeof buckets)[number]>();
    const keyFor = (ts: number) => {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      if (weekly) d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      return getDateKey(d);
    };
    const cursor = new Date(rangeStart);
    cursor.setHours(0, 0, 0, 0);
    if (weekly) cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    while (cursor.getTime() <= rangeEnd) {
      const bucket = {
        label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        visits: 0,
        redemptions: 0,
        newCards: 0,
      };
      buckets.push(bucket);
      index.set(getDateKey(cursor), bucket);
      cursor.setDate(cursor.getDate() + (weekly ? 7 : 1));
    }
    visits.forEach((v) => {
      if (inRange(v.timestamp, rangeStart, rangeEnd)) {
        const b = index.get(keyFor(v.timestamp));
        if (b) b.visits += 1;
      }
    });
    insights.forEach(({ card, issuedAt }) => {
      if (issuedAt !== null && inRange(issuedAt, rangeStart, rangeEnd)) {
        const b = index.get(keyFor(issuedAt));
        if (b) b.newCards += 1;
      }
      (card.history ?? []).forEach((tx) => {
        if (tx.type === "redeem" && inRange(tx.timestamp, rangeStart, rangeEnd)) {
          const b = index.get(keyFor(tx.timestamp));
          if (b) b.redemptions += 1;
        }
      });
    });
    return { buckets, weekly };
  }, [visits, insights, rangeStart, rangeEnd, selectedDayCount]);

  // ---------- busiest days / hours ----------
  const { byWeekday, byHour } = useMemo(() => {
    const weekday = WEEKDAYS.map((label) => ({ label, visits: 0 }));
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h % 12 || 12}${h < 12 ? "a" : "p"}`, visits: 0 }));
    visits.forEach((v) => {
      if (!inRange(v.timestamp, rangeStart, rangeEnd)) return;
      const d = new Date(v.timestamp);
      weekday[(d.getDay() + 6) % 7]!.visits += 1;
      hours[d.getHours()]!.visits += 1;
    });
    // Trim the hour axis to the span that actually has visits (opening hours).
    const active = hours.filter((h) => h.visits > 0);
    const first = active[0]?.hour ?? 8;
    const last = active[active.length - 1]?.hour ?? 19;
    return { byWeekday: weekday, byHour: hours.slice(Math.min(first, 8), Math.max(last, 19) + 1) };
  }, [visits, rangeStart, rangeEnd]);

  // ---------- drop-off funnel (all-time, by visits required) ----------
  const funnel = useMemo(() => {
    const cards = insights;
    const total = cards.length;
    const reached = (pred: (r: CardInsight) => boolean) => cards.filter(pred).length;
    const visitShare = (r: CardInsight) => {
      if (r.stage === "redeemed") return 1;
      const required = Math.max(r.totalStamps - r.bonusStamps, 1);
      return r.earnedStamps / required;
    };
    const steps = [
      { label: "Card issued", value: total },
      { label: "1st visit", value: reached((r) => r.stage === "redeemed" || r.earnedStamps > 0) },
      { label: "Halfway", value: reached((r) => visitShare(r) >= 0.5) },
      { label: "Card full", value: reached((r) => r.stage === "redeemed" || r.stage === "ready") },
      { label: "Redeemed", value: reached((r) => r.stage === "redeemed") },
    ];
    return steps.map((s) => ({ ...s, pct: total > 0 ? (s.value / total) * 100 : 0 }));
  }, [insights]);

  // ---------- action lists ----------
  const closeToReward = useMemo(
    () =>
      insights
        .filter((r) => r.stage === "ready" || r.stage === "almost")
        .sort((a, b) => a.remaining - b.remaining || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
        .slice(0, LIST_LIMIT),
    [insights]
  );
  const atRisk = useMemo(() => {
    const rows = insights.filter(
      (r) => r.stage !== "redeemed" && r.daysSinceActivity !== null && r.daysSinceActivity >= AT_RISK_DAYS
    );
    // Most invested first: they have the most to lose and are easiest to win back.
    return { total: rows.length, rows: rows.sort((a, b) => b.progress - a.progress).slice(0, LIST_LIMIT) };
  }, [insights]);
  const readyCount = insights.filter((r) => r.stage === "ready").length;

  // Win-back gifts sent in range, and whether those clients came back after.
  const winBack = useMemo(() => {
    let sent = 0;
    let cameBack = 0;
    let redeemed = 0;
    let stampsGifted = 0;
    insights.forEach(({ card }) => {
      const gifts = (card.history ?? []).filter((tx) => tx.type === "gift" && inRange(tx.timestamp, rangeStart, rangeEnd));
      if (gifts.length === 0) return;
      const firstGift = Math.min(...gifts.map((g) => g.timestamp));
      sent += 1;
      stampsGifted += gifts.reduce((sum, g) => sum + g.amount, 0);
      const history = card.history ?? [];
      if (history.some((tx) => tx.type === "stamp_add" && tx.timestamp > firstGift)) cameBack += 1;
      if (history.some((tx) => tx.type === "redeem" && tx.timestamp > firstGift)) redeemed += 1;
    });
    return { sent, cameBack, redeemed, stampsGifted, rate: sent > 0 ? (cameBack / sent) * 100 : 0 };
  }, [insights, rangeStart, rangeEnd]);
  const almostCount = insights.filter((r) => r.stage === "almost").length;

  // ---------- campaign comparison (all-time) ----------
  const campaignRows = useMemo(() => {
    const groups = new Map<string, CardInsight[]>();
    allInsights.forEach((r) => {
      const key = campaignKeyOf(r.card);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    });
    return Array.from(groups, ([key, rows]) => {
      const live = campaigns.find((c) => c.id === key);
      const redeemed = rows.filter((r) => r.stage === "redeemed");
      const withVisit = rows.filter((r) => r.stage === "redeemed" || r.earnedStamps > 0);
      const daysToComplete = median(
        redeemed
          .filter((r) => r.issuedAt !== null && r.redeemedAt !== null)
          .map((r) => (r.redeemedAt! - r.issuedAt!) / DAY_MS)
      );
      return {
        key,
        name: live?.name ?? rows[0]!.card.campaignName,
        archived: !live,
        enabled: live?.isEnabled !== false,
        totalStamps: live?.totalStamps ?? rows[0]!.totalStamps,
        bonusStamps: live ? live.bonusStamps ?? 0 : rows[0]!.bonusStamps,
        issued: rows.length,
        active: rows.length - redeemed.length,
        redeemed: redeemed.length,
        startRate: rows.length ? (withVisit.length / rows.length) * 100 : 0,
        completionRate: rows.length ? (redeemed.length / rows.length) * 100 : 0,
        daysToComplete,
      };
    }).sort((a, b) => b.issued - a.issued);
  }, [allInsights, campaigns]);

  // ---------- staff ----------
  const staffRows = useMemo(() => {
    const map = new Map<string, number>();
    visits.forEach((v) => {
      if (inRange(v.timestamp, rangeStart, rangeEnd)) map.set(v.actorName, (map.get(v.actorName) ?? 0) + v.amount);
    });
    const rows = Array.from(map, ([name, stamps]) => ({ name, stamps })).sort((a, b) => b.stamps - a.stamps);
    const max = rows[0]?.stamps ?? 0;
    return rows.map((r) => ({ ...r, share: max ? (r.stamps / max) * 100 : 0 }));
  }, [visits, rangeStart, rangeEnd]);

  const tickInterval = activitySeries.buckets.length > 16 ? Math.ceil(activitySeries.buckets.length / 10) : 0;
  const hasRangeActivity = stats.visits > 0 || stats.redemptions > 0 || stats.newCards > 0;
  const axisTick = { fontSize: 11, fill: colors.muted };

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8 animate-fade-in">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        {/* Header + filters */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-4xl">Analytics</h1>
            <p className="text-sm text-muted-foreground md:text-base">
              Who's coming back, who's slipping away, and which campaigns actually get finished.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-subtle">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Campaign</label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
              >
                <option value="all">All campaigns</option>
                {campaignOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">From</label>
              <Input
                type="date"
                className="h-10 w-[150px]"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">To</label>
              <Input
                type="date"
                className="h-10 w-[150px]"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  if (e.target.value < startDate) setStartDate(e.target.value);
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {[7, 30, 90, 365].map((days) => (
                <Button
                  key={days}
                  type="button"
                  variant={activePreset === days ? "default" : "outline"}
                  size="sm"
                  onClick={() => applyPresetRange(days)}
                >
                  {days === 365 ? "1Y" : `${days}D`}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-muted-foreground">
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
            {rangeLabel}
          </Badge>
          <Badge variant="outline" className="border-border/80 text-muted-foreground">
            {selectedDayCount} days · compared with the previous {selectedDayCount}
          </Badge>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label="Visits"
            value={formatNumber(stats.visits)}
            sub={`${formatNumber(stats.stamps)} stamps given`}
            icon={Stamp}
            delta={describeDelta(stats.visits, prevStats.visits)}
          />
          <KpiCard
            label="Clients who visited"
            value={formatNumber(stats.visitingClients)}
            sub="Unique clients stamped in range"
            icon={Users}
            delta={describeDelta(stats.visitingClients, prevStats.visitingClients)}
          />
          <KpiCard
            label="Returning clients"
            value={`${formatPercent(returningShare)}%`}
            sub={`${formatNumber(stats.returningClients)} had visited before`}
            icon={Repeat}
            delta={describeDelta(returningShare, prevReturningShare)}
          />
          <KpiCard
            label="New cards"
            value={formatNumber(stats.newCards)}
            sub="Issued in range"
            icon={UserPlus}
            delta={describeDelta(stats.newCards, prevStats.newCards)}
          />
          <KpiCard
            label="Rewards redeemed"
            value={formatNumber(stats.redemptions)}
            sub={`${formatNumber(readyCount)} more ready to claim now`}
            icon={BadgeCheck}
            delta={describeDelta(stats.redemptions, prevStats.redemptions)}
          />
          <KpiCard
            label="Days between visits"
            value={stats.medianDaysBetweenVisits === null ? "—" : formatDecimal(stats.medianDaysBetweenVisits)}
            sub="Median gap between a client's visits"
            icon={Clock}
            delta={
              stats.medianDaysBetweenVisits !== null && prevStats.medianDaysBetweenVisits !== null
                ? describeDelta(stats.medianDaysBetweenVisits, prevStats.medianDaysBetweenVisits, true)
                : undefined
            }
          />
        </div>

        {/* Action lists */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-border/80 bg-card shadow-subtle">
            <SectionTitle
              title="Close to the reward"
              sub={`${readyCount} ready to redeem · ${almostCount} within 2 stamps. A nudge here converts best.`}
              action={
                <Link to="/issued-cards?stage=almost&sort=remaining" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground hover:underline">
                  All <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardContent className="pt-2">
              <ActionList
                rows={closeToReward}
                empty="Nobody is close to a reward right now."
                detail={(r) => (r.stage === "ready" ? "ready to redeem" : `${r.remaining} to go`) + ` · ${formatRelativeDays(r.lastActivityAt, now).toLowerCase()}`}
              />
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card shadow-subtle">
            <SectionTitle
              title="Slipping away"
              sub={`${atRisk.total} active ${atRisk.total === 1 ? "card has" : "cards have"} had no activity for ${AT_RISK_DAYS}+ days. Most progress first.`}
              action={
                <Link to="/issued-cards?stage=at_risk&sort=progress_desc" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground hover:underline">
                  All <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardContent className="pt-2">
              <ActionList
                rows={atRisk.rows}
                empty={`No active cards inactive for ${AT_RISK_DAYS}+ days.`}
                detail={(r) => `${r.card.stamps}/${r.totalStamps} · last seen ${r.daysSinceActivity} days ago`}
              />
            </CardContent>
          </Card>
        </div>

        {/* Win-back results */}
        <Card className="border-amber-200/80 bg-amber-50/40 shadow-subtle">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <Gift className="h-5 w-5 text-amber-700" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-foreground">Win-back gifts</h3>
                <p className="text-sm text-muted-foreground">
                  {winBack.sent === 0
                    ? "No gifts sent in this range. Gift stamps to inactive clients to bring them back."
                    : `Clients gifted in range and whether they returned afterwards.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              {winBack.sent > 0 && (
                <>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{formatNumber(winBack.sent)}</div>
                    <div className="text-xs text-muted-foreground">clients gifted ({formatNumber(winBack.stampsGifted)} stamps)</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">
                      {formatNumber(winBack.cameBack)} <span className="text-base font-medium text-muted-foreground">({formatPercent(winBack.rate)}%)</span>
                    </div>
                    <div className="text-xs text-muted-foreground">came back for a visit</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{formatNumber(winBack.redeemed)}</div>
                    <div className="text-xs text-muted-foreground">went on to redeem</div>
                  </div>
                </>
              )}
              <Link
                to="/issued-cards?winback=1"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-700"
              >
                <Gift className="h-4 w-4" /> Send a win-back gift
              </Link>
            </div>
          </CardContent>
        </Card>

        {!hasRangeActivity ? (
          <Card className="border-dashed border-border bg-card/60 shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Activity className="h-6 w-6 text-muted-foreground" />
              </span>
              <h3 className="text-base font-semibold text-foreground">No activity in this range</h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Nothing was stamped, issued or redeemed between {rangeLabel}. Try a wider window.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Activity over time */}
            <Card className="border-border/80 bg-card shadow-subtle">
              <SectionTitle
                title="Visits over time"
                sub={`Stamped visits per ${activitySeries.weekly ? "week" : "day"}.`}
              />
              <CardContent className="pt-4">
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activitySeries.buckets} margin={{ top: 8, right: 18, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fillVisits" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={colors.foreground} stopOpacity={0.22} />
                          <stop offset="100%" stopColor={colors.foreground} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke={colors.border} strokeOpacity={0.6} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} interval={tickInterval} tick={axisTick} tickMargin={10} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={axisTick} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.border }} />
                      <Area type="monotone" name="Visits" dataKey="visits" stroke={colors.foreground} strokeWidth={2} fill="url(#fillVisits)" activeDot={{ r: 4 }} />
                      <Area type="monotone" name="New cards" dataKey="newCards" stroke={colors.muted} strokeWidth={2} strokeDasharray="4 3" fill="none" activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: colors.foreground }} /> Visits
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: colors.muted }} /> New cards
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Busiest days / hours */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-border/80 bg-card shadow-subtle">
                <SectionTitle title="Busiest days" sub="Visits by day of the week, in range." />
                <CardContent className="pt-4">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byWeekday} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={axisTick} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.border, opacity: 0.3 }} />
                        <Bar dataKey="visits" name="Visits" fill={colors.foreground} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border/80 bg-card shadow-subtle">
                <SectionTitle title="Busiest hours" sub="Visits by time of day, in range." />
                <CardContent className="pt-4">
                  <div className="h-[220px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={byHour} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval={0} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={axisTick} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.border, opacity: 0.3 }} />
                        <Bar dataKey="visits" name="Visits" fill={colors.foreground} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* Funnel + staff */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="border-border/80 bg-card shadow-subtle xl:col-span-2">
            <SectionTitle
              title="Where clients drop off"
              sub="All cards ever issued (for the selected campaign): how far they got. Gift stamps don't count as visits."
            />
            <CardContent className="pt-4">
              {funnel[0]!.value === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No cards issued yet.</p>
              ) : (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={10}>
                      <XAxis type="number" hide domain={[0, funnel[0]!.value]} />
                      <YAxis type="category" dataKey="label" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: colors.foreground }} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.border, opacity: 0.3 }} />
                      <Bar dataKey="value" name="Cards" fill={colors.foreground} radius={[0, 4, 4, 0]}>
                        <LabelList
                          dataKey="pct"
                          position="right"
                          formatter={(v: number) => `${formatPercent(v)}%`}
                          style={{ fontSize: 12, fill: colors.muted }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card shadow-subtle">
            <SectionTitle title="Stamps by team member" sub="Who gave stamps in range." />
            <CardContent className="pt-4">
              {staffRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No stamps in this range.</p>
              ) : (
                <ul className="space-y-3">
                  {staffRows.map((row) => (
                    <li key={row.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate text-foreground">{row.name}</span>
                        <span className="font-medium tabular-nums">{formatNumber(row.stamps)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground/80" style={{ width: `${row.share}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Campaign comparison */}
        <Card className="border-border/80 bg-card shadow-subtle">
          <SectionTitle
            title="Campaign comparison"
            sub="All-time. Compare gifted vs. non-gifted campaigns: does a head start get more cards finished?"
          />
          <CardContent className="overflow-x-auto pt-4">
            {campaignRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No cards issued yet.</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Campaign</th>
                    <th className="py-2 pr-4 font-medium">Stamps</th>
                    <th className="py-2 pr-4 text-right font-medium">Issued</th>
                    <th className="py-2 pr-4 text-right font-medium">Active</th>
                    <th className="py-2 pr-4 text-right font-medium" title="Cards with at least one real visit">Came back</th>
                    <th className="py-2 pr-4 text-right font-medium">Redeemed</th>
                    <th className="py-2 text-right font-medium" title="Median days from issue to redeem">Days to finish</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((row) => (
                    <tr key={row.key} className="border-b border-border/60 last:border-0">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          {row.name}
                          {row.archived && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Archived</Badge>}
                          {!row.archived && !row.enabled && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Disabled</Badge>}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        <span className="tabular-nums">{row.totalStamps}</span>
                        {row.bonusStamps > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                            <Gift className="h-3 w-3" /> {row.bonusStamps} gifted
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.issued)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(row.active)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatPercent(row.startRate)}%</td>
                      <td className="py-3 pr-4 text-right">
                        <span className="font-semibold tabular-nums">{formatPercent(row.completionRate)}%</span>
                        <span className="ml-1 text-xs text-muted-foreground tabular-nums">({row.redeemed})</span>
                      </td>
                      <td className="py-3 text-right tabular-nums text-muted-foreground">
                        {row.daysToComplete === null ? "—" : formatNumber(row.daysToComplete)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Card engagement (server-computed, all campaigns) */}
        <EngagementSection from={startDate} to={endDate} />
      </div>
    </div>
  );
};
