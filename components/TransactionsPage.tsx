import React, { useEffect, useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Input } from "./ui/input";
import { 
    Search, Calendar, History,
    Gift, Plus, Minus, CreditCard, ArrowUpDown, Download
} from "lucide-react";
import { Customer, Transaction } from '../types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { LocalizedTree } from './LocalizedTree';
import { useLocale } from './LocaleProvider';

interface TransactionsPageProps {
  customers: Customer[];
}

// Flattened Transaction Type
interface FlatTransaction extends Transaction {
    customerName: string;
    customerEmail: string;
    campaignName: string;
    cardId: string;
}

const escapeCsvValue = (value: string | number | undefined) => {
    const normalized = value == null ? "" : String(value);
    return `"${normalized.replace(/"/g, '""')}"`;
};

export const TransactionsPage: React.FC<TransactionsPageProps> = ({ customers }) => {
  const { language } = useLocale();
  const PAGE_SIZE = 50;
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 1. Flatten Data
  const allTransactions: FlatTransaction[] = useMemo(() => {
      return customers.flatMap(customer => 
          customer.cards.flatMap(card => 
              (card.history || []).map(tx => ({
                  ...tx,
                  customerName: customer.name,
                  customerEmail: customer.email,
                  campaignName: card.campaignName,
                  cardId: card.uniqueId
              }))
          )
      ).sort((a, b) => {
          return sortOrder === 'desc' 
            ? b.timestamp - a.timestamp 
            : a.timestamp - b.timestamp;
      });
  }, [customers, sortOrder]);

  // 2. Filter Data
  const filteredTransactions = useMemo(() => {
      return allTransactions.filter(tx => {
          const lowerQuery = searchQuery.toLowerCase();
          const matchesSearch = 
              tx.customerName.toLowerCase().includes(lowerQuery) ||
              tx.campaignName.toLowerCase().includes(lowerQuery) ||
              tx.cardId.toLowerCase().includes(lowerQuery) ||
              (tx.remarks && tx.remarks.toLowerCase().includes(lowerQuery));

          const matchesDate = dateFilter
              ? (() => {
                  const date = new Date(tx.timestamp);
                  const localDate = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
                  return localDate === dateFilter;
                })()
              : true;

          return matchesSearch && matchesDate;
      });
  }, [allTransactions, searchQuery, dateFilter]);

  useEffect(() => {
      setVisibleCount(PAGE_SIZE);
  }, [customers, searchQuery, dateFilter, sortOrder]);

  const visibleTransactions = useMemo(() => {
      return filteredTransactions.slice(0, visibleCount);
  }, [filteredTransactions, visibleCount]);

  const hasMoreTransactions = filteredTransactions.length > visibleCount;

  const toggleSort = () => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
  const handleLoadMore = () => setVisibleCount((prev) => prev + PAGE_SIZE);

  const handleExportCsv = () => {
      const headers = [
          "Recorded At",
          "Customer Name",
          "Customer Email",
          "Campaign",
          "Card ID",
          "Action",
          "Amount",
          "Processed By",
          "Actor Role",
          "Remarks"
      ];

      const rows = filteredTransactions.map((tx) => [
          new Date(tx.timestamp).toISOString(),
          tx.customerName,
          tx.customerEmail,
          tx.campaignName,
          tx.cardId,
          getLabel(tx.type),
          tx.amount,
          tx.actorName || "Owner",
          tx.actorRole === "staff" ? "Staff" : "Owner",
          tx.remarks || ""
      ]);

      const csvContent = [
          headers.map(escapeCsvValue).join(","),
          ...rows.map((row) => row.map(escapeCsvValue).join(","))
      ].join("\r\n");

      const blob = new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      link.href = url;
      link.download = `transactions-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const getIcon = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return <Gift size={16} />;
          case 'mission_bonus': return <Gift size={16} />;
          case 'stamp_remove': return <Minus size={16} />;
          case 'issued': return <CreditCard size={16} />;
          default: return <Plus size={16} />;
      }
  };

  const getBadgeColor = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return "bg-purple-100 text-purple-700 border-purple-200";
          case 'mission_bonus': return "bg-amber-100 text-amber-700 border-amber-200";
          case 'stamp_remove': return "bg-red-100 text-red-700 border-red-200";
          case 'issued': return "bg-blue-100 text-blue-700 border-blue-200";
          default: return "bg-green-100 text-green-700 border-green-200";
      }
  };

  const getLabel = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return "Redeemed";
          case 'mission_bonus': return "Mission bonus";
          case 'stamp_remove': return "Removed";
          case 'issued': return "Issued";
          default: return "Stamp";
      }
  };

  return (
    <LocalizedTree>
    <div className="min-h-full min-w-0 space-y-6 bg-gray-50/50 p-3 animate-fade-in sm:p-4 md:h-full md:overflow-y-auto md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Transactions</h1>
                <p className="text-muted-foreground">History of all stamps, redemptions, and issuances.</p>
            </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 rounded-xl border bg-white p-3 shadow-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-4">
            <div className="flex w-full min-w-0 items-center space-x-2 rounded-lg border bg-gray-50 px-3 py-2 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-ring sm:max-w-md sm:flex-1">
                <Search className="text-gray-400" size={20} />
                <Input 
                    className="min-w-0 flex-1 border-none bg-transparent px-0 shadow-none focus-visible:ring-0"
                    placeholder="Search by name, card ID, or campaign..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            
            <div className="flex w-full min-w-0 items-center space-x-2 rounded-lg border bg-gray-50 px-3 py-2 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-ring sm:w-auto">
                <Calendar className="text-gray-400" size={20} />
                <input 
                    type="date"
                    className="min-w-0 flex-1 bg-transparent text-sm text-gray-600 outline-hidden sm:flex-none"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                />
                {dateFilter && (
                    <button onClick={() => setDateFilter("")} className="ml-2 text-xs text-muted-foreground hover:text-foreground">
                        Clear
                    </button>
                )}
            </div>

             <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap">
                 <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    className="w-full gap-2 sm:w-auto"
                    disabled={filteredTransactions.length === 0}
                 >
                    <Download size={16} />
                    Export CSV
                 </Button>
                 <Button variant="ghost" size="sm" onClick={toggleSort} className="w-full gap-2 text-muted-foreground sm:w-auto">
                    <ArrowUpDown size={16} />
                    {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
                 </Button>
            </div>
        </div>

        {/* Table */}
        <div className="space-y-3 xl:hidden">
            {filteredTransactions.length === 0 ? (
                <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
                    <History size={24} className="mx-auto mb-2 opacity-20" />
                    No transactions found matching your filters.
                </div>
            ) : visibleTransactions.map(tx => (
                <article key={tx.id} className="rounded-xl border bg-white p-4 shadow-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                            <p className="break-words font-medium text-foreground">{tx.customerName}</p>
                            <p className="break-all text-xs text-muted-foreground">{tx.customerEmail}</p>
                        </div>
                        <div className={cn(
                            "inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                            getBadgeColor(tx.type)
                        )}>
                            {getIcon(tx.type)}{getLabel(tx.type)}
                        </div>
                    </div>
                    <div className="mt-3 min-w-0 border-t pt-3">
                        <p className="break-words text-sm font-medium">{tx.campaignName}</p>
                        <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">#{tx.cardId.slice(0, 8)}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Date &amp; Time</p>
                            <p className="text-xs">{new Date(tx.timestamp).toLocaleDateString(language, { dateStyle: 'medium' })}</p>
                            <p className="text-xs text-muted-foreground">{new Date(tx.timestamp).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })}</p>
                        </div>
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">By</p>
                            <p className="break-words text-xs font-medium">{tx.actorName || "Owner"}</p>
                            <p className="text-xs text-muted-foreground">{tx.actorRole === "staff" ? "Staff" : "Owner"}</p>
                        </div>
                    </div>
                    {tx.remarks && <p className="mt-3 break-words border-t pt-3 text-xs text-muted-foreground">{tx.remarks}</p>}
                </article>
            ))}
        </div>

        <div className="hidden flex-1 overflow-auto rounded-xl border bg-white shadow-xs xl:block">
            <Table>
                <TableHeader>
                    <TableRow className="bg-muted/30">
                        <TableHead className="w-[180px]">Date & Time</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Campaign / Card ID</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>By</TableHead>
                        <TableHead className="text-right">Remarks</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredTransactions.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center h-32 text-muted-foreground flex-col gap-2">
                                <div className="flex justify-center mb-2"><History size={24} className="opacity-20"/></div>
                                No transactions found matching your filters.
                            </TableCell>
                        </TableRow>
                    ) : (
                        visibleTransactions.map(tx => (
                            <TableRow key={tx.id} className="hover:bg-muted/30 transition-colors">
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                    <div className="font-medium text-foreground">{new Date(tx.timestamp).toLocaleDateString(language, { dateStyle: 'medium' })}</div>
                                    <div>{new Date(tx.timestamp).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })}</div>
                                </TableCell>
                                <TableCell>
                                    <div className="font-medium">{tx.customerName}</div>
                                    <div className="text-xs text-muted-foreground">{tx.customerEmail}</div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{tx.campaignName}</span>
                                    </div>
                                    <div className="text-[10px] font-mono text-muted-foreground bg-gray-100 inline-block px-1.5 rounded mt-0.5">
                                        #{tx.cardId.slice(0, 8)}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className={cn(
                                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border",
                                        getBadgeColor(tx.type)
                                    )}>
                                        {getIcon(tx.type)}
                                        {getLabel(tx.type)}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">
                                            {tx.actorName || "Owner"}
                                        </span>
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                            {tx.actorRole === "staff" ? "Staff" : "Owner"}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground max-w-[200px] truncate">
                                    {tx.remarks || "-"}
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
        <div className="flex flex-col items-center gap-3">
            <div className="text-xs text-muted-foreground text-center">
                Showing {visibleTransactions.length} of {filteredTransactions.length} transaction{filteredTransactions.length !== 1 && 's'}
            </div>
            {hasMoreTransactions && (
                <Button variant="outline" size="sm" onClick={handleLoadMore}>
                    Load more
                </Button>
            )}
        </div>
    </div>
    </LocalizedTree>
  );
};
