import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Customer, IssuedCard, Template, Transaction } from "../types";
import { resolveCardTemplate } from "../lib/templateSerialization";
import { cn } from "../lib/utils";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  Minus,
  Sparkles,
  Stamp,
  TrendingUp,
  Users,
} from "lucide-react";

interface AnalyticsPageProps {
  customers: Customer[];
  campaigns: Template[];
}

type ActivityBucket = {
  label: string;
  stampAdds: number;
  redemptions: number;
};

type CampaignStatsGroup = {
  id: string;
  name: string;
  totalStamps: number | null;
  issuedCards: IssuedCard[];
  archived: boolean;
};

type RangeStats = {
  stampAdds: number;
  redemptions: number;
  activeCustomers: number;
};

const DEFAULT_DAY_COUNT = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
  return date.getTime();
};

const getDateKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const isTimestampInRange = (timestamp: number | undefined, start: number, end: number) =>
  typeof timestamp === "number" && timestamp >= start && timestamp <= end;

const formatDateRangeLabel = (startDate: string, endDate: string) => {
  const start = parseDateInputToTimestamp(startDate);
  const end = parseDateInputToTimestamp(endDate);
  if (start === null || end === null) return "Custom range";
  const startLabel = new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
};

// Resolve the live theme tokens so charts stay in lock-step with the design
// system (and any future theme) instead of hardcoding hex values.
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

const computeRangeStats = (customers: Customer[], start: number, end: number): RangeStats => {
  let stampAdds = 0;
  let redemptions = 0;
  const activeCustomers = new Set<string>();

  customers.forEach((customer) => {
    let hasActivity = false;
    customer.cards.forEach((card) => {
      (card.history || []).forEach((tx: Transaction) => {
        if (!isTimestampInRange(tx.timestamp, start, end)) return;
        hasActivity = true;
        if (tx.type === "stamp_add") stampAdds += tx.amount || 1;
        if (tx.type === "redeem") redemptions += 1;
      });
    });
    if (hasActivity) activeCustomers.add(customer.id);
  });

  return { stampAdds, redemptions, activeCustomers: activeCustomers.size };
};

const describeDelta = (current: number, previous: number) => {
  if (previous === 0) {
    if (current === 0) return { dir: "flat" as const, text: "No change" };
    return { dir: "up" as const, text: "New activity" };
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { dir: "flat" as const, text: "No change" };
  return {
    dir: change > 0 ? ("up" as const) : ("down" as const),
    text: `${change > 0 ? "+" : ""}${formatPercent(change)}% vs prev`,
  };
};

const KpiCard: React.FC<{
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  delta?: { dir: "up" | "down" | "flat"; text: string };
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
        <div className="mt-2 flex items-center gap-2">
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                delta.dir === "up" && "bg-foreground/10 text-foreground",
                delta.dir === "down" && "bg-muted text-muted-foreground",
                delta.dir === "flat" && "bg-muted text-muted-foreground"
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
      {label && <div className="mb-1.5 font-medium text-foreground">{label}</div>}
      <div className="space-y-1">
        {payload.map((entry: any) => (
          <div key={entry.dataKey ?? entry.name} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: entry.color || entry.payload?.fill }}
              />
              {entry.name}
            </span>
            <span className="font-medium tabular-nums text-foreground">{formatNumber(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{ rangeLabel: string }> = ({ rangeLabel }) => (
  <Card className="border-dashed border-border bg-card/60 shadow-none">
    <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Activity className="h-6 w-6 text-muted-foreground" />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">No activity in this range</h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Nothing was stamped or redeemed between {rangeLabel}. Try a wider window, or issue a card to
          start collecting data.
        </p>
      </div>
    </CardContent>
  </Card>
);

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ customers, campaigns }) => {
  const colors = useChartColors();

  const [startDate, setStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - (DEFAULT_DAY_COUNT - 1));
    return toDateInputValue(start);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));

  const { rangeStart, rangeEnd } = useMemo(() => {
    const now = new Date();
    const fallbackEnd = new Date(now);
    fallbackEnd.setHours(23, 59, 59, 999);
    const fallbackStart = new Date(now);
    fallbackStart.setDate(fallbackStart.getDate() - (DEFAULT_DAY_COUNT - 1));
    fallbackStart.setHours(0, 0, 0, 0);

    let nextStart = parseDateInputToTimestamp(startDate) ?? fallbackStart.getTime();
    let nextEnd = parseDateInputToTimestamp(endDate, true) ?? fallbackEnd.getTime();
    if (nextStart > nextEnd) {
      const swap = nextStart;
      nextStart = nextEnd;
      nextEnd = swap;
    }

    return { rangeStart: nextStart, rangeEnd: nextEnd };
  }, [startDate, endDate]);

  const applyPresetRange = (dayCount: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (dayCount - 1));
    setStartDate(toDateInputValue(start));
    setEndDate(toDateInputValue(end));
  };

  const selectedDayCount = useMemo(() => {
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(rangeEnd);
    end.setHours(0, 0, 0, 0);
    return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  }, [rangeStart, rangeEnd]);

  const activePreset = useMemo(() => {
    const todayEnd = toDateInputValue(new Date());
    if (endDate !== todayEnd) return null;
    if ([7, 14, 30, 90].includes(selectedDayCount)) return selectedDayCount;
    return null;
  }, [endDate, selectedDayCount]);

  const rangeLabel = useMemo(() => formatDateRangeLabel(startDate, endDate), [startDate, endDate]);
  const allCards = useMemo(() => customers.flatMap((c) => c.cards), [customers]);
  const filteredCards = useMemo(() => {
    return allCards.filter((card) =>
      (card.history || []).some((tx) => isTimestampInRange(tx.timestamp, rangeStart, rangeEnd))
    );
  }, [allCards, rangeStart, rangeEnd]);

  // Current vs previous equal-length period for trend deltas.
  const rangeStats = useMemo(() => computeRangeStats(customers, rangeStart, rangeEnd), [
    customers,
    rangeStart,
    rangeEnd,
  ]);
  const previousStats = useMemo(() => {
    const span = rangeEnd - rangeStart;
    const prevEnd = rangeStart - 1;
    const prevStart = prevEnd - span;
    return computeRangeStats(customers, prevStart, prevEnd);
  }, [customers, rangeStart, rangeEnd]);

  const totals = useMemo(() => {
    const issued = filteredCards.length;
    const active = filteredCards.filter((card) => card.status === "Active");
    const redeemed = filteredCards.filter((card) => card.status === "Redeemed");
    const redemptionRate = issued > 0 ? (redeemed.length / issued) * 100 : 0;

    const avgStamps =
      active.length > 0
        ? active.reduce((sum, card) => sum + (card.stamps || 0), 0) / active.length
        : 0;

    const readyToRedeem = active.filter((card) => {
      const template = resolveCardTemplate(card, campaigns);
      if (!template) return false;
      return card.stamps >= template.totalStamps;
    }).length;

    return {
      issued,
      active: active.length,
      redeemed: redeemed.length,
      redemptionRate,
      avgStamps,
      readyToRedeem,
    };
  }, [filteredCards, campaigns]);

  const activityBuckets = useMemo(() => {
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(rangeEnd);
    end.setHours(0, 0, 0, 0);
    const days: ActivityBucket[] = [];

    const daySpan = Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS));
    for (let i = 0; i <= daySpan; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      days.push({
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        stampAdds: 0,
        redemptions: 0,
      });
    }

    const bucketByKey = new Map<string, ActivityBucket>();
    days.forEach((bucket, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      bucketByKey.set(getDateKey(date), bucket);
    });

    allCards.forEach((card) => {
      (card.history || []).forEach((tx: Transaction) => {
        if (!isTimestampInRange(tx.timestamp, rangeStart, rangeEnd)) return;
        const bucket = bucketByKey.get(getDateKey(new Date(tx.timestamp)));
        if (!bucket) return;
        if (tx.type === "stamp_add") bucket.stampAdds += tx.amount || 1;
        if (tx.type === "redeem") bucket.redemptions += 1;
      });
    });

    return days;
  }, [allCards, rangeStart, rangeEnd]);

  const hasActivity = useMemo(
    () => activityBuckets.some((b) => b.stampAdds > 0 || b.redemptions > 0),
    [activityBuckets]
  );

  const progressDistribution = useMemo(() => {
    const buckets = { zero: 0, low: 0, mid: 0, full: 0 };
    filteredCards
      .filter((card) => card.status === "Active")
      .forEach((card) => {
        const template = resolveCardTemplate(card, campaigns);
        if (!template || template.totalStamps === 0) return;
        const ratio = card.stamps / template.totalStamps;
        if (ratio <= 0) buckets.zero += 1;
        else if (ratio < 0.5) buckets.low += 1;
        else if (ratio < 1) buckets.mid += 1;
        else buckets.full += 1;
      });
    return buckets;
  }, [filteredCards, campaigns]);

  const distributionData = useMemo(
    () => [
      { name: "Not started", value: progressDistribution.zero, fill: colors.border },
      { name: "1–49%", value: progressDistribution.low, fill: "hsl(220 12% 64%)" },
      { name: "50–99%", value: progressDistribution.mid, fill: colors.muted },
      { name: "Complete", value: progressDistribution.full, fill: colors.foreground },
    ],
    [progressDistribution, colors]
  );
  const distributionTotal = distributionData.reduce((sum, d) => sum + d.value, 0);

  const campaignStats = useMemo(() => {
    const groups = new Map<string, CampaignStatsGroup>();

    campaigns.forEach((campaign) => {
      groups.set(campaign.id, {
        id: campaign.id,
        name: campaign.name,
        totalStamps: campaign.totalStamps,
        issuedCards: [],
        archived: false,
      });
    });

    filteredCards.forEach((card) => {
      const liveCampaign = card.campaignId
        ? campaigns.find((campaign) => campaign.id === card.campaignId)
        : undefined;
      const template = resolveCardTemplate(card, campaigns);
      const groupId = liveCampaign
        ? liveCampaign.id
        : `deleted:${card.campaignName}:${template?.totalStamps ?? "unknown"}`;
      const existingGroup = groups.get(groupId);

      if (existingGroup) {
        existingGroup.issuedCards.push(card);
        if (existingGroup.totalStamps === null && template) {
          existingGroup.totalStamps = template.totalStamps;
        }
        return;
      }

      groups.set(groupId, {
        id: groupId,
        name: card.campaignName || template?.name || "Archived campaign",
        totalStamps: template?.totalStamps ?? null,
        issuedCards: [card],
        archived: true,
      });
    });

    return Array.from(groups.values())
      .map((campaign) => {
        const cards = campaign.issuedCards;
        const active = cards.filter((card) => card.status === "Active");
        const redeemed = cards.filter((card) => card.status === "Redeemed");
        const avgStamps =
          active.length > 0
            ? active.reduce((sum, card) => sum + card.stamps, 0) / active.length
            : 0;
        const completionRate = cards.length > 0 ? (redeemed.length / cards.length) * 100 : 0;
        const readyToRedeem = active.filter((card) => {
          const template = resolveCardTemplate(card, campaigns);
          return template ? card.stamps >= template.totalStamps : false;
        }).length;

        return {
          id: campaign.id,
          name: campaign.name,
          totalStamps: campaign.totalStamps,
          archived: campaign.archived,
          issued: cards.length,
          active: active.length,
          redeemed: redeemed.length,
          avgStamps,
          completionRate,
          readyToRedeem,
        };
      })
      .filter((c) => c.issued > 0)
      .sort((a, b) => b.issued - a.issued);
  }, [campaigns, filteredCards]);

  const tickInterval = activityBuckets.length > 16 ? Math.ceil(activityBuckets.length / 10) : 0;

  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-8 animate-fade-in">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        {/* Header + range controls */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-4xl">
              Analytics
            </h1>
            <p className="text-sm text-muted-foreground md:text-base">
              A pulse check on loyalty performance and customer activity.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-subtle">
            <div className="hidden items-center gap-2 self-center pr-1 text-sm text-muted-foreground sm:flex">
              <CalendarDays className="h-4 w-4" />
              Range
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                From
              </label>
              <Input
                type="date"
                className="h-10 w-[150px]"
                value={startDate}
                onChange={(event) => {
                  const value = event.target.value;
                  setStartDate(value);
                  if (value > endDate) setEndDate(value);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                To
              </label>
              <Input
                type="date"
                className="h-10 w-[150px]"
                value={endDate}
                onChange={(event) => {
                  const value = event.target.value;
                  setEndDate(value);
                  if (value < startDate) setStartDate(value);
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {[7, 14, 30, 90].map((days) => (
                <Button
                  key={days}
                  type="button"
                  variant={activePreset === days ? "default" : "outline"}
                  size="sm"
                  onClick={() => applyPresetRange(days)}
                >
                  {days}D
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-muted-foreground">
            {rangeLabel}
          </Badge>
          <Badge variant="outline" className="border-border/80 text-muted-foreground">
            {Math.max(0, selectedDayCount)} days
          </Badge>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label="Active customers"
            value={formatNumber(rangeStats.activeCustomers)}
            sub="With activity in range"
            icon={Users}
            delta={describeDelta(rangeStats.activeCustomers, previousStats.activeCustomers)}
          />
          <KpiCard
            label="Stamps added"
            value={formatNumber(rangeStats.stampAdds)}
            sub="Total stamps in range"
            icon={Stamp}
            delta={describeDelta(rangeStats.stampAdds, previousStats.stampAdds)}
          />
          <KpiCard
            label="Redemptions"
            value={formatNumber(rangeStats.redemptions)}
            sub="Rewards claimed in range"
            icon={BadgeCheck}
            delta={describeDelta(rangeStats.redemptions, previousStats.redemptions)}
          />
          <KpiCard
            label="Redemption rate"
            value={`${formatPercent(totals.redemptionRate)}%`}
            sub={`${formatNumber(totals.issued)} cards active in range`}
            icon={TrendingUp}
          />
          <KpiCard
            label="Ready to redeem"
            value={formatNumber(totals.readyToRedeem)}
            sub="Cards at the reward threshold"
            icon={CreditCard}
          />
          <KpiCard
            label="Avg stamps / card"
            value={formatDecimal(totals.avgStamps)}
            sub="Momentum across active cards"
            icon={Sparkles}
          />
        </div>

        {!hasActivity && distributionTotal === 0 ? (
          <EmptyState rangeLabel={rangeLabel} />
        ) : (
          <>
            {/* Activity + distribution */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <Card className="border-border/80 bg-card shadow-subtle xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Activity over time</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Stamps collected and rewards redeemed, by day.
                  </p>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={activityBuckets} margin={{ top: 8, right: 18, left: -16, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillStamps" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colors.foreground} stopOpacity={0.28} />
                            <stop offset="100%" stopColor={colors.foreground} stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="fillRedeem" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colors.muted} stopOpacity={0.22} />
                            <stop offset="100%" stopColor={colors.muted} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          interval={tickInterval}
                          tick={{ fontSize: 11, fill: colors.muted }}
                          tickMargin={10}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={40}
                          tick={{ fontSize: 11, fill: colors.muted }}
                        />
                        <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.border }} />
                        <Area
                          type="monotone"
                          name="Stamps"
                          dataKey="stampAdds"
                          stroke={colors.foreground}
                          strokeWidth={2}
                          fill="url(#fillStamps)"
                          activeDot={{ r: 4 }}
                        />
                        <Area
                          type="monotone"
                          name="Redemptions"
                          dataKey="redemptions"
                          stroke={colors.muted}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          fill="url(#fillRedeem)"
                          activeDot={{ r: 4 }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: colors.foreground }} />
                      Stamps added
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: colors.muted }} />
                      Redemptions
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/80 bg-card shadow-subtle">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Progress distribution</CardTitle>
                  <p className="text-sm text-muted-foreground">Active cards by completion.</p>
                </CardHeader>
                <CardContent className="pt-4">
                  {distributionTotal === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      No active cards in this range.
                    </p>
                  ) : (
                    <>
                      <div className="relative h-[180px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={distributionData.filter((d) => d.value > 0)}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={56}
                              outerRadius={80}
                              paddingAngle={2}
                              stroke="none"
                            >
                              {distributionData
                                .filter((d) => d.value > 0)
                                .map((entry) => (
                                  <Cell key={entry.name} fill={entry.fill} />
                                ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-semibold tabular-nums text-foreground">
                            {formatNumber(distributionTotal)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">active cards</span>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2 text-sm">
                        {distributionData.map((entry) => (
                          <div key={entry.name} className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ background: entry.fill }}
                              />
                              {entry.name}
                            </span>
                            <span className="font-medium tabular-nums">{formatNumber(entry.value)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Campaign performance */}
            <Card className="border-border/80 bg-card shadow-subtle">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Campaign performance</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Active vs redeemed cards by campaign, in the selected range.
                </p>
              </CardHeader>
              <CardContent className="pt-4">
                {campaignStats.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No campaign activity in this range.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
                    <div className="lg:col-span-3">
                      <div style={{ height: Math.max(160, campaignStats.length * 56) }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={campaignStats}
                            layout="vertical"
                            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                            barCategoryGap={16}
                          >
                            <XAxis
                              type="number"
                              allowDecimals={false}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fontSize: 11, fill: colors.muted }}
                            />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={120}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fontSize: 12, fill: colors.foreground }}
                            />
                            <Tooltip content={<ChartTooltip />} cursor={{ fill: colors.border, opacity: 0.3 }} />
                            <Bar dataKey="active" name="Active" stackId="cards" fill={colors.muted} radius={[4, 0, 0, 4]} />
                            <Bar
                              dataKey="redeemed"
                              name="Redeemed"
                              stackId="cards"
                              fill={colors.foreground}
                              radius={[0, 4, 4, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: colors.muted }} />
                          Active
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: colors.foreground }} />
                          Redeemed
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 lg:col-span-2">
                      {campaignStats.map((campaign) => (
                        <div
                          key={campaign.id}
                          className="rounded-lg border border-border/80 bg-background px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 truncate">
                              <span className="truncate text-sm font-medium text-foreground">
                                {campaign.name}
                              </span>
                              {campaign.archived && (
                                <Badge variant="outline" className="shrink-0 text-[10px]">
                                  Archived
                                </Badge>
                              )}
                            </div>
                            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                              {formatPercent(campaign.completionRate)}% redeemed
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{campaign.issued} issued</span>
                            <span>·</span>
                            <span>{campaign.readyToRedeem} ready</span>
                            <span>·</span>
                            <span>avg {formatDecimal(campaign.avgStamps)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
