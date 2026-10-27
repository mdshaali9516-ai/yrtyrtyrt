import React, { useState, useEffect } from 'react';
import { Package, ArrowRight, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

interface ResellerAddingToOrderBannerProps {
  isCheckoutOpen?: boolean;
}

export const ResellerAddingToOrderBanner: React.FC<ResellerAddingToOrderBannerProps> = ({ isCheckoutOpen = false }) => {
  const { lang, showToast } = useApp();
  const [isActive, setIsActive] = useState(false);
  const [itemCount, setItemCount] = useState(0);

  const checkState = () => {
    if (typeof window === 'undefined') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    const isMode = sessionStorage.getItem('tawzoon_reseller_is_adding_to_order') === 'true';
    setIsActive(isMode);
    try {
      const items = JSON.parse(sessionStorage.getItem('tawzoon_reseller_pending_order_items') || '[]');
      setItemCount(Array.isArray(items) ? items.length : 0);
    } catch {
      setItemCount(0);
    }
  };

  useEffect(() => {
    checkState();

    const handleModeChange = () => checkState();
    window.addEventListener('tawzoon_reseller_order_mode_changed', handleModeChange);
    window.addEventListener('storage', handleModeChange);

    const interval = setInterval(checkState, 800);

    return () => {
      window.removeEventListener('tawzoon_reseller_order_mode_changed', handleModeChange);
      window.removeEventListener('storage', handleModeChange);
      clearInterval(interval);
    };
  }, []);

  if (!isActive || isCheckoutOpen) return null;

  const handleReturnToOrderForm = () => {
    try {
      const items = JSON.parse(sessionStorage.getItem('tawzoon_reseller_pending_order_items') || '[]');
      sessionStorage.removeItem('tawzoon_reseller_is_adding_to_order');
      setIsActive(false);
      window.dispatchEvent(new Event('tawzoon_reseller_order_mode_changed'));
      window.dispatchEvent(
        new CustomEvent('tawzoon_open_reseller_checkout', {
          detail: { items: Array.isArray(items) ? items : [] },
        })
      );
    } catch {
      sessionStorage.removeItem('tawzoon_reseller_is_adding_to_order');
      setIsActive(false);
      window.dispatchEvent(new CustomEvent('tawzoon_open_reseller_checkout', { detail: { items: [] } }));
    }
  };

  const handleCancel = () => {
    sessionStorage.removeItem('tawzoon_reseller_is_adding_to_order');
    setIsActive(false);
    window.dispatchEvent(new Event('tawzoon_reseller_order_mode_changed'));
    showToast(lang === 'bn' ? 'অর্ডারে পণ্য যোগ করার মোড বন্ধ করা হয়েছে।' : 'Adding to order mode closed.', 'info');
  };

  return (
    <aside
      aria-label="Reseller Order Addition Bar"
      className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-[990] max-w-lg w-[94%] sm:w-auto bg-slate-900/95 text-white backdrop-blur-md px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-2xl shadow-2xl border border-emerald-500/50 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-5"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-[#009245] text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
          <Package className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5 truncate">
            <span>
              {lang === 'bn'
                ? `অর্ডারে পণ্য যোগ করার মোড (${itemCount}টি পণ্য)`
                : `Adding to Order (${itemCount} items)`}
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
          </div>
          <div className="text-[11px] text-emerald-300 truncate">
            {lang === 'bn'
              ? 'ক্যাটালগ ঘুরে ছবি ও সাইজ পছন্দ করে যোগ করুন'
              : 'Browse catalog and pick items to add'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleReturnToOrderForm}
          className="px-3 sm:px-3.5 py-1.5 rounded-xl bg-[#009245] hover:bg-[#007a38] text-white text-xs font-black shadow-md cursor-pointer transition-all flex items-center gap-1.5 active:scale-95"
        >
          <span>{lang === 'bn' ? 'অর্ডার ফর্মে ফিরে যান' : 'Go to Order'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={handleCancel}
          className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          title={lang === 'bn' ? 'বন্ধ করুন' : 'Cancel'}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
};
