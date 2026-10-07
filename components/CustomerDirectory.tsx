import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search, Mail, Phone, Edit, UserPlus } from "lucide-react";
import { Customer } from '../types';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { upsertCustomer } from '../lib/db/customers';
import { useAuth } from './AuthProvider';
import { LocalizedTree } from './LocalizedTree';

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
    const result = await upsertCustomer(
      { id: editingCustomer.id, name: formData.name, email: formData.email, mobile: formData.mobile, status: editingCustomer.status },
      currentOwner.id
    );
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
    <LocalizedTree>
    <div className="min-h-full min-w-0 space-y-6 p-4 animate-fade-in bg-gray-50/50 md:h-full md:overflow-y-auto md:p-8">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Customers</h1>
          <p className="text-muted-foreground">Manage your customer database.</p>
        </div>
        {!readOnly && (
          <Button onClick={() => { setFormData({ name: '', email: '', mobile: '' }); setIsAddOpen(true); }} className="gap-2 rounded-full shadow-xs w-full sm:w-auto">
            <UserPlus size={16} /> Add Customer
          </Button>
        )}
      </div>

      <div className="flex items-center space-x-2 bg-white px-3 py-2 rounded-lg border w-full max-w-sm shadow-xs">
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

      <div className="hidden rounded-xl border bg-white flex-1 overflow-auto shadow-xs xl:block">
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

      <div className="space-y-3 xl:hidden">
        {filteredCustomers.length === 0 ? (
          <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
            No customers found.
          </div>
        ) : filteredCustomers.map(customer => (
          <article key={customer.id} className="rounded-xl border bg-white p-4 shadow-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                  {customer.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="break-words font-medium">{customer.name}</p>
                  <p className="break-all text-sm text-muted-foreground">{customer.email}</p>
                  {customer.mobile && <p className="mt-1 flex items-center gap-1.5 break-all text-xs text-muted-foreground"><Phone size={12} />{customer.mobile}</p>}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800" title="Active cards">
                <span className="font-semibold">{customer.cards.length}</span>
                <span className="ml-1">Active Cards</span>
              </span>
            </div>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full gap-2"
                onClick={() => { setEditingCustomer(customer); setFormData({ name: customer.name, email: customer.email, mobile: customer.mobile || '' }) }}
              >
                <Edit size={15} /> Edit
              </Button>
            )}
          </article>
        ))}
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
    </LocalizedTree>
  );
};
