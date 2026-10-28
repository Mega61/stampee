import React, { useEffect, useState } from "react";
import { AlertCircle, FlaskConical, Gift, Percent, Ticket, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { fetchGameReport, type GameGroup, type GameReport } from "../../lib/db/game";

// "Weekly scratch game" section of AnalyticsPage: what the game costs (bonus
// stamps vs the monthly budget) and whether it brings clients back (visit
// within 14 days for players vs eligible non-players vs the game holdout).
// Data: GET /analytics/game (docs/CARD_ENGAGEMENT_PLAN.md §8.8, §8.10). Same
// look as EngagementSection.

const MIN_CARD_WEEKS = 30;

const formatNumber = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
const formatRate = (value: number | null) => (value === null ? "—" : `${formatNumber(value * 100)}%`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
};

const KpiTile: React.FC<{ label: string; value: string; sub: string; icon: React.ElementType }> = ({ label, value, sub, icon: Icon }) => (
  <Card className="border-border/80 bg-card shadow-subtle">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/70">
        <Icon className="h-4 w-4 text-foreground/70" />
      </span>
    </CardHeader>
    <CardContent>
      <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
    </CardContent>
  </Card>
);

const SectionTitle: React.FC<{ title: string; sub: string; action?: React.ReactNode }> = ({ title, sub, action }) => (
  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-2">
    <div className="space-y-1">
      <CardTitle className="text-lg">{title}</CardTitle>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
    {action}
  </CardHeader>
);

// ---------- budget ----------

const Budget: React.FC<{ months: GameReport["months"]; cap: number | null }> = ({ months, cap }) => {
  if (months.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No plays in this range.</p>;
  }
  return (
    <ul className="space-y-4">
      {months.map((m) => {
        const budget = m.cap ?? cap;
        const pct = budget ? (m.stampsAwarded / budget) * 100 : 0;
        return (
          <li key={m.month} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground">{formatMonth(m.month)}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{formatNumber(m.stampsAwarded)}</span>
                <span className="text-muted-foreground">{budget ? ` / ${formatNumber(budget)} stamps` : " stamps"}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">· {formatNumber(m.plays)} plays</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", pct >= 100 ? "bg-amber-500" : "bg-foreground/80")}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

// ---------- comparison ----------

const GroupColumn: React.FC<{ title: string; sub: string; group: GameGroup; muted: boolean }> = ({ title, sub, group, muted }) => (
  <div className="rounded-lg border border-border/70 bg-background/60 p-4">
    <div className="mb-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
    <div className={cn(muted && "opacity-60")}>
      <div className="text-xs text-muted-foreground">Visited within 14 days</div>
      <div className="text-2xl font-semibold tabular-nums">{formatRate(group.rate)}</div>
    </div>
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>Weeks measured</span>
      <span className="tabular-nums">
        <span className="font-medium text-foreground">{formatNumber(group.visited)}</span> of {formatNumber(group.cardWeeks)}
      </span>
    </div>
  </div>
);

const Comparison: React.FC<{ comparison: GameReport["comparison"] }> = ({ comparison }) => {
  const { players, nonPlayers, holdout, enoughData } = comparison;
  const verdict =
    enoughData && players.rate !== null && nonPlayers.rate !== null
      ? Math.round((players.rate - nonPlayers.rate) * 100)
      : null;
  return (
    <div className="space-y-4">
      {verdict !== null ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-foreground">
          Clients who played came back within 14 days{" "}
          <span className="font-medium">
            {verdict === 0 ? "as often as" : `${Math.abs(verdict)} pts ${verdict > 0 ? "more often than" : "less often than"}`}
          </span>{" "}
          eligible clients who didn&apos;t play.
        </p>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Not enough data yet (needs {MIN_CARD_WEEKS} measured weeks in each group). A week counts once 14 days have
            passed.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <GroupColumn title="Played" sub="Weeks the client scratched the ticket" group={players} muted={!enoughData} />
        <GroupColumn title="Didn't play" sub="Eligible weeks without a play" group={nonPlayers} muted={!enoughData} />
        <GroupColumn title="Game holdout" sub="~10% of cards that don't get the game yet" group={holdout} muted={!enoughData} />
      </div>
    </div>
  );
};

// ---------- section ----------

const SkeletonBlock: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("animate-pulse rounded-xl border border-border/60 bg-muted/40", className)} />
);

export const GameSection: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const [report, setReport] = useState<GameReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [rangeFrom, rangeTo] = from <= to ? [from, to] : [to, from];

  useEffect(() => {
    if (!rangeFrom || !rangeTo) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchGameReport({ from: rangeFrom, to: rangeTo }, controller.signal)
      .then((data) => setReport(data))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load the scratch game report.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [rangeFrom, rangeTo, reloadKey]);

  // Nothing to show for businesses that never turned the game on.
  if (report && !report.enabled && report.totals.plays === 0) return null;

  const t = report?.totals;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="scratch-game-title">
      <div className="space-y-1">
        <h2 id="scratch-game-title" className="text-lg font-semibold tracking-tight text-foreground">
          Weekly scratch game
        </h2>
        <p className="text-sm text-muted-foreground">
          What the &ldquo;Raspa y gana&rdquo; ticket costs in bonus stamps, and whether players come back sooner. Bogotá
          time; bonus stamps never count as visits.
        </p>
      </div>

      {error && !loading ? (
        <Card className="border-dashed border-border bg-card/60 shadow-none">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the scratch game report. {error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : !report || !t ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} className="h-[132px]" />
            ))}
          </div>
          <SkeletonBlock className="h-[220px]" />
        </>
      ) : (
        <div className={cn("flex flex-col gap-6 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile label="Plays" value={formatNumber(t.plays)} sub={`${formatNumber(t.players)} clients played`} icon={Ticket} />
            <KpiTile label="Wins" value={formatNumber(t.wins)} sub={`Win rate ${formatRate(t.winRate)}`} icon={Percent} />
            <KpiTile
              label="Bonus stamps"
              value={formatNumber(t.stampsAwarded)}
              sub={report.cap !== null ? `Budget ${formatNumber(report.cap)} per month` : "Game is off"}
              icon={Gift}
            />
            <KpiTile
              label="Came back (players)"
              value={formatRate(report.comparison.players.rate)}
              sub={`vs ${formatRate(report.comparison.nonPlayers.rate)} who didn't play`}
              icon={Users}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="border-border/80 bg-card shadow-subtle">
              <SectionTitle title="Monthly budget" sub="Bonus stamps awarded vs the monthly cap." />
              <CardContent className="pt-4">
                <Budget months={report.months} cap={report.cap} />
              </CardContent>
            </Card>
            <Card className="border-border/80 bg-card shadow-subtle xl:col-span-2">
              <SectionTitle
                title="Does it bring clients back?"
                sub="Share of weeks followed by a stamped visit within 14 days."
                action={
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/70">
                    <FlaskConical className="h-4 w-4 text-foreground/70" />
                  </span>
                }
              />
              <CardContent className="pt-4">
                <Comparison comparison={report.comparison} />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </section>
  );
};
