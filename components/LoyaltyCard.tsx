import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { BackgroundDoodles } from './BackgroundDoodles';
import { StampSlot } from './StampSlot';
import { RewardModal } from './RewardModal';
import { QrCodeDisplay } from './ui/qr-code-display';
import { generateReward } from '../services/rewardService';
import { Template, Transaction } from '../types';
import { cn, resolveHexAndOpacity, hexToRgba } from '../lib/utils';
import { QrCode, History, Gift, Plus, X, Minus, CreditCard, Globe } from 'lucide-react';
import { siFacebook, siInstagram, siTiktok, siX, siYoutube } from 'simple-icons/icons';

const LottiePlayer = lazy(() => import('lottie-react'));

interface LoyaltyCardProps {
  template: Template;
  mode: 'preview' | 'active' | 'public';
  readOnly?: boolean;
  currentStamps?: number;
  onBack?: () => void;
  onCreate?: () => void;
  className?: string;
  customerName?: string; // For public view
  cardId?: string; // For public view
  qrValue?: string;
  sizeVariant?: 'default' | 'compact';
  history?: Transaction[];
  isRedeemed?: boolean;
  onStampAddTap?: () => void;
  onStampRemoveTap?: () => void;
}

export const LoyaltyCard: React.FC<LoyaltyCardProps> = ({ 
    template, 
    mode, 
    readOnly = false,
    currentStamps,
    onBack, 
    onCreate, 
    className = "",
    customerName,
    cardId,
    qrValue,
    sizeVariant = 'default',
    history = [],
    isRedeemed = false,
    onStampAddTap,
    onStampRemoveTap
}) => {
  const [stamps, setStamps] = useState<number>(0);
  const [showReward, setShowReward] = useState<boolean>(false);
  const [loadingReward, setLoadingReward] = useState<boolean>(false);
  const [rewardData, setRewardData] = useState<{ code: string; message: string } | null>(null);
  const [giftAnimation, setGiftAnimation] = useState<object | null>(null);
  
  // Navigation State
  const [currentSlide, setCurrentSlide] = useState<0 | 1>(0);
  const [historyUnlocked, setHistoryUnlocked] = useState(false);
  
  // Refs for scroll handling
  const lastScrollTime = useRef<number>(0);
  const slide2Ref = useRef<HTMLDivElement>(null);

  // Sync with prop if provided
  useEffect(() => {
    if (currentStamps !== undefined) {
        setStamps(currentStamps);
    } else {
        // Reset internal state if template changes and no prop provided
        setStamps(0);
    }
    setShowReward(false);
    setRewardData(null);
    setCurrentSlide(0);
    setHistoryUnlocked(false);
  }, [template.id, template.totalStamps, currentStamps]);

  const { colors, icon: Icon, totalStamps, rewardName, showLogo } = template;

  const orderedSocial = [
    'tiktok',
    'youtube',
    'x',
    'instagram',
    'facebook',
    'website'
  ] as const;

  const orderedEntries = orderedSocial
    .map((key) => [key, template.social?.[key]] as const)
    .filter(([, value]) => !!value) as Array<[string, string]>;

  const normalizeSocialUrl = (platform: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
    switch (platform) {
      case 'instagram':
        return `https://instagram.com/${handle}`;
      case 'facebook':
        return `https://facebook.com/${handle}`;
      case 'tiktok':
        return `https://tiktok.com/@${handle}`;
      case 'x':
        return `https://x.com/${handle}`;
      case 'youtube':
        return `https://youtube.com/@${handle}`;
      case 'website':
        return `https://${handle}`;
      default:
        return trimmed;
    }
  };

  const SimpleIcon = ({ icon, ...props }: React.SVGProps<SVGSVGElement> & { icon: { path: string; viewBox?: string } }) => (
    <svg viewBox={icon.viewBox || "0 0 24 24"} aria-hidden="true" {...props}>
      <path fill="currentColor" d={icon.path} />
    </svg>
  );

  const getSocialIcon = (platform: string) => {
    switch (platform) {
      case 'instagram':
        return (props: React.SVGProps<SVGSVGElement>) => <SimpleIcon icon={siInstagram} {...props} />;
      case 'facebook':
        return (props: React.SVGProps<SVGSVGElement>) => <SimpleIcon icon={siFacebook} {...props} />;
      case 'tiktok':
        return (props: React.SVGProps<SVGSVGElement>) => <SimpleIcon icon={siTiktok} {...props} />;
      case 'x':
        return (props: React.SVGProps<SVGSVGElement>) => <SimpleIcon icon={siX} {...props} />;
      case 'youtube':
        return (props: React.SVGProps<SVGSVGElement>) => <SimpleIcon icon={siYoutube} {...props} />;
      case 'website':
        return Globe;
      default:
        return Globe;
    }
  };

  const bgHex = colors.background || '#ffffff';
  const bgIntensity = template.backgroundOpacity ?? 100;
  const overlayOpacity = bgIntensity / 100;

  const isHighDensity = totalStamps > 12;
  const isCompleted = stamps >= totalStamps;
  const shouldShowRewardModal = mode !== 'preview';

  const textColor = resolveHexAndOpacity(colors.text, '#111111');
  const mutedColor = resolveHexAndOpacity(colors.muted, '#666666');
  const stampActiveColor = resolveHexAndOpacity(colors.stampActive, '#111111');
  const stampInactiveColor = resolveHexAndOpacity(colors.stampInactive, '#dddddd');
  const iconActiveColor = resolveHexAndOpacity(colors.iconActive, '#111111');
  const iconInactiveColor = resolveHexAndOpacity(colors.iconInactive, '#888888');

  const isMobileCompleted = isCompleted && mode === 'public';

  useEffect(() => {
    if (!(isCompleted && !isRedeemed)) return;

    let cancelled = false;
    void import('../Gift Box Orange.json').then((module) => {
      if (!cancelled) {
        setGiftAnimation(module.default);
      }
    }).catch(() => {
      if (!cancelled) {
        setGiftAnimation(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isCompleted, isRedeemed]);

  const stampSizing = (() => {
    if (sizeVariant === 'compact') {
      return totalStamps >= 13
        ? { sizeClassName: "w-12 h-12 sm:w-14 sm:h-14", iconSize: 22 }
        : totalStamps >= 9
          ? { sizeClassName: "w-14 h-14 sm:w-16 sm:h-16", iconSize: 26 }
          : { sizeClassName: "w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem]", iconSize: 32 };
    }
    if (isMobileCompleted) {
      return totalStamps >= 13
        ? { sizeClassName: "w-12 h-12 sm:w-16 sm:h-16", iconSize: 22 }
        : totalStamps >= 9
          ? { sizeClassName: "w-14 h-14 sm:w-[4.5rem] sm:h-[4.5rem]", iconSize: 26 }
          : { sizeClassName: "w-16 h-16 sm:w-20 sm:h-20", iconSize: 30 };
    }
    return totalStamps >= 13
      ? { sizeClassName: "w-14 h-14 sm:w-16 sm:h-16", iconSize: 26 }
      : totalStamps >= 9
        ? { sizeClassName: "w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem]", iconSize: 30 }
        : { sizeClassName: "w-20 h-20 sm:w-20 sm:h-20", iconSize: 38 };
  })();

  const handleStampClick = (index: number) => {
    if (readOnly && !onStampAddTap && !onStampRemoveTap) return;

    if (index === stamps) {
      if (readOnly && onStampAddTap) {
        onStampAddTap();
        return;
      }
      const newCount = stamps + 1;
      setStamps(newCount);
      if (newCount === totalStamps && shouldShowRewardModal) {
        triggerReward();
      }
    } else if (index < stamps) {
      if (readOnly && onStampRemoveTap) {
        onStampRemoveTap();
        return;
      }
      setStamps(index); 
      setRewardData(null); 
    }
  };

  const triggerReward = async () => {
    setShowReward(true);
    setLoadingReward(true);
    try {
      const data = await generateReward();
      setRewardData(data);
    } catch (e) {
      console.error(e);
      setRewardData({ code: "ERROR", message: "No se pudo generar la recompensa." });
    } finally {
      setLoadingReward(false);
    }
  };

  useEffect(() => {
    const shouldAutoShowReward = mode === 'public' || (mode === 'active' && readOnly);
    if (!shouldAutoShowReward) return;
    if (isRedeemed) {
      setShowReward(false);
      return;
    }
    if (isCompleted) {
      setShowReward(true);
      setLoadingReward(false);
      return;
    }
    setShowReward(false);
  }, [isCompleted, isRedeemed, mode, readOnly]);

  const resetCard = () => {
    if (readOnly) {
        setShowReward(false);
        return;
    }
    setStamps(0);
    setShowReward(false);
    setRewardData(null);
  };

  // --- MOUSE WHEEL HANDLER ---
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!historyUnlocked) return;
    const now = Date.now();
    // Cooldown to prevent rapid firing
    if (now - lastScrollTime.current < 1200) return;

    // SCROLL DOWN -> Go to Page 2
    if (e.deltaY > 50 && currentSlide === 0) {
      setCurrentSlide(1);
      lastScrollTime.current = now;
    } 
    // SCROLL UP -> Go to Page 1
    else if (e.deltaY < -50 && currentSlide === 1) {
      // Check if Slide 2 is scrolled to top
      if (slide2Ref.current) {
         if (slide2Ref.current.scrollTop <= 0) {
            setCurrentSlide(0);
            lastScrollTime.current = now;
         }
      } else {
        setCurrentSlide(0);
        lastScrollTime.current = now;
      }
    }
  };

  const getTransactionIcon = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return Gift;
          case 'stamp_remove': return Minus;
          case 'issued': return CreditCard;
          default: return Plus;
      }
  };

  const getTransactionColor = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return 'bg-purple-50 text-purple-600';
          case 'stamp_remove': return 'bg-red-50 text-red-600';
          case 'issued': return 'bg-blue-50 text-blue-600';
          default: return 'bg-gray-50 text-gray-600';
      }
  };

  return (
    <div 
      className={`relative w-full h-full overflow-hidden font-sans select-none ${className}`}
      style={{ backgroundColor: bgHex }}
      onWheel={handleWheel}
    >
      {/* --- STATIC BACKGROUND LAYERS (Shared across slides) --- */}
      
      {/* 1. Background Image Layer */}
      {template.backgroundImage && (
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-1000"
          style={{ 
            backgroundImage: `url(${template.backgroundImage})`,
            transform: currentSlide === 1 ? 'scale(1.1)' : 'scale(1)' // Subtle zoom on background change
          }}
        />
      )}

      {/* 2. Color Overlay Layer */}
      <div 
        className="absolute inset-0 z-0 transition-opacity duration-300"
        style={{ 
          backgroundColor: bgHex,
          opacity: template.backgroundImage ? overlayOpacity : 1 
        }}
      />

      {/* Doodles */}
      {template.id === 'cookie-classic' && !template.backgroundImage && <BackgroundDoodles />}
      
      {/* --- PREVIEW MODE HEADER --- */}
      {mode === 'preview' && onBack && (
         <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-50 bg-black/5 backdrop-blur-sm">
           <button onClick={onBack} className="text-sm font-semibold px-4 py-2 bg-white/50 rounded-full hover:bg-white/80 transition-all">
             ← Templates
           </button>
           <span className="text-xs uppercase tracking-widest opacity-50 font-bold">Preview Mode</span>
         </div>
      )}


      {/* --- SLIDING RAIL CONTAINER --- */}
      {/* Custom cubic-bezier for a "snap" feel, duration 1000ms */}
      <div 
        className="w-full h-[200%] transition-transform duration-1000 ease-[cubic-bezier(0.19,1,0.22,1)] will-change-transform"
        style={{ transform: `translateY(-${currentSlide * 50}%)` }}
      >
          
          {/* --- SLIDE 1: FRONT (Stamps) --- */}
          <div className="w-full h-[50%] relative flex flex-col items-center justify-center p-6">
            
            {/* NEW: Top Header (QR Button Only) */}
            <div className={cn(
                "absolute top-6 left-6 right-6 flex justify-end items-center z-30 transition-all duration-500",
                currentSlide === 0 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
            )}>
                 {/* Right: QR Trigger */}
                 <button 
                    onClick={() => {
                      setHistoryUnlocked(true);
                      setCurrentSlide(1);
                    }}
                    className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center border shadow-sm bg-white/20 backdrop-blur-md border-white/20",
                        "transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                    )}
                    aria-label="Ver detalles de la tarjeta"
                 >
                    <QrCode size={20} className="" style={{ color: textColor.hex }} />
                 </button>
            </div>

            <div className={cn(
                "relative z-10 w-full max-w-lg flex flex-col items-center transition-all duration-1000 delay-100 ease-out",
                mode === 'preview' ? 'scale-90' : 'scale-100',
                currentSlide === 0 
                  ? "opacity-100 translate-y-0" 
                  : "opacity-0 -translate-y-12 scale-95" 
            )}>
              
              {/* Floating Icon Header (Toggleable) */}
              {(showLogo !== false) && (
                <div className="mb-6 animate-bounce-short">
                  <div 
                    className={`
                      rounded-full shadow-lg ring-4 ring-white/20 
                      relative flex items-center justify-center
                      w-24 h-24
                      ${template.logoImage ? 'overflow-hidden p-0' : 'p-5'}
                    `}
                    style={{ backgroundColor: stampInactiveColor.hex }}
                  >
                    {template.logoImage ? (
                      <img 
                        src={template.logoImage} 
                        alt="Logo de la marca"
                        className="w-full h-full object-cover" 
                      />
                    ) : (
                      <Icon size={48} className="" style={{ color: iconActiveColor.hex }} />
                    )}
                  </div>
                </div>
              )}

              {/* Text Content */}
              <div className={cn(
                "text-center mb-14 space-y-2",
                sizeVariant === 'compact' && "mb-10",
                isMobileCompleted && "mb-8"
              )}>
                <h1
                  className={cn(
                    template.titleSize || 'text-4xl md:text-5xl',
                    "font-extrabold tracking-tight uppercase break-words max-w-full drop-shadow-sm",
                    sizeVariant === 'compact' && "text-3xl md:text-4xl",
                    isMobileCompleted && "text-3xl"
                  )}
                  style={{ color: textColor.hex }}
                >
                  {template.name}
                </h1>
                {/* Subtitle: always the owner-editable tagline (with a count
                    fallback) so the customer-facing card matches what's shown
                    in the editor preview. `description` is a preset-only field
                    the editor never exposes, so it must not drive display. */}
                <p
                  className={cn(
                    "font-medium text-sm md:text-base tracking-wide opacity-90 drop-shadow-sm",
                    sizeVariant === 'compact' && "text-xs md:text-sm",
                    isMobileCompleted && "text-xs"
                  )}
                  style={{ color: hexToRgba(mutedColor.hex, mutedColor.opacity) }}
                >
                  {template.tagline ? template.tagline : `Reúne ${totalStamps} sellos y reclama tu ${rewardName}`}
                </p>
              </div>

              {/* Stamps Grid */}
              <div className={cn(
                  "relative grid grid-cols-4 justify-items-center max-w-sm transition-all",
                  isCompleted ? "mb-6" : "mb-12",
                  isHighDensity ? "gap-2" : "gap-4",
                  readOnly && !onStampAddTap && !onStampRemoveTap && "pointer-events-none" // Disable interaction in read-only unless tap callbacks are provided
              )}>
                {Array.from({ length: totalStamps }).map((_, index) => (
                  <StampSlot 
                    key={index}
                    index={index}
                    active={index < stamps}
                    onClick={() => handleStampClick(index)}
                    icon={Icon}
                    colors={colors}
                    sizeClassName={stampSizing.sizeClassName}
                    iconSize={stampSizing.iconSize}
                    activeBg={stampActiveColor.hex}
                    inactiveBg={stampInactiveColor.hex}
                    activeIcon={iconActiveColor.hex}
                    inactiveIcon={iconInactiveColor.hex}
                    inactiveBorder={hexToRgba(iconInactiveColor.hex, 0.5)}
                  />
                ))}

                {isCompleted && !isRedeemed && !showReward && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                    <div className="w-[80vw] h-[80vw] max-w-[520px] max-h-[520px] md:w-[520px] md:h-[520px]">
                      {giftAnimation && (
                        <Suspense fallback={null}>
                          <LottiePlayer animationData={giftAnimation} loop={true} />
                        </Suspense>
                      )}
                    </div>
                  </div>
                )}

              </div>

              {/* Congratulations Message or Reward Label */}
              {isCompleted && !isRedeemed && shouldShowRewardModal ? (
                 <div className="mt-3 flex flex-col items-center text-center">
                   <h3 className={cn("text-lg md:text-2xl font-bold text-gray-900 mt-1", isMobileCompleted && "text-base")}>
                     🎉 ¡Felicitaciones! 🎉
                   </h3>
                   <p className={cn("text-base md:text-lg text-gray-600 leading-snug", isMobileCompleted && "text-sm")}>
                      ¡Tu próximo <strong>{rewardName}</strong> es gratis! Muéstralo al personal.
                   </p>
                 </div>
              ) : (
                  <div
                    className={cn(
                      "mt-4 font-semibold text-lg opacity-90 drop-shadow-sm",
                      sizeVariant === 'compact' && "text-base"
                    )}
                    style={{ color: textColor.hex }}
                  >
                    <p>Recompensa: {rewardName}</p>
                  </div>
              )}

            </div>

            {orderedEntries.length > 0 && (
              <div className="mt-6 inline-flex items-center justify-center gap-4">
                {orderedEntries.map(([platform, value]) => {
                  const IconEl = getSocialIcon(platform);
                  const href = normalizeSocialUrl(platform, value as string);
                  const label = `${platform}: ${value}`;
                  return (
                    <a
                      key={platform}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={label}
                      title={label}
                        className="w-8 h-8 flex items-center justify-center transition-opacity hover:opacity-80"
                        style={{ color: textColor.hex }}
                      >
                      <IconEl size={20} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* --- SLIDE 2: BACK (Details & QR) - MINIMALIST WHITE --- */}
          {historyUnlocked && (
            <div 
              ref={slide2Ref}
              className="w-full h-[50%] relative flex flex-col items-center bg-white text-gray-900 overflow-y-auto no-scrollbar"
            >
              {/* Minimalist Header for Slide 2 */}
              <div className="w-full flex justify-between items-center p-6 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur-sm z-50">
                   <div className="flex items-center gap-3">
                       <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                           <Icon size={16} className="text-gray-900"/>
                       </div>
                       <span className="font-bold text-sm tracking-wide uppercase text-gray-500">Historial</span>
                   </div>
                   <button 
                     onClick={() => setCurrentSlide(0)} 
                     className="p-2 -mr-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-900"
                   >
                       <X size={24} />
                   </button>
              </div>

              {/* Inner Wrapper */}
              <div className={cn(
                  "relative z-10 w-full max-w-sm flex flex-col items-center gap-8 py-8 px-6",
                  mode === 'preview' ? 'scale-90 origin-top' : 'scale-100'
              )}>
                
                {/* 1. Big QR Code Section */}
                <div className={cn(
                    "flex flex-col items-center gap-4 w-full transition-all duration-1000 ease-out",
                    currentSlide === 1 ? "opacity-100 translate-y-0 delay-200" : "opacity-0 translate-y-8"
                )}>
                    <div className="relative p-2 rounded-xl border-2 border-gray-100">
                        {qrValue ? (
                          <QrCodeDisplay value={qrValue} label="Código QR de la tarjeta" className="h-[220px] w-[220px] rounded-lg" />
                        ) : (
                          <>
                            <QrCode size={220} className="text-gray-900" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-white p-2 rounded-full shadow-sm border border-gray-100">
                                    <Icon size={40} className="text-gray-900" />
                                </div>
                            </div>
                          </>
                        )}
                    </div>
                    {(customerName || cardId) && (
                      <div className="text-center space-y-1">
                        {customerName && (
                          <div className="text-sm text-gray-700">
                            Emitida a <span className="font-semibold">{customerName}</span>
                          </div>
                        )}
                        {cardId && (
                          <div className="text-xs text-gray-400 font-mono">
                            ID de tarjeta: {cardId}
                          </div>
                        )}
                      </div>
                    )}
                </div>

                {/* 2. Transaction History - REAL DATA */}
                <div className={cn(
                    "w-full flex flex-col transition-all duration-1000 ease-out",
                    currentSlide === 1 ? "opacity-100 translate-y-0 delay-500" : "opacity-0 translate-y-16"
                )}>
                    <div className="flex items-center gap-2 mb-4">
                        <History size={16} className="text-gray-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Registro de actividad</span>
                    </div>
                    
                    <div className="w-full">
                         <div className="w-full p-0 space-y-4">
                            {history.length === 0 ? (
                                <p className="text-center text-gray-400 text-sm py-4 italic">Aún no hay actividad.</p>
                            ) : (
                                history.map((tx) => {
                                    const TxIcon = getTransactionIcon(tx.type);
                                    const txColor = getTransactionColor(tx.type);
                                    
                                    return (
                                        <div 
                                          key={tx.id} 
                                          className="flex items-start justify-between group"
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className={cn(
                                                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                                                    txColor
                                                )}>
                                                    <TxIcon size={16} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-semibold text-gray-900">{tx.title}</span>
                                                    <span className="text-xs text-gray-400">{tx.date}</span>
                                                    {tx.remarks && (
                                                        <span className="text-xs text-gray-500 mt-1 italic">"{tx.remarks}"</span>
                                                    )}
                                                </div>
                                            </div>
                                            {tx.amount !== 0 && (
                                                <div className={cn(
                                                    "text-sm font-bold",
                                                    tx.amount > 0 ? 'text-gray-900' : 'text-red-500'
                                                )}>
                                                    {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

              </div>
            </div>
          )}

      </div>

      {/* Action Bar for Preview (Bottom Fixed) */}
      {mode === 'preview' && onCreate && (
        <div className={cn(
            "absolute bottom-8 left-0 right-0 px-6 flex justify-center z-50 transition-all duration-500",
            currentSlide === 0 ? "opacity-100 translate-y-0 delay-300" : "opacity-0 translate-y-10 pointer-events-none"
        )}>
           <button 
             onClick={onCreate}
             className="shadow-2xl hover:scale-105 active:scale-95 transition-all bg-black text-white px-8 py-4 rounded-full font-bold text-lg flex items-center gap-2"
           >
             Crear <Icon size={20} />
           </button>
        </div>
      )}

      {shouldShowRewardModal && (
        // Public cards and read-only active cards (issued-cards kiosk) should not have a close button.
        <RewardModal 
          isOpen={showReward} 
          loading={loadingReward} 
          reward={rewardData} 
          rewardName={rewardName}
          businessName={template.name}
          showCloseButton={!(mode === 'public' || (mode === 'active' && readOnly))}
          scope={mode === 'active' && readOnly ? 'container' : 'fullscreen'}
          onClose={resetCard}
          colors={colors}
        />
      )}
    </div>
  );
};
