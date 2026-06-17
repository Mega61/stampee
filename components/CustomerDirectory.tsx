import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search, Mail, Phone, Edit, UserPlus } from "lucide-react";
import { Customer } from '../types';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { upsertCustomer, updateCustomer } from '../lib/db/customers';
import { useAuth } from './AuthProvider';

interface CustomerDirectoryProps {
  customers: Customer[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  readOnly?: boolean;
  refreshData?: () => Promise<void>;
}

export const CustomerDirectory: React.FC<CustomerDirectoryProps> = ({ customers, setCustomers, readOnly = false, refreshData }) => {
  const { currentOwner } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', mobile: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveEdit = async () => {
    if (!editingCustomer || !currentOwner) return;
    setError("");
    setBusy(true);
    const result = await updateCustomer(editingCustomer.id, {
      name: formData.name,
      email: formData.email,
      mobile: formData.mobile,
      status: editingCustomer.status,
    });
    setBusy(false);
    if (result.ok) {
      if (refreshData) {
        void refreshData();
      } else {
        setCustomers(prev => prev.map(c => c.id === editingCustomer.id ? { ...c, ...formData } : c));
      }
      setEditingCustomer(null);
    } else {
      setError(result.error ?? "Unable to update this customer right now.");
    }
  };

  const handleAddCustomer = async () => {
    if (!currentOwner) return;
    setError("");
    setBusy(true);
    const newId = `cust-${Date.now()}`;
    const result = await upsertCustomer(
      { id: newId, name: formData.name, email: formData.email, mobile: formData.mobile, status: 'Active' },
      currentOwner.id
    );
    setBusy(false);
    if (result.ok) {
      if (refreshData) {
        void refreshData();
      } else {
        const newCustomer: Customer = {
          id: newId,
          name: formData.name,
          email: formData.email,
          mobile: formData.mobile,
          status: 'Active',
          cards: []
        };
        setCustomers(prev => [...prev, newCustomer]);
      }
      setIsAddOpen(false);
      setFormData({ name: '', email: '', mobile: '' });
    } else {
      setError(result.error ?? "Unable to create this customer right now.");
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 animate-fade-in h-full flex flex-col bg-gray-50/50">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Customers</h1>
          <p className="text-muted-foreground">Manage your customer database.</p>
        </div>
        {!readOnly && (
          <Button onClick={() => { setFormData({ name: '', email: '', mobile: '' }); setIsAddOpen(true); }} className="gap-2 rounded-full shadow-sm w-full sm:w-auto">
            <UserPlus size={16} /> Add Customer
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-lg border w-full max-w-sm shadow-sm">
        <Search className="text-gray-400" size={20} />
        <Input
          className="flex-1 border-none shadow-none focus-visible:ring-0 px-0"
          placeholder="Search customers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border bg-white flex-1 overflow-auto shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Name</TableHead>
              <TableHead>Contact Info</TableHead>
              <TableHead className="text-center">Active Cards</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center h-24">No customers found.</TableCell></TableRow>
            ) : (
              filteredCustomers.map(customer => (
                <TableRow key={customer.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                        {customer.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium">{customer.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm text-muted-foreground gap-1">
                      <div className="flex items-center gap-2"><Mail size={12} /> {customer.email}</div>
                      {customer.mobile && <div className="flex items-center gap-2"><Phone size={12} /> {customer.mobile}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {customer.cards.length}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingCustomer(customer); setFormData({ name: customer.name, email: customer.email, mobile: customer.mobile || '' }) }}
                      >
                        <Edit size={16} className="text-muted-foreground" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!readOnly && !!editingCustomer} onOpenChange={(o) => !o && !busy && setEditingCustomer(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Customer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2"><Label>Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Email</Label><Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Mobile</Label><Input value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveEdit} disabled={busy}>{busy ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!readOnly && isAddOpen} onOpenChange={(open) => !busy && setIsAddOpen(open)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Customer</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2"><Label>Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Email</Label><Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Mobile</Label><Input value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddCustomer} disabled={!formData.name || busy}>{busy ? "Creating..." : "Create Customer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
