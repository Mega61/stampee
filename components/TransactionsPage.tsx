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
              ? new Date(tx.timestamp).toLocaleDateString() === new Date(dateFilter).toLocaleDateString()
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
          case 'stamp_remove': return <Minus size={16} />;
          case 'issued': return <CreditCard size={16} />;
          case 'gift': return <Gift size={16} />;
          case 'bonus': return <Gift size={16} />;
          default: return <Plus size={16} />;
      }
  };

  const getBadgeColor = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return "bg-purple-100 text-purple-700 border-purple-200";
          case 'stamp_remove': return "bg-red-100 text-red-700 border-red-200";
          case 'issued': return "bg-blue-100 text-blue-700 border-blue-200";
          case 'gift': return "bg-amber-100 text-amber-800 border-amber-200";
          case 'bonus': return "bg-yellow-100 text-yellow-800 border-yellow-200";
          default: return "bg-green-100 text-green-700 border-green-200";
      }
  };

  const getLabel = (type: Transaction['type']) => {
      switch(type) {
          case 'redeem': return "Redeemed";
          case 'stamp_remove': return "Removed";
          case 'issued': return "Issued";
          case 'gift': return "Gift";
          case 'bonus': return "Bonus";
          default: return "Stamp";
      }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 animate-fade-in h-full flex flex-col bg-gray-50/50">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Transactions</h1>
                <p className="text-muted-foreground">History of all stamps, redemptions, and issuances.</p>
            </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-xl border shadow-sm">
            <div className="flex items-center space-x-2 bg-gray-50 px-3 py-2 rounded-lg border w-full max-w-md focus-within:ring-2 focus-within:ring-ring focus-within:bg-white transition-colors">
                <Search className="text-gray-400" size={20} />
                <Input 
                    className="flex-1 border-none shadow-none focus-visible:ring-0 px-0 bg-transparent" 
                    placeholder="Search by name, card ID, or campaign..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            
            <div className="flex items-center space-x-2 bg-gray-50 px-3 py-2 rounded-lg border w-full sm:w-auto focus-within:ring-2 focus-within:ring-ring focus-within:bg-white transition-colors">
                <Calendar className="text-gray-400" size={20} />
                <input 
                    type="date"
                    className="bg-transparent text-sm outline-none text-gray-600"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                />
                {dateFilter && (
                    <button onClick={() => setDateFilter("")} className="ml-2 text-xs text-muted-foreground hover:text-foreground">
                        Clear
                    </button>
                )}
            </div>

             <div className="ml-auto flex items-center gap-2">
                 <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    className="gap-2"
                    disabled={filteredTransactions.length === 0}
                 >
                    <Download size={16} />
                    Export CSV
                 </Button>
                 <Button variant="ghost" size="sm" onClick={toggleSort} className="gap-2 text-muted-foreground">
                    <ArrowUpDown size={16} />
                    {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
                 </Button>
            </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border bg-white flex-1 overflow-auto shadow-sm">
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
                                    <div className="font-medium text-foreground">{tx.date.split(',')[0]}</div>
                                    <div>{tx.date.split(',')[1]}</div>
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
  );
};
