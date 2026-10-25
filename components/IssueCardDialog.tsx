import React, { useState } from 'react';
import { Customer, IssuedCard, Template, Transaction } from '../types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { QrCodeDisplay } from "./ui/qr-code-display";
import { Search, CreditCard, ChevronRight, UserPlus, CheckCircle2, User, ArrowLeft, Copy, ExternalLink, Ban } from "lucide-react";
import { useAuth } from './AuthProvider';
import { buildPublicCardUrl } from '../lib/links';

interface IssueCardDialogProps {
    isOpen: boolean;
    onClose: () => void;
    campaigns: Template[];
    customers: Customer[];
    onIssue: (campaign: Template, customer: Customer | null, newCustomerData: {name: string, email: string, mobile: string}) => Promise<IssuedCard>;
    preSelectedCampaign?: Template | null;
    preSelectedCustomer?: Customer | null;
}

export const IssueCardDialog: React.FC<IssueCardDialogProps> = ({ 
    isOpen, 
    onClose, 
    campaigns, 
    customers, 
    onIssue,
    preSelectedCampaign = null,
    preSelectedCustomer = null
}) => {
    const { currentOwner } = useAuth();
    const slug = currentOwner?.slug ?? "";
    // State
    const [step, setStep] = useState<'campaign' | 'customer' | 'new-customer' | 'review' | 'success'>('campaign');
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedCampaign, setSelectedCampaign] = useState<Template | null>(null);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [newCustomerData, setNewCustomerData] = useState({ name: '', email: '', mobile: '' });
    const [createdCard, setCreatedCard] = useState<IssuedCard | null>(null);
    const [submitError, setSubmitError] = useState("");
    const [flowError, setFlowError] = useState("");
    const [issuing, setIssuing] = useState(false);
    const publicUrl = createdCard ? buildPublicCardUrl(slug, createdCard.uniqueId) : "";
    const displayUrl = publicUrl.length > 42 ? `${publicUrl.slice(0, 42)}...` : publicUrl;

    // Initial load effect
    React.useEffect(() => {
        if (isOpen) {
            setStep('campaign');
            setSearchQuery("");
            setNewCustomerData({ name: '', email: '', mobile: '' });
            setCreatedCard(null);
            setSubmitError("");
            setFlowError("");
            setIssuing(false);

            if (preSelectedCampaign && preSelectedCustomer) {
                if (preSelectedCampaign.isEnabled === false) {
                    setSelectedCampaign(null);
                    setSelectedCustomer(null);
                    setStep('campaign');
                    setFlowError(`"${preSelectedCampaign.name}" is disabled and cannot issue new cards.`);
                } else {
                    setSelectedCampaign(preSelectedCampaign);
                    setSelectedCustomer(preSelectedCustomer);
                    setStep('review');
                }
            } else if (preSelectedCampaign) {
                if (preSelectedCampaign.isEnabled === false) {
                    setSelectedCampaign(null);
                    setSelectedCustomer(null);
                    setStep('campaign');
                    setFlowError(`"${preSelectedCampaign.name}" is disabled and cannot issue new cards.`);
                } else {
                    setSelectedCampaign(preSelectedCampaign);
                    setStep('customer');
                }
            } else {
                setSelectedCampaign(null);
                setSelectedCustomer(null);
            }
        }
    }, [isOpen, preSelectedCampaign, preSelectedCustomer]);

    // Filtering
    const filteredCampaigns = campaigns.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const filteredCustomers = customers.filter(c => 
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Handlers
    const handleSelectCampaign = (c: Template) => {
        if (c.isEnabled === false) {
            setFlowError(`"${c.name}" is disabled and cannot issue new cards.`);
            return;
        }
        setFlowError("");
        setSelectedCampaign(c);
        setSearchQuery("");
        setStep('customer');
    };

    const handleSelectCustomer = (c: Customer) => {
        setSelectedCustomer(c);
        setSubmitError("");
        setStep('review');
    };

    const handleCreateNewCustomer = () => {
        setSelectedCustomer(null);
        setNewCustomerData({ name: searchQuery, email: '', mobile: '' });
        setSubmitError("");
        setFlowError("");
        setStep('new-customer');
    };

    const handleConfirmIssue = async () => {
        if (!selectedCampaign) return;
        if (selectedCampaign.isEnabled === false) {
            setSubmitError("This campaign is disabled and cannot issue new cards.");
            return;
        }
        setSubmitError("");
        setIssuing(true);
        try {
            const card = await onIssue(selectedCampaign, selectedCustomer, newCustomerData);
            setCreatedCard(card);
            setStep('success');
        } catch (error) {
            if (error instanceof Error && error.message) {
                setSubmitError(error.message);
            } else {
                setSubmitError("Unable to issue this card right now. Please try again.");
            }
        } finally {
            setIssuing(false);
        }
    };

    const handleCopyLink = () => {
        if (!publicUrl) return;
        navigator.clipboard.writeText(publicUrl);
        alert("Link copied to clipboard!");
    };

    const handleOpenLink = () => {
        if (!publicUrl) return;
        window.open(publicUrl, '_blank');
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-[calc(100vw-1rem)] max-w-[500px] h-[min(650px,calc(100vh-1rem))] sm:h-[650px] flex flex-col p-0 gap-0 overflow-hidden transition-all">
                {/* Header */}
                <div className="border-b bg-muted/20 p-4 sm:p-6">
                    <DialogTitle className="text-xl">
                        {step === 'campaign' && "Select Campaign"}
                        {step === 'customer' && "Select Customer"}
                        {step === 'new-customer' && "New Customer Details"}
                        {step === 'review' && "Review & Issue"}
                        {step === 'success' && "Card Issued Successfully!"}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'campaign' && "Choose which loyalty card to issue."}
                        {step === 'customer' && `Who should receive the "${selectedCampaign?.name}" card?`}
                        {step === 'new-customer' && "Enter details for the new cardholder."}
                        {step === 'review' && "Confirm details before issuing."}
                        {step === 'success' && "Scan the QR code or share the link below."}
                    </DialogDescription>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-0">
                    {/* STEP 1: CAMPAIGN */}
                    {step === 'campaign' && (
                        <div className="p-4 space-y-4">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search campaigns..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                            </div>
                            <div className="grid gap-2">
                                {filteredCampaigns.length === 0 ? <p className="text-center text-sm text-muted-foreground py-8">No campaigns found.</p> :
                                filteredCampaigns.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => handleSelectCampaign(c)}
                                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors text-left group ${c.isEnabled === false ? 'opacity-70 bg-muted/20 cursor-not-allowed' : 'hover:bg-muted/50'}`}
                                        disabled={c.isEnabled === false}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                                                {c.isEnabled === false ? <Ban size={18} /> : <CreditCard size={20} />}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-sm">{c.name}</p>
                                                <p className="text-xs text-muted-foreground">{c.totalStamps} stamps{(c.bonusStamps ?? 0) > 0 ? ` • ${c.bonusStamps} gifted` : ''} {c.isEnabled === false ? '• Disabled' : ''}</p>
                                            </div>
                                        </div>
                                        <ChevronRight size={16} className={`text-muted-foreground transition-opacity ${c.isEnabled === false ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}/>
                                    </button>
                                ))}
                            </div>
                            {flowError && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                                    {flowError}
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 2: CUSTOMER */}
                    {step === 'customer' && (
                        <div className="p-4 space-y-4">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="Search existing customers..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
                            </div>
                            <Button variant="outline" className="w-full justify-start gap-2 border-dashed text-primary" onClick={handleCreateNewCustomer}>
                                <UserPlus size={16} /> Create New Customer "{searchQuery}"
                            </Button>
                            <div className="space-y-1">
                                {filteredCustomers.slice(0, 10).map(c => (
                                    <button key={c.id} onClick={() => handleSelectCustomer(c)} className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left">
                                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">{c.name.substring(0,2).toUpperCase()}</div>
                                        <div className="flex-1 overflow-hidden"><p className="font-medium text-sm truncate">{c.name}</p><p className="text-xs text-muted-foreground truncate">{c.email}</p></div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* STEP 3: NEW CUSTOMER */}
                    {step === 'new-customer' && (
                        <div className="space-y-4 p-4 sm:p-6">
                            <div className="grid gap-2"><Label>Full Name</Label><Input value={newCustomerData.name} onChange={(e) => setNewCustomerData({...newCustomerData, name: e.target.value})} autoFocus /></div>
                            <div className="grid gap-2"><Label>Email</Label><Input value={newCustomerData.email} onChange={(e) => setNewCustomerData({...newCustomerData, email: e.target.value})} /></div>
                            <div className="grid gap-2"><Label>Mobile (Optional)</Label><Input value={newCustomerData.mobile} onChange={(e) => setNewCustomerData({...newCustomerData, mobile: e.target.value})} /></div>
                        </div>
                    )}

                    {/* STEP 4: REVIEW */}
                    {step === 'review' && (
                        <div className="flex h-full flex-col items-center justify-center space-y-6 p-4 text-center sm:p-6">
                            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600"><CheckCircle2 size={32} /></div>
                            <div className="w-full space-y-1"><p className="text-sm uppercase tracking-wider text-muted-foreground">Issuing Card</p><div className="text-lg font-bold sm:text-xl">{selectedCampaign?.name}</div></div>
                            <div className="w-full space-y-1 border-y py-4"><p className="text-sm uppercase tracking-wider text-muted-foreground">To Customer</p><div className="flex items-center justify-center gap-2 text-base font-semibold sm:text-lg"><User size={18} />{selectedCustomer ? selectedCustomer.name : newCustomerData.name}</div></div>
                            {submitError && (
                                <div className="w-full rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {submitError}
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 5: SUCCESS (QR CODE) */}
                    {step === 'success' && createdCard && (
                        <div className="flex h-full flex-col items-center justify-center space-y-6 p-4 animate-fade-in sm:p-6">
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                                <QrCodeDisplay value={publicUrl} label="QR code" className="h-56 w-56 sm:h-72 sm:w-72" />
                            </div>
                            <div className="text-center space-y-2 w-full max-w-xs">
                                <p className="text-sm text-muted-foreground">Scan to access loyalty card</p>
                                <div className="flex items-center gap-2">
                                    <Input 
                                        readOnly 
                                        value={displayUrl || publicUrl} 
                                        className="text-xs font-mono bg-muted/50"
                                    />
                                    <Button size="icon" variant="outline" onClick={handleCopyLink}><Copy size={14} /></Button>
                                    <Button size="icon" variant="outline" onClick={handleOpenLink}><ExternalLink size={14} /></Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex flex-col gap-2 border-t bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                    {step === 'campaign' && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
                    
                    {step === 'customer' && <Button variant="outline" onClick={() => setStep('campaign')} className="gap-2 sm:w-auto"><ArrowLeft size={16} /> Back</Button>}
                    
                    {step === 'new-customer' && (
                        <>
                            <Button variant="outline" onClick={() => setStep('customer')} className="gap-2 sm:w-auto" disabled={issuing}><ArrowLeft size={16} /> Back</Button>
                            <Button onClick={() => setStep('review')} className="sm:w-auto" disabled={!newCustomerData.name}>Review</Button>
                        </>
                    )}

                    {step === 'review' && (
                        <>
                            <Button variant="outline" onClick={() => setStep(selectedCustomer ? 'customer' : 'new-customer')} className="gap-2 sm:w-auto" disabled={issuing}><ArrowLeft size={16} /> Back</Button>
                            <Button onClick={handleConfirmIssue} className="bg-green-600 hover:bg-green-700 sm:w-auto" disabled={issuing}>
                                {issuing ? "Issuing..." : "Confirm & Issue"}
                            </Button>
                        </>
                    )}

                    {step === 'success' && (
                        <Button onClick={onClose} className="w-full">Done</Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
