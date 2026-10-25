import React, { useState, useRef, useEffect } from 'react';
import { Template } from '../types';
import { Button } from './ui/button';
import { Gift, PlusCircle, Edit2, Trash2, CreditCard, Play, QrCode, Power, Copy, ExternalLink } from 'lucide-react';
import { LoyaltyCard } from './LoyaltyCard';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { QrCodeDisplay } from './ui/qr-code-display';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { buildCampaignSignupUrl } from '../lib/links';
import { useAuth } from './AuthProvider';

interface MyCardsProps {
  cards: Template[];
  onDeleteCard: (cardId: string) => Promise<void>;
  onToggleCampaignEnabled: (cardId: string, isEnabled: boolean) => Promise<void>;
}

interface ResponsiveCardItemProps {
  card: Template;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onShowSignupQr: (card: Template) => void;
  onToggleEnabled: (id: string, isEnabled: boolean) => void;
  toggleBusy: boolean;
}

// Internal component for responsive card scaling
const ResponsiveCardItem: React.FC<ResponsiveCardItemProps> = ({ 
    card, 
    onEdit, 
    onDelete,
    onShowSignupQr,
    onToggleEnabled,
    toggleBusy,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const navigate = useNavigate();

    // Matching dimensions from Customize Live Preview (max-w-[380px] h-[750px])
    const BASE_WIDTH = 380;
    const BASE_HEIGHT = 750;

    useEffect(() => {
        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                 const width = entries[0].contentRect.width;
                 setScale(width / BASE_WIDTH);
            }
        });
        
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        
        return () => observer.disconnect();
    }, []);

    const openActiveView = () => navigate(`/active/${card.id}`);

    return (
        <div className="group flex flex-col items-center gap-6 w-full max-w-[380px] mx-auto">
             <div 
                ref={containerRef}
                // Aspect ratio 380/750 matches the Customize preview shape
                className="relative w-full aspect-[380/750] rounded-[2.5rem] shadow-2xl border border-gray-100 bg-white group-hover:scale-[1.02] transition-all duration-300 overflow-hidden ring-1 ring-black/5 cursor-pointer"
                onClick={openActiveView}
            >
                <div 
                    className="origin-top-left absolute top-0 left-0 will-change-transform"
                    style={{ 
                        width: `${BASE_WIDTH}px`, 
                        height: `${BASE_HEIGHT}px`, 
                        transform: `scale(${scale})` 
                    }}
                >
                    <LoyaltyCard 
                        template={card} 
                        mode="active" 
                        className="w-full h-full pointer-events-none" 
                    />
                </div>
                 
                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none z-10" />
            </div>

            {/* Actions & Labels */}
            <div className="text-center space-y-4 w-full px-2">
                <div className="space-y-1 cursor-pointer" onClick={openActiveView}>
                    <div className="flex items-center justify-center gap-2">
                      <h3 className="font-bold text-2xl text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
                        {card.name}
                      </h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${card.isEnabled === false ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {card.isEnabled === false ? 'Disabled' : 'Enabled'}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate" title={card.rewardName}>
                       Reward: {card.rewardName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                       {card.totalStamps} stamps
                       {(card.bonusStamps ?? 0) > 0 && (
                         <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                           <Gift size={11} /> {card.bonusStamps} gifted · {card.totalStamps - (card.bonusStamps ?? 0)} visits
                         </span>
                       )}
                    </p>
                </div>
                
                <div className="flex items-center justify-center gap-3">
                    <Button 
                        size="sm" 
                        className="rounded-full px-6 gap-2 shadow-sm font-semibold" 
                        onClick={openActiveView}
                    >
                        <Play size={16} fill="currentColor" /> Open
                    </Button>
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full gap-1.5"
                            onClick={() => onShowSignupQr(card)}
                            title="Show signup QR"
                        >
                            <QrCode size={14} /> QR
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full gap-1.5"
                            onClick={() => onToggleEnabled(card.id, card.isEnabled === false)}
                            disabled={toggleBusy}
                            title={card.isEnabled === false ? 'Enable campaign' : 'Disable campaign'}
                        >
                            <Power size={14} />
                            {card.isEnabled === false ? 'Enable' : 'Disable'}
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 rounded-full hover:bg-gray-100" 
                            onClick={() => onEdit(card.id)}
                            title="Edit Campaign"
                        >
                            <Edit2 size={18} className="text-muted-foreground" />
                        </Button>
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-9 w-9 rounded-full hover:bg-red-50 hover:text-destructive" 
                            onClick={() => onDelete(card.id)}
                            title="Delete Campaign"
                        >
                            <Trash2 size={18} />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export const MyCards: React.FC<MyCardsProps> = ({
  cards,
  onDeleteCard,
  onToggleCampaignEnabled,
}) => {
  const navigate = useNavigate();
  const { currentOwner } = useAuth();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [qrCard, setQrCard] = useState<Template | null>(null);
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const qrUrl = qrCard && currentOwner?.slug ? buildCampaignSignupUrl(currentOwner.slug, qrCard.id) : "";
  const qrDisplayUrl = qrUrl.length > 42 ? `${qrUrl.slice(0, 42)}...` : qrUrl;

  const confirmDelete = async () => {
    if (deleteId) {
      setDeleteBusy(true);
      setDeleteError("");
      try {
        await onDeleteCard(deleteId);
        setDeleteId(null);
      } catch {
        setDeleteError("Unable to delete this campaign right now. Please try again.");
      } finally {
        setDeleteBusy(false);
      }
    }
  };

  const handleCreateNew = () => {
    navigate('/gallery');
  };
  const handleEdit = (id: string) => navigate(`/editor/${id}`);

  const handleToggleEnabled = async (id: string, isEnabled: boolean) => {
    setDeleteError("");
    setToggleBusyId(id);
    try {
      await onToggleCampaignEnabled(id, isEnabled);
    } catch {
      setDeleteError("Unable to update this campaign status right now. Please try again.");
    } finally {
      setToggleBusyId(null);
    }
  };

  const handleCopyQrUrl = () => {
    if (!qrUrl) return;
    void navigator.clipboard.writeText(qrUrl);
  };

  const handleOpenQrUrl = () => {
    if (!qrUrl) return;
    window.open(qrUrl, '_blank');
  };

  return (
    <div className="p-4 md:p-8 space-y-8 animate-fade-in h-full overflow-y-auto bg-gray-50/50">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b pb-6">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-primary text-primary-foreground rounded-xl shadow-md">
                <CreditCard size={24} />
            </div>
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Campaigns</h1>
                <p className="text-muted-foreground">Manage your active loyalty campaigns.</p>
            </div>
        </div>
        <div className="flex items-center gap-3">
            <Button onClick={handleCreateNew} className="gap-2 rounded-full shadow-sm w-full md:w-auto h-11 text-base">
                <PlusCircle size={20} /> Create New
            </Button>
        </div>
      </header>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[500px] border-2 border-dashed border-gray-200 rounded-[2rem] bg-white/50">
          <div className="bg-white p-6 rounded-full shadow-sm mb-6">
             <PlusCircle size={40} className="text-muted-foreground" />
          </div>
          <h3 className="text-2xl font-bold text-foreground">No campaigns created yet</h3>
          <p className="text-muted-foreground max-w-sm text-center mt-2 mb-8 text-lg">
            Get started by creating your first digital loyalty campaign from our templates.
          </p>
          <Button onClick={handleCreateNew} size="lg" className="rounded-full text-lg px-8 h-14">Create your first campaign</Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-10 pb-12 px-2 md:px-4">
          {cards.map((card) => (
            <ResponsiveCardItem 
                key={card.id} 
                card={card} 
                onEdit={handleEdit} 
                onDelete={(id) => setDeleteId(id)}
                onShowSignupQr={setQrCard}
                onToggleEnabled={handleToggleEnabled}
                toggleBusy={toggleBusyId === card.id}
            />
          ))}
        </div>
      )}

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete <strong>{cards.find(c => c.id === deleteId)?.name}</strong> from your campaigns, but any issued cards will stay active and keep using their saved card snapshot.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrCard} onOpenChange={(open) => !open && setQrCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Campaign Signup QR</DialogTitle>
            <DialogDescription>
              Customers can scan this QR code at reception to join <strong>{qrCard?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qrUrl && (
              <div className="rounded-xl border bg-white p-3">
                <QrCodeDisplay value={qrUrl} className="h-56 w-56" label="Campaign signup QR code" />
              </div>
            )}
            <div className="w-full space-y-2">
              <Label className="text-xs text-muted-foreground">Signup link</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={qrDisplayUrl || qrUrl} className="text-xs font-mono bg-muted/40" />
                <Button type="button" variant="outline" size="icon" onClick={handleCopyQrUrl} title="Copy link">
                  <Copy size={14} />
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={handleOpenQrUrl} title="Open link">
                  <ExternalLink size={14} />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
