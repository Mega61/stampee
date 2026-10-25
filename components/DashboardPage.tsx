import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Gift,
  PlusCircle,
  ReceiptText,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';
import { Customer, Template, Transaction } from '../types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { useAuth } from './AuthProvider';
import { loadFromStorage, saveToStorage } from '../lib/storage';
import { cn } from '../lib/utils';

interface DashboardPageProps {
  campaigns: Template[];
  customers: Customer[];
}

interface ChecklistStep {
  title: string;
  description: string;
  href: string;
  complete: boolean;
  buttonLabel: string;
}

interface ActivityItem extends Transaction {
  customerName: string;
  campaignName: string;
}

interface DashboardDismissState {
  getStarted: boolean;
}

const dashboardDismissStateKey = (ownerId: string) => `dashboard:dismissed:${ownerId}`;
const defaultDismissState: DashboardDismissState = {
  getStarted: false,
};

const formatAction = (type: Transaction['type']) => {
  switch (type) {
    case 'issued':
      return 'Card issued';
    case 'redeem':
      return 'Reward redeemed';
    case 'stamp_remove':
      return 'Stamp removed';
    case 'gift':
      return 'Gift stamps';
    default:
      return 'Stamp added';
  }
};

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const DashboardPage: React.FC<DashboardPageProps> = ({ campaigns, customers }) => {
  const { currentOwner } = useAuth();
  const cards = useMemo(() => customers.flatMap((customer) => customer.cards), [customers]);
  const [dismissedSections, setDismissedSections] = useState<DashboardDismissState>(defaultDismissState);

  const recentActivity = useMemo<ActivityItem[]>(
    () =>
      customers
        .flatMap((customer) =>
          customer.cards.flatMap((card) =>
            (card.history || []).map((transaction) => ({
              ...transaction,
              customerName: customer.name,
              campaignName: card.campaignName,
            }))
          )
        )
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5),
    [customers]
  );

  const activeCardCount = cards.filter((card) => card.status === 'Active').length;
  const redeemedCardCount = cards.filter((card) => card.status === 'Redeemed').length;
  const hasStampActivity = recentActivity.some((transaction) => transaction.type === 'stamp_add') ||
    customers.some((customer) =>
      customer.cards.some((card) => (card.history || []).some((transaction) => transaction.type === 'stamp_add'))
    );

  const steps: ChecklistStep[] = [
    {
      title: 'Create Campaign',
      description: 'Create your first loyalty campaign.',
      href: '/gallery',
      complete: campaigns.length > 0,
      buttonLabel: 'Create campaign',
    },
    {
      title: 'Issue Card',
      description: 'Issue your first loyalty card to a customer.',
      href: '/issued-cards',
      complete: cards.length > 0,
      buttonLabel: 'Issue card',
    },
    {
      title: 'Stamp a Card',
      description: 'Open an issued card and add the first stamp.',
      href: '/issued-cards',
      complete: hasStampActivity,
      buttonLabel: 'Add stamp',
    },
  ];

  const completedSteps = steps.filter((step) => step.complete).length;
  const setupComplete = completedSteps === steps.length;
  const progressPercent = (completedSteps / steps.length) * 100;
  const showGetStarted = !setupComplete || !dismissedSections.getStarted;

  const statCards = [
    {
      label: 'Campaigns',
      value: campaigns.length,
      detail: campaigns.length === 1 ? '1 campaign live' : `${campaigns.length} campaigns live`,
      icon: CreditCard,
    },
    {
      label: 'Issued Cards',
      value: cards.length,
      detail: cards.length === 1 ? '1 card issued' : `${cards.length} cards issued`,
      icon: Wallet,
    },
    {
      label: 'Customers',
      value: customers.length,
      detail: customers.length === 1 ? '1 customer added' : `${customers.length} customers added`,
      icon: Users,
    },
    {
      label: 'Active Cards',
      value: activeCardCount,
      detail: `${redeemedCardCount} redeemed`,
      icon: Sparkles,
    },
  ];

  useEffect(() => {
    if (!currentOwner?.id) {
      setDismissedSections(defaultDismissState);
      return;
    }

    const stored = loadFromStorage<DashboardDismissState>(dashboardDismissStateKey(currentOwner.id));
    setDismissedSections({
      getStarted: stored?.getStarted ?? false,
    });
  }, [currentOwner?.id]);

  const dismissSection = (section: keyof DashboardDismissState) => {
    if (!setupComplete || !currentOwner?.id) return;

    const nextState = {
      ...dismissedSections,
      [section]: true,
    };

    setDismissedSections(nextState);
    saveToStorage(dashboardDismissStateKey(currentOwner.id), nextState);
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50/50 p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="rounded-[28px] border border-border/80 bg-card px-6 py-6 shadow-subtle md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <Badge variant="outline" className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.18em]">
                Owner Overview
              </Badge>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">Dashboard</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
                  Get your loyalty program live in three steps. Progress updates automatically as you create campaigns, issue cards, and start stamping.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/campaigns">View Campaigns</Link>
              </Button>
              <Button asChild className="rounded-full">
                <Link to="/gallery">Create Campaign</Link>
              </Button>
            </div>
          </div>
        </header>

        {showGetStarted && (
          <Card className="rounded-[28px] border-border/80">
            <CardHeader className="gap-4 border-b border-border/70 pb-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl">Get started</CardTitle>
                    {setupComplete && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
                        onClick={() => dismissSection('getStarted')}
                        aria-label="Dismiss get started"
                      >
                        Dismiss
                      </Button>
                    )}
                  </div>
                  <CardDescription className="mt-1 text-sm">
                    Launch your loyalty program in three steps.
                  </CardDescription>
                </div>
                <Badge
                  variant={setupComplete ? 'default' : 'outline'}
                  className={cn(
                    'w-fit rounded-full px-3 py-1',
                    setupComplete && 'bg-emerald-600 text-white hover:bg-emerald-600'
                  )}
                >
                  {setupComplete ? 'Setup complete' : `${completedSteps} of ${steps.length} completed`}
                </Badge>
              </div>
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {setupComplete ? (
                  <p className="text-sm text-muted-foreground">
                    Your loyalty workflow is ready. Jump back into campaigns or issued cards anytime.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Complete each step in order. The next action stays one click away.
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-3">
                {steps.map((step, index) => (
                  <div
                    key={step.title}
                    className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                          step.complete
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-border bg-card text-foreground'
                        )}
                      >
                        {step.complete ? <CheckCircle2 size={20} /> : <span>{index + 1}</span>}
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                          {step.complete && (
                            <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                              Completed
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    {step.complete ? (
                      <Button asChild variant="ghost" className="justify-start rounded-full md:justify-center">
                        <Link to={step.href}>
                          {setupComplete
                            ? step.title === 'Create Campaign'
                              ? 'Create another'
                              : 'Open workflow'
                            : 'Review'}
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild className="justify-start rounded-full md:justify-center">
                        <Link to={step.href}>
                          {step.buttonLabel}
                          <ArrowRight size={16} className="ml-2" />
                        </Link>
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {setupComplete && (
                <div className="flex flex-wrap gap-3 border-t border-border/70 pt-2">
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/gallery">Create Campaign</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/campaigns">View Campaigns</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <Link to="/issued-cards">View Issued Cards</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((item) => (
            <Card key={item.label} className="rounded-[24px]">
              <CardContent className="flex items-start justify-between p-6">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <div className="rounded-2xl bg-muted p-3 text-foreground">
                  <item.icon size={20} />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="rounded-[28px]">
          <CardHeader className="border-b border-border/70 pb-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-xl">Recent activity</CardTitle>
                <CardDescription className="mt-1">
                  Latest transactions across all issued cards.
                </CardDescription>
              </div>
              <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                {recentActivity.length} shown
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {recentActivity.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 py-12 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-subtle">
                  <ReceiptText size={20} className="text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">No activity yet</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Complete the checklist above to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-muted p-3 text-foreground">
                        {transaction.type === 'redeem' || transaction.type === 'gift' ? (
                          <Gift size={18} />
                        ) : transaction.type === 'issued' ? (
                          <Wallet size={18} />
                        ) : (
                          <PlusCircle size={18} />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{formatAction(transaction.type)}</p>
                        <p className="text-sm text-muted-foreground">
                          {transaction.customerName} on {transaction.campaignName}
                        </p>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <div>{formatTimestamp(transaction.timestamp)}</div>
                      <div className="text-xs uppercase tracking-[0.14em]">{transaction.actorRole ?? 'owner'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
