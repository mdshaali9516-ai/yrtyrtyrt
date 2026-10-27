import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext.js';
import { api } from '../../services/api.js';
import { Product } from '../../types/index.js';
import { HeroSection } from '../HeroSection.js';
import { ProductCard } from '../ProductCard.js';
import { ProductDetailsPage } from '../ProductDetailsPage.js';
import { ProductDetailsModal } from '../ProductDetailsModal.js';
import { PublicCartDrawer } from '../common/PublicCartDrawer.js';
import { PublicOrderCheckoutModal } from './PublicOrderCheckoutModal.js';
import { ToastContainer } from '../ToastContainer.js';
import { ScrollReveal } from '../common/ScrollReveal.js';
import {
  Search,
  Store,
  MessageCircle,
  Phone,
  ShieldCheck,
  Truck,
  RotateCcw,
  Headphones,
  ShoppingBag,
  ArrowRight,
  AlertCircle,
  ChevronLeft,
  X,
  CreditCard,
  Heart
} from 'lucide-react';

interface ResellerStorefrontViewProps {
  storeSlug: string;
}

const normalizeBengali = (str: string | undefined | null): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\u09DF/g, '\u09AF') // Replace য় with য
    .replace(/\u09DC/g, '\u09A1') // Replace ড় with ড
    .replace(/\u09DD/g, '\u09A2') // Replace ঢ় with ঢ
    .trim();
};

const resolveThemeColor = (color?: string): string => {
  if (!color) return '#009245';
  if (color.startsWith('#')) return color;
  const map: Record<string, string> = {
    emerald: '#009245',
    blue: '#2563eb',
    indigo: '#4f46e5',
    orange: '#ea580c',
    rose: '#e11d48',
    dark: '#0f172a',
  };
  return map[color] || '#009245';
};

export const ResellerStorefrontView: React.FC<ResellerStorefrontViewProps> = ({ storeSlug }) => {
  const {
    lang,
    categories,
    subsections,
    cartItems,
    setIsPublicCartOpen,
    wishlistItems,
    openCheckoutModal,
  } = useApp();

  const [reseller, setReseller] = useState<any | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [isExpired, setIsExpired] = useState(false);
  const [loading, setLoading] = useState(true);

  // In-page store filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const loadStore = async () => {
      setLoading(true);
      try {
        const res = await api.getPublicStore(storeSlug);
        if (res && res.reseller) {
          setReseller(res.reseller);
          setProducts(Array.isArray(res.products) ? res.products : []);
          setIsExpired(Boolean(res.isExpired));

          // Set referral tracking for orders placed from this reseller store
          const refCode = res.reseller.referenceCode || res.reseller.storeSlug || res.reseller.id;
          if (refCode && typeof window !== 'undefined') {
            sessionStorage.setItem('reseller_referral_code', refCode);
          }
        }
      } catch (err) {
        console.error('Failed to load reseller store:', err);
      } finally {
        setLoading(false);
      }
    };
    loadStore();
  }, [storeSlug]);

  // Derived properties
  const shopName = reseller?.storeName || (reseller?.name ? `${reseller.name} এক্সপ্রেস শপ` : 'অনলাইন শপ');
  const logoUrl = reseller?.storeLogoUrl || reseller?.avatarUrl || '';
  const whatsappNum = reseller?.storeWhatsapp || reseller?.phone || '01712345678';
  const phoneNum = reseller?.storePhone || reseller?.phone || '01712345678';
  const themeHex = resolveThemeColor(reseller?.storeThemeColor);

  // Filter products by category, subcategory & search query
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (p.isActive === false || p.isArchived) return false;

      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        (p.nameBn && p.nameBn.toLowerCase().includes(q)) ||
        (p.nameEn && p.nameEn.toLowerCase().includes(q)) ||
        (p.productCode && p.productCode.toLowerCase().includes(q)) ||
        (p.subcategoryBn && p.subcategoryBn.toLowerCase().includes(q));

      const matchesCat =
        selectedCategory === 'all' ||
        (p.categorySlug && p.categorySlug.toLowerCase() === selectedCategory.toLowerCase());

      const matchesSub =
        !selectedSubCategory ||
        (p.subcategoryBn && normalizeBengali(p.subcategoryBn).includes(normalizeBengali(selectedSubCategory))) ||
        (p.subcategoryEn && p.subcategoryEn.toLowerCase().includes(selectedSubCategory.toLowerCase()));

      return matchesSearch && matchesCat && matchesSub;
    });
  }, [products, searchQuery, selectedCategory, selectedSubCategory]);

  // Available subcategories for the selected category
  const activeSubcategories = useMemo(() => {
    const list = selectedCategory === 'all'
      ? products
      : products.filter(p => p.categorySlug && p.categorySlug.toLowerCase() === selectedCategory.toLowerCase());
    return Array.from(new Set(list.map(p => p.subcategoryBn).filter(Boolean))) as string[];
  }, [products, selectedCategory]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: `${themeHex} transparent ${themeHex} ${themeHex}` }}
          />
          <p className="text-xs font-bold text-slate-500">
            {lang === 'bn' ? 'শপ লোড হচ্ছে...' : 'Loading Store...'}
          </p>
        </div>
      </div>
    );
  }

  if (!reseller) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-lg border border-slate-200 text-center space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900">
            {lang === 'bn' ? 'দোকানটি পাওয়া যায়নি' : 'Store Not Found'}
          </h2>
          <p className="text-xs text-slate-500">
            {lang === 'bn'
              ? 'এই ইউআরএল বা সাবডোমেইনের অধীনে কোনো সক্রিয় রিসেলার শপ পাওয়া যায়নি।'
              : 'No active reseller shop was found under this URL.'}
          </p>
          <a
            href="/"
            className="inline-block px-6 py-2.5 text-white text-xs font-black rounded-xl shadow-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: themeHex }}
          >
            {lang === 'bn' ? 'হোমে ফিরে যান' : 'Back to Home'}
          </a>
        </div>
      </div>
    );
  }

  // If viewing a single product detail page
  if (viewingProduct) {
    return (
      <div className="min-h-screen bg-[#fafaf9] text-slate-900 pb-20">
        <ProductDetailsPage
          product={viewingProduct}
          onBack={() => setViewingProduct(null)}
          categoryProducts={products}
          relatedProducts={products}
          onSelectRelated={(p) => {
            setViewingProduct(p);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
        {/* Modals & Cart Drawer */}
        <PublicCartDrawer />
        <PublicOrderCheckoutModal reseller={reseller} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] font-sans text-slate-900 selection:bg-emerald-200 selection:text-emerald-950 flex flex-col justify-between">
      
      {/* 1. TOP ANNOUNCEMENT PROMO BAR */}
      <div
        className="text-white text-[11px] sm:text-xs font-bold py-2 px-3 text-center tracking-wide"
        style={{ backgroundColor: themeHex }}
      >
        <span>
          {lang === 'bn'
            ? '🔥 বিশেষ অফার: সারাদেশে ক্যাশ অন ডেলিভারি সুবিধা • দ্রুত হোম ডেলিভারি!'
            : '🔥 Nationwide Cash on Delivery • Fast Home Delivery!'}
        </span>
      </div>

      {/* 2. RESELLER BRANDED NAVBAR */}
      <header className="border-b border-slate-200/90 sticky top-0 z-40 shadow-2xs" style={{ backgroundColor: reseller?.storeHeaderColor || '#ffffff' }}>
        <div className="max-w-[1240px] mx-auto px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3">
          
          {/* Brand Logo & Shop Name */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl overflow-hidden border-2 bg-slate-50 flex items-center justify-center shrink-0 shadow-2xs"
              style={{ borderColor: themeHex }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt={shopName} className="w-full h-full object-cover" />
              ) : (
                <Store className="w-5 h-5" style={{ color: themeHex }} />
              )}
            </div>

            <div className="min-w-0">
              <a href={`/shop/${storeSlug}`} className="text-sm sm:text-base font-black text-slate-900 leading-tight truncate block hover:opacity-80">
                {shopName}
              </a>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium truncate block">
                {reseller?.storeDescription || (lang === 'bn' ? 'অনলাইন শপ' : 'Online Shop')}
              </span>
            </div>
          </div>

          {/* Quick Actions: Search, WhatsApp, Phone, Cart */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            
            {/* Search Trigger (Mobile/Desktop) */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="পণ্য অনুসন্ধান"
            >
              <Search className="w-4 h-4 text-slate-600" />
              <span className="hidden md:inline">{lang === 'bn' ? 'সার্চ' : 'Search'}</span>
            </button>

            {/* WhatsApp Direct Order Button */}
            <a
              href={`https://wa.me/88${whatsappNum.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                `আসসালামু আলাইকুম! ${shopName} শপ থেকে পণ্য সম্পর্কে জানতে চাই।`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 sm:px-3 py-2 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-2xs transition-opacity hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: themeHex }}
              title="WhatsApp এ মেসেজ দিন"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>

            {/* Helpline Call Button */}
            <a
              href={`tel:${phoneNum}`}
              className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              title="সরাসরি কল করুন"
            >
              <Phone className="w-4 h-4" style={{ color: themeHex }} />
              <span className="hidden sm:inline">{lang === 'bn' ? 'কল দিন' : 'Call'}</span>
            </a>

            {/* Shopping Cart Drawer Trigger */}
            <button
              type="button"
              onClick={() => setIsPublicCartOpen(true)}
              className="p-2 sm:px-3.5 sm:py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs relative"
              title="শপিং ব্যাগ"
            >
              <ShoppingBag className="w-4 h-4 text-white" />
              <span className="hidden sm:inline">{lang === 'bn' ? 'কার্ট' : 'Cart'}</span>
              {cartItems.length > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-[10px] font-black text-white rounded-full flex items-center justify-center shadow-xs"
                  style={{ backgroundColor: themeHex }}
                >
                  {cartItems.length}
                </span>
              )}
            </button>

          </div>

        </div>

        {/* Collapsible Search Input Bar */}
        {isSearchOpen && (
          <div className="border-t border-slate-100 bg-slate-50/80 px-3 sm:px-6 py-2.5 animate-in slide-in-from-top-1 duration-150">
            <div className="max-w-[1240px] mx-auto relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === 'bn' ? 'পণ্য খুঁজুন (নাম বা কোড দিয়ে)...' : 'Search products...'}
                className="w-full pl-9 pr-8 py-2 bg-white rounded-xl border border-slate-200 text-xs sm:text-sm font-bold text-slate-900 focus:outline-none shadow-2xs"
                style={{ borderColor: searchQuery ? themeHex : undefined }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* MAIN PUBLIC STORE BODY (Exact Mirror of Tawzoon Public Page) */}
      <main className="flex-1 space-y-4 sm:space-y-6">
        
        {/* 3. HERO SHOWCASE SECTION (Eid, Luxury, Tech Banners) */}
        <HeroSection />

        {/* 4. TRUST & SERVICES STRIP */}
        <ScrollReveal className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 pt-1 pb-2 sm:py-3" delay={0} duration={350}>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 py-2 sm:py-3 px-1 sm:px-4 shadow-xs grid grid-cols-4 divide-x divide-slate-100 items-center">
            
            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl">
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-3xs"
                style={{ backgroundColor: `${themeHex}15`, borderColor: `${themeHex}30` }}
              >
                <ShieldCheck className="w-4 h-4" style={{ color: themeHex }} />
              </div>
              <div className="min-w-0">
                <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 leading-tight">
                  {lang === 'bn' ? 'নির্ভরযোগ্য পণ্য' : 'Authentic'}
                </h4>
                <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                  {lang === 'bn' ? '১০০% মানসম্মত' : '100% Quality'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl">
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-3xs"
                style={{ backgroundColor: `${themeHex}15`, borderColor: `${themeHex}30` }}
              >
                <Truck className="w-4 h-4" style={{ color: themeHex }} />
              </div>
              <div className="min-w-0">
                <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 leading-tight">
                  {lang === 'bn' ? 'সারা দেশে ডেলিভারি' : 'Nationwide'}
                </h4>
                <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                  {lang === 'bn' ? 'দ্রুত হোম ডেলিভারি' : 'Fast Delivery'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl">
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-3xs"
                style={{ backgroundColor: `${themeHex}15`, borderColor: `${themeHex}30` }}
              >
                <RotateCcw className="w-4 h-4" style={{ color: themeHex }} />
              </div>
              <div className="min-w-0">
                <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 leading-tight">
                  {lang === 'bn' ? 'সহজ রিটার্ন' : 'Easy Return'}
                </h4>
                <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                  {lang === 'bn' ? '৭ দিনের মধ্যে' : '7 Days'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl">
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-3xs"
                style={{ backgroundColor: `${themeHex}15`, borderColor: `${themeHex}30` }}
              >
                <Headphones className="w-4 h-4" style={{ color: themeHex }} />
              </div>
              <div className="min-w-0">
                <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 leading-tight">
                  {lang === 'bn' ? '২৪/৭ হেল্পলাইন' : '24/7 Helpline'}
                </h4>
                <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                  {phoneNum}
                </p>
              </div>
            </div>

          </div>
        </ScrollReveal>

        {/* 5. CATEGORIES & SUBCATEGORIES FILTER BAR */}
        <section className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 space-y-2.5">
          
          {/* Main Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setSelectedSubCategory(null);
              }}
              className={`px-4 py-2 rounded-full text-xs font-black shrink-0 transition-all cursor-pointer shadow-3xs ${
                selectedCategory === 'all'
                  ? 'text-white shadow-xs'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
              style={{ backgroundColor: selectedCategory === 'all' ? themeHex : undefined }}
            >
              {lang === 'bn' ? 'সকল পণ্য' : 'All Products'} ({products.length})
            </button>

            {categories.map((cat) => {
              const isSelected = selectedCategory.toLowerCase() === cat.slug.toLowerCase();
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.slug);
                    setSelectedSubCategory(null);
                  }}
                  className={`px-4 py-2 rounded-full text-xs font-black shrink-0 transition-all cursor-pointer shadow-3xs uppercase ${
                    isSelected
                      ? 'text-white shadow-xs'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                  style={{ backgroundColor: isSelected ? themeHex : undefined }}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>

          {/* Subcategories Horizontal Bar */}
          {activeSubcategories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none pt-1">
              <span className="text-[11px] font-bold text-slate-400 shrink-0 pr-1">
                {lang === 'bn' ? 'ফিল্টার:' : 'Filter:'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedSubCategory(null)}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold shrink-0 transition-colors cursor-pointer ${
                  selectedSubCategory === null
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {lang === 'bn' ? 'সব' : 'All'}
              </button>
              {activeSubcategories.map((sub) => {
                const isSelected = selectedSubCategory === sub;
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setSelectedSubCategory(isSelected ? null : sub)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold shrink-0 transition-colors cursor-pointer ${
                      isSelected
                        ? 'text-white shadow-2xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                    style={{ backgroundColor: isSelected ? themeHex : undefined }}
                  >
                    {sub}
                  </button>
                );
              })}
            </div>
          )}

        </section>

        {/* 6. PRODUCTS GRID SECTION */}
        <section className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 pt-2">
          
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: themeHex }}
              />
              <h2 className="text-base sm:text-xl font-black text-slate-900 tracking-tight">
                {selectedSubCategory || (selectedCategory === 'all' ? (lang === 'bn' ? 'সেরা কালেকশন' : 'Featured Collection') : selectedCategory.toUpperCase())}
              </h2>
            </div>
            <span className="text-xs font-bold text-slate-500 font-mono">
              {filteredProducts.length} {lang === 'bn' ? 'টি পণ্য' : 'products'}
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 text-slate-400 mx-auto flex items-center justify-center">
                <ShoppingBag className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-slate-700">
                {lang === 'bn' ? 'কোনো পণ্য পাওয়া যায়নি।' : 'No products found.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedSubCategory(null);
                }}
                className="px-4 py-2 text-white text-xs font-bold rounded-xl shadow-xs"
                style={{ backgroundColor: themeHex }}
              >
                {lang === 'bn' ? 'সব পণ্য দেখুন' : 'View All Products'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onCardClick={() => {
                    setViewingProduct(product);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              ))}
            </div>
          )}

        </section>

      </main>

      {/* 7. RESELLER FOOTER (Clean Brand Footer) */}
      <footer className="mt-12 border-t-2" style={{ backgroundColor: reseller?.storeFooterColor || '#0f172a', borderColor: themeHex }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
          
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-2xl overflow-hidden border-2 bg-slate-800 flex items-center justify-center shrink-0 shadow-md"
                style={{ borderColor: themeHex }}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt={shopName} className="w-full h-full object-cover" />
                ) : (
                  <Store className="w-6 h-6 text-white" />
                )}
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white leading-tight">
                  {shopName}
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  রিসেলার: <span className="font-bold text-slate-200">{reseller.name}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <a
                href={`https://wa.me/88${whatsappNum.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl text-xs font-black inline-flex items-center gap-2 text-white shadow-xs"
                style={{ backgroundColor: themeHex }}
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp: {whatsappNum}</span>
              </a>
              <a
                href={`tel:${phoneNum}`}
                className="px-4 py-2 rounded-xl text-xs font-black inline-flex items-center gap-2 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                <span>হেল্পলাইন: {phoneNum}</span>
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-200">
            <p>© {new Date().getFullYear()} {shopName}. সর্বস্বত্ব সংরক্ষিত।</p>
            <div className="flex items-center gap-4 text-slate-200 text-xs">
              <span>ক্যাশ অন ডেলিভারি</span>
              <span>•</span>
              <span>বিকাশ পেমেন্ট</span>
              <span>•</span>
              <span>সারাদেশে হোম ডেলিভারি</span>
            </div>
          </div>

        </div>
      </footer>

      {/* MODALS & DRAWERS FOR COMPLETE SHOPPING EXPERIENCE */}
      <ProductDetailsModal />
      <PublicCartDrawer />
      <PublicOrderCheckoutModal reseller={reseller} />
      <ToastContainer />

    </div>
  );
};
