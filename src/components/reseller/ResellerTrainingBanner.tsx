import React from 'react';
import { Play, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

interface ResellerTrainingBannerProps {
  onLearnClick: () => void;
}

export const ResellerTrainingBanner: React.FC<ResellerTrainingBannerProps> = ({ onLearnClick }) => {
  const { lang, brandSettings } = useApp();

  const title = lang === 'bn'
    ? (brandSettings?.resellerBannerTitleBn || 'নতুন রিসেলার?')
    : (brandSettings?.resellerBannerTitleEn || 'New Reseller?');
    
  const subtitle = lang === 'bn'
    ? (brandSettings?.resellerBannerSubtitleBn || 'অ্যাপ ব্যবহার শিখুন সহজ ভিডিও টিউটোরিয়ালে')
    : (brandSettings?.resellerBannerSubtitleEn || 'Learn app usage with easy video tutorials');

  const buttonText = lang === 'bn'
    ? (brandSettings?.resellerBannerButtonBn || 'কোর্সসমূহ দেখুন')
    : (brandSettings?.resellerBannerButtonEn || 'View Courses');

  const bgImage = brandSettings?.resellerBannerBgImage || '/src/assets/images/reseller_banner_visual_base_1790741724073.jpg';

  return (
    <div className="px-3 sm:px-4 pt-3 pb-1">
      {/* 
        Container height is dynamically adjusted:
        - Mobile: Locked strictly at h-40 so it stays exactly as it is (100% untouched!)
        - Desktop: Height increased to h-52 / h-60 / h-64 to accommodate the full height of the reseller character without any cutoffs
      */}
      <div 
        className="relative overflow-hidden w-full rounded-2xl sm:rounded-3xl bg-[#005a2b] shadow-md group cursor-pointer h-40 sm:h-52 md:h-60 lg:h-64 flex flex-col justify-center items-center p-4 sm:p-6 border border-emerald-850 transition-all duration-300 hover:scale-[1.01] hover:shadow-lg hover:border-emerald-500 active:scale-[0.98] active:brightness-95 active:shadow-sm text-center"
        onClick={onLearnClick}
      >
        {/* Background Image Layer containing the Hoodie Cartoon Character */}
        <div className="absolute inset-0 z-0">
          <img 
            src={bgImage} 
            alt="Banner Hoodie Reseller Character" 
            className="w-full h-full object-cover object-left opacity-95 transition-transform duration-10000 group-hover:scale-105"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=80';
            }}
          />
          {/* Elegant gradient overlay preserving the rich green tone and character visibility */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#005a2b]/95 via-[#005a2b]/60 to-transparent" />
        </div>

        {/* Animated Emerald Glows */}
        <div className="absolute -right-12 -bottom-12 w-36 h-36 rounded-full bg-emerald-400/20 blur-2xl animate-pulse pointer-events-none" />
        <div className="absolute -left-12 -top-12 w-36 h-36 rounded-full bg-green-400/20 blur-2xl animate-pulse pointer-events-none" />

        {/* Stacked Content Layout: App Logo, Title, Subtitle, and Compact Button */}
        <div className="relative z-10 w-full flex flex-col items-center justify-center gap-2.5">
          {/* App / Brand Logo & Guide Badge */}
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full border border-white/30 shadow-xs">
              {brandSettings?.logoUrl ? (
                <img 
                  src={brandSettings.logoUrl} 
                  alt="App Logo" 
                  className="w-4.5 h-4.5 rounded-full object-cover bg-white p-0.5 shrink-0" 
                />
              ) : (
                <div className="w-4.5 h-4.5 rounded-full bg-[#009245] text-white flex items-center justify-center font-black text-[9px] shadow-3xs">
                  T
                </div>
              )}
              <span className="text-[10px] sm:text-xs font-black text-white tracking-wide">
                {brandSettings?.appName || 'TAWZOON NEXUS'}
              </span>
            </div>

            <span className="text-[9px] sm:text-[10px] font-black text-amber-300 bg-amber-400/20 px-2.5 py-0.5 rounded-full border border-amber-400/30 uppercase tracking-wider inline-block">
              {lang === 'bn' ? 'লার্নিং গাইড' : 'Learning Guide'}
            </span>
          </div>

          <div className="space-y-0.5">
            <h2 className="text-xl sm:text-2xl font-black text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
              {title}
            </h2>
            <p className="text-[11px] sm:text-xs font-semibold text-emerald-100/95 leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              {subtitle}
            </p>
          </div>

          {/* Centered Compact Blue Button - Perfectly sized, not stretched, mobile-adjusted */}
          <div className="pt-0.5">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 sm:px-7 sm:py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black text-[11px] sm:text-xs rounded-xl sm:rounded-2xl transition-all shadow-md shadow-emerald-950/20 cursor-pointer"
            >
              <div className="w-4 h-4 rounded-full bg-white text-blue-600 flex items-center justify-center shadow-xs">
                <Play className="w-2 h-2 fill-current ml-0.5" />
              </div>
              <span>{buttonText}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
