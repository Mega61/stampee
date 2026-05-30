import React, { useRef, useState } from 'react';
import { Template } from '../types';
import { LoyaltyCard } from './LoyaltyCard';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { ArrowLeft, Check as CheckIcon, Smartphone, Image as ImageIcon, Type, Palette, Grid, X, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ICON_OPTIONS } from '../lib/iconRegistry';
import { useAuth } from './AuthProvider';
import { deleteCampaignAssetByUrl, type CampaignAssetKind, uploadCampaignAsset } from '../lib/storage/campaignAssets';

interface CardEditorProps {
  initialTemplate: Template;
  onSave: (template: Template) => Promise<void>;
}

type PalettePreset = {
  id: string;
  name: string;
  swatches: [string, string, string, string, string, string];
  colors: {
    background: string;
    text: string;
    stampInactive: string;
    iconInactive: string;
    stampActive: string;
    iconActive: string;
    button?: string;
    buttonText?: string;
    muted?: string;
    border?: string;
    cardBackground?: string;
  };
};

const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'slate-mono',
    name: 'Slate',
    swatches: ['#0f172a', '#334155', '#64748b', '#94a3b8', '#e2e8f0', '#f8fafc'],
    colors: {
      background: '#f8fafc',
      text: '#0f172a',
      stampInactive: '#e2e8f0',
      iconInactive: '#64748b',
      stampActive: '#94a3b8',
      iconActive: '#0f172a',
      button: '#334155',
      buttonText: '#ffffff',
      muted: '#64748b',
      border: '#cbd5e1',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'gray-mono',
    name: 'Gray',
    swatches: ['#111827', '#4b5563', '#6b7280', '#9ca3af', '#e5e7eb', '#f9fafb'],
    colors: {
      background: '#f9fafb',
      text: '#111827',
      stampInactive: '#e5e7eb',
      iconInactive: '#6b7280',
      stampActive: '#9ca3af',
      iconActive: '#1f2937',
      button: '#4b5563',
      buttonText: '#ffffff',
      muted: '#6b7280',
      border: '#d1d5db',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'blue-mono',
    name: 'Blue',
    swatches: ['#1e3a8a', '#2563eb', '#3b82f6', '#93c5fd', '#dbeafe', '#eff6ff'],
    colors: {
      background: '#eff6ff',
      text: '#1e3a8a',
      stampInactive: '#dbeafe',
      iconInactive: '#3b82f6',
      stampActive: '#93c5fd',
      iconActive: '#1e40af',
      button: '#2563eb',
      buttonText: '#ffffff',
      muted: '#60a5fa',
      border: '#bfdbfe',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'sky-mono',
    name: 'Sky',
    swatches: ['#0c4a6e', '#0ea5e9', '#38bdf8', '#7dd3fc', '#e0f2fe', '#f0f9ff'],
    colors: {
      background: '#f0f9ff',
      text: '#0c4a6e',
      stampInactive: '#e0f2fe',
      iconInactive: '#0284c7',
      stampActive: '#7dd3fc',
      iconActive: '#075985',
      button: '#0ea5e9',
      buttonText: '#ffffff',
      muted: '#38bdf8',
      border: '#bae6fd',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'cyan-mono',
    name: 'Cyan',
    swatches: ['#164e63', '#06b6d4', '#22d3ee', '#67e8f9', '#cffafe', '#ecfeff'],
    colors: {
      background: '#ecfeff',
      text: '#164e63',
      stampInactive: '#cffafe',
      iconInactive: '#0891b2',
      stampActive: '#67e8f9',
      iconActive: '#155e75',
      button: '#06b6d4',
      buttonText: '#ffffff',
      muted: '#22d3ee',
      border: '#a5f3fc',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'teal-mono',
    name: 'Teal',
    swatches: ['#134e4a', '#14b8a6', '#2dd4bf', '#5eead4', '#ccfbf1', '#f0fdfa'],
    colors: {
      background: '#f0fdfa',
      text: '#134e4a',
      stampInactive: '#ccfbf1',
      iconInactive: '#0f766e',
      stampActive: '#5eead4',
      iconActive: '#115e59',
      button: '#14b8a6',
      buttonText: '#ffffff',
      muted: '#2dd4bf',
      border: '#99f6e4',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'emerald-mono',
    name: 'Emerald',
    swatches: ['#064e3b', '#10b981', '#34d399', '#6ee7b7', '#d1fae5', '#ecfdf5'],
    colors: {
      background: '#ecfdf5',
      text: '#064e3b',
      stampInactive: '#d1fae5',
      iconInactive: '#059669',
      stampActive: '#6ee7b7',
      iconActive: '#065f46',
      button: '#10b981',
      buttonText: '#ffffff',
      muted: '#34d399',
      border: '#a7f3d0',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'green-mono',
    name: 'Green',
    swatches: ['#14532d', '#22c55e', '#4ade80', '#86efac', '#dcfce7', '#f0fdf4'],
    colors: {
      background: '#f0fdf4',
      text: '#14532d',
      stampInactive: '#dcfce7',
      iconInactive: '#16a34a',
      stampActive: '#86efac',
      iconActive: '#166534',
      button: '#22c55e',
      buttonText: '#ffffff',
      muted: '#4ade80',
      border: '#bbf7d0',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'lime-mono',
    name: 'Lime',
    swatches: ['#365314', '#84cc16', '#a3e635', '#bef264', '#ecfccb', '#f7fee7'],
    colors: {
      background: '#f7fee7',
      text: '#365314',
      stampInactive: '#ecfccb',
      iconInactive: '#65a30d',
      stampActive: '#bef264',
      iconActive: '#3f6212',
      button: '#84cc16',
      buttonText: '#1f2937',
      muted: '#a3e635',
      border: '#d9f99d',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'amber-mono',
    name: 'Amber',
    swatches: ['#78350f', '#f59e0b', '#fbbf24', '#fcd34d', '#fef3c7', '#fffbeb'],
    colors: {
      background: '#fffbeb',
      text: '#78350f',
      stampInactive: '#fef3c7',
      iconInactive: '#d97706',
      stampActive: '#fcd34d',
      iconActive: '#92400e',
      button: '#f59e0b',
      buttonText: '#111827',
      muted: '#fbbf24',
      border: '#fde68a',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'orange-mono',
    name: 'Orange',
    swatches: ['#7c2d12', '#f97316', '#fb923c', '#fdba74', '#ffedd5', '#fff7ed'],
    colors: {
      background: '#fff7ed',
      text: '#7c2d12',
      stampInactive: '#ffedd5',
      iconInactive: '#ea580c',
      stampActive: '#fdba74',
      iconActive: '#9a3412',
      button: '#f97316',
      buttonText: '#ffffff',
      muted: '#fb923c',
      border: '#fed7aa',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'red-mono',
    name: 'Red',
    swatches: ['#7f1d1d', '#ef4444', '#f87171', '#fca5a5', '#fee2e2', '#fef2f2'],
    colors: {
      background: '#fef2f2',
      text: '#7f1d1d',
      stampInactive: '#fee2e2',
      iconInactive: '#dc2626',
      stampActive: '#fca5a5',
      iconActive: '#991b1b',
      button: '#ef4444',
      buttonText: '#ffffff',
      muted: '#f87171',
      border: '#fecaca',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'rose-mono',
    name: 'Rose',
    swatches: ['#881337', '#f43f5e', '#fb7185', '#fda4af', '#ffe4e6', '#fff1f2'],
    colors: {
      background: '#fff1f2',
      text: '#881337',
      stampInactive: '#ffe4e6',
      iconInactive: '#e11d48',
      stampActive: '#fda4af',
      iconActive: '#9f1239',
      button: '#f43f5e',
      buttonText: '#ffffff',
      muted: '#fb7185',
      border: '#fecdd3',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'pink-mono',
    name: 'Pink',
    swatches: ['#831843', '#ec4899', '#f472b6', '#f9a8d4', '#fbcfe8', '#fdf2f8'],
    colors: {
      background: '#fdf2f8',
      text: '#831843',
      stampInactive: '#fbcfe8',
      iconInactive: '#db2777',
      stampActive: '#f9a8d4',
      iconActive: '#9d174d',
      button: '#ec4899',
      buttonText: '#ffffff',
      muted: '#f472b6',
      border: '#fbcfe8',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'fuchsia-mono',
    name: 'Fuchsia',
    swatches: ['#701a75', '#d946ef', '#e879f9', '#f0abfc', '#fae8ff', '#fdf4ff'],
    colors: {
      background: '#fdf4ff',
      text: '#701a75',
      stampInactive: '#fae8ff',
      iconInactive: '#c026d3',
      stampActive: '#f0abfc',
      iconActive: '#86198f',
      button: '#d946ef',
      buttonText: '#ffffff',
      muted: '#e879f9',
      border: '#f5d0fe',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'violet-mono',
    name: 'Violet',
    swatches: ['#4c1d95', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ede9fe', '#f5f3ff'],
    colors: {
      background: '#f5f3ff',
      text: '#4c1d95',
      stampInactive: '#ede9fe',
      iconInactive: '#7c3aed',
      stampActive: '#c4b5fd',
      iconActive: '#5b21b6',
      button: '#8b5cf6',
      buttonText: '#ffffff',
      muted: '#a78bfa',
      border: '#ddd6fe',
      cardBackground: '#ffffff',
    },
  },
  {
    id: 'indigo-mono',
    name: 'Indigo',
    swatches: ['#312e81', '#6366f1', '#818cf8', '#a5b4fc', '#e0e7ff', '#eef2ff'],
    colors: {
      background: '#eef2ff',
      text: '#312e81',
      stampInactive: '#e0e7ff',
      iconInactive: '#4f46e5',
      stampActive: '#a5b4fc',
      iconActive: '#3730a3',
      button: '#6366f1',
      buttonText: '#ffffff',
      muted: '#818cf8',
      border: '#c7d2fe',
      cardBackground: '#ffffff',
    },
  },
];

const normalizeHex = (value?: string) => (value ?? '').trim().toLowerCase();

const LOGO_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml';
const BACKGROUND_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

export const CardEditor: React.FC<CardEditorProps> = ({ initialTemplate, onSave }) => {
  const navigate = useNavigate();
  const { currentOwner } = useAuth();
  const [template, setTemplate] = useState<Template>(initialTemplate);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [logoUploadBusy, setLogoUploadBusy] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [logoUploadNotice, setLogoUploadNotice] = useState("");
  const [logoSelectedFileName, setLogoSelectedFileName] = useState('');
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false);
  const [backgroundUploadError, setBackgroundUploadError] = useState("");
  const [backgroundUploadNotice, setBackgroundUploadNotice] = useState("");
  const [backgroundSelectedFileName, setBackgroundSelectedFileName] = useState('');
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundFileInputRef = useRef<HTMLInputElement | null>(null);
  
  const [bgHex, setBgHex] = useState(template.colors.background || '#ffffff');
  const [bgIntensity, setBgIntensity] = useState(template.backgroundOpacity ?? 100);
  const [textHex, setTextHex] = useState(template.colors.text || '#000000');
  
  const [stampInactiveBgHex, setStampInactiveBgHex] = useState(template.colors.stampInactive || '#cccccc');
  const [stampInactiveIconHex, setStampInactiveIconHex] = useState(template.colors.iconInactive || '#888888');

  const [stampActiveBgHex, setStampActiveBgHex] = useState(template.colors.stampActive || '#000000');
  const [stampActiveIconHex, setStampActiveIconHex] = useState(template.colors.iconActive || '#ffffff');
  
  const handleChange = <K extends keyof Template>(field: K, value: Template[K]) => {
    setTemplate(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSocialChange = (field: 'instagram' | 'facebook' | 'tiktok' | 'x' | 'youtube' | 'website', value: string) => {
    const trimmed = value.trim();
    setTemplate(prev => ({
      ...prev,
      social: {
        ...prev.social,
        [field]: trimmed.length === 0 ? undefined : value
      }
    }));
  };

  const handleStampsChange = (value: number) => {
    if (!Number.isNaN(value)) {
        setTemplate(prev => ({
            ...prev,
            totalStamps: Math.min(Math.max(value, 3), 16)
        }));
    }
  };

  const updateColors = (
    type: 'background' | 'text' | 'stampInactiveBg' | 'stampInactiveIcon' | 'stampActiveBg' | 'stampActiveIcon', 
    hex: string, 
    intensity?: number
  ) => {
    setTemplate(prev => {
        const newColors = { ...prev.colors };
        let nextOpacity = prev.backgroundOpacity ?? 100;
        
        if (type === 'background') {
            const opacity = intensity !== undefined ? intensity : bgIntensity;
            newColors.background = hex;
            newColors.cardBackground = hex; 
            setBgHex(hex);
            nextOpacity = opacity;
            if(intensity !== undefined) setBgIntensity(intensity);
        } else if (type === 'text') {
            newColors.text = hex;
            newColors.muted = hex;
            setTextHex(hex);
        } else if (type === 'stampInactiveBg') {
            newColors.stampInactive = hex; 
            setStampInactiveBgHex(hex);
        } else if (type === 'stampInactiveIcon') {
            newColors.iconInactive = hex;
            setStampInactiveIconHex(hex);
        } else if (type === 'stampActiveBg') {
            newColors.stampActive = hex; 
            newColors.button = hex; 
            setStampActiveBgHex(hex);
        } else if (type === 'stampActiveIcon') {
            newColors.iconActive = hex;
            setStampActiveIconHex(hex);
        }
        return { ...prev, backgroundOpacity: nextOpacity, colors: newColors };
    });
  };

  const isPaletteSelected = (palette: PalettePreset) => (
    normalizeHex(template.colors.background) === normalizeHex(palette.colors.background) &&
    normalizeHex(template.colors.text) === normalizeHex(palette.colors.text) &&
    normalizeHex(template.colors.stampInactive) === normalizeHex(palette.colors.stampInactive) &&
    normalizeHex(template.colors.iconInactive) === normalizeHex(palette.colors.iconInactive) &&
    normalizeHex(template.colors.stampActive) === normalizeHex(palette.colors.stampActive) &&
    normalizeHex(template.colors.iconActive) === normalizeHex(palette.colors.iconActive)
  );

  const applyPalette = (palette: PalettePreset) => {
    const nextBg = palette.colors.background;
    const nextText = palette.colors.text;
    const nextInactiveBg = palette.colors.stampInactive;
    const nextInactiveIcon = palette.colors.iconInactive;
    const nextActiveBg = palette.colors.stampActive;
    const nextActiveIcon = palette.colors.iconActive;

    setTemplate((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        background: nextBg,
        cardBackground: palette.colors.cardBackground ?? nextBg,
        text: nextText,
        muted: palette.colors.muted ?? nextText,
        stampInactive: nextInactiveBg,
        iconInactive: nextInactiveIcon,
        stampActive: nextActiveBg,
        iconActive: nextActiveIcon,
        button: palette.colors.button ?? nextActiveBg,
        buttonText: palette.colors.buttonText ?? '#ffffff',
        border: palette.colors.border ?? nextInactiveBg,
      },
    }));

    setBgHex(nextBg);
    setTextHex(nextText);
    setStampInactiveBgHex(nextInactiveBg);
    setStampInactiveIconHex(nextInactiveIcon);
    setStampActiveBgHex(nextActiveBg);
    setStampActiveIconHex(nextActiveIcon);
  };

  const selectedPalette = PALETTE_PRESETS.find((palette) => isPaletteSelected(palette));
  const previewSwatches = selectedPalette?.swatches ?? [
    template.colors.text,
    template.colors.button,
    template.colors.iconInactive,
    template.colors.stampActive,
    template.colors.stampInactive,
    template.colors.background,
  ];

  const setUploadBusy = (kind: CampaignAssetKind, busy: boolean) => {
    if (kind === 'logo') {
      setLogoUploadBusy(busy);
      return;
    }
    setBackgroundUploadBusy(busy);
  };

  const setUploadError = (kind: CampaignAssetKind, message: string) => {
    if (kind === 'logo') {
      setLogoUploadError(message);
      return;
    }
    setBackgroundUploadError(message);
  };

  const setUploadNotice = (kind: CampaignAssetKind, message: string) => {
    if (kind === 'logo') {
      setLogoUploadNotice(message);
      return;
    }
    setBackgroundUploadNotice(message);
  };

  const clearUploadMessages = (kind: CampaignAssetKind) => {
    setUploadError(kind, '');
    setUploadNotice(kind, '');
  };

  const tryCleanupPreviousAsset = async (kind: CampaignAssetKind, previousUrl?: string) => {
    if (!previousUrl) return;
    const result = await deleteCampaignAssetByUrl(previousUrl);
    if (result.managed && !result.deleted) {
      setUploadNotice(kind, result.error ?? 'Unable to clean up previous image from storage.');
    }
  };

  const handleAssetUpload = async (kind: CampaignAssetKind, file: File | null) => {
    if (!file) return;
    if (!currentOwner?.id) {
      setUploadError(kind, 'You must be signed in as the account owner to upload images.');
      return;
    }

    const previousUrl = kind === 'logo' ? template.logoImage : template.backgroundImage;
    clearUploadMessages(kind);
    setUploadBusy(kind, true);

    try {
      const uploaded = await uploadCampaignAsset({
        file,
        ownerId: currentOwner.id,
        kind,
      });

      if (kind === 'logo') {
        handleChange('logoImage', uploaded.publicUrl);
      } else {
        handleChange('backgroundImage', uploaded.publicUrl);
      }

      if (previousUrl && previousUrl !== uploaded.publicUrl) {
        await tryCleanupPreviousAsset(kind, previousUrl);
      }
    } catch (error) {
      setUploadError(
        kind,
        error instanceof Error ? error.message : 'Unable to upload image right now. Please try again.'
      );
    } finally {
      setUploadBusy(kind, false);
    }
  };

  const openFilePicker = (kind: CampaignAssetKind) => {
    if (kind === 'logo') {
      logoFileInputRef.current?.click();
      return;
    }
    backgroundFileInputRef.current?.click();
  };

  const handleClearAsset = async (kind: CampaignAssetKind) => {
    const previousUrl = kind === 'logo' ? template.logoImage : template.backgroundImage;
    clearUploadMessages(kind);

    if (kind === 'logo') {
      handleChange('logoImage', '');
      setLogoSelectedFileName('');
    } else {
      handleChange('backgroundImage', '');
      setBackgroundSelectedFileName('');
    }

    if (previousUrl) {
      await tryCleanupPreviousAsset(kind, previousUrl);
    }
  };

  const handleSave = async () => {
    setSaveError("");
    setSaveBusy(true);
    try {
      await onSave(template);
      navigate('/campaigns');
    } catch {
      setSaveError('Unable to save this campaign right now. Please try again.');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  return (
    <div className="min-h-[100dvh] bg-gray-50 font-sans lg:flex lg:min-h-screen">
      <div className="hidden lg:static lg:order-2 lg:flex lg:flex-1 lg:items-center lg:justify-center lg:border-b-0 lg:bg-gray-100 lg:p-12">
        <div className="relative mx-auto w-full max-w-[430px] lg:max-w-[380px]">
          <div className="h-[56dvh] min-h-[340px] max-h-[520px] w-full overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-lg lg:h-[750px] lg:max-h-none lg:rounded-[3rem] lg:shadow-none">
            <LoyaltyCard
              template={template}
              mode="preview"
              sizeVariant="default"
              className="h-full w-full"
            />
          </div>
          <p className="mt-3 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground lg:mt-8">
            Live Preview
          </p>
        </div>
      </div>

      <div className="order-2 w-full bg-white p-4 pb-6 sm:p-6 lg:order-1 lg:flex lg:flex-col lg:h-[100dvh] lg:w-1/3 lg:border-r lg:p-10 lg:pb-10 lg:overflow-hidden">
        <div className="mb-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handleCancel} className="rounded-full">
                  <ArrowLeft size={20} />
              </Button>
              <div>
                  <h1 className="text-2xl font-bold tracking-tight">Customize</h1>
                  <p className="text-sm text-muted-foreground">Design your perfect loyalty card.</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="lg:hidden shrink-0"
              onClick={() => setIsPreviewOpen(true)}
            >
              Live Preview
            </Button>
        </div>

        <div className="px-3 sm:px-4 lg:flex-1 lg:overflow-y-auto lg:px-3 lg:pr-3 xl:px-4 lg:no-scrollbar">
            <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="w-full">
                <AccordionItem value="general">
                    <AccordionTrigger>
                        <span className="flex items-center gap-2"><Type size={16}/> General Info</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="businessName">Name</Label>
                            <Input 
                                id="businessName" 
                                value={template.name} 
                                onChange={(e) => handleChange('name', e.target.value)} 
                                placeholder="e.g. Joe's Coffee"
                            />
                        </div>
                        
                        <div className="space-y-4 pt-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="showLogo" className="text-sm font-medium">Show Main Logo</Label>
                                <Switch 
                                    id="showLogo"
                                    checked={template.showLogo !== false}
                                    onCheckedChange={(checked) => handleChange('showLogo', checked)}
                                />
                            </div>
                        </div>

                        {template.showLogo !== false && (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label htmlFor="logoUpload">Upload Brand Logo</Label>
                              <input
                                id="logoUpload"
                                ref={logoFileInputRef}
                                type="file"
                                accept={LOGO_FILE_ACCEPT}
                                onChange={(e) => {
                                  const selected = e.target.files?.[0] ?? null;
                                  setLogoSelectedFileName(selected?.name ?? '');
                                  void handleAssetUpload('logo', selected);
                                  e.target.value = '';
                                }}
                                disabled={logoUploadBusy}
                                className="sr-only"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-start"
                                onClick={() => openFilePicker('logo')}
                                disabled={logoUploadBusy}
                              >
                                {logoUploadBusy ? 'Uploading logo...' : 'Upload logo from device'}
                              </Button>
                              {logoSelectedFileName && (
                                <p className="text-xs text-muted-foreground">
                                  Selected: {logoSelectedFileName}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground">
                                JPG, PNG, WebP, or SVG up to 2MB.
                              </p>
                              {logoUploadBusy && (
                                <p className="text-xs text-muted-foreground">Uploading logo...</p>
                              )}
                              {logoUploadError && (
                                <p className="text-xs text-rose-700">{logoUploadError}</p>
                              )}
                              {logoUploadNotice && (
                                <p className="text-xs text-amber-700">{logoUploadNotice}</p>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="logoImage">Brand Logo URL</Label>
                              <div className="flex gap-2">
                                <Input
                                  id="logoImage"
                                  value={template.logoImage || ''}
                                  onChange={(e) => handleChange('logoImage', e.target.value)}
                                  placeholder="https://example.com/logo.png"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  title="Clear Logo"
                                  onClick={() => void handleClearAsset('logo')}
                                  disabled={logoUploadBusy || !template.logoImage}
                                >
                                  <X size={14} />
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">Replaces the default icon in the header.</p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="rewardName">Reward Name</Label>
                            <Input 
                                id="rewardName" 
                                value={template.rewardName} 
                                onChange={(e) => handleChange('rewardName', e.target.value)} 
                                placeholder="e.g. Free Coffee"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tagline">Tagline / Instruction</Label>
                            <Input 
                                id="tagline" 
                                value={template.tagline || ''} 
                                onChange={(e) => handleChange('tagline', e.target.value)} 
                                placeholder={`Collect ${template.totalStamps} stamps for a...`}
                            />
                            <p className="text-xs text-muted-foreground">Override the default "Collect X stamps..." text.</p>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="totalStamps">Number of Stamps</Label>
                                <span className="inline-flex min-w-12 items-center justify-center rounded-full bg-secondary px-3 py-1 text-sm font-semibold">
                                    {template.totalStamps}
                                </span>
                            </div>
                            <input
                                id="totalStamps"
                                type="range"
                                min={3}
                                max={16}
                                step={1}
                                value={template.totalStamps}
                                onChange={(e) => handleStampsChange(parseInt(e.target.value, 10))}
                                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>3</span>
                                <span>16</span>
                            </div>
                        </div>
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="design">
                    <AccordionTrigger>
                        <span className="flex items-center gap-2"><Palette size={16}/> Design & Colors</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-6 pt-2">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Preset Palettes</Label>
                                <span className="text-[10px] text-muted-foreground">Built-in themes</span>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex w-full items-center justify-between rounded-lg border border-[#b5bccb] bg-[#d3d8e2] px-3 py-2 text-left text-[#3f4865] transition-colors hover:bg-[#c7cdd9]"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="flex shrink-0 gap-1">
                                                {previewSwatches.map((swatch, idx) => (
                                                    <span
                                                        key={`${swatch}-${idx}`}
                                                        className="h-4 w-4 rounded-[3px] border border-black/10"
                                                        style={{ backgroundColor: swatch }}
                                                    />
                                                ))}
                                            </div>
                                            <span className="truncate text-sm font-semibold">
                                                {selectedPalette?.name ?? 'Custom Theme'}
                                            </span>
                                        </div>
                                        <ChevronDown size={16} className="shrink-0 opacity-70" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="start"
                                    sideOffset={6}
                                    className="w-[--radix-dropdown-menu-trigger-width] min-w-[280px] max-h-[18rem] overflow-y-auto rounded-lg border border-[#a8b0c3] bg-[#c8ceda] p-1.5 text-[#434b67] shadow-xl"
                                >
                                    <p className="px-2 pb-1 pt-0.5 text-xs font-semibold tracking-wide text-[#68718d]">
                                        Built-in Themes
                                    </p>
                                    {PALETTE_PRESETS.map((palette) => {
                                        const selected = isPaletteSelected(palette);
                                        return (
                                            <DropdownMenuItem
                                                key={palette.id}
                                                onSelect={() => applyPalette(palette)}
                                                className={
                                                    `mb-1 flex items-center justify-between rounded-md px-2 py-2 text-sm outline-none transition-colors ` +
                                                    (selected
                                                      ? 'bg-[#1298d2] text-white focus:bg-[#1298d2] focus:text-white'
                                                      : 'text-[#434b67] hover:bg-[#b9c0cf] focus:bg-[#b9c0cf] focus:text-[#2f3650]')
                                                }
                                            >
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className="flex shrink-0 gap-1">
                                                        {palette.swatches.map((swatch, idx) => (
                                                            <span
                                                                key={`${palette.id}-${swatch}-${idx}`}
                                                                className="h-4 w-4 rounded-[2px] border border-black/10"
                                                                style={{ backgroundColor: swatch }}
                                                            />
                                                        ))}
                                                    </div>
                                                    <span className="truncate font-medium">{palette.name}</span>
                                                </div>
                                            </DropdownMenuItem>
                                        );
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>

                        <div className="space-y-3">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Background</Label>
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full overflow-hidden border shadow-sm shrink-0 relative">
                                    <input 
                                        type="color" 
                                        value={bgHex}
                                        onChange={(e) => updateColors('background', e.target.value)}
                                        className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                    />
                                </div>
                                <div className="flex-1 space-y-1">
                                    <Label className="text-xs">
                                      {template.backgroundImage ? "Overlay Opacity" : "Color Intensity"} ({bgIntensity}%)
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-muted-foreground">
                                          {template.backgroundImage ? "Clear" : "Transparent"}
                                        </span>
                                        <input 
                                            type="range" 
                                            min="0" 
                                            max="100" 
                                            value={bgIntensity} 
                                            onChange={(e) => updateColors('background', bgHex, parseInt(e.target.value))}
                                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                        />
                                        <span className="text-[10px] text-muted-foreground">Solid</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="space-y-2 mt-2">
                                <Label htmlFor="backgroundUpload" className="text-xs">Upload Background Image</Label>
                                <input
                                    id="backgroundUpload"
                                    ref={backgroundFileInputRef}
                                    type="file"
                                    accept={BACKGROUND_FILE_ACCEPT}
                                    onChange={(e) => {
                                      const selected = e.target.files?.[0] ?? null;
                                      setBackgroundSelectedFileName(selected?.name ?? '');
                                      void handleAssetUpload('background', selected);
                                      e.target.value = '';
                                    }}
                                    disabled={backgroundUploadBusy}
                                    className="sr-only"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full justify-start"
                                  onClick={() => openFilePicker('background')}
                                  disabled={backgroundUploadBusy}
                                >
                                  {backgroundUploadBusy ? 'Uploading background...' : 'Upload background from device'}
                                </Button>
                                {backgroundSelectedFileName && (
                                  <p className="text-xs text-muted-foreground">
                                    Selected: {backgroundSelectedFileName}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground">JPG, PNG, or WebP up to 6MB.</p>
                                {backgroundUploadBusy && (
                                  <p className="text-xs text-muted-foreground">Uploading background...</p>
                                )}
                                {backgroundUploadError && (
                                  <p className="text-xs text-rose-700">{backgroundUploadError}</p>
                                )}
                                {backgroundUploadNotice && (
                                  <p className="text-xs text-amber-700">{backgroundUploadNotice}</p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="bgImage" className="text-xs">Background Image URL</Label>
                                <div className="flex gap-2">
                                    <Input 
                                        id="bgImage" 
                                        value={template.backgroundImage || ''} 
                                        onChange={(e) => handleChange('backgroundImage', e.target.value)} 
                                        placeholder="https://..."
                                        className="text-xs"
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={() => void handleClearAsset('background')}
                                      title="Clear Image"
                                      disabled={backgroundUploadBusy || !template.backgroundImage}
                                    >
                                        <ImageIcon size={14} />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-3">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Empty Slot</Label>
                                
                                <div className="space-y-1">
                                    <p className="text-[10px] text-muted-foreground">Background</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-md overflow-hidden border shadow-sm shrink-0 relative">
                                            <input 
                                                type="color" 
                                                value={stampInactiveBgHex}
                                                onChange={(e) => updateColors('stampInactiveBg', e.target.value)}
                                                className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{stampInactiveBgHex}</span>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <p className="text-[10px] text-muted-foreground">Icon Color</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-md overflow-hidden border shadow-sm shrink-0 relative">
                                            <input 
                                                type="color" 
                                                value={stampInactiveIconHex}
                                                onChange={(e) => updateColors('stampInactiveIcon', e.target.value)}
                                                className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{stampInactiveIconHex}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Filled Slot</Label>
                                
                                <div className="space-y-1">
                                    <p className="text-[10px] text-muted-foreground">Background</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-md overflow-hidden border shadow-sm shrink-0 relative">
                                            <input 
                                                type="color" 
                                                value={stampActiveBgHex}
                                                onChange={(e) => updateColors('stampActiveBg', e.target.value)}
                                                className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{stampActiveBgHex}</span>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <p className="text-[10px] text-muted-foreground">Icon Color</p>
                                    <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-md overflow-hidden border shadow-sm shrink-0 relative">
                                            <input 
                                                type="color" 
                                                value={stampActiveIconHex}
                                                onChange={(e) => updateColors('stampActiveIcon', e.target.value)}
                                                className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                            />
                                        </div>
                                        <span className="text-[10px] font-mono text-muted-foreground">{stampActiveIconHex}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t">
                            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Main Text Color</Label>
                            <div className="flex items-center gap-2">
                                <div className="h-10 w-10 rounded-md overflow-hidden border shadow-sm shrink-0 relative">
                                    <input 
                                        type="color" 
                                        value={textHex}
                                        onChange={(e) => updateColors('text', e.target.value)}
                                        className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground font-mono">{textHex}</span>
                            </div>
                        </div>

                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="icons">
                    <AccordionTrigger>
                        <span className="flex items-center gap-2"><Grid size={16}/> Icon</span>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2">
                        <div className="grid grid-cols-4 gap-2">
                            {ICON_OPTIONS.map((item, idx) => {
                                const IsSelected = template.icon === item.icon;
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleChange('icon', item.icon)}
                                        className={`
                                            flex flex-col items-center justify-center gap-1 p-3 rounded-lg border transition-all
                                            ${IsSelected 
                                                ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary ring-offset-2' 
                                                : 'hover:bg-secondary hover:border-secondary-foreground/20 bg-white'
                                            }
                                        `}
                                    >
                                        <item.icon size={24} />
                                        <span className="text-[10px] font-medium truncate w-full text-center">{item.label}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </AccordionContent>
                </AccordionItem>

                <AccordionItem value="social">
                    <AccordionTrigger>
                        <span className="flex items-center gap-2"><Smartphone size={16}/> Social</span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="social-instagram">Instagram</Label>
                            <Input
                                id="social-instagram"
                                value={template.social?.instagram || ''}
                                onChange={(e) => handleSocialChange('instagram', e.target.value)}
                                placeholder="@yourbrand or https://instagram.com/yourbrand"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="social-facebook">Facebook</Label>
                            <Input
                                id="social-facebook"
                                value={template.social?.facebook || ''}
                                onChange={(e) => handleSocialChange('facebook', e.target.value)}
                                placeholder="yourbrand or https://facebook.com/yourbrand"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="social-tiktok">TikTok</Label>
                            <Input
                                id="social-tiktok"
                                value={template.social?.tiktok || ''}
                                onChange={(e) => handleSocialChange('tiktok', e.target.value)}
                                placeholder="@yourbrand or https://tiktok.com/@yourbrand"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="social-x">X</Label>
                            <Input
                                id="social-x"
                                value={template.social?.x || ''}
                                onChange={(e) => handleSocialChange('x', e.target.value)}
                                placeholder="@yourbrand or https://x.com/yourbrand"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="social-youtube">YouTube</Label>
                            <Input
                                id="social-youtube"
                                value={template.social?.youtube || ''}
                                onChange={(e) => handleSocialChange('youtube', e.target.value)}
                                placeholder="@yourbrand or https://youtube.com/@yourbrand"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="social-website">Website</Label>
                            <Input
                                id="social-website"
                                value={template.social?.website || ''}
                                onChange={(e) => handleSocialChange('website', e.target.value)}
                                placeholder="https://yourbrand.com"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>

        <div className="mt-8 border-t pt-6 lg:mt-auto lg:shrink-0">
            {saveError && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {saveError}
                </div>
            )}
            <Button
              size="lg"
              className="w-full gap-2 text-lg font-semibold h-14"
              onClick={handleSave}
              disabled={saveBusy || logoUploadBusy || backgroundUploadBusy}
            >
                {saveBusy ? 'Saving...' : 'Save'} <CheckIcon size={20} />
            </Button>
        </div>
      </div>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent
          className="
            h-[100dvh] w-screen max-w-none rounded-none border-0 bg-gray-100 p-4 shadow-none lg:hidden
            [&>button]:right-4 [&>button]:top-4 [&>button]:z-50 [&>button]:rounded-full
            [&>button]:bg-black/55 [&>button]:p-1 [&>button]:text-white [&>button]:opacity-100
          "
        >
          <DialogTitle className="sr-only">Live card preview</DialogTitle>
          <div className="mx-auto flex h-full w-full max-w-[430px] items-center justify-center py-6">
            <div className="h-full min-h-[360px] max-h-[86dvh] w-full overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-lg">
              <LoyaltyCard
                template={template}
                mode="preview"
                sizeVariant="compact"
                className="h-full w-full"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
