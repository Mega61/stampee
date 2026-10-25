import React from 'react';
import { LayoutDashboard, Users, CreditCard, Settings, LogOut, Wallet, History, QrCode, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

interface SidebarProps {
  className?: string;
  onScanQr?: () => void;
}

interface SidebarContentProps {
  onNavigate?: () => void;
  onScanQr?: () => void;
}

export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner'] },
  { path: '/campaigns', label: 'Campaigns', icon: CreditCard, roles: ['owner'] },
  { path: '/issued-cards', label: 'Issued Cards', icon: Wallet, roles: ['owner', 'staff'] },
  { path: '/transactions', label: 'Transactions', icon: History, roles: ['owner'] },
  { path: '/customers', label: 'Customers', icon: Users, roles: ['owner', 'staff'] },
  { path: '/analytics', label: 'Analytics', icon: Sparkles, roles: ['owner'] },
  { path: '/settings', label: 'Settings', icon: Settings, roles: ['owner'] },
];

export const SidebarContent: React.FC<SidebarContentProps> = ({ onNavigate, onScanQr }) => {
  const navigate = useNavigate();
  const { currentUser, currentOwner, isStaff, logout } = useAuth();

  return (
    <div className="flex h-full flex-col py-8">
      <div className="px-3 py-2">
        <div className="mb-6 px-4 flex items-center gap-3">
          <Link to="/" className="inline-flex items-center" onClick={onNavigate}>
            <img
              src="/stampee.svg"
              alt="Logo"
              className="h-12 w-auto"
            />
          </Link>
        </div>
        <div className="space-y-2">
          {NAV_ITEMS.filter((item) => item.roles.includes(isStaff ? 'staff' : 'owner')).map((item) => (
            <NavLink to={item.path} key={item.path} onClick={onNavigate}>
              {({ isActive }) => (
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                >
                  <item.icon size={20} />
                  {item.label}
                </Button>
              )}
            </NavLink>
          ))}
          {isStaff && (
            <Button
              variant="default"
              className="w-full justify-start gap-2 mt-2"
              onClick={() => {
                onScanQr?.();
                onNavigate?.();
              }}
            >
              <QrCode size={20} />
              Scan QR Code
            </Button>
          )}
        </div>
      </div>
      <div className="mt-auto px-4 pt-6 space-y-3">
         {currentUser && (
          <div className="rounded-lg border border-border/80 bg-card px-3 py-3 text-xs text-muted-foreground shadow-subtle">
              <div className="font-semibold text-foreground">{currentUser.businessName}</div>
              <div className="font-mono">@{currentOwner?.slug ?? "staff"}</div>
              {isStaff && <div className="text-[10px] uppercase tracking-widest mt-1">Staff Access</div>}
          </div>
         )}
         <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
         >
            <LogOut size={20} />
            Log Out
         </Button>
         <div className="px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            v0.5
         </div>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ className, onScanQr }) => {
  return (
    <div className={cn("hidden h-screen w-72 border-r border-border/80 bg-card md:block", className)}>
      <SidebarContent onScanQr={onScanQr} />
    </div>
  );
};
