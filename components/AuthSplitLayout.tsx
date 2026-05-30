import React from "react";
import {
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  LockKeyhole,
  QrCode,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Ticket,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";

type AuthMode = "login" | "signup" | "staff";

interface AuthSplitLayoutProps {
  title: string;
  subtitle: string;
  badge?: string;
  mode: AuthMode;
  titleClassName?: string;
  children: React.ReactNode;
}

interface ShowcaseCard {
  eyebrow: string;
  title: string;
  copy: string;
  list: string[];
  className: string;
}

interface AccentCard {
  title: string;
  copy: string;
  className: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface ShowcasePill {
  label: string;
  className: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface UtilityCard {
  title: string;
  value: string;
  rows: string[];
  className: string;
}

interface ThemeConfig {
  leftBg: string;
  rightBg: string;
  navLinkLabel: string;
  navLinkTo: string;
  showcaseEyebrow: string;
  showcaseTitle: string;
  showcaseCopy: string;
  showcaseSlug: string;
  card: ShowcaseCard;
  accent: AccentCard;
  utility: UtilityCard;
  pills: ShowcasePill[];
  actions: React.ComponentType<{ className?: string; strokeWidth?: number }>[];
}

const MODE_CONFIG: Record<AuthMode, ThemeConfig> = {
  login: {
    leftBg: "bg-[#f3f0e8]",
    rightBg: "bg-[#c79b2f]",
    navLinkLabel: "",
    navLinkTo: "",
    showcaseEyebrow: "Owner workspace",
    showcaseTitle: "Cards that live in the browser.",
    showcaseCopy: "Keep campaigns, issued cards, and return visits in one place without sending customers to an app store.",
    showcaseSlug: "/stampee",
    card: {
      eyebrow: "Repeat visits",
      title: "Launch, stamp, retain.",
      copy: "Use one branded link to issue loyalty cards and watch activity move in real time.",
      list: ["Campaign controls", "Customer-ready link", "Live loyalty activity"],
      className: "bg-[linear-gradient(180deg,#bc7d2a_0%,#8e5520_100%)] text-white shadow-[0_38px_120px_-60px_rgba(57,29,6,0.65)]",
    },
    accent: {
      title: "Issue in seconds",
      copy: "Cards open in the browser and are ready to stamp right away.",
      className: "bg-[linear-gradient(180deg,#d92de1_0%,#bd21d5_100%)] text-white shadow-[0_26px_90px_-48px_rgba(133,9,151,0.65)]",
      icon: Ticket,
    },
    utility: {
      title: "Campaign view",
      value: "Live",
      rows: ["Offer performance", "Customer re-visits", "Issuance queue"],
      className: "bg-[#edd9bf] text-[#473521] shadow-[0_28px_96px_-52px_rgba(60,31,7,0.48)]",
    },
    pills: [
      { label: "/stampee", className: "bg-[#f4f1ec] text-[#1f1d19]", icon: Sparkles },
      { label: "Owner dashboard", className: "bg-white/88 text-[#3c342a]", icon: WalletCards },
      { label: "Browser card", className: "bg-white/72 text-[#3c342a]", icon: QrCode },
    ],
    actions: [ChartNoAxesCombined, WalletCards, Sparkles],
  },
  signup: {
    leftBg: "bg-[#f2efe8]",
    rightBg: "bg-[#c79b2f]",
    navLinkLabel: "Log in",
    navLinkTo: "/login",
    showcaseEyebrow: "Launch faster",
    showcaseTitle: "Launch digital loyalty in minutes.",
    showcaseCopy: "Claim your branded card link, set up the workspace, and start issuing loyalty cards without printing or app installs.",
    showcaseSlug: "/yourbrand",
    card: {
      eyebrow: "Setup time",
      title: "From signup to card link in one flow.",
      copy: "Create the owner workspace, reserve the public URL, and be ready for customers the same day.",
      list: ["Free to start", "Custom public URL", "No card printing"],
      className: "bg-[linear-gradient(180deg,#c98a39_0%,#9d6325_100%)] text-white shadow-[0_38px_120px_-60px_rgba(57,29,6,0.65)]",
    },
    accent: {
      title: "Custom public URL",
      copy: "Reserve the branded link customers will save and revisit.",
      className: "bg-[linear-gradient(180deg,#d92de1_0%,#bd21d5_100%)] text-white shadow-[0_26px_90px_-48px_rgba(133,9,151,0.65)]",
      icon: QrCode,
    },
    utility: {
      title: "Workspace ready",
      value: "Same day",
      rows: ["Owner setup", "Staff-ready portal", "Live launch status"],
      className: "bg-[#efdbc2] text-[#473521] shadow-[0_28px_96px_-52px_rgba(60,31,7,0.48)]",
    },
    pills: [
      { label: "/yourbrand", className: "bg-[#f4f1ec] text-[#1f1d19]", icon: Sparkles },
      { label: "Free to start", className: "bg-white/88 text-[#3c342a]", icon: ArrowUpRight },
      { label: "No downloads", className: "bg-white/72 text-[#3c342a]", icon: WalletCards },
    ],
    actions: [Sparkles, Building2, ChartNoAxesCombined],
  },
  staff: {
    leftBg: "bg-[#f4eee7]",
    rightBg: "bg-[#b2781f]",
    navLinkLabel: "Acceso propietario",
    navLinkTo: "/login",
    showcaseEyebrow: "Acceso del equipo",
    showcaseTitle: "Acceso de personal rápido y seguro.",
    showcaseCopy: "El personal inicia sesión con correo, PIN e ID del negocio, y pasa directo a emitir tarjetas y al modo kiosco.",
    showcaseSlug: "/negocio/staff",
    card: {
      eyebrow: "Portal del personal",
      title: "Protegido con PIN, ligado al negocio.",
      copy: "Mantén el acceso del personal separado de la configuración del propietario y listo para la fila y el modo kiosco.",
      list: ["Correo + PIN", "Acceso por negocio", "Listo para kiosco"],
      className: "bg-[linear-gradient(180deg,#9c5324_0%,#6d3418_100%)] text-white shadow-[0_38px_120px_-60px_rgba(49,19,4,0.7)]",
    },
    accent: {
      title: "Escanea y emite",
      copy: "Pasa de la fila a la tarjeta del cliente en pocos toques.",
      className: "bg-[linear-gradient(180deg,#2440d1_0%,#13279a_100%)] text-white shadow-[0_26px_90px_-48px_rgba(16,34,123,0.7)]",
      icon: ScanLine,
    },
    utility: {
      title: "Verificación de negocio",
      value: "Verificado",
      rows: ["Acceso con PIN", "Entrega a kiosco", "Inicio por negocio"],
      className: "bg-[#ead6bc] text-[#473521] shadow-[0_28px_96px_-52px_rgba(60,31,7,0.48)]",
    },
    pills: [
      { label: "/negocio/staff", className: "bg-[#f4f1ec] text-[#1f1d19]", icon: LockKeyhole },
      { label: "Acceso con PIN", className: "bg-white/88 text-[#3c342a]", icon: ShieldCheck },
      { label: "Listo para kiosco", className: "bg-white/72 text-[#3c342a]", icon: ScanLine },
    ],
    actions: [ShieldCheck, ScanLine, LockKeyhole],
  },
};

const MobileShowcase: React.FC<{ theme: ThemeConfig }> = ({ theme }) => {
  const AccentIcon = theme.accent.icon;
  const HeroPillIcon = theme.pills[0].icon;

  return (
    <div className="lg:hidden">
      <div className={`relative overflow-hidden rounded-[2rem] ${theme.rightBg} px-4 py-5 text-white shadow-[0_24px_70px_-44px_rgba(0,0,0,0.4)]`}>
        <div className="absolute right-[-2.5rem] top-[-2rem] h-36 w-36 rounded-[2.5rem] border border-white/20 bg-black/10" />
        <div className="absolute left-[-1rem] top-[4.6rem] h-28 w-28 rounded-full bg-white/10 blur-2xl" />

        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">{theme.showcaseEyebrow}</p>
          <h2 className="mt-2 max-w-[12ch] text-[2rem] font-semibold leading-[0.94] tracking-[-0.05em]">
            {theme.showcaseTitle}
          </h2>

          <div className={`mt-5 max-w-[14rem] rounded-[1.75rem] p-4 ${theme.card.className}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/72">{theme.card.eyebrow}</p>
            <p className="mt-3 text-lg font-semibold leading-tight">{theme.card.title}</p>
          </div>

          <div className={`absolute right-0 top-[5.8rem] w-[11.5rem] rounded-[1.7rem] p-4 ${theme.accent.className}`}>
            <AccentIcon className="h-5 w-5" strokeWidth={2} />
            <p className="mt-4 text-sm font-semibold">{theme.accent.title}</p>
          </div>

          <div className={`relative mt-4 inline-flex items-center gap-3 rounded-full px-4 py-3 text-sm font-semibold shadow-lg ${theme.pills[0].className}`}>
            <HeroPillIcon className="h-4 w-4" strokeWidth={2} />
            <span>{theme.showcaseSlug}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const DesktopShowcase: React.FC<{ theme: ThemeConfig }> = ({ theme }) => {
  const AccentIcon = theme.accent.icon;
  const PrimaryPillIcon = theme.pills[0].icon;

  return (
    <aside className={`relative hidden min-h-[100dvh] overflow-hidden lg:flex lg:items-center lg:justify-center ${theme.rightBg}`}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="auth-orbit absolute right-[-9rem] top-[-4rem] h-[22rem] w-[22rem] rounded-[4rem] border border-black/15 bg-black/10" />
        <div className="auth-orbit-delayed absolute right-[10%] top-[10%] h-[15rem] w-[15rem] rounded-full border border-white/12 bg-white/8" />
        <div className="absolute bottom-[-6rem] left-[18%] h-[14rem] w-[14rem] rounded-full bg-white/10 blur-[90px]" />
        <div className="absolute right-[6%] top-[24%] h-[28rem] w-[18rem] rounded-[3rem] bg-black/8 blur-[2px]" />
      </div>

      <div className="relative h-[min(86vh,54rem)] w-full max-w-[52rem]">
        <div className={`auth-float absolute left-[27%] top-[5%] h-[70%] w-[23.5rem] rounded-[3.2rem] p-8 ${theme.card.className}`}>
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-4">
                <div className="rounded-full bg-white/16 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
                  {theme.card.eyebrow}
                </div>
                <ArrowUpRight className="h-6 w-6 text-white/85" strokeWidth={2.2} />
              </div>

              <h2 className="mt-8 max-w-[9ch] text-[3rem] font-semibold leading-[0.94] tracking-[-0.05em]">
                {theme.card.title}
              </h2>
              <p className="mt-5 max-w-[18rem] text-base leading-7 text-white/76">
                {theme.card.copy}
              </p>
            </div>

            <div className="space-y-3">
              {theme.card.list.map((item) => (
                <div key={item} className="rounded-full bg-white/16 px-5 py-3.5 text-sm font-medium text-white/90 backdrop-blur-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`auth-float-delayed absolute left-[4%] top-[18%] w-[19rem] rounded-[2.3rem] p-6 ${theme.accent.className}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1rem] bg-white/16">
              <AccentIcon className="h-6 w-6" strokeWidth={2} />
            </div>
            <span className="rounded-full bg-white/14 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
              Destacado
            </span>
          </div>
          <p className="mt-7 text-[1.8rem] font-semibold leading-[1.02] tracking-tight">{theme.accent.title}</p>
          <p className="mt-3 max-w-[15rem] text-sm leading-6 text-white/78">{theme.accent.copy}</p>
        </div>

        <div className={`auth-float absolute left-[1%] top-[39%] inline-flex items-center gap-4 rounded-full px-6 py-4 text-[1.1rem] font-semibold shadow-[0_20px_50px_-28px_rgba(0,0,0,0.35)] ${theme.pills[0].className}`}>
          <PrimaryPillIcon className="h-5 w-5" strokeWidth={2.2} />
          <span>{theme.showcaseSlug}</span>
        </div>

        <div className="auth-float-delayed absolute bottom-[14%] left-[10%] flex gap-4">
          {theme.actions.map((Icon, index) => (
            <div
              key={index}
              className="flex h-[4.35rem] w-[4.35rem] items-center justify-center rounded-full bg-[#14203b] text-white shadow-[0_26px_64px_-36px_rgba(6,14,31,0.68)]"
            >
              <Icon className="h-7 w-7" strokeWidth={2} />
            </div>
          ))}
        </div>

        <div className={`auth-float-slow absolute bottom-[6%] right-[10%] w-[22rem] rounded-[2.5rem] p-6 ${theme.utility.className}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-[0.65]">{theme.utility.title}</p>
              <p className="mt-3 text-[2rem] font-semibold leading-none">{theme.utility.value}</p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-[1.3rem] bg-white/55 text-[#1f1d19]">
              <ChartNoAxesCombined className="h-7 w-7" strokeWidth={2} />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {theme.utility.rows.map((row) => (
              <div key={row} className="flex items-center justify-between rounded-full bg-white/45 px-4 py-3 text-sm font-medium">
                <span>{row}</span>
                <span className="opacity-[0.45]">{">"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute inset-x-[17%] bottom-[5%] hidden justify-center gap-2 xl:flex">
          {theme.pills.slice(1).map((pill) => {
            const Icon = pill.icon;
            return (
              <div
                key={pill.label}
                className={`auth-float-slow inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold shadow-[0_12px_30px_-18px_rgba(0,0,0,0.3)] ${pill.className}`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{pill.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export const AuthSplitLayout: React.FC<AuthSplitLayoutProps> = ({
  title,
  subtitle,
  badge,
  mode,
  titleClassName,
  children,
}) => {
  const theme = MODE_CONFIG[mode];

  return (
    <div className={`min-h-[100dvh] ${theme.leftBg} text-[#1d1d1f] antialiased`}>
      <style>{`
        @keyframes auth-float-a { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0,-12px,0); } }
        @keyframes auth-float-b { 0%, 100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0,14px,0); } }
        .auth-float { animation: auth-float-a 8.5s ease-in-out infinite; }
        .auth-float-delayed { animation: auth-float-b 10.5s ease-in-out infinite 1.2s; }
        .auth-float-slow { animation: auth-float-a 12s ease-in-out infinite 0.8s; }
        .auth-orbit { animation: auth-float-b 14s ease-in-out infinite; }
        .auth-orbit-delayed { animation: auth-float-a 15.5s ease-in-out infinite 1.8s; }
        @media (prefers-reduced-motion: reduce) {
          .auth-float,
          .auth-float-delayed,
          .auth-float-slow,
          .auth-orbit,
          .auth-orbit-delayed {
            animation: none !important;
          }
        }
      `}</style>

      <div className="grid min-h-[100dvh] grid-cols-1 lg:grid-cols-2">
        <section className={`relative flex min-h-[100dvh] flex-col ${theme.leftBg} px-5 pb-10 pt-5 sm:px-8 sm:pt-7 lg:px-10 lg:pb-12 xl:px-16`}>
          <header className="flex items-center justify-between gap-4">
            <Link to="/login" className="inline-flex items-center">
              <img src="/stampee.svg" alt="Stampee" className="h-10 w-auto sm:h-11" />
            </Link>

            {theme.navLinkLabel && (
              <Link
                to={theme.navLinkTo}
                className="inline-flex items-center rounded-full border border-black/10 bg-white/75 px-4 py-2.5 text-sm font-semibold text-[#1d1d1f] transition-colors hover:bg-white"
              >
                {theme.navLinkLabel}
              </Link>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-[37rem] flex-1 flex-col justify-center py-6 sm:py-8 lg:py-10">
            <MobileShowcase theme={theme} />

            <div className="mt-8 text-center lg:mt-0 lg:text-left">
              {badge && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#736b5e]">
                  {badge}
                </p>
              )}

              <h1
                className={`mt-3 text-[clamp(2.8rem,6.5vw,4.8rem)] font-semibold leading-[0.92] tracking-[-0.06em] text-[#171512] ${titleClassName ?? ""}`}
              >
                {title}
              </h1>

              <p className="mx-auto mt-4 max-w-[34rem] text-base leading-7 text-[#635b4e] sm:text-lg lg:mx-0">
                {subtitle}
              </p>
            </div>

            <div className="mt-8 rounded-[2rem] border border-black/[0.08] bg-white/86 p-4 shadow-[0_18px_50px_-34px_rgba(0,0,0,0.28)] sm:p-6 lg:mt-10 lg:rounded-[2.15rem] lg:p-7">
              {children}
            </div>
          </div>
        </section>

        <DesktopShowcase theme={theme} />
      </div>
    </div>
  );
};
