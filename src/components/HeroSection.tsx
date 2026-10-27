import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.js';
import { ChevronLeft, ChevronRight, ArrowRight, Sparkles } from 'lucide-react';
import { HeroSlideItem } from '../types/index.js';

const DEFAULT_SLIDES: HeroSlideItem[] = [
  {
    id: 1,
    tagBn: 'গুণগত মানের পণ্য',
    tagEn: 'QUALITY ASSURED PRODUCTS',
    titleLine1Bn: 'আপনার প্রতিদিনের',
    titleLine1En: 'Everything For Your',
    titleLine2Bn: 'প্রয়োজনের সবকিছু',
    titleLine2En: 'Daily Needs',
    titleLine3Bn: 'এক জায়গায়',
    titleLine3En: 'In One Place',
    subheadBn: 'নির্বাচিত, মানসম্মত এবং নির্ভরযোগ্য পণ্য এখন আরও সহজে',
    subheadEn: 'Carefully curated, premium, and authentic products delivered with trust',
    ctaBn: 'পণ্যসমূহ দেখুন',
    ctaEn: 'Explore Products',
    category: 'all',
    image: 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=1000&auto=format&fit=crop&q=80',
  },
  {
    id: 2,
    tagBn: 'স্মার্ট ইলেকট্রনিক্স ও গ্যাজেটস',
    tagEn: 'SMART ELECTRONICS & TECH',
    titleLine1Bn: 'আধুনিক লাইফস্টাইলের',
    titleLine1En: 'Modern Lifestyle',
    titleLine2Bn: 'সেরা টেকনোলজি ও স্মার্ট',
    titleLine2En: 'Smart Tech &',
    titleLine3Bn: 'এক্সেসরিজ',
    titleLine3En: 'Accessories',
    subheadBn: 'মোবাইল, ওয়াচ ও প্রিমিয়াম অডিও ডিভাইসের সেরা ডিল',
    subheadEn: 'Explore cutting-edge audio, smart wearables, and essentials',
    ctaBn: 'গ্যাজেট এক্সপ্লোর করুন',
    ctaEn: 'Explore Gadgets',
    category: 'gadgets',
    image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1000&auto=format&fit=crop&q=80',
  },
  {
    id: 3,
    tagBn: 'নতুন ট্রেন্ডি কালেকশন',
    tagEn: 'PREMIUM FASHION & HOME',
    titleLine1Bn: 'মার্জিত ও আকর্ষণীয়',
    titleLine1En: 'Refined Quality &',
    titleLine2Bn: 'নতুন ফ্যাশন ও লাইফস্টাইল',
    titleLine2En: 'Trendy Seasonal',
    titleLine3Bn: 'পণ্য সম্ভার',
    titleLine3En: 'Collection',
    subheadBn: 'দৈনন্দিন পোশাক ও হোম ডেকোরে সেরা মান ও সাশ্রয়ী দাম',
    subheadEn: 'Apparel, travel gear, and household essentials designed for living',
    ctaBn: 'কালেকশন দেখুন',
    ctaEn: 'Explore Collection',
    category: 'shop',
    image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=1000&auto=format&fit=crop&q=80',
  },
];

// Distinct Color Palettes for the 3 Categories (Slide 1: Soft Light Green, Slide 2: Sky Cyan, Slide 3: Rose Cashmere)
export const SLIDE_THEMES = [
  {
    // Slide 1: All Categories - Soft Light Green / Mint Tech Atmosphere (User requested)
    cardBg: 'from-[#e8f7ee] via-[#f0faf4] to-[#d8f2e2]',
    borderColor: 'border-[#b6e8cb]',
    spotlight: 'from-emerald-300/80 via-teal-200/50 to-transparent',
    dotColor: 'bg-emerald-600/45',
    waveBg: 'rgba(52, 211, 153, 0.18)',
    tagBg: 'from-[#006837] via-[#009245] to-[#00b050]',
    tagShadow: 'rgba(0, 146, 69, 0.35)',
    keywordColor: 'text-[#009245]',
    accentBar: 'border-[#009245]',
    btnGradient: 'from-[#007a3d] via-[#009245] to-[#00a854]',
    btnShadow: 'rgba(0, 146, 69, 0.38)',
  },
  {
    // Slide 2: Gadgets & Tech - Modern Cool Sky & Electric Cyan Tech
    cardBg: 'from-[#edf6fd] via-[#e2effa] to-[#cfe4f5]',
    borderColor: 'border-[#b5d6ef]',
    spotlight: 'from-sky-300/80 via-cyan-200/50 to-transparent',
    dotColor: 'bg-sky-600/45',
    waveBg: 'rgba(56, 189, 248, 0.18)',
    tagBg: 'from-[#0284c7] via-[#0369a1] to-[#075985]',
    tagShadow: 'rgba(2, 132, 199, 0.35)',
    keywordColor: 'text-[#0284c7]',
    accentBar: 'border-[#0284c7]',
    btnGradient: 'from-[#007a3d] via-[#009245] to-[#00a854]',
    btnShadow: 'rgba(0, 146, 69, 0.38)',
  },
  {
    // Slide 3: Fashion & Style - Soft Rose Cashmere & Coral Tech
    cardBg: 'from-[#fef2f4] via-[#fce7eb] to-[#f5d6dc]',
    borderColor: 'border-[#e8bcc5]',
    spotlight: 'from-rose-300/80 via-pink-200/50 to-transparent',
    dotColor: 'bg-rose-600/45',
    waveBg: 'rgba(244, 63, 94, 0.18)',
    tagBg: 'from-[#e11d48] via-[#be123c] to-[#9f1239]',
    tagShadow: 'rgba(225, 29, 72, 0.35)',
    keywordColor: 'text-[#be123c]',
    accentBar: 'border-[#be123c]',
    btnGradient: 'from-[#007a3d] via-[#009245] to-[#00a854]',
    btnShadow: 'rgba(0, 146, 69, 0.38)',
  },
];

export const HeroSection: React.FC = () => {
  const { lang, setPublicCategory, brandSettings } = useApp();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const slides: HeroSlideItem[] = (brandSettings?.heroSlides && brandSettings.heroSlides.length > 0)
    ? brandSettings.heroSlides
    : DEFAULT_SLIDES;

  // Reset currentSlide if out of range
  useEffect(() => {
    if (currentSlide >= slides.length) {
      setCurrentSlide(0);
    }
  }, [slides.length, currentSlide]);

  // Auto carousel slide every 5 seconds (pauses when backgrounded)
  useEffect(() => {
    if (isPaused || slides.length <= 1) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [isPaused, slides.length]);

  const slide = slides[currentSlide] || slides[0] || DEFAULT_SLIDES[0];
  const theme = SLIDE_THEMES[currentSlide % SLIDE_THEMES.length];

  const handlePrev = () => {
    setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  const handleCta = () => {
    setPublicCategory(slide.category || 'all');
    const el = document.getElementById('catalog-section');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  // Touch swipe support for mobile
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    if (diff > 45) {
      handleNext();
    } else if (diff < -45) {
      handlePrev();
    }
    touchStartX.current = null;
  };

  // Is Slide 3 (Fashion / Home wide collection)
  const isSlide3 = currentSlide === 2;

  return (
    <section
      className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 pt-1.5 sm:pt-2 pb-3 sm:pb-5"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Distinct Color Themed Hero Banner Card with Interactive UI Animations */}
      <div
        onClick={handleCta}
        className={`group relative rounded-2xl sm:rounded-3xl overflow-hidden bg-gradient-to-br ${theme.cardBg} border ${theme.borderColor} shadow-[0_6px_24px_-4px_rgba(0,0,0,0.07)] hover:shadow-[0_16px_36px_-6px_rgba(0,146,69,0.22)] hover:-translate-y-1 active:scale-[0.99] transition-all duration-500 ease-out select-none cursor-pointer`}
      >
        {/* Interactive Ambient Light Sheen on Hover */}
        <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 pointer-events-none z-15" />
        
        {/* Modern Tech Curved Wave Shapes */}
        <div className="absolute -left-12 -top-12 w-64 h-64 rounded-full bg-white/40 blur-3xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
        <div className="absolute -right-8 -bottom-8 w-80 h-80 rounded-full bg-white/30 blur-3xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />
        
        {/* Soft Organic SVG Curved Wave Overlay */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-40 group-hover:opacity-50 transition-opacity duration-500"
          viewBox="0 0 1200 400"
          preserveAspectRatio="none"
        >
          <path
            d="M 0,220 C 300,160 500,320 800,200 C 1000,120 1100,240 1200,180 L 1200,400 L 0,400 Z"
            fill={theme.waveBg}
          />
          <path
            d="M 0,140 C 200,60 450,220 700,140 C 950,60 1100,180 1200,120"
            fill="none"
            stroke="rgba(255, 255, 255, 0.7)"
            strokeWidth="2"
          />
        </svg>

        {/* Tech Dot Grid Pattern: Top-Right (4x4) */}
        <div className="absolute top-3.5 right-4 sm:right-7 grid grid-cols-4 gap-1.5 opacity-35 pointer-events-none group-hover:opacity-60 transition-opacity duration-500">
          {[...Array(16)].map((_, i) => (
            <div key={i} className={`w-1 h-1 rounded-full ${theme.dotColor}`} />
          ))}
        </div>

        {/* Tech Dot Grid Pattern: Center (2x4) */}
        <div className="absolute top-1/2 -translate-y-1/2 left-[44%] hidden lg:grid grid-cols-4 gap-1.5 opacity-35 pointer-events-none">
          {[...Array(8)].map((_, i) => (
            <div key={i} className={`w-1 h-1 rounded-full ${theme.dotColor}`} />
          ))}
        </div>

        {/* Tech Dot Grid Pattern: Bottom-Left (4x3) */}
        <div className="absolute bottom-3.5 left-4 sm:left-7 grid grid-cols-4 gap-1.5 opacity-35 pointer-events-none">
          {[...Array(12)].map((_, i) => (
            <div key={i} className={`w-1 h-1 rounded-full ${theme.dotColor}`} />
          ))}
        </div>

        {/* Studio Spotlight Halo behind product cutout */}
        <div className="absolute right-0 top-0 bottom-0 w-[55%] sm:w-[45%] pointer-events-none overflow-hidden">
          <div className={`absolute right-3 sm:right-8 top-1/2 -translate-y-1/2 w-48 sm:w-88 h-48 sm:h-88 rounded-full bg-gradient-to-tr ${theme.spotlight} blur-2xl sm:blur-3xl opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700`} />
        </div>

        {/* Ambient Top Subtle Lighting Sheen */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/45 via-transparent to-black/5 pointer-events-none" />

        {/* Left Side Navigation Button */}
        {slides.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            aria-label="Previous Slide"
            className="absolute left-1.5 sm:left-3 top-1/2 -translate-y-1/2 z-20 w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-white/95 backdrop-blur-xs shadow-md text-slate-800 hover:text-white hover:bg-[#009245] flex items-center justify-center transition-all duration-200 hover:scale-115 active:scale-90 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </button>
        )}

        {/* Right Side Navigation Button */}
        {slides.length > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            aria-label="Next Slide"
            className="absolute right-1.5 sm:right-3 top-1/2 -translate-y-1/2 z-20 w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-white/95 backdrop-blur-xs shadow-md text-slate-800 hover:text-white hover:bg-[#009245] flex items-center justify-center transition-all duration-200 hover:scale-115 active:scale-90 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
          </button>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="relative z-10 grid grid-cols-12 items-center pl-8 pr-7 sm:pl-14 sm:pr-14 py-3.5 sm:py-7 min-h-[175px] sm:min-h-[250px] md:min-h-[290px] gap-2 sm:gap-6">
          
          {/* Left Text Column */}
          <div className="col-span-7 sm:col-span-7 space-y-1.5 sm:space-y-3">
            
            {/* Professional Tag (Reduced Round Shape to rounded-lg sm:rounded-xl) */}
            <div className="w-fit flex items-center">
              <div
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl bg-gradient-to-r ${theme.tagBg} text-white shadow-[0_4px_12px_${theme.tagShadow}] border border-white/30 select-none whitespace-nowrap shrink-0 group-hover:scale-102 transition-transform duration-300`}
              >
                <span className="text-[9.5px] sm:text-xs md:text-sm font-extrabold tracking-wide whitespace-nowrap">
                  {lang === 'bn' ? slide.tagBn : slide.tagEn}
                </span>
                <Sparkles className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-white/90 shrink-0 fill-white/30 animate-pulse" />
              </div>
            </div>

            {/* Main Headline */}
            <div className="leading-[1.16] space-y-0.5">
              <h1 className="text-[13px] sm:text-xl md:text-2xl lg:text-[29px] font-black text-slate-950 tracking-tight drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
                {lang === 'bn' ? slide.titleLine1Bn : slide.titleLine1En}
              </h1>
              <h2 className="text-[13px] sm:text-xl md:text-2xl lg:text-[29px] font-black text-slate-950 tracking-tight drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
                {lang === 'bn' ? slide.titleLine2Bn : slide.titleLine2En}
              </h2>
              {slide.titleLine3Bn && (
                <h3 className={`text-[13px] sm:text-xl md:text-2xl lg:text-[29px] font-black ${theme.keywordColor} tracking-tight drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]`}>
                  {lang === 'bn' ? slide.titleLine3Bn : slide.titleLine3En}
                </h3>
              )}
            </div>

            {/* Subtitle with Vertical Accent Bar */}
            <div className={`border-l-[3px] sm:border-l-4 ${theme.accentBar} pl-2 sm:pl-2.5 py-0.5`}>
              <p className="text-[9.5px] sm:text-xs md:text-sm text-slate-700 font-bold leading-snug line-clamp-2 max-w-sm">
                {lang === 'bn' ? slide.subheadBn : slide.subheadEn}
              </p>
            </div>

            {/* Professional CTA Button (Reduced Round Shape to rounded-xl sm:rounded-2xl with UI Animation) */}
            <div className="pt-0.5 sm:pt-1 flex items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCta();
                }}
                className={`group/btn bg-gradient-to-r ${theme.btnGradient} text-white text-[10px] sm:text-xs md:text-sm font-extrabold px-3.5 sm:px-6 py-1.5 sm:py-2.5 rounded-xl sm:rounded-2xl inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shadow-[0_4px_16px_${theme.btnShadow}] hover:shadow-[0_8px_24px_${theme.btnShadow}] hover:scale-105 active:scale-95 transition-all duration-200 border border-white/30 cursor-pointer`}
              >
                <span>{lang === 'bn' ? slide.ctaBn : slide.ctaEn}</span>
                <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5] group-hover/btn:translate-x-1.5 transition-transform duration-300" />
              </button>
            </div>

          </div>

          {/* Right Product Cutout Area with UI Animation */}
          <div className="col-span-5 sm:col-span-5 relative flex justify-end items-center h-full">
            <div
              className={`relative w-full ${
                isSlide3
                  ? 'max-w-[175px] sm:max-w-[290px] md:max-w-[370px] h-[145px] sm:h-[220px] md:h-[260px]'
                  : 'max-w-[160px] sm:max-w-[270px] md:max-w-[340px] h-[135px] sm:h-[210px] md:h-[250px]'
              } flex items-center justify-end`}
            >
              <img
                key={slide.id}
                src={slide.image || DEFAULT_SLIDES[currentSlide % DEFAULT_SLIDES.length]?.image}
                alt="Showcase Cutout"
                className={`max-w-full max-h-full object-contain object-bottom drop-shadow-[0_8px_16px_rgba(0,0,0,0.12)] group-hover:scale-106 group-hover:-translate-y-1 transition-all duration-500 ease-out select-none ${
                  isSlide3 ? 'scale-105 sm:scale-110' : ''
                }`}
                onError={(e) => {
                  const fallback = DEFAULT_SLIDES[currentSlide % DEFAULT_SLIDES.length]?.image || 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=1000&auto=format&fit=crop&q=80';
                  if (e.currentTarget.src !== fallback) {
                    e.currentTarget.src = fallback;
                  }
                }}
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

        </div>

        {/* Pagination Dots at Bottom Center */}
        {slides.length > 1 && (
          <div className="absolute bottom-1.5 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentSlide(i);
                }}
                aria-label={`Go to slide ${i + 1}`}
                className={`transition-all duration-300 rounded-full hover:scale-125 cursor-pointer ${
                  currentSlide === i
                    ? 'w-6 sm:w-7 h-1.5 sm:h-2 bg-[#009245] shadow-xs'
                    : 'w-2 sm:w-2.5 h-1.5 sm:h-2 bg-slate-300/80 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
        )}

      </div>
    </section>
  );
};
