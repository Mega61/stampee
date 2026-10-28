import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Eye,
  FlaskConical,
  Minus,
  Repeat,
  Timer,
  WalletCards,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import {
  fetchEngagement,
  type EngagementArm,
  type EngagementKpis,
  type EngagementReport,
} from "../../lib/db/engagement";
import type { CardViewSource } from "../../types";

// "Card engagement" section of AnalyticsPage: does opening the loyalty card
// bring clients back? Data: GET /analytics/engagement (definitions in
// docs/CARD_ENGAGEMENT_PLAN.md §4.4). The tile/title styles mirror the
// KpiCard / SectionTitle helpers in AnalyticsPage.tsx.

const MIN_CARDS_PER_ARM = 50;

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const formatDecimal = (value: number, digits = 1) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
const formatRate = (value: number | null) => (value === null ? "—" : `${formatNumber(value * 100)}%`);
const formatSeconds = (value: number | null) => {
  if (value === null) return "—";
  if (value < 60) return `${formatNumber(value)}s`;
  const minutes = Math.floor(value / 60);
  return `${minutes}m ${formatNumber(value % 60)}s`;
};

type Delta = { dir: "up" | "down" | "flat"; text: string; good: boolean };

// Rates compare in percentage points; everything else as a relative change.
const describeDelta = (
  current: number | null,
  previous: number | null,
  opts: { rate?: boolean; lowerIsBetter?: boolean } = {}
): Delta | undefined => {
  if (current === null || previous === null) return undefined;
  let change: number;
  let text: string;
  if (opts.rate) {
    change = (current - previous) * 100;
    text = `${change > 0 ? "+" : ""}${formatNumber(change)} pts vs prev`;
    if (Math.abs(change) < 0.5) return { dir: "flat", text: "No change", good: true };
  } else {
    if (previous === 0) {
      if (current === 0) return { dir: "flat", text: "No change", good: true };
      return { dir: "up", text: "New", good: !opts.lowerIsBetter };
    }
    change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return { dir: "flat", text: "No change", good: true };
    text = `${change > 0 ? "+" : ""}${formatNumber(change)}% vs prev`;
  }
  const dir = change > 0 ? "up" : "down";
  return { dir, text, good: opts.lowerIsBetter ? dir === "down" : dir === "up" };
};

const KpiTile: React.FC<{
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  delta?: Delta;
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

const SectionTitle: React.FC<{ title: string; sub: string; action?: React.ReactNode }> = ({ title, sub, action }) => (
  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
    <div className="space-y-1">
      <CardTitle className="text-lg">{title}</CardTitle>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
    {action}
  </CardHeader>
);

// ---------- funnel ----------

const Funnel: React.FC<{ funnel: EngagementReport["funnel"] }> = ({ funnel }) => {
  const base = funnel.activeCards;
  const steps = [
    { label: "Active cards", hint: "Cards with status Active today", value: funnel.activeCards },
    { label: "Opened the card", hint: "At least one open in range", value: funnel.openedCards },
    { label: "Opened again", hint: "Re-opened within 30 days of a previous open, on another day", value: funnel.reopenedCards },
    { label: "Visited after opening", hint: "Got a stamp within 14 days after an open", value: funnel.visitedAfterOpenCards },
  ];
  return (
    <ul className="space-y-4">
      {steps.map((step) => {
        const pct = base > 0 ? (step.value / base) * 100 : 0;
        return (
          <li key={step.label} className="space-y-1.5" title={step.hint}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-foreground">{step.label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{formatNumber(step.value)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{base > 0 ? `${formatNumber(pct)}%` : "—"}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground/80 transition-[width] duration-500"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

// ---------- source mix ----------

const SOURCES: { key: CardViewSource; label: string; tone: string }[] = [
  { key: "link", label: "Link", tone: "bg-foreground/85" },
  { key: "whatsapp", label: "WhatsApp", tone: "bg-foreground/60" },
  { key: "pwa", label: "Installed app", tone: "bg-foreground/40" },
  { key: "wallet", label: "Wallet", tone: "bg-foreground/20" },
];

const SourceMix: React.FC<{ sources: EngagementReport["sources"] }> = ({ sources }) => {
  const total = SOURCES.reduce((sum, s) => sum + sources[s.key], 0);
  if (total === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No card opens in this range.</p>;
  }
  return (
    <div className="space-y-5">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Opens by source">
        {SOURCES.filter((s) => sources[s.key] > 0).map((s) => (
          <div
            key={s.key}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", s.tone)}
            style={{ width: `${(sources[s.key] / total) * 100}%` }}
            title={`${s.label}: ${formatNumber(sources[s.key])}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {SOURCES.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.tone)} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="tabular-nums">
              <span className="font-medium text-foreground">{formatNumber(sources[s.key])}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">{formatNumber((sources[s.key] / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------- wallet passes ----------

const WALLETS: { key: "google" | "apple"; label: string }[] = [
  { key: "google", label: "Google Wallet" },
  { key: "apple", label: "Apple Wallet" },
];

const WalletPasses: React.FC<{ passes: NonNullable<EngagementReport["walletPasses"]> }> = ({ passes }) => (
  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {WALLETS.map((w) => {
      const s = passes[w.key];
      return (
        <li key={w.key} className="rounded-lg border border-border/70 bg-background/60 p-4">
          <p className="text-sm text-muted-foreground">{w.label}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatNumber(s.current)}</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-emerald-700 tabular-nums">+{formatNumber(s.added)}</span> added
            </span>
            <span>
              <span className="font-medium text-rose-700 tabular-nums">−{formatNumber(s.removed)}</span> removed
            </span>
            <span>in range</span>
          </p>
        </li>
      );
    })}
  </ul>
);

// ---------- experiment ----------

const ArmColumn: React.FC<{ title: string; sub: string; arm: EngagementArm; muted: boolean }> = ({ title, sub, arm, muted }) => (
  <div className="rounded-lg border border-border/70 bg-background/60 p-4">
    <div className="mb-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
    <dl className={cn("grid grid-cols-2 gap-4", muted && "opacity-60")}>
      <div>
        <dt className="text-xs text-muted-foreground">Comeback rate</dt>
        <dd className="text-2xl font-semibold tabular-nums">{formatRate(arm.comebackRate)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Days between visits</dt>
        <dd className="text-2xl font-semibold tabular-nums">
          {arm.medianDaysBetweenVisits === null ? "—" : formatDecimal(arm.medianDaysBetweenVisits)}
        </dd>
      </div>
    </dl>
    <div className="mt-4 space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Cards with a visit</span>
        <span className="tabular-nums">
          <span className="font-medium text-foreground">{formatNumber(arm.cardsWithVisit)}</span> of {formatNumber(arm.cards)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" title={`${arm.cardsWithVisit} / ${MIN_CARDS_PER_ARM} needed`}>
        <div
          className="h-full rounded-full bg-foreground/70"
          style={{ width: `${Math.min((arm.cardsWithVisit / MIN_CARDS_PER_ARM) * 100, 100)}%` }}
        />
      </div>
    </div>
  </div>
);

// One-line read-out once both arms are big enough: animated minus classic.
const Verdict: React.FC<{ fx: EngagementArm; holdout: EngagementArm }> = ({ fx, holdout }) => {
  const parts: string[] = [];
  if (fx.comebackRate !== null && holdout.comebackRate !== null) {
    const pts = Math.round((fx.comebackRate - holdout.comebackRate) * 100);
    parts.push(pts === 0 ? "the same comeback rate" : `${Math.abs(pts)} pts ${pts > 0 ? "higher" : "lower"} comeback rate`);
  }
  if (fx.medianDaysBetweenVisits !== null && holdout.medianDaysBetweenVisits !== null) {
    const days = holdout.medianDaysBetweenVisits - fx.medianDaysBetweenVisits;
    parts.push(
      Math.abs(days) < 0.5
        ? "the same time between visits"
        : `${formatDecimal(Math.abs(days))} ${days > 0 ? "fewer" : "more"} days between visits`
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-foreground">
      Animated card vs classic: <span className="font-medium">{parts.join(" and ")}</span>.
    </p>
  );
};

const Experiment: React.FC<{ experiment: EngagementReport["experiment"] }> = ({ experiment }) => {
  const { fx, holdout, enoughData } = experiment;
  return (
    <div className="space-y-4">
      {enoughData && <Verdict fx={fx} holdout={holdout} />}
      {!enoughData && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Not enough data yet (needs {MIN_CARDS_PER_ARM} cards with a visit in each group). Numbers below are early
            and can swing a lot.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ArmColumn title="Animated card" sub="~90% of cards: the new interactive card" arm={fx} muted={!enoughData} />
        <ArmColumn title="Classic card" sub="~10% holdout: the card as it was before" arm={holdout} muted={!enoughData} />
      </div>
    </div>
  );
};

// ---------- section ----------

const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded-xl border border-border/60 bg-muted/40", className)} />
);

const kpiTiles = (kpis: EngagementKpis, previous: EngagementKpis) => [
  {
    label: "Comeback rate",
    value: formatRate(kpis.comebackRate),
    sub: "Visited again within 45 days",
    icon: Repeat,
    delta: describeDelta(kpis.comebackRate, previous.comebackRate, { rate: true }),
  },
  {
    label: "Days between visits",
    value: kpis.medianDaysBetweenVisits === null ? "—" : formatDecimal(kpis.medianDaysBetweenVisits),
    sub: "Median, per card",
    icon: Clock,
    delta: describeDelta(kpis.medianDaysBetweenVisits, previous.medianDaysBetweenVisits, { lowerIsBetter: true }),
  },
  {
    label: "Opens per card / week",
    value: kpis.opensPerCardPerWeek === null ? "—" : formatDecimal(kpis.opensPerCardPerWeek, 2),
    sub: "Across active cards",
    icon: Eye,
    delta: describeDelta(kpis.opensPerCardPerWeek, previous.opensPerCardPerWeek),
  },
  {
    label: "Time on card",
    value: formatSeconds(kpis.medianSessionSeconds),
    sub: "Median per open",
    icon: Timer,
    delta: describeDelta(kpis.medianSessionSeconds, previous.medianSessionSeconds),
  },
];

export const EngagementSection: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [rangeFrom, rangeTo] = from <= to ? [from, to] : [to, from];

  useEffect(() => {
    if (!rangeFrom || !rangeTo) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchEngagement({ from: rangeFrom, to: rangeTo }, controller.signal)
      .then((data) => setReport(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load engagement data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [rangeFrom, rangeTo, reloadKey]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="card-engagement-title">
      <div className="space-y-1">
        <h2 id="card-engagement-title" className="text-lg font-semibold tracking-tight text-foreground">
          Card engagement
        </h2>
        <p className="text-sm text-muted-foreground">
          Do clients who open their loyalty card come back sooner? All campaigns, Bogotá time. Only stamped visits
          count; gifts don't.
        </p>
      </div>

      {error && !loading ? (
        <Card className="border-dashed border-border bg-card/60 shadow-none">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Couldn't load card engagement. {error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !report ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} className="h-[132px]" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <SkeletonBlock className="h-[260px] xl:col-span-2" />
            <SkeletonBlock className="h-[260px]" />
          </div>
        </>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpiTiles(report.kpis, report.previous).map((tile) => (
              <KpiTile key={tile.label} {...tile} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="border-border/80 bg-card shadow-subtle xl:col-span-2">
              <SectionTitle
                title="From open to visit"
                sub="Cards opened in range, opened again, then stamped soon after. Shown as % of active cards."
              />
              <CardContent className="pt-4">
                <Funnel funnel={report.funnel} />
              </CardContent>
            </Card>
            <Card className="border-border/80 bg-card shadow-subtle">
              <SectionTitle title="Where opens come from" sub="Card opens in range, by how the client got there." />
              <CardContent className="pt-4">
                <SourceMix sources={report.sources} />
              </CardContent>
            </Card>
          </div>

          {report.walletPasses && (
            <Card className="border-border/80 bg-card shadow-subtle">
              <SectionTitle
                title="Passes in Wallet"
                sub="Loyalty cards clients keep in Google or Apple Wallet right now, and how many were added or removed in this range."
                action={
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/70">
                    <WalletCards className="h-4 w-4 text-foreground/70" />
                  </span>
                }
              />
              <CardContent className="pt-4">
                <WalletPasses passes={report.walletPasses} />
              </CardContent>
            </Card>
          )}

          <Card className="border-border/80 bg-card shadow-subtle">
            <SectionTitle
              title="Experiment: animated card vs classic"
              sub="1 in 10 cards keeps the classic card so we can tell whether the new one brings clients back more."
              action={
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/70">
                  <FlaskConical className="h-4 w-4 text-foreground/70" />
                </span>
              }
            />
            <CardContent className="pt-4">
              <Experiment experiment={report.experiment} />
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
};
