import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Sidebar, NAV_ITEMS, SidebarContent } from './components/Sidebar';
import { Template, Customer } from './types';
import { templates } from './data/templates';
import { BrowserRouter, Routes, Route, Outlet, useParams, useNavigate, Navigate, useSearchParams, useLocation } from 'react-router-dom';
import { toStoredTemplate, fromStoredTemplate } from './lib/templateSerialization';
import { cn } from './lib/utils';
import { AuthProvider, useAuth } from './components/AuthProvider';
import { RequireAuth } from './components/RequireAuth';
import { RequireRole } from './components/RequireRole';
import { VerifyBanner } from './components/VerifyBanner';
import { fetchCampaigns, upsertCampaign, deleteCampaign as dbDeleteCampaign, setCampaignEnabled } from './lib/db/campaigns';
import { fetchCustomersWithCards } from './lib/db/customers';
import { fetchPublicScanEntryContext } from './lib/db/issuedCards';
import { buildIssuedCardsKioskUrl, buildStaffPortalUrl } from './lib/links';

const LoyaltyCard = lazy(() => import('./components/LoyaltyCard').then((module) => ({ default: module.LoyaltyCard })));
const CardEditor = lazy(() => import('./components/CardEditor').then((module) => ({ default: module.CardEditor })));
const MyCards = lazy(() => import('./components/MyCards').then((module) => ({ default: module.MyCards })));
const IssuedCardsPage = lazy(() => import('./components/IssuedCardsPage').then((module) => ({ default: module.IssuedCardsPage })));
const CustomerDirectory = lazy(() => import('./components/CustomerDirectory').then((module) => ({ default: module.CustomerDirectory })));
const TemplatesGallery = lazy(() => import('./components/TemplatesGallery').then((module) => ({ default: module.TemplatesGallery })));
const TransactionsPage = lazy(() => import('./components/TransactionsPage').then((module) => ({ default: module.TransactionsPage })));
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })));
const LoginPage = lazy(() => import('./components/LoginPage').then((module) => ({ default: module.LoginPage })));
const StaffLoginPage = lazy(() => import('./components/StaffLoginPage').then((module) => ({ default: module.StaffLoginPage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const ForgotPasswordPage = lazy(() => import('./components/ForgotPasswordPage').then((module) => ({ default: module.ForgotPasswordPage })));
const DashboardPage = lazy(() => import('./components/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const PublicCardPage = lazy(() => import('./components/PublicCardPage'));
const DevCardsPage = import.meta.env.DEV ? lazy(() => import('./components/dev/DevCardsPage')) : null;
const PublicCampaignSignupPage = lazy(() => import('./components/PublicCampaignSignupPage').then((module) => ({ default: module.PublicCampaignSignupPage })));

const RouteLoader: React.FC = () => (
  <div className="flex min-h-[40vh] w-full items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const withSuspense = (node: React.ReactNode) => (
  <Suspense fallback={<RouteLoader />}>
    {node}
  </Suspense>
);

const DEFAULT_TITLE = 'Golden Beauty Studio · Fidelización';

// Internal tool: no SEO. Just keep the tab title in sync with the section.
const TitleManager: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const section = NAV_ITEMS.find((item) => item.path === location.pathname)?.label;
    document.title = section ? `${section} · Golden Beauty Studio` : DEFAULT_TITLE;
  }, [location.pathname]);

  return null;
};

const StaffScanEntryWrapper: React.FC = () => {
  const { slug, uniqueId } = useParams<{ slug: string; uniqueId: string }>();
  const navigate = useNavigate();
  const { currentOwner, currentUser, loading } = useAuth();
  const [loadingContext, setLoadingContext] = useState(true);
  const [context, setContext] = useState<Awaited<ReturnType<typeof fetchPublicScanEntryContext>>>(null);

  useEffect(() => {
    if (!slug || !uniqueId) {
      setLoadingContext(false);
      setContext(null);
      return;
    }

    let active = true;
    setLoadingContext(true);

    void (async () => {
      const nextContext = await fetchPublicScanEntryContext(slug, uniqueId);
      if (!active) return;
      setContext(nextContext);
      setLoadingContext(false);
    })();

    return () => {
      active = false;
    };
  }, [slug, uniqueId]);

  useEffect(() => {
    if (loading || loadingContext || !context) return;

    if (!currentUser || !currentOwner) {
      window.location.replace(buildStaffPortalUrl(context.owner.slug, context.owner.id, context.card.uniqueId));
      return;
    }

    if (currentOwner.id !== context.owner.id) {
      return;
    }

    navigate(buildIssuedCardsKioskUrl(context.card.uniqueId), { replace: true });
  }, [context, currentOwner, currentUser, loading, loadingContext, navigate]);

  if (loading || loadingContext) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!context) {
    return (
      <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
        Tarjeta no encontrada.
      </div>
    );
  }

  if (!currentUser || !currentOwner) {
    return (
      <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
        Redirigiendo al inicio de sesión del personal...
      </div>
    );
  }

  if (currentOwner.id !== context.owner.id) {
    return (
      <div className="h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">Negocio incorrecto</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta tarjeta no pertenece a tu negocio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center px-6 text-center text-muted-foreground">
      Abriendo kiosco...
    </div>
  );
};

const ActiveCardWrapper: React.FC<{ templates: Template[] }> = ({ templates }) => {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const template = templates.find(t => t.id === cardId);

  if (!template) return <Navigate to="/campaigns" />;

  return (
    <div className="h-screen w-full bg-background relative flex flex-col items-center justify-center animate-fade-in">
      <button
        onClick={() => navigate('/campaigns')}
        className="absolute top-6 left-6 z-50 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 transition-colors backdrop-blur-sm"
        title="Close"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      {withSuspense(
        <LoyaltyCard
          template={template}
          mode="active"
          className="h-full w-full"
        />
      )}
    </div>
  );
};

const PreviewWrapper: React.FC = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const template = templates.find(t => t.id === templateId);

  if (!template) return <Navigate to="/gallery" />;

  return (
    <div className="h-screen w-full">
      {withSuspense(
        <LoyaltyCard
          template={template}
          mode="preview"
          onBack={() => navigate('/gallery')}
          onCreate={() => navigate(`/editor/new?templateId=${templateId}`)}
          className="h-full w-full"
        />
      )}
    </div>
  );
};

const EditorWrapper: React.FC<{ onSave: (t: Template) => Promise<void>; templates: Template[] }> = ({ onSave, templates: createdTemplates }) => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();

  let initialTemplate: Template | undefined;

  if (id === 'new') {
    const baseId = searchParams.get('templateId');
    const baseTemplate = templates.find(t => t.id === baseId);
    initialTemplate = baseTemplate
      ? { ...baseTemplate, backgroundOpacity: 80 }
      : undefined;
    if (!initialTemplate && templates[0]) {
      initialTemplate = { ...templates[0], backgroundOpacity: 80 };
    }
  } else {
    initialTemplate = createdTemplates.find(t => t.id === id);
  }

  if (!initialTemplate) return <Navigate to="/campaigns" />;

  return (
    withSuspense(
      <CardEditor
        initialTemplate={initialTemplate}
        onSave={onSave}
      />
    )
  );
};

const DashboardLayout: React.FC = () => {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const location = useLocation();

  const activeTitle = NAV_ITEMS.find((item) => item.path === location.pathname)?.label ?? "Dashboard";

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      <Sidebar
        onScanQr={() => window.dispatchEvent(new Event('open-qr-scan'))}
      />
      <main className="relative flex min-h-screen min-w-0 flex-1 flex-col overflow-visible md:h-screen md:overflow-hidden">
        <div className="md:hidden sticky top-0 z-40 flex items-center justify-between border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur-sm">
          <button
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border/80 bg-background shadow-subtle"
            onClick={() => setIsMobileNavOpen(true)}
            aria-label="Open navigation menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm font-semibold">{activeTitle}</div>
          <div className="h-10 w-10" />
        </div>

        <div className={cn(
          "fixed inset-0 z-50 md:hidden transition-opacity duration-200",
          isMobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}>
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className={cn(
            "absolute left-0 top-0 h-full w-72 border-r border-border/80 bg-card shadow-panel transition-transform duration-200",
            isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
          )}>
            <div className="flex items-center justify-between px-4 py-4 border-b">
              <span className="text-sm font-semibold">Menu</span>
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/80"
                onClick={() => setIsMobileNavOpen(false)}
                aria-label="Close navigation menu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <SidebarContent
              onNavigate={() => setIsMobileNavOpen(false)}
              onScanQr={() => {
                window.dispatchEvent(new Event('open-qr-scan'));
                setIsMobileNavOpen(false);
              }}
            />
          </div>
        </div>

        <VerifyBanner />
        <div className="flex-1 overflow-visible md:overflow-hidden">
          <div
            key={location.pathname}
            className="dashboard-route-transition min-h-full md:h-full"
          >
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
};

const AppRoutes: React.FC = () => {
  const { currentOwner, isStaff } = useAuth();
  const [createdCards, setCreatedCards] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dataReady, setDataReady] = useState(false);

  const loadData = useCallback(async (ownerId: string) => {
    setDataReady(false);
    const [storedCampaigns, storedCustomers] = await Promise.all([
      fetchCampaigns(ownerId),
      fetchCustomersWithCards(ownerId),
    ]);
    setCreatedCards(storedCampaigns.map(fromStoredTemplate));
    setCustomers(storedCustomers);
    setDataReady(true);
  }, []);

  useEffect(() => {
    if (!currentOwner) {
      setCreatedCards([]);
      setCustomers([]);
      setDataReady(true);
      return;
    }
    void loadData(currentOwner.id);
  }, [currentOwner?.id, loadData]);

  const refreshData = useCallback(async () => {
    if (currentOwner) {
      await loadData(currentOwner.id);
    }
  }, [currentOwner, loadData]);

  const handleSaveCard = async (template: Template) => {
    if (!currentOwner) {
      throw new Error('No active owner account found.');
    }
    const isNew = !createdCards.find(c => c.id === template.id);
    const saved = isNew
      ? { ...template, id: `custom-${Date.now()}`, isEnabled: template.isEnabled ?? true }
      : { ...template, isEnabled: template.isEnabled ?? true };
    const stored = toStoredTemplate(saved);
    const result = await upsertCampaign(stored, currentOwner.id);
    if (!result.ok) {
      throw new Error(result.error ?? 'Failed to save the campaign.');
    }

    if (isNew) {
      setCreatedCards(prev => [...prev, saved]);
    } else {
      setCreatedCards(prev => prev.map(c => c.id === saved.id ? saved : c));
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    const result = await dbDeleteCampaign(cardId);
    if (!result.ok) {
      throw new Error(result.error ?? 'Failed to delete the campaign.');
    }
    setCreatedCards(prev => prev.filter(c => c.id !== cardId));
  };

  const handleToggleCampaignEnabled = async (cardId: string, isEnabled: boolean) => {
    if (!currentOwner) {
      throw new Error('No active owner account found.');
    }
    const result = await setCampaignEnabled(cardId, currentOwner.id, isEnabled);
    if (!result.ok) {
      throw new Error(result.error ?? 'Failed to update campaign status.');
    }
    setCreatedCards(prev => prev.map(card => (card.id === cardId ? { ...card, isEnabled } : card)));
  };

  return (
    <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/:slug/staff" element={withSuspense(<StaffLoginPage />)} />
        <Route path="/:slug/scan/:uniqueId" element={<StaffScanEntryWrapper />} />
        <Route path="/:slug/join/:campaignId" element={withSuspense(<PublicCampaignSignupPage />)} />
        <Route path="/:slug/:uniqueId" element={withSuspense(<PublicCardPage />)} />
        {DevCardsPage && <Route path="/dev/cards" element={withSuspense(<DevCardsPage />)} />}
        <Route path="/login" element={withSuspense(<LoginPage />)} />
        <Route path="/forgot-password" element={withSuspense(<ForgotPasswordPage />)} />

        {/* Authenticated Routes */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireRole allowed={["owner", "admin"]} />}>
            <Route path="/active/:cardId" element={<ActiveCardWrapper templates={createdCards} />} />
            <Route path="/preview/:templateId" element={<PreviewWrapper />} />
            <Route path="/editor/:id" element={<EditorWrapper onSave={handleSaveCard} templates={createdCards} />} />
          </Route>

          <Route element={<DashboardLayout />}>
            <Route element={<RequireRole allowed={["owner", "admin"]} />}>
            <Route path="/dashboard" element={
                withSuspense(<DashboardPage campaigns={createdCards} customers={customers} />)
              } />
              <Route path="/campaigns" element={
                withSuspense(
                  <MyCards
                    cards={createdCards}
                    onDeleteCard={handleDeleteCard}
                    onToggleCampaignEnabled={handleToggleCampaignEnabled}
                  />
                )
              } />
              <Route path="/gallery" element={withSuspense(<TemplatesGallery />)} />
              <Route path="/analytics" element={withSuspense(<AnalyticsPage customers={customers} campaigns={createdCards} />)} />
              <Route path="/transactions" element={withSuspense(<TransactionsPage customers={customers} />)} />
              <Route path="/settings" element={withSuspense(<SettingsPage />)} />
            </Route>

            <Route element={<RequireRole allowed={["owner", "admin", "staff"]} />}>
              <Route path="/issued-cards" element={
                withSuspense(
                  <IssuedCardsPage
                    customers={customers}
                    campaigns={createdCards}
                    setCustomers={setCustomers}
                    refreshData={refreshData}
                    dataReady={dataReady}
                  />
                )
              } />
              <Route path="/customers" element={
                withSuspense(
                  <CustomerDirectory
                    customers={customers}
                    setCustomers={setCustomers}
                    readOnly={isStaff}
                    refreshData={refreshData}
                  />
                )
              } />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <TitleManager />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
