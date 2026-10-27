import React from 'react';
import {
  Wallet,
  TrendingUp,
  ArrowDownLeft,
  Clock,
  ChevronRight,
  Sparkles,
  GraduationCap,
  Megaphone,
  Package,
  DollarSign,
  Users,
  Bell,
  HelpCircle,
  Globe,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Sale, Transaction } from '../../types/index.js';
import { ResellerTrainingBanner } from './ResellerTrainingBanner.js';

interface ResellerDashboardTabProps {
  salesList?: Sale[];
  transactionsList?: Transaction[];
  onOpenRecordSale?: () => void;
  onOpenWithdraw?: () => void;
  onSwitchTab: (tab: any) => void;
}

export const ResellerDashboardTab: React.FC<ResellerDashboardTabProps> = ({
  salesList,
  transactionsList,
  onOpenRecordSale,
  onOpenWithdraw,
  onSwitchTab,
}) => {
  const { lang, employee } = useApp();

  if (!employee) return null;
  const wallet = employee.wallet;

  const quickAccessItems = [
    {
      id: 'training',
      labelBn: 'কোর্সসমূহ',
      labelEn: 'Courses',
      icon: GraduationCap,
      color: 'text-emerald-600',
      bg: 'bg-emerald-100/70',
      cardBg: 'bg-emerald-50/35',
      cardBorder: 'border-emerald-200/90',
      cardHover: 'hover:border-emerald-300 hover:bg-emerald-50/60',
      subBn: 'ভিডিও দেখে শিখুন',
      subEn: 'Watch & Learn',
    },
    {
      id: 'campaigns',
      labelBn: 'ক্যাম্পেইনস ও ভিডিও',
      labelEn: 'Campaigns & Video',
      icon: Megaphone,
      color: 'text-rose-600',
      bg: 'bg-rose-100/70',
      cardBg: 'bg-rose-50/35',
      cardBorder: 'border-rose-200/90',
      cardHover: 'hover:border-rose-300 hover:bg-rose-50/60',
      subBn: 'ভিডিও ও বিজ্ঞাপন মেকার',
      subEn: 'Video & Ads Studio',
      isNew: true,
    },
    {
      id: 'orders',
      labelBn: 'আমার অর্ডার',
      labelEn: 'My Orders',
      icon: Package,
      color: 'text-blue-600',
      bg: 'bg-blue-100/70',
      cardBg: 'bg-blue-50/35',
      cardBorder: 'border-blue-200/90',
      cardHover: 'hover:border-blue-300 hover:bg-blue-50/60',
      subBn: 'সব অর্ডারের স্ট্যাটাস',
      subEn: 'Order Status',
    },
    {
      id: 'create-website',
      labelBn: 'ওয়েবসাইট তৈরি করুন',
      labelEn: 'Create Website',
      icon: Globe,
      color: 'text-amber-600',
      bg: 'bg-amber-100/70',
      cardBg: 'bg-amber-50/35',
      cardBorder: 'border-amber-200/90',
      cardHover: 'hover:border-amber-300 hover:bg-amber-50/60',
      subBn: 'নিজের কাস্টম শপ',
      subEn: 'Custom Shop Store',
      isNew: true,
    },
    {
      id: 'withdrawal',
      labelBn: 'উইথড্র',
      labelEn: 'Withdraw',
      icon: DollarSign,
      color: 'text-violet-600',
      bg: 'bg-violet-100/70',
      cardBg: 'bg-violet-50/35',
      cardBorder: 'border-violet-200/90',
      cardHover: 'hover:border-violet-300 hover:bg-violet-50/60',
      subBn: 'ব্যালেন্স উত্তোলন',
      subEn: 'Payouts',
    },
    {
      id: 'referral',
      labelBn: 'রেফারেল',
      labelEn: 'Referral',
      icon: Users,
      color: 'text-pink-600',
      bg: 'bg-pink-100/70',
      cardBg: 'bg-pink-50/35',
      cardBorder: 'border-pink-200/90',
      cardHover: 'hover:border-pink-300 hover:bg-pink-50/60',
      subBn: 'ক্লায়েন্ট ও আয় দেখুন',
      subEn: 'Clients & Income',
    },
    {
      id: 'earnings',
      labelBn: 'ইনকাম হিস্টরি',
      labelEn: 'Income History',
      icon: TrendingUp,
      color: 'text-emerald-700',
      bg: 'bg-emerald-100/70',
      cardBg: 'bg-emerald-50/35',
      cardBorder: 'border-emerald-200/90',
      cardHover: 'hover:border-emerald-300 hover:bg-emerald-50/60',
      subBn: 'আপনার আয়ের বিস্তারিত দেখুন',
      subEn: 'View detailed earnings',
    },
    {
      id: 'notifications',
      labelBn: 'নোটিশ ও আপডেট',
      labelEn: 'Notifications',
      icon: Bell,
      color: 'text-indigo-600',
      bg: 'bg-indigo-100/70',
      cardBg: 'bg-indigo-50/35',
      cardBorder: 'border-indigo-200/90',
      cardHover: 'hover:border-indigo-300 hover:bg-indigo-50/60',
      subBn: 'গুরুত্বপূর্ণ তথ্য',
      subEn: 'Important info',
    },
    {
      id: 'support',
      labelBn: 'সাহায্য / সাপোর্ট',
      labelEn: 'Support',
      icon: HelpCircle,
      color: 'text-teal-600',
      bg: 'bg-teal-100/70',
      cardBg: 'bg-teal-50/35',
      cardBorder: 'border-teal-200/90',
      cardHover: 'hover:border-teal-300 hover:bg-teal-50/60',
      subBn: 'FAQ, সমস্যা সমাধান',
      subEn: 'Help Desk',
    },
  ];

  return (
    <div className="space-y-6 sm:space-y-10 w-full overflow-x-hidden pb-10">
      
      {/* 1. Reseller Training & Visual Banner */}
      <div className="w-full">
        <ResellerTrainingBanner onLearnClick={() => onSwitchTab('training')} />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6 sm:space-y-10">
        
        {/* 2. Financial Balance Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-5 w-full">
        
          {/* Card 1: Available Balance */}
          <div 
            onClick={() => onSwitchTab('withdrawal')}
            className="bg-emerald-50/40 border border-emerald-200/90 hover:border-emerald-300 hover:bg-emerald-50/70 rounded-2xl p-3 sm:p-5 shadow-xs flex items-center gap-2.5 sm:gap-4 relative overflow-hidden group transition-all cursor-pointer"
          >
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-100/70 text-emerald-600 flex items-center justify-center shrink-0 shadow-xs">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9.5px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block leading-none mb-1 truncate">
                {lang === 'bn' ? 'বর্তমান ব্যালেন্স' : 'Available Balance'}
              </span>
              <div className="text-base sm:text-xl font-black text-slate-900 font-mono tabular-nums leading-none">
                ৳{wallet.availableBalance.toLocaleString()}
              </div>
              <p className="text-[8px] sm:text-[10px] text-emerald-600 font-bold mt-1 leading-none truncate">
                {lang === 'bn' ? 'বোনাস যুক্ত' : 'Bonus Included'}
              </p>
            </div>
            <div className="absolute right-2.5 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>

          {/* Card 2: Total Earnings */}
          <div className="bg-sky-50/40 border border-sky-200/90 hover:border-sky-300 hover:bg-sky-50/70 rounded-2xl p-3 sm:p-5 shadow-xs flex items-center gap-2.5 sm:gap-4 relative overflow-hidden group transition-all">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-sky-100/70 text-sky-600 flex items-center justify-center shrink-0 shadow-xs">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9.5px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block leading-none mb-1 truncate">
                {lang === 'bn' ? 'মোট কমিশন' : 'Total Commission'}
              </span>
              <div className="text-base sm:text-xl font-black text-slate-900 font-mono tabular-nums leading-none">
                ৳{wallet.totalEarnings.toLocaleString()}
              </div>
              <p className="text-[8px] sm:text-[10px] text-sky-600 font-bold mt-1 leading-none truncate">
                {lang === 'bn' ? 'অর্জিত লাভ' : 'Earned'}
              </p>
            </div>
            <div className="absolute right-2.5 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>

          {/* Card 3: Total Withdrawn */}
          <div className="bg-violet-50/40 border border-violet-200/90 hover:border-violet-300 hover:bg-violet-50/70 rounded-2xl p-3 sm:p-5 shadow-xs flex items-center gap-2.5 sm:gap-4 relative overflow-hidden group transition-all">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-violet-100/70 text-violet-600 flex items-center justify-center shrink-0 shadow-xs">
              <ArrowDownLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9.5px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block leading-none mb-1 truncate">
                {lang === 'bn' ? 'মোট উইথড্র' : 'Total Withdrawn'}
              </span>
              <div className="text-base sm:text-xl font-black text-slate-900 font-mono tabular-nums leading-none">
                ৳{wallet.totalWithdrawn.toLocaleString()}
              </div>
              <p className="text-[8px] sm:text-[10px] text-slate-400 font-bold mt-1 leading-none truncate">
                {lang === 'bn' ? 'উত্তোলিত' : 'Paid Out'}
              </p>
            </div>
            <div className="absolute right-2.5 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>

          {/* Card 4: Pending Withdrawal */}
          <div className="bg-amber-50/40 border border-amber-200/90 hover:border-amber-300 hover:bg-amber-50/70 rounded-2xl p-3 sm:p-5 shadow-xs flex items-center gap-2.5 sm:gap-4 relative overflow-hidden group transition-all">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-100/70 text-amber-600 flex items-center justify-center shrink-0 shadow-xs">
              <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[9.5px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider block leading-none mb-1 truncate">
                {lang === 'bn' ? 'পেন্ডিং উইথড্র' : 'Pending Payout'}
              </span>
              <div className="text-base sm:text-xl font-black text-slate-900 font-mono tabular-nums leading-none">
                ৳{wallet.pendingWithdrawal.toLocaleString()}
              </div>
              <p className="text-[8px] sm:text-[10px] text-amber-600 font-bold mt-1 leading-none truncate">
                {lang === 'bn' ? 'প্রসেসিং হচ্ছে' : 'Processing'}
              </p>
            </div>
            <div className="absolute right-2.5 top-2.5 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">
              <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>

        </div>

        {/* 3. Quick Action Hub / Service Grid */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>{lang === 'bn' ? 'সার্ভিস ও ফিচারসমূহ' : 'Services & Features'}</span>
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {quickAccessItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSwitchTab(item.id)}
                  className={`border ${item.cardBorder} ${item.cardBg} ${item.cardHover} rounded-2xl p-3.5 sm:p-4 text-left transition-all hover:shadow-xs group cursor-pointer flex flex-col justify-between relative overflow-hidden`}
                >
                  {item.isNew && (
                    <span className="absolute top-2.5 right-2.5 px-1.5 py-0.5 bg-rose-50 text-rose-600 border border-rose-100 rounded-md text-[9px] font-black uppercase tracking-wider">
                      New
                    </span>
                  )}
                  <div className="space-y-2.5">
                    <div className={`w-9 h-9 rounded-xl ${item.bg} ${item.color} flex items-center justify-center transition-transform group-hover:scale-105`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                        {lang === 'bn' ? item.labelBn : item.labelEn}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                        {lang === 'bn' ? item.subBn : item.subEn}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100/80 flex items-center justify-between text-[10px] font-bold text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>{lang === 'bn' ? 'প্রবেশ করুন' : 'Open'}</span>
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      </div>

    </div>
  );
};
