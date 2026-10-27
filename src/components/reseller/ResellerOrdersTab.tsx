import React, { useState, useMemo } from 'react';
import {
  Package,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  Truck,
  PlusCircle,
  UserCheck,
  ArrowLeft,
  ArrowRight,
  Phone,
  MapPin,
  CreditCard,
  Calendar,
  SlidersHorizontal,
  Check,
  X,
  Copy,
  TrendingUp,
  FileText,
  RotateCw,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Sale, Product } from '../../types/index.js';
import { ResellerCashMemoModal, CashMemoData } from './ResellerCashMemoModal.js';

interface ResellerOrdersTabProps {
  salesList: Sale[];
  onOpenRecordSale: () => void;
  productsList?: Product[];
  onRefresh?: () => void;
}

export interface GroupedOrder {
  orderKey: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  district?: string;
  thana?: string;
  saleDate: string;
  timestamp: number;
  items: Sale[];
  totalQuantity: number;
  totalAmount: number;
  totalProfit: number;
  deliveryFee: number;
  grandTotal: number;
  isDeliveryAdvance: boolean;
  notes?: string;
  courierPartner?: string;
  trackingCode?: string;
  courierTrackingUrl?: string;
  paymentStatus: 'PAID' | 'PENDING' | 'DELIVERED';
  saleStatus: 'Approved' | 'Pending Verification' | 'Rejected' | 'Confirmed' | string;
  deliveryStatus: 'pending' | 'processing' | 'shipped' | 'delivered';
  status: 'pending' | 'delivered' | 'cancelled';
}

// Convert English digits to Bengali digits
const toBn = (numOrStr: string | number): string => {
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(numOrStr).replace(/[0-9]/g, (digit) => bnDigits[+digit] || digit);
};

// Format Date Only (e.g. ০৩ অক্টো ২০২৬)
const formatDateOnly = (isoDate: string, lang: 'bn' | 'en'): string => {
  if (!isoDate) return 'N/A';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;

  if (lang === 'bn') {
    const monthsBn = [
      'জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
      'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'
    ];
    return `${toBn(d.getDate().toString().padStart(2, '0'))} ${monthsBn[d.getMonth()]} ${toBn(d.getFullYear())}`;
  }
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Format Exact Time Only (e.g. ০৩:০৯ PM)
const formatTimeOnly = (isoDate: string, lang: 'bn' | 'en'): string => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = hours.toString().padStart(2, '0');

  if (lang === 'bn') {
    return `${toBn(hoursStr)}:${toBn(minutes)} ${ampm}`;
  }
  return `${hoursStr}:${minutes} ${ampm}`;
};

export const ResellerOrdersTab: React.FC<ResellerOrdersTabProps> = ({
  salesList = [],
  onOpenRecordSale,
  productsList = [],
  onRefresh,
}) => {
  const { lang, showToast } = useApp();
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'delivered' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Expanded filters state
  const [showFilters, setShowFilters] = useState(false);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'pending'>('all');

  // Selected Order Key for Detailed View
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);

  // Cash Memo Modal State
  const [memoModalData, setMemoModalData] = useState<CashMemoData | null>(null);

  // Handle manual refresh
  const handleManualRefresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
      showToast(lang === 'bn' ? '✓ অর্ডার তালিকা আপডেট হয়েছে!' : '✓ Orders refreshed!', 'success');
    } catch {
      showToast(lang === 'bn' ? 'রিফ্রেশ করতে সমস্যা হয়েছে' : 'Failed to refresh orders', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const [copiedCode, setCopiedCode] = useState(false);

  // Copy tracking link helper
  const handleCopyTrackingLink = (textToCopy: string) => {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    showToast(
      lang === 'bn'
        ? '✓ কুরিয়ার ট্র্যাকিং তথ্য কপি করা হয়েছে!'
        : '✓ Tracking info copied!',
      'success'
    );
  };

  // Helper to resolve product image
  const getProductImage = (sale: Sale): string => {
    if (sale.productImage) return sale.productImage;
    const cleanId = sale.productId ? sale.productId.split('_')[0] : '';
    const matched = (productsList || []).find((p) => p.id === cleanId || p.id === sale.productId);
    if (matched) {
      return matched.imageUrl || (matched.images && matched.images.length > 0 ? matched.images[0].url : '');
    }
    return '';
  };

  // Group individual sales into cohesive orders
  const groupedOrders: GroupedOrder[] = useMemo(() => {
    if (!salesList || salesList.length === 0) return [];

    const map = new Map<string, Sale[]>();

    salesList.forEach((sale) => {
      let key = sale.orderCode?.trim();
      if (!key) {
        const timeBucket = Math.floor(new Date(sale.saleDate).getTime() / (30 * 1000));
        key = `LEGACY-${sale.customerPhone?.trim() || 'anon'}-${timeBucket}`;
      }

      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(sale);
    });

    const orders: GroupedOrder[] = [];

    map.forEach((items, key) => {
      items.sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime());

      const first = items[0];
      const orderCode = first.orderCode || `ORD-${first.id.slice(0, 6).toUpperCase()}`;

      const totalQuantity = items.reduce((sum, s) => sum + (s.quantity || 1), 0);
      const totalAmount = items.reduce((sum, s) => sum + (s.totalAmount || ((s.sellingPrice || 0) * (s.quantity || 1))), 0);
      const totalProfit = items.reduce((sum, s) => sum + (s.commissionAmount || 0), 0);

      const combinedNotes = items.map((s) => s.notes || '').join(' ');
      const isDeliveryAdvance = combinedNotes.includes('ডেলিভারি চার্জ অগ্রিম পেইড') || combinedNotes.includes('advance');
      const deliveryFee = isDeliveryAdvance ? 0 : 120;
      const grandTotal = totalAmount + deliveryFee;

      const isAllPaid = items.every((s) => s.paymentStatus === 'PAID');
      const isAnyDelivered = items.some((s) => s.deliveryStatus === 'delivered' || s.paymentStatus === 'DELIVERED');
      const isAnyRejected = items.some((s) => s.saleStatus === 'Rejected');

      let paymentStatus: 'PAID' | 'PENDING' | 'DELIVERED' = 'PENDING';
      if (isAllPaid) paymentStatus = 'PAID';
      else if (isAnyDelivered) paymentStatus = 'DELIVERED';

      let saleStatus: 'Approved' | 'Pending Verification' | 'Rejected' = 'Pending Verification';
      if (isAnyRejected) saleStatus = 'Rejected';
      else if (items.every((s) => s.saleStatus === 'Approved')) saleStatus = 'Approved';

      let deliveryStatus: 'pending' | 'processing' | 'shipped' | 'delivered' = 'pending';
      if (items.every((s) => s.deliveryStatus === 'delivered')) deliveryStatus = 'delivered';
      else if (items.some((s) => s.deliveryStatus === 'shipped')) deliveryStatus = 'shipped';
      else if (items.some((s) => s.deliveryStatus === 'processing')) deliveryStatus = 'processing';

      let status: 'pending' | 'delivered' | 'cancelled' = 'pending';
      if (isAnyRejected) status = 'cancelled';
      else if (isAllPaid || isAnyDelivered || deliveryStatus === 'delivered') status = 'delivered';
      else status = 'pending';

      const courierPartner = items.find((s) => s.courierPartner)?.courierPartner;
      const trackingCode = items.find((s) => s.trackingCode)?.trackingCode;
      let courierTrackingUrl = items.find((s) => s.courierTrackingUrl)?.courierTrackingUrl;

      if (trackingCode && !courierTrackingUrl) {
        if (courierPartner?.toLowerCase().includes('pathao')) {
          courierTrackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${trackingCode}`;
        } else {
          courierTrackingUrl = `https://steadfast.com.bd/t/${trackingCode}`;
        }
      }

      const timestamps = items.map((s) => new Date(s.saleDate).getTime()).filter((t) => !isNaN(t));
      const latestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
      const latestDateStr = new Date(latestTimestamp).toISOString();

      orders.push({
        orderKey: key,
        orderCode,
        customerName: first.customerName || 'N/A',
        customerPhone: first.customerPhone || 'N/A',
        customerAddress: first.customerAddress || 'N/A',
        district: first.district,
        thana: first.thana,
        saleDate: latestDateStr,
        timestamp: latestTimestamp,
        items,
        totalQuantity,
        totalAmount,
        totalProfit,
        deliveryFee,
        grandTotal,
        isDeliveryAdvance,
        notes: combinedNotes.trim(),
        courierPartner,
        trackingCode,
        courierTrackingUrl,
        paymentStatus,
        saleStatus,
        deliveryStatus,
        status,
      });
    });

    return orders.sort((a, b) => b.timestamp - a.timestamp);
  }, [salesList, productsList]);

  // Counts for the 4 status tabs
  const counts = useMemo(() => {
    const res = {
      all: groupedOrders.length,
      pending: 0,
      delivered: 0,
      cancelled: 0,
    };
    groupedOrders.forEach((order) => {
      if (order.status === 'pending') res.pending++;
      else if (order.status === 'delivered') res.delivered++;
      else if (order.status === 'cancelled') res.cancelled++;
    });
    return res;
  }, [groupedOrders]);

  // Selected Order for Detailed View
  const selectedOrder = useMemo(() => {
    if (!selectedOrderKey) return null;
    return groupedOrders.find((o) => o.orderKey === selectedOrderKey) || null;
  }, [selectedOrderKey, groupedOrders]);

  // Main order filtering pipeline
  const filteredOrders = useMemo(() => {
    return groupedOrders.filter((order) => {
      if (filterStatus !== 'all' && order.status !== filterStatus) {
        return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const mCode = order.orderCode.toLowerCase().includes(q) || order.orderKey.toLowerCase().includes(q);
        const mCustomer = order.customerName.toLowerCase().includes(q) || order.customerPhone.includes(q);
        const mProduct = order.items.some((item) => item.productName?.toLowerCase().includes(q));
        if (!mCode && !mCustomer && !mProduct) {
          return false;
        }
      }

      if (dateFilter !== 'all') {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (dateFilter === 'today' && now - order.timestamp > oneDay) return false;
        if (dateFilter === '7days' && now - order.timestamp > 7 * oneDay) return false;
        if (dateFilter === '30days' && now - order.timestamp > 30 * oneDay) return false;
      }

      if (paymentFilter !== 'all') {
        if (paymentFilter === 'paid' && order.paymentStatus !== 'PAID') return false;
        if (paymentFilter === 'pending' && order.paymentStatus !== 'PENDING') return false;
      }

      return true;
    });
  }, [groupedOrders, filterStatus, search, dateFilter, paymentFilter]);

  // Overall financial summary
  const summaryTotals = useMemo(() => {
    return filteredOrders.reduce(
      (acc, order) => {
        acc.totalOrders += 1;
        acc.totalQuantity += order.totalQuantity;
        acc.totalAmount += order.totalAmount;
        acc.totalProfit += order.totalProfit;
        if (order.status === 'delivered' || order.paymentStatus === 'PAID') {
          acc.paidProfit += order.totalProfit;
        } else {
          acc.pendingProfit += order.totalProfit;
        }
        return acc;
      },
      {
        totalOrders: 0,
        totalQuantity: 0,
        totalAmount: 0,
        totalProfit: 0,
        paidProfit: 0,
        pendingProfit: 0,
      }
    );
  }, [filteredOrders]);

  // Compact Single-Line Status Badge Helper (whitespace-nowrap)
  const getStatusBadge = (order: GroupedOrder) => {
    if (order.status === 'cancelled') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold bg-rose-50 text-rose-700 border-rose-200 shrink-0 whitespace-nowrap">
          <XCircle className="w-3 h-3 text-rose-600" />
          <span>{lang === 'bn' ? 'বাতিল' : 'Cancelled'}</span>
        </span>
      );
    }
    if (order.status === 'delivered') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold bg-emerald-50 text-emerald-800 border-emerald-200 shrink-0 whitespace-nowrap">
          <CheckCircle2 className="w-3 h-3 text-[#009245]" />
          <span>{lang === 'bn' ? 'ডেলিভার্ড' : 'Delivered'}</span>
        </span>
      );
    }
    if (order.items.some(s => s.saleStatus === 'Confirmed' || (s as any).status === 'CONFIRMED')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold bg-blue-50 text-blue-800 border-blue-200 shrink-0 whitespace-nowrap">
          <CheckCircle2 className="w-3 h-3 text-blue-600" />
          <span>{lang === 'bn' ? 'অর্ডার কনফার্মড' : 'Confirmed'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold bg-amber-50 text-amber-900 border-amber-300 shrink-0 whitespace-nowrap">
        <Clock className="w-3 h-3 text-amber-600 animate-spin-slow" />
        <span>{lang === 'bn' ? 'পেন্ডিং ভেরিফিকেশন' : 'Pending'}</span>
      </span>
    );
  };

  // -------------------------------------------------------------
  // DETAILED VIEW (VIEW DETAILS)
  // EXACT ORDER OF SECTIONS AS EXPLICITLY INSTRUCTED BY USER:
  // ১. সবার উপরে: অর্ডার হেডার ও প্রসেসিং ট্র্যাকিং (এক লাইনে)
  // ২. কাস্টমারের তথ্য (আগে দেওয়া থাকবে - এক লাইনে)
  // ৩. পণ্য বিবরণ (সিরিয়ালে কতগুলো পণ্য নিছি - পরিমাণ ও 'টি' এক লাইনে)
  // ৪. সর্বমোট হিসাব ও প্রফিট (১টি সুন্দর সিঙ্গেল কার্ড, নো ডাবল বক্স)
  // ৫. কুরিয়ার বুকিং ট্র্যাকিং ও অপেক্ষা চলমান নোটিশ (সবার লাস্টে থাকবে!)
  // -------------------------------------------------------------
  if (selectedOrder) {
    const hasCourierTracking = Boolean(selectedOrder.trackingCode || selectedOrder.courierTrackingUrl);
    const courierName = selectedOrder.courierPartner || 'Steadfast Courier';
    const activeTrackingCode = selectedOrder.trackingCode || `STEAD-${selectedOrder.orderCode.replace(/[^0-9]/g, '').slice(-6) || '789123'}`;
    const activeTrackingUrl = selectedOrder.courierTrackingUrl || `https://steadfast.com.bd/t/${activeTrackingCode}`;
    const isApproved = selectedOrder.saleStatus === 'Approved' || selectedOrder.saleStatus === 'Confirmed' || (selectedOrder.items && selectedOrder.items.some(s => (s as any).saleStatus === 'Confirmed' || (s as any).status === 'CONFIRMED' || (s as any).saleStatus === 'Approved'));
    const isShipped = selectedOrder.deliveryStatus === 'shipped' || selectedOrder.status === 'delivered';
    const isDelivered = selectedOrder.status === 'delivered' || selectedOrder.paymentStatus === 'PAID';

    // Calculate road tracker stage (1 to 4) & progress percentage
    let currentStage = 1;
    let progressPercent = 12.5;

    if (isDelivered) {
      currentStage = 4;
      progressPercent = 88;
    } else if (isShipped || hasCourierTracking) {
      currentStage = 3;
      progressPercent = 63;
    } else if (isApproved || selectedOrder.deliveryStatus === 'processing') {
      currentStage = 2;
      progressPercent = 38;
    }

    return (
      <div className="space-y-3 text-slate-800 font-sans pb-32 animate-in fade-in duration-200">
        
        {/* ============================================================= */}
        {/* ১. সবার উপরে: অর্ডার হেডার ও অর্ডার প্রসেসিং ট্র্যাকিং (এক লাইনে) */}
        {/* ============================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-3xs space-y-2.5">
          {/* Header Line: Back button, Order Code, Date & Time, Status Badge, Cash Memo Button */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 py-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedOrderKey(null)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ফিরুন' : 'Back'}</span>
              </button>

              <span className="font-mono text-xs font-black text-sky-900 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0">
                {selectedOrder.orderCode}
              </span>
            </div>

            {/* Date & Time Single Line Badge */}
            <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0">
              <Calendar className="w-3 h-3 text-[#009245]" />
              <span>{formatDateOnly(selectedOrder.saleDate, 'bn')}</span>
              <span className="text-slate-300">•</span>
              <Clock className="w-3 h-3 text-blue-600" />
              <span className="text-blue-700">{formatTimeOnly(selectedOrder.saleDate, 'bn')}</span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {getStatusBadge(selectedOrder)}

              <button
                type="button"
                onClick={() => {
                  setMemoModalData({
                    orderId: selectedOrder.orderCode,
                    date: `${formatDateOnly(selectedOrder.saleDate, 'bn')}, ${formatTimeOnly(selectedOrder.saleDate, 'bn')}`,
                    customerName: selectedOrder.customerName,
                    customerPhone: selectedOrder.customerPhone,
                    fullAddress: selectedOrder.customerAddress,
                    items: selectedOrder.items.map((item) => ({
                      nameBn: item.productName,
                      productCode: item.productCode,
                      size: item.size,
                      quantity: item.quantity,
                      sellingPrice: item.sellingPrice,
                    })),
                    productsTotalAmount: selectedOrder.totalAmount,
                    deliveryFee: selectedOrder.deliveryFee,
                    grandTotalAmount: selectedOrder.grandTotal,
                  });
                }}
                className="px-2.5 py-1 bg-[#009245] hover:bg-[#007a37] text-white text-xs font-black rounded-lg transition inline-flex items-center gap-1 shadow-3xs cursor-pointer active:scale-95 shrink-0 whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ক্যাশ মেমো' : 'Memo'}</span>
              </button>
            </div>
          </div>

          {/* SINGLE-LINE ORDER PROCESSING & TRAFFIC TRACKER (এক লাইনে ট্র্যাকিং) */}
          <div className="pt-3 pb-1 border-t border-slate-100">
            {/* Animated Road Track with Truck */}
            <div className="relative mb-2 px-1">
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-[#009245] to-emerald-600 transition-all duration-700 rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Truck moving on line */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-700 z-10"
                style={{ left: `${progressPercent}%` }}
              >
                <div className="w-6 h-6 rounded-full bg-white border-2 border-[#009245] text-[#009245] shadow-xs flex items-center justify-center">
                  <Truck className="w-3 h-3 fill-emerald-50" />
                </div>
              </div>
            </div>

            {/* 4 STAGES STRICTLY IN ONE SINGLE LINE (whitespace-nowrap) */}
            <div className="flex items-center justify-between gap-1 text-[11px] whitespace-nowrap overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden pt-0.5">
              <div className={`flex items-center gap-1 font-bold shrink-0 ${currentStage >= 1 ? 'text-[#009245]' : 'text-slate-400'}`}>
                <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black ${currentStage >= 1 ? 'bg-[#009245] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  ✓
                </span>
                <span>{lang === 'bn' ? '১. প্লেসড' : '1. Placed'}</span>
              </div>

              <span className="text-slate-300 text-[10px] shrink-0">➔</span>

              <div className={`flex items-center gap-1 font-bold shrink-0 ${currentStage >= 2 ? 'text-[#009245]' : currentStage === 1 ? 'text-amber-800 font-black animate-pulse' : 'text-slate-400'}`}>
                <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black ${currentStage >= 2 ? 'bg-[#009245] text-white' : currentStage === 1 ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  ২
                </span>
                <span>{lang === 'bn' ? '২. বুকিং' : '2. Booked'}</span>
              </div>

              <span className="text-slate-300 text-[10px] shrink-0">➔</span>

              <div className={`flex items-center gap-1 font-bold shrink-0 ${currentStage >= 3 ? 'text-[#009245]' : currentStage === 2 ? 'text-blue-700 font-black animate-pulse' : 'text-slate-400'}`}>
                <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black ${currentStage >= 3 ? 'bg-[#009245] text-white' : currentStage === 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  ৩
                </span>
                <span>{lang === 'bn' ? '৩. ট্রানজিট' : '3. Transit'}</span>
              </div>

              <span className="text-slate-300 text-[10px] shrink-0">➔</span>

              <div className={`flex items-center gap-1 font-bold shrink-0 ${currentStage >= 4 ? 'text-emerald-700 font-black' : 'text-slate-400'}`}>
                <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-black ${currentStage >= 4 ? 'bg-[#009245] text-white' : 'bg-slate-200 text-slate-500'}`}>
                  ৪
                </span>
                <span>{lang === 'bn' ? '৪. ডেলিভার্ড' : '4. Delivered'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================= */}
        {/* ২. কাস্টমারের তথ্য (CUSTOMER INFO - স্পষ্ট, ২/৩ লাইনে ফাঁকা ফাঁকা সুন্দর ডিজাইন) */}
        {/* ============================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-3xs space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-[#009245]" />
              <span>{lang === 'bn' ? 'কাস্টমারের বিবরণ ও ঠিকানা' : 'Customer Details & Address'}</span>
            </h3>
            <a
              href={`tel:${selectedOrder.customerPhone}`}
              className="px-2.5 py-1 bg-[#009245] hover:bg-[#007a37] text-white text-xs font-black rounded-lg transition inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shadow-3xs active:scale-95"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'কল করুন' : 'Call'}</span>
            </a>
          </div>

          <div className="space-y-2 text-xs">
            {/* Row 1: Name & Phone in clean, spacious layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {lang === 'bn' ? 'কাস্টমারের নাম' : 'Customer Name'}
                </span>
                <strong className="text-sm font-black text-slate-900 block leading-tight">
                  {selectedOrder.customerName}
                </strong>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-0.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  {lang === 'bn' ? 'মোবাইল নম্বর' : 'Phone Number'}
                </span>
                <strong className="text-sm font-mono font-black text-[#009245] block leading-tight">
                  {selectedOrder.customerPhone}
                </strong>
              </div>
            </div>

            {/* Row 2: Full Address in dedicated readable box */}
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#009245]" />
                <span>{lang === 'bn' ? 'সম্পূর্ণ ডেলিভারি ঠিকানা' : 'Delivery Address'}</span>
              </span>
              <p className="text-xs font-bold text-slate-800 leading-relaxed pt-0.5">
                {selectedOrder.customerAddress}
              </p>
            </div>

            {/* Row 3: Delivery Fee System */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50/60 border border-emerald-100 text-xs">
              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-[#009245]" />
                <span>{lang === 'bn' ? 'ডেলিভারি মেথড:' : 'Delivery Method:'}</span>
              </span>
              <span className="font-mono font-black text-[#009245]">
                {selectedOrder.isDeliveryAdvance
                  ? (lang === 'bn' ? 'অগ্রিম পেমেন্টকৃত' : 'Advance Paid')
                  : (lang === 'bn' ? 'ক্যাশ অন ডেলিভারি (৳১২০)' : 'Cash on Delivery (৳120)')}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================= */}
        {/* ৩. পণ্য বিবরণ (PRODUCTS IN SERIAL - PROMINENT SIZE & QUANTITY) */}
        {/* ============================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-3xs space-y-1.5">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-[#009245]" />
              <span>{lang === 'bn' ? `পণ্য বিবরণ (${toBn(selectedOrder.items.length)}টি)` : `Products (${selectedOrder.items.length})`}</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-bold whitespace-nowrap">
              {lang === 'bn' ? `মোট পরিমাণ: ${toBn(selectedOrder.totalQuantity)}টি` : `Total: ${selectedOrder.totalQuantity}`}
            </span>
          </div>

          <div className="space-y-1.5">
            {selectedOrder.items.map((item, idx) => {
              const itemImg = getProductImage(item);
              const itemTotal = (item.totalAmount || (item.sellingPrice * item.quantity));

              return (
                <div
                  key={item.id || idx}
                  className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 border border-slate-100"
                >
                  {/* Left: Serial badge, Image, Name & Prominent Size Badge */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-5 h-5 rounded-md bg-slate-800 text-white text-[10px] font-black flex items-center justify-center shrink-0">
                      #{idx + 1}
                    </span>

                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0 shadow-3xs">
                      {itemImg ? (
                        <img src={itemImg} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package className="w-4 h-4 text-slate-300" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <span className="text-xs font-black text-slate-900 block truncate">
                        {item.productName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item.size ? (
                          <span className="bg-[#009245] text-white px-2 py-0.5 rounded-md font-black uppercase text-[10px] shrink-0 whitespace-nowrap shadow-3xs">
                            সাইজ: {item.size}
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-md font-bold text-[10px] shrink-0 whitespace-nowrap">
                            সাইজ: ফ্রি সাইজ
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Quantity, Total & Profit */}
                  <div className="flex flex-col items-end gap-1 shrink-0 whitespace-nowrap">
                    <span className="font-mono font-bold text-slate-800 bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">
                      {toBn(item.quantity)}টি × ৳{item.sellingPrice.toLocaleString()} = ৳{itemTotal.toLocaleString()}
                    </span>
                    <span className="text-[10px] font-black font-mono text-[#009245] bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                      প্রফিট: +৳{item.commissionAmount.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================================================= */}
        {/* ৪. সর্বমোট হিসাব ও প্রফিট (১টি একক প্রফেশনাল লাইন - নো ডাবল বক্স) */}
        {/* ============================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-3xs space-y-2">
          <h3 className="text-xs font-black text-slate-900 flex items-center gap-1.5 pb-1 border-b border-slate-100">
            <TrendingUp className="w-3.5 h-3.5 text-[#009245]" />
            <span>{lang === 'bn' ? 'সর্বমোট হিসাব ও প্রফিট' : 'Total Bill & Profit'}</span>
          </h3>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span>{lang === 'bn' ? `পণ্যের মোট মূল্য (${toBn(selectedOrder.totalQuantity)}টি):` : `Products Total:`}</span>
              <span className="font-mono font-bold text-slate-800">৳{selectedOrder.totalAmount.toLocaleString()}</span>
            </div>

            <div className="flex items-center justify-between text-slate-600">
              <span>{lang === 'bn' ? 'ডেলিভারি চার্জ:' : 'Delivery Fee:'}</span>
              <span className="font-mono font-bold text-slate-800">
                {selectedOrder.deliveryFee > 0 ? `+৳${selectedOrder.deliveryFee}` : '৳০'}
              </span>
            </div>

            <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-xs font-black text-slate-900">
              <span>{lang === 'bn' ? 'সর্বমোট কাস্টমার পেয়াবল:' : 'Grand Total Payable:'}</span>
              <span className="font-mono text-sm text-[#009245]">৳{selectedOrder.grandTotal.toLocaleString()}</span>
            </div>

            {/* Clean Single-Line Profit Row */}
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-xs font-black text-slate-800 whitespace-nowrap">
                  {lang === 'bn' ? 'আপনার প্রফিট:' : 'Your Profit:'}
                </span>
                <span className="font-mono text-sm sm:text-base font-black text-[#009245] whitespace-nowrap">
                  +৳{selectedOrder.totalProfit.toLocaleString()}
                </span>
              </div>

              <span className={`text-[10.5px] font-black px-2.5 py-0.5 rounded-md border shrink-0 whitespace-nowrap ${
                selectedOrder.paymentStatus === 'PAID' || selectedOrder.status === 'delivered'
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-amber-500 text-white border-amber-500'
              }`}>
                {selectedOrder.paymentStatus === 'PAID' || selectedOrder.status === 'delivered'
                  ? (lang === 'bn' ? 'পেইড (জমা হয়েছে)' : 'Paid')
                  : (lang === 'bn' ? 'পেন্ডিং (ডেলিভারির পর)' : 'Pending')}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================= */}
        {/* ৫. সবার লাস্টে: কুরিয়ার বুকিং ও অপেক্ষা চলমান নোটিশ + কপি বাটন */}
        {/* ============================================================= */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-3xs space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
            <h3 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-[#009245]" />
              <span>{lang === 'bn' ? 'কুরিয়ার বুকিং ও ট্র্যাকিং তথ্য' : 'Courier Tracking'}</span>
            </h3>
            {hasCourierTracking && (
              <span className="text-[10.5px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md whitespace-nowrap">
                {courierName}
              </span>
            )}
          </div>

          {/* CASE A: Awaiting Courier Booking Notice */}
          {!hasCourierTracking ? (
            <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-amber-950 font-black text-xs">
                  <Clock className="w-4 h-4 text-amber-600 animate-spin-slow shrink-0" />
                  <span>{lang === 'bn' ? 'কুরিয়ার বুকিং নোটিশ' : 'Courier Booking Notice'}</span>
                </div>
                <span className="text-[10px] font-black text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                  {lang === 'bn' ? 'প্রক্রিয়াধীন' : 'In Progress'}
                </span>
              </div>

              <p className="text-xs text-amber-950/90 leading-relaxed font-medium">
                {lang === 'bn'
                  ? 'আপনার বুকিং সম্পন্ন হলে আপনি এখানে সরাসরি লাইভ ট্র্যাকিং আইডি ও লিস্ট দেখতে পাবেন। এখান থেকে এক-ক্লিকে ট্র্যাকিং কোড ও লিংক কপি করার সুবিধা থাকবে। অ্যাডমিন প্যানেল থেকে কুরিয়ার বুকিং সম্পন্ন হওয়া মাত্রই অটোমেটিক ট্র্যাকিং চালু হয়ে যাবে।'
                  : 'Once booking is complete, live tracking ID and list with 1-click copy feature will appear here.'}
              </p>
            </div>
          ) : (
            /* CASE B: Courier Link / Code Active with COPY BUTTON */
            <div className="space-y-2">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 flex items-center gap-2 text-xs truncate">
                  <span className="text-slate-500 font-bold text-xs shrink-0">
                    {lang === 'bn' ? 'ট্র্যাকিং কোড:' : 'Tracking ID:'}
                  </span>
                  <span className="font-mono font-black text-slate-900 text-sm truncate">
                    {activeTrackingCode}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyTrackingLink(activeTrackingCode)}
                    className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-[#009245] border border-emerald-300 rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition shadow-3xs active:scale-95 whitespace-nowrap"
                    title="কুরিয়ার ট্র্যাকিং কোড কপি করুন"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedCode ? (lang === 'bn' ? 'কপি হয়েছে!' : 'Copied!') : (lang === 'bn' ? 'কপি করুন' : 'Copy')}</span>
                  </button>

                  {activeTrackingUrl && (
                    <a
                      href={activeTrackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-[#009245] hover:bg-[#007a37] text-white rounded-lg text-xs font-black flex items-center gap-1 cursor-pointer transition shadow-3xs active:scale-95 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{lang === 'bn' ? 'ট্র্যাক করুন' : 'Track'}</span>
                    </a>
                  )}
                </div>
              </div>

              {activeTrackingUrl && (
                <div className="text-[11px] font-mono text-slate-600 truncate bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
                  <span className="truncate">{activeTrackingUrl}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Back Button */}
        <div className="pt-2 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setSelectedOrderKey(null)}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-950 text-white text-xs font-bold rounded-lg cursor-pointer shadow-3xs transition-all active:scale-95"
          >
            {lang === 'bn' ? 'অর্ডার তালিকায় ফিরে যান ✕' : 'Back to Orders ✕'}
          </button>
        </div>

        {/* Reseller Cash Memo Modal */}
        <ResellerCashMemoModal
          isOpen={!!memoModalData}
          onClose={() => setMemoModalData(null)}
          memoData={memoModalData}
        />
      </div>
    );
  }

  // -------------------------------------------------------------
  // ORDERS TAB MAIN LIST VIEW (CLEAN, 1-LINE SECTIONS, ZERO HIBIJIBI)
  // -------------------------------------------------------------
  const tabsConfig = [
    {
      key: 'all' as const,
      labelBn: 'সব',
      labelEn: 'All',
      count: counts.all,
      activeBg: 'bg-[#009245] text-white border-[#009245]',
      activeCircle: 'bg-white text-[#009245]',
      inactiveBg: 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
      inactiveCircle: 'bg-slate-100 text-slate-700',
    },
    {
      key: 'pending' as const,
      labelBn: 'পেন্ডিং',
      labelEn: 'Pending',
      count: counts.pending,
      activeBg: 'bg-amber-500 text-white border-amber-500',
      activeCircle: 'bg-white text-amber-600',
      inactiveBg: 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
      inactiveCircle: 'bg-slate-100 text-slate-700',
    },
    {
      key: 'delivered' as const,
      labelBn: 'ডেলিভারি',
      labelEn: 'Delivery',
      count: counts.delivered,
      activeBg: 'bg-blue-600 text-white border-blue-600',
      activeCircle: 'bg-white text-blue-600',
      inactiveBg: 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
      inactiveCircle: 'bg-slate-100 text-slate-700',
    },
    {
      key: 'cancelled' as const,
      labelBn: 'বাতিল',
      labelEn: 'Cancelled',
      count: counts.cancelled,
      activeBg: 'bg-rose-600 text-white border-rose-600',
      activeCircle: 'bg-white text-rose-600',
      inactiveBg: 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
      inactiveCircle: 'bg-slate-100 text-slate-700',
    },
  ];

  return (
    <div className="space-y-3.5 text-slate-800 font-sans pb-28">
      
      {/* 1. Header Toolbar in ONE Line */}
      <div className="flex items-center justify-between gap-2">
        <div className="truncate">
          <h2 className="text-base font-black text-slate-900 tracking-tight truncate">
            {lang === 'bn' ? 'অর্ডার তালিকা ও সেলস হিস্ট্রি' : 'Order List & Sales History'}
          </h2>
          <p className="text-[11px] text-slate-500 truncate">
            {lang === 'bn' ? 'মাল্টিপল পণ্যের সিরিয়াল ও প্রফিট হিসাব' : 'Multi-item details and profit tracking'}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 flex items-center gap-1 shadow-3xs cursor-pointer active:scale-95 disabled:opacity-50 whitespace-nowrap"
              title="নতুন অর্ডার রিফ্রেশ করুন"
            >
              <RotateCw className={`w-3.5 h-3.5 text-[#009245] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{lang === 'bn' ? 'রিফ্রেশ' : 'Refresh'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenRecordSale}
            className="px-3 py-1 bg-[#009245] hover:bg-[#007a37] text-white rounded-lg text-xs font-black flex items-center gap-1 shadow-3xs cursor-pointer active:scale-95 whitespace-nowrap"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'নতুন সেল' : 'Record'}</span>
          </button>
        </div>
      </div>

      {/* 2. Top 4 Status Tabs */}
      <div className="grid grid-cols-4 gap-1.5">
        {tabsConfig.map((tab) => {
          const isActive = filterStatus === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterStatus(tab.key)}
              className={`flex flex-col items-center justify-between p-1.5 rounded-xl border transition-all h-14 cursor-pointer shadow-3xs ${
                isActive ? tab.activeBg : tab.inactiveBg
              }`}
            >
              <span className="text-[11px] font-bold whitespace-nowrap">
                {lang === 'bn' ? tab.labelBn : tab.labelEn}
              </span>
              <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
                isActive ? tab.activeCircle : tab.inactiveCircle
              }`}>
                {toBn(tab.count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === 'bn'
                ? 'অর্ডার কোড, কাস্টমারের নাম, ফোন দিয়ে খুঁজুন...'
                : 'Search by order code, customer name or phone...'
            }
            className="w-full pl-8.5 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-[#009245] outline-none shadow-3xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1 transition cursor-pointer shadow-3xs whitespace-nowrap ${
            showFilters
              ? 'bg-emerald-50 border-emerald-300 text-[#009245]'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{lang === 'bn' ? 'ফিল্টার' : 'Filter'}</span>
        </button>
      </div>

      {/* Expandable Advanced Filters */}
      {showFilters && (
        <div className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-3xs grid grid-cols-2 gap-2 animate-in fade-in duration-150">
          <div className="space-y-1">
            <label className="text-[9.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{lang === 'bn' ? 'তারিখ' : 'Date'}</span>
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1 text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">{lang === 'bn' ? 'সকল সময়' : 'All Time'}</option>
              <option value="today">{lang === 'bn' ? 'আজকের' : 'Today'}</option>
              <option value="7days">{lang === 'bn' ? '৭ দিন' : '7 Days'}</option>
              <option value="30days">{lang === 'bn' ? '৩০ দিন' : '30 Days'}</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[9.5px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <CreditCard className="w-3 h-3" />
              <span>{lang === 'bn' ? 'পেমেন্ট' : 'Payment'}</span>
            </label>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-1 text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">{lang === 'bn' ? 'সব' : 'All'}</option>
              <option value="pending">{lang === 'bn' ? 'পেন্ডিং' : 'Pending'}</option>
              <option value="paid">{lang === 'bn' ? 'পেইড' : 'Paid'}</option>
            </select>
          </div>
        </div>
      )}

      {/* 4. Orders List Display */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-2 shadow-3xs max-w-sm mx-auto my-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#009245] mx-auto flex items-center justify-center">
            <Package className="w-5 h-5" />
          </div>
          <h3 className="text-xs font-bold text-slate-800">
            {lang === 'bn' ? 'কোনো অর্ডার পাওয়া যায়নি' : 'No orders found'}
          </h3>
          <p className="text-[11px] text-slate-500 leading-normal">
            {lang === 'bn'
              ? 'কার্ট থেকে অর্ডার সম্পন্ন করুন অথবা নতুন সেল রেকর্ড করুন।'
              : 'Record customer orders from catalog or cart.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredOrders.map((order, idx) => {
            // Alternating card outer background and crisp professional outer borders
            const isEven = idx % 2 === 0;
            const cardBgClass = isEven 
              ? 'bg-[#F3F7FF] border-[#A9C8F5] shadow-xs' 
              : 'bg-[#FFFAF0] border-[#E8C98C] shadow-xs';

            return (
              <div
                key={order.orderKey}
                className={`${cardBgClass} border-2 rounded-2xl p-3 sm:p-3.5 transition-all space-y-2.5 animate-in fade-in duration-150 hover:shadow-md`}
              >
                {/* 1. Top Bar: Order Code, Date & Time, Status Badge */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-slate-200/60 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-mono text-xs font-black text-sky-900 bg-white/90 border border-sky-300 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 shadow-3xs">
                      {order.orderCode}
                    </span>

                    <span className="flex items-center gap-1 text-[10px] sm:text-[10.5px] font-mono font-bold text-slate-700 bg-white/90 px-1.5 py-0.5 rounded border border-slate-200 whitespace-nowrap shrink-0 shadow-3xs">
                      <Calendar className="w-3 h-3 text-[#009245]" />
                      <span>{formatDateOnly(order.saleDate, 'bn')}</span>
                      <span className="text-slate-300">•</span>
                      <Clock className="w-3 h-3 text-blue-600" />
                      <span className="text-blue-700">{formatTimeOnly(order.saleDate, 'bn')}</span>
                    </span>
                  </div>

                  <div className="shrink-0">
                    {getStatusBadge(order)}
                  </div>
                </div>

                {/* 2. Customer Info Bar */}
                <div className="space-y-1.5 text-xs pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <UserCheck className="w-3.5 h-3.5 text-[#009245] shrink-0" />
                      <span className="font-black text-slate-900 text-xs sm:text-sm truncate">{order.customerName}</span>
                    </div>
                    <a
                      href={`tel:${order.customerPhone}`}
                      className="font-mono text-xs font-black text-slate-800 bg-white/90 px-2 py-0.5 rounded-md border border-slate-200 flex items-center gap-1 hover:text-[#009245] shrink-0 shadow-3xs"
                    >
                      <Phone className="w-3 h-3 text-[#009245]" />
                      <span>{order.customerPhone}</span>
                    </a>
                  </div>

                  <div className="flex items-start gap-1.5 text-slate-700 text-xs font-medium leading-relaxed pl-0.5">
                    <MapPin className="w-3.5 h-3.5 text-[#009245] shrink-0 mt-0.5" />
                    <span>{order.customerAddress}</span>
                  </div>
                </div>

                {/* 3. Products in Serial */}
                <div className="space-y-1.5 pt-1 border-t border-slate-200/50">
                  <div className="text-[10px] font-black text-slate-600 uppercase tracking-wide px-0.5">
                    {lang === 'bn' ? 'অর্ডারকৃত পণ্যসমূহ:' : 'Ordered Products:'}
                  </div>
                  {order.items.map((item, idx) => {
                    const itemImg = getProductImage(item);
                    const itemTotal = (item.totalAmount || (item.sellingPrice * item.quantity));

                    return (
                      <div
                        key={item.id || idx}
                        className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5 py-1.5 px-2 rounded-xl bg-white/85 border border-slate-200/80 min-w-0 shadow-3xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="w-4 h-4 rounded bg-slate-800 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                            #{idx + 1}
                          </span>

                          <div className="w-8 h-8 rounded-md bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                            {itemImg ? (
                              <img src={itemImg} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Package className="w-3 h-3 text-slate-300" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-bold text-slate-900 block truncate">
                              {item.productName}
                            </span>
                            {item.size ? (
                              <span className="bg-[#009245] text-white px-1.5 py-0.2 rounded font-black text-[9.5px] shrink-0 whitespace-nowrap inline-block mt-0.5">
                                সাইজ: {item.size}
                              </span>
                            ) : (
                              <span className="bg-slate-200 text-slate-700 px-1 py-0.2 rounded font-bold text-[9.5px] shrink-0 whitespace-nowrap inline-block mt-0.5">
                                সাইজ: ফ্রি সাইজ
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                          <span className="font-mono font-bold text-slate-800 bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[10px] sm:text-[10.5px] whitespace-nowrap shrink-0">
                            {toBn(item.quantity)}টি × ৳{item.sellingPrice.toLocaleString()}
                          </span>

                          <span className="font-mono text-xs font-black text-slate-900 whitespace-nowrap">
                            ৳{itemTotal.toLocaleString()}
                          </span>
                          <span className="text-[9.5px] font-black font-mono text-[#009245] bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 whitespace-nowrap">
                            +৳{item.commissionAmount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4. Footer: Bill, Profit & Actions */}
                <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 font-semibold whitespace-nowrap">
                        {lang === 'bn' ? 'বিল:' : 'Bill:'}
                      </span>
                      <span className="font-mono text-xs font-black text-slate-900 whitespace-nowrap">
                        ৳{order.grandTotal.toLocaleString()}
                      </span>
                    </div>

                    <div className="h-3.5 w-px bg-slate-300 shrink-0" />

                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 font-semibold whitespace-nowrap">
                        {lang === 'bn' ? 'প্রফিট:' : 'Profit:'}
                      </span>
                      {order.paymentStatus === 'PAID' || order.status === 'delivered' ? (
                        <span className="font-mono text-[11px] font-black text-[#009245] whitespace-nowrap">
                          +৳{order.totalProfit.toLocaleString()} (পেইড)
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] font-black text-amber-800 whitespace-nowrap">
                          +৳{order.totalProfit.toLocaleString()} (পেন্ডিং)
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setMemoModalData({
                          orderId: order.orderCode,
                          date: `${formatDateOnly(order.saleDate, 'bn')}, ${formatTimeOnly(order.saleDate, 'bn')}`,
                          customerName: order.customerName,
                          customerPhone: order.customerPhone,
                          fullAddress: order.customerAddress,
                          items: order.items.map((item) => ({
                            nameBn: item.productName,
                            productCode: item.productCode,
                            size: item.size,
                            quantity: item.quantity,
                            sellingPrice: item.sellingPrice,
                          })),
                          productsTotalAmount: order.totalAmount,
                          deliveryFee: order.deliveryFee,
                          grandTotalAmount: order.grandTotal,
                        });
                      }}
                      className="px-2 py-1 bg-white/90 hover:bg-white text-slate-700 text-[11px] font-bold rounded-lg border border-slate-300 transition flex items-center gap-1 cursor-pointer whitespace-nowrap shadow-3xs"
                      title="ক্যাশ মেমো দেখুন"
                    >
                      <FileText className="w-3 h-3 text-slate-500" />
                      <span>{lang === 'bn' ? 'মেমো' : 'Memo'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedOrderKey(order.orderKey)}
                      className="px-2.5 py-1 bg-[#009245] hover:bg-[#007a37] text-white text-[11px] font-black rounded-lg transition flex items-center gap-1 shadow-3xs cursor-pointer active:scale-95 whitespace-nowrap"
                    >
                      <span>{lang === 'bn' ? 'বিস্তারিত' : 'Details'}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* 5. Overall Financial Summary Card at the bottom */}
      {filteredOrders.length > 0 && (
        <div className="bg-gradient-to-br from-emerald-950 to-slate-900 text-white rounded-2xl p-4 shadow-md border border-emerald-800/30 space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-800/40 pb-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-black uppercase tracking-wider text-emerald-300">
                {lang === 'bn' ? 'সর্বমোট হিসাব ও প্রফিট' : 'Overall Summary'}
              </h4>
            </div>
            <span className="text-[11px] bg-emerald-500 text-slate-950 font-mono font-black px-2 py-0.5 rounded-full whitespace-nowrap">
              {toBn(summaryTotals.totalOrders)}টি অর্ডার
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="bg-white/5 p-2 rounded-xl border border-white/10">
              <span className="text-[9.5px] uppercase font-bold text-slate-400 block mb-0.5">মোট পণ্য</span>
              <span className="font-mono text-sm font-black text-white">{toBn(summaryTotals.totalQuantity)} টি</span>
            </div>
            <div className="bg-white/5 p-2 rounded-xl border border-white/10">
              <span className="text-[9.5px] uppercase font-bold text-slate-400 block mb-0.5">মোট বিক্রয়</span>
              <span className="font-mono text-sm font-black text-white">৳{summaryTotals.totalAmount.toLocaleString()}</span>
            </div>
            <div className="bg-amber-500/10 p-2 rounded-xl border border-amber-500/30">
              <span className="text-[9.5px] uppercase font-bold text-amber-300 block mb-0.5">পেন্ডিং প্রফিট</span>
              <span className="font-mono text-sm font-black text-amber-400">৳{summaryTotals.pendingProfit.toLocaleString()}</span>
            </div>
            <div className="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/30">
              <span className="text-[9.5px] uppercase font-bold text-emerald-300 block mb-0.5">পেইড প্রফিট</span>
              <span className="font-mono text-sm font-black text-emerald-400">৳{summaryTotals.paidProfit.toLocaleString()}</span>
            </div>
          </div>

          <div className="pt-1.5 border-t border-emerald-800/40 flex items-center justify-between text-xs">
            <span className="text-emerald-200/80 font-bold">
              {lang === 'bn' ? 'মোট সম্ভাব্য প্রফিট:' : 'Total Profit:'}
            </span>
            <span className="font-mono text-base font-black text-emerald-300 whitespace-nowrap">
              +৳{summaryTotals.totalProfit.toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Reseller Cash Memo Modal */}
      <ResellerCashMemoModal
        isOpen={!!memoModalData}
        onClose={() => setMemoModalData(null)}
        memoData={memoModalData}
      />
    </div>
  );
};
