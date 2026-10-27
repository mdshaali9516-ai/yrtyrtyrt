import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.js';
import { HeroSection } from './HeroSection.js';
import { ProductCard } from './ProductCard.js';
import { ShopCategoryPage, isCategoryMatch } from './ShopCategoryPage.js';
import { ProductDetailsPage } from './ProductDetailsPage.js';
import { ScrollReveal } from './common/ScrollReveal.js';
import { PublicNotificationsView } from './public/PublicNotificationsView.js';
import { Product } from '../types/index.js';
import { api } from '../services/api.js';
import { useDebounce } from '../hooks/useDebounce.js';
import { ShieldCheck, Truck, RotateCcw, Headphones, ArrowRight, SlidersHorizontal, ChevronRight, Shirt, Smartphone, Package, Heart, ChevronLeft, Home, Bell } from 'lucide-react';

const normalizeBengali = (str: string | undefined | null): string => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\u09DF/g, '\u09AF') // Replace য় (U+09DF) with য (U+09AF)
    .replace(/\u09DC/g, '\u09A1') // Replace ড় with ড
    .replace(/\u09DD/g, '\u09A2') // Replace ঢ় with ঢ
    .replace(/\u09BC/g, '') // Remove Bengali nukta ় (U+09BC)
    .trim();
};

export const PublicStorefront: React.FC = () => {
  const {
    lang,
    categories,
    publicCategory,
    setPublicCategory,
    publicSearch,
    setPublicSearch,
    selectedPublicSubcategory,
    setSelectedPublicSubcategory,
    refreshBootstrap,
    activePortal,
    subsections,
    wishlistItems,
  } = useApp();

  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const cached = localStorage.getItem('tawzoon_cached_products');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => products.length === 0);
  const [sortOrder, setSortOrder] = useState<string>('default');
  const [activeFilterTag] = useState<'all' | 'featured' | 'trending' | 'new_arrival'>('all');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(selectedPublicSubcategory);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [inPageTab, setInPageTab] = useState<'all' | 'wishlist'>('all');
  const [error, setError] = useState<string | null>(null);

  // Debounce search keystrokes by 250ms to prevent query flooding
  const debouncedSearch = useDebounce(publicSearch, 250);

  const fetchProducts = async (isBackground = false) => {
    // Only show full loading skeleton if we have no products at all
    if (!isBackground && products.length === 0) {
      setLoading(true);
      setError(null);
    }
    try {
      const categoryToQuery = (publicCategory !== 'all' && publicCategory !== 'wishlist' && publicCategory !== 'shop' && publicCategory !== 'shop_tab' && publicCategory !== 'gadgets' && publicCategory !== 'gajet' && publicCategory !== 'others' && publicCategory !== 'other')
        ? publicCategory
        : undefined;

      const res = await api.getProducts({
        category: categoryToQuery,
        search: debouncedSearch.trim() || undefined,
        sort: sortOrder !== 'default' ? sortOrder : undefined,
        filter: activeFilterTag !== 'all' ? activeFilterTag : undefined,
      });
      if (Array.isArray(res.products)) {
        setProducts(res.products);
        if (!categoryToQuery && !debouncedSearch.trim() && sortOrder === 'default' && activeFilterTag === 'all') {
          try {
            localStorage.setItem('tawzoon_cached_products', JSON.stringify(res.products.slice(0, 50)));
          } catch {}
        }
      }
    } catch (err) {
      console.error('Failed to load products:', err);
      if (products.length === 0) {
        setError(lang === 'bn' ? 'পণ্য লোড করতে সমস্যা হয়েছে। পুনরায় চেষ্টা করুন।' : 'Failed to load products. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setSelectedSubCategory(null);
    setViewingProduct(null);
    fetchProducts(products.length > 0);
  }, [publicCategory, debouncedSearch, sortOrder, activeFilterTag, activePortal]);

  // Listen for Home / Logo click navigation event to refresh storefront completely
  useEffect(() => {
    const handleNavHome = () => {
      setSelectedSubCategory(null);
      setViewingProduct(null);
      setInPageTab('all');
      setSortOrder('default');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      fetchProducts(true);
    };
    window.addEventListener('tawzoon_nav_home', handleNavHome);
    return () => window.removeEventListener('tawzoon_nav_home', handleNavHome);
  }, []);

  // Live Product Sync: Listen for product create/update/delete events or window focus
  useEffect(() => {
    const handleProductsUpdated = () => {
      try {
        localStorage.removeItem('tawzoon_cached_products');
      } catch {}
      fetchProducts(true);
    };
    window.addEventListener('tawzoon_products_updated', handleProductsUpdated);
    window.addEventListener('focus', handleProductsUpdated);
    return () => {
      window.removeEventListener('tawzoon_products_updated', handleProductsUpdated);
      window.removeEventListener('focus', handleProductsUpdated);
    };
  }, []);

  const currentCategoryObj = categories.find(c => c.slug.toLowerCase() === publicCategory.toLowerCase());
  const categoryProducts = publicCategory === 'wishlist'
    ? wishlistItems
    : products.filter(
        p => publicCategory === 'all' || p.categorySlug.toLowerCase() === publicCategory.toLowerCase()
      );
  
  // Use ordered subsections if we are in a specific main category
  let subCategories: string[] = [];
  if (publicCategory !== 'all') {
    subCategories = subsections
      .filter(s => s.isActive !== false && s.parentSlug?.toLowerCase() === publicCategory.toLowerCase() && !s.parentSub)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(s => s.name);
  }

  // Fallback if no subsections or 'all' category
  if (subCategories.length === 0) {
    subCategories = Array.from(
      new Set(
        categoryProducts.map(p => (lang === 'bn' ? p.subcategoryBn : p.subcategoryEn)).filter(Boolean)
      )
    );
  }

  // Dynamic calculation of products matching subcategory
  const getSubCatCount = (subcatBn: string, subcatEn: string) => {
    const activeList = (products || []).filter(p => p.isActive !== false && !p.isArchived);
    return activeList.filter((p) => {
      const sBn = normalizeBengali(subcatBn);
      const sEn = (subcatEn || '').toLowerCase().trim();
      const pSubBn = normalizeBengali(p.subcategoryBn);
      const pSubEn = (p.subcategoryEn || '').toLowerCase().trim();
      const pNameBn = normalizeBengali(p.nameBn);
      const pNameEn = (p.nameEn || '').toLowerCase();

      return (
        (pSubBn && (pSubBn.includes(sBn) || sBn.includes(pSubBn))) ||
        (pSubEn && (pSubEn.includes(sEn) || sEn.includes(pSubEn))) ||
        pNameBn.includes(sBn) ||
        pNameEn.includes(sEn)
      );
    }).length;
  };

  const categoryGroups = React.useMemo(() => {
    const activeSubs = (subsections || []).filter(s => s.isActive !== false);
    const parentGroups = activeSubs.filter(s => !s.parentSub);

    if (parentGroups.length > 0) {
      return parentGroups
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map(pg => {
          const childItems = activeSubs
            .filter(s => s.parentSub && s.parentSub.trim() === pg.name.trim())
            .sort((a, b) => (a.order || 0) - (b.order || 0));
          return {
            id: pg.id,
            titleBn: pg.name,
            titleEn: pg.name,
            subtitleBn: pg.description || '',
            subtitleEn: pg.description || '',
            bgColor: 'bg-[#f0faf3]',
            borderColor: 'border-[#d8f0e0]',
            accentColor: '#009245',
            items: childItems.map(item => ({
              id: item.id,
              nameBn: item.name,
              nameEn: item.name,
              count: getSubCatCount(item.name, item.name),
              image: item.imageUrl || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80',
            })),
          };
        });
    }

    const activeList = (products || []).filter(p => p.isActive !== false && !p.isArchived);
    const uniqueSubs = Array.from(new Set(activeList.map(p => p.subcategoryBn).filter(Boolean)));
    return [
      {
        id: 'default-all-group',
        titleBn: 'সকল কালেকশন',
        titleEn: 'All Collections',
        subtitleBn: 'সব ক্যাটাগরি ও সাব-ক্যাটাগরি সমূহ',
        subtitleEn: 'All Categories and Sub-categories',
        bgColor: 'bg-[#f0faf3]',
        borderColor: 'border-[#d8f0e0]',
        accentColor: '#009245',
        items: uniqueSubs.map((sub, idx) => ({
          id: `sub-${idx}`,
          nameBn: sub,
          nameEn: sub,
          count: getSubCatCount(sub, sub),
          image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&auto=format&fit=crop&q=80',
        })),
      },
    ];
  }, [subsections, products]);

  // In-page section data source: switches between all products and wishlist locally
  const activeProductsSource = inPageTab === 'wishlist'
    ? wishlistItems
    : (selectedSubCategory ? products.filter(p => p.isActive !== false && !p.isArchived) : categoryProducts);

  const filteredProducts = selectedSubCategory
    ? activeProductsSource.filter(p => {
        const s = normalizeBengali(selectedSubCategory);
        const pSubBn = normalizeBengali(p.subcategoryBn);
        const pSubEn = (p.subcategoryEn || '').toLowerCase().trim();
        const pNameBn = normalizeBengali(p.nameBn);
        const pNameEn = (p.nameEn || '').toLowerCase();
        return (
          pSubBn.includes(s) ||
          s.includes(pSubBn) ||
          pSubEn.includes(s) ||
          pNameBn.includes(s) ||
          pNameEn.includes(s)
        );
      })
    : activeProductsSource;

  // Robust Client-Side Sorting Reinforcement
  const sortedAndFilteredProducts = React.useMemo(() => {
    let list = [...filteredProducts];
    if (sortOrder === 'price_asc') {
      list.sort((a, b) => a.sellingPrice - b.sellingPrice);
    } else if (sortOrder === 'price_desc') {
      list.sort((a, b) => b.sellingPrice - a.sellingPrice);
    } else if (sortOrder === 'newest') {
      // Reversing or sorting by ID/Date if available, here we reverse to show newly added on top
      list.reverse();
    }
    return list;
  }, [filteredProducts, sortOrder]);

  const isSearchActive = Boolean(publicSearch && publicSearch.trim().length > 0);

  // If viewing a product, render dedicated Product Details / Order Page!
  if (viewingProduct) {
    const activeList = sortedAndFilteredProducts.length > 0 ? sortedAndFilteredProducts : products;
    return (
      <div className="min-h-screen bg-[#fafaf9] text-slate-900 pb-20">
        <ProductDetailsPage
          product={viewingProduct}
          onBack={() => setViewingProduct(null)}
          categoryProducts={activeList}
          onSelectRelated={(prod) => {
            setViewingProduct(prod);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>
    );
  }

  // If notifications view is active
  if (publicCategory.toLowerCase() === 'notifications') {
    return <PublicNotificationsView />;
  }

  // If any specific category, shop_tab, OR active search is present, render the dedicated Category Page!
  if ((publicCategory !== 'all' && publicCategory !== 'wishlist') || isSearchActive) {
    const slug = (publicCategory !== 'all' && publicCategory !== 'wishlist')
      ? publicCategory.toLowerCase()
      : 'shop';

    return (
      <div className="min-h-screen bg-[#fafaf9] text-slate-900 pb-20">
        <ShopCategoryPage
          categorySlug={slug}
          products={products}
          loading={loading}
        />
      </div>
    );
  }

  // If WISHLIST is active from bottom nav bar, render dedicated Wishlist Page!
  if (publicCategory.toLowerCase() === 'wishlist') {
    return (
      <div className="min-h-screen bg-[#fafaf9] text-slate-900 pb-24">
        <div className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 pt-3 pb-6 space-y-4">
          {/* Clean Single Header Bar */}
          <div className="bg-white dark:bg-slate-900 py-2.5 px-3.5 sm:px-4 rounded-2xl shadow-2xs border border-slate-200/90 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => {
                  setPublicCategory('all');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl inline-flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95 shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ফিরে যান' : 'Back'}</span>
              </button>
              <h1 className="text-xs sm:text-sm md:text-base font-black text-slate-900 dark:text-white truncate">
                {lang === 'bn' ? 'আমার পছন্দের তালিকা' : 'My Wishlist'}
              </h1>
            </div>

            <div className="flex items-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200/80 px-3 py-1 rounded-full text-xs font-black shadow-2xs shrink-0">
              <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
              <span>{wishlistItems.length} {lang === 'bn' ? 'টি পণ্য' : 'items'}</span>
            </div>
          </div>

          {/* Wishlist Items Grid */}
          {wishlistItems.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-slate-200/80 p-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-rose-50 text-rose-400 mx-auto flex items-center justify-center">
                <Heart className="w-8 h-8" />
              </div>
              <h3 className="text-base sm:text-lg font-black text-slate-900">
                {lang === 'bn' ? 'আপনার পছন্দের তালিকায় কোনো পণ্য নেই' : 'Your Wishlist is Empty'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
                {lang === 'bn' ? 'পছন্দের পণ্য সংরক্ষণ করতে পণ্যের কার্ডে থাকা হার্ট আইকনে ক্লিক করুন।' : 'Click the heart icon on any product to save it to your favorites.'}
              </p>
              <button
                onClick={() => {
                  setPublicCategory('all');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="px-5 py-2.5 bg-[#009245] hover:bg-[#007a3a] text-white text-xs sm:text-sm font-bold rounded-xl hover:scale-105 transition-all shadow-xs cursor-pointer active:scale-95"
              >
                {lang === 'bn' ? 'হোমে ফিরে যান' : 'Back to Home'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
              {wishlistItems.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  compact={true}
                  onCardClick={() => setViewingProduct(product)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }


  // Split into "Popular Products" (top 5) and "Important / Essential Products"
  const popularProducts = inPageTab === 'wishlist'
    ? sortedAndFilteredProducts
    : sortedAndFilteredProducts.slice(0, 5);
  const importantProducts = inPageTab === 'wishlist'
    ? []
    : (sortedAndFilteredProducts.length > 5 ? sortedAndFilteredProducts.slice(5) : []);

  // Filter valid active categories
  const displayCategories = categories.filter(
    (c) => c.isActive !== false && c.slug !== 'd' && c.description !== 'd'
  );

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 pb-20">
      
      {/* 1. Hero Showcase Banner */}
      <HeroSection />

      {/* 2. Trust / Feature Badges Strip (Clean Black Text & Brand Green Icons) */}
      <ScrollReveal className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8 pt-1 pb-2 sm:py-3" delay={0} duration={350}>
        <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 py-2 sm:py-3 px-1 sm:px-4 shadow-xs grid grid-cols-4 divide-x divide-slate-100 items-center">
          
          {/* Badge 1: Reliable Products */}
          <div className="group flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl hover:bg-emerald-50/60 hover:shadow-2xs hover:-translate-y-0.5 active:scale-95 transition-all duration-300 cursor-pointer">
            <div className="w-6.5 h-6.5 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100/80 group-hover:bg-[#009245] group-hover:text-white group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-3xs">
              <ShieldCheck className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 text-[#009245] group-hover:text-white transition-colors duration-300" />
            </div>
            <div className="min-w-0">
              <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 group-hover:text-[#009245] leading-tight transition-colors duration-300">
                {lang === 'bn' ? 'নির্ভরযোগ্য পণ্য' : 'Authentic'}
              </h4>
              <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                {lang === 'bn' ? '১০০% মানসম্মত' : '100% Quality'}
              </p>
            </div>
          </div>

          {/* Badge 2: Nationwide Delivery */}
          <div className="group flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl hover:bg-emerald-50/60 hover:shadow-2xs hover:-translate-y-0.5 active:scale-95 transition-all duration-300 cursor-pointer">
            <div className="w-6.5 h-6.5 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100/80 group-hover:bg-[#009245] group-hover:text-white group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-3xs">
              <Truck className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 text-[#009245] group-hover:text-white transition-colors duration-300" />
            </div>
            <div className="min-w-0">
              <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 group-hover:text-[#009245] leading-tight transition-colors duration-300">
                {lang === 'bn' ? 'সারা দেশে ডেলিভারি' : 'Nationwide'}
              </h4>
              <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                {lang === 'bn' ? 'দ্রুত ও নিরাপদ' : 'Fast Delivery'}
              </p>
            </div>
          </div>

          {/* Badge 3: Easy Return */}
          <div className="group flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl hover:bg-emerald-50/60 hover:shadow-2xs hover:-translate-y-0.5 active:scale-95 transition-all duration-300 cursor-pointer">
            <div className="w-6.5 h-6.5 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100/80 group-hover:bg-[#009245] group-hover:text-white group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-3xs">
              <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4 text-[#009245] group-hover:text-white transition-colors duration-300" />
            </div>
            <div className="min-w-0">
              <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 group-hover:text-[#009245] leading-tight transition-colors duration-300">
                {lang === 'bn' ? 'সহজ রিটার্ন' : 'Easy Return'}
              </h4>
              <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                {lang === 'bn' ? '৭ দিনের মধ্যে' : '7 Days'}
              </p>
            </div>
          </div>

          {/* Badge 4: 24/7 Support */}
          <div className="group flex flex-col sm:flex-row items-center justify-center sm:justify-start text-center sm:text-left gap-1 sm:gap-2.5 p-1 sm:p-2 rounded-xl hover:bg-emerald-50/60 hover:shadow-2xs hover:-translate-y-0.5 active:scale-95 transition-all duration-300 cursor-pointer">
            <div className="w-6.5 h-6.5 sm:w-8 sm:h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100/80 group-hover:bg-[#009245] group-hover:text-white group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-3xs">
              <Headphones className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5 text-[#009245] group-hover:text-white transition-colors duration-300" />
            </div>
            <div className="min-w-0">
              <h4 className="text-[9px] sm:text-xs md:text-sm font-bold text-slate-900 group-hover:text-[#009245] leading-tight transition-colors duration-300">
                {lang === 'bn' ? '২৪/৭ সাপোর্ট' : '24/7 Support'}
              </h4>
              <p className="text-[8px] sm:text-[11px] text-slate-500 mt-0.5 hidden md:block">
                {lang === 'bn' ? 'যে কোনো সময়' : 'Help Anytime'}
              </p>
            </div>
          </div>

        </div>
      </ScrollReveal>

      {/* 3. ক্যাটাগরি সমূহ (Category Showcase Section with UI Animations) */}
      {publicCategory === 'all' && displayCategories.length > 0 && (
        <ScrollReveal delay={0} duration={350}>
          <section className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-2 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-5 h-1.5 bg-[#009245] rounded-full inline-block" />
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  {lang === 'bn' ? 'ক্যাটাগরি সমূহ' : 'Categories'}
                </h2>
              </div>

              <button
                onClick={() => {
                  setPublicSearch('');
                  setSelectedPublicSubcategory(null);
                  setPublicCategory('shop');
                  setSelectedSubCategory(null);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="text-xs sm:text-sm font-bold text-slate-700 hover:text-[#009245] transition-colors flex items-center gap-1 group cursor-pointer"
              >
                <span>{lang === 'bn' ? 'সব ক্যাটাগরি দেখুন' : 'View All Categories'}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">
              {displayCategories.map((cat, idx) => {
                const count = products.filter(
                  (p) => isCategoryMatch(p.categorySlug, cat.slug) && p.isActive !== false
                ).length;

                // Distinct Professional Color Themes per Category
                const isShop = cat.slug.toLowerCase().includes('shop') || idx === 0;
                const isGadget = cat.slug.toLowerCase().includes('gadget') || cat.slug.toLowerCase().includes('gajet') || idx === 1;

                const theme = isShop
                  ? {
                      bg: 'bg-gradient-to-br from-emerald-50 via-teal-50/40 to-green-50/50',
                      border: 'border-emerald-200/90 shadow-2xs',
                      hoverBorder: 'hover:border-emerald-500 hover:shadow-md',
                      badgeBg: 'bg-white/90 backdrop-blur-xs',
                      badgeBorder: 'border-emerald-200',
                      badgeText: 'text-emerald-800',
                      btnBg: 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 shadow-xs',
                      iconBg: 'bg-white/95 backdrop-blur-xs border-emerald-200 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
                      IconComponent: Shirt,
                    }
                  : isGadget
                  ? {
                      bg: 'bg-gradient-to-br from-sky-50 via-blue-50/40 to-cyan-50/50',
                      border: 'border-sky-200/90 shadow-2xs',
                      hoverBorder: 'hover:border-sky-500 hover:shadow-md',
                      badgeBg: 'bg-white/90 backdrop-blur-xs',
                      badgeBorder: 'border-sky-200',
                      badgeText: 'text-sky-800',
                      btnBg: 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 shadow-xs',
                      iconBg: 'bg-white/95 backdrop-blur-xs border-sky-200 text-sky-700 group-hover:bg-sky-600 group-hover:text-white',
                      IconComponent: Smartphone,
                    }
                  : {
                      bg: 'bg-gradient-to-br from-purple-50 via-fuchsia-50/40 to-violet-50/50',
                      border: 'border-purple-200/90 shadow-2xs',
                      hoverBorder: 'hover:border-purple-500 hover:shadow-md',
                      badgeBg: 'bg-white/90 backdrop-blur-xs',
                      badgeBorder: 'border-purple-200',
                      badgeText: 'text-purple-800',
                      btnBg: 'bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 shadow-xs',
                      iconBg: 'bg-white/95 backdrop-blur-xs border-purple-200 text-purple-700 group-hover:bg-purple-600 group-hover:text-white',
                      IconComponent: Package,
                    };

                const IconTag = theme.IconComponent;

                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setPublicSearch('');
                      setSelectedPublicSubcategory(null);
                      setPublicCategory(cat.slug);
                      setSelectedSubCategory(null);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className={`${theme.bg} border ${theme.border} rounded-xl sm:rounded-2xl p-3 sm:p-5 flex items-center justify-between gap-2.5 sm:gap-4 transition-all duration-400 hover:shadow-md ${theme.hoverBorder} hover:-translate-y-1 active:scale-[0.99] cursor-pointer group`}
                  >
                    <div className="flex-1 space-y-1.5 sm:space-y-2 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-lg font-black text-slate-900 uppercase tracking-tight truncate group-hover:text-[#009245] transition-colors">
                          {cat.name}
                        </h3>
                        <span className={`${theme.badgeBg} border ${theme.badgeBorder} ${theme.badgeText} text-[10.5px] sm:text-[11.5px] font-black px-2 py-0.5 rounded-lg shadow-2xs shrink-0 transition-all`}>
                          {lang === 'bn' ? `${count} টি পণ্য` : `${count} Products`}
                        </span>
                      </div>

                      <p className="text-[11px] sm:text-xs text-slate-700 font-medium line-clamp-1 sm:line-clamp-2 leading-tight sm:leading-relaxed max-w-[280px]">
                        {cat.description || (lang === 'bn' ? 'প্রয়োজনীয় সব পণ্য এক জায়গায়।' : 'All essentials in one place.')}
                      </p>

                      <div className="pt-1 sm:pt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPublicSearch('');
                            setSelectedPublicSubcategory(null);
                            setPublicCategory(cat.slug);
                            setSelectedSubCategory(null);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={`inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-xl ${theme.btnBg} text-white text-xs sm:text-sm font-black transition-all duration-200 shadow-xs hover:shadow-md hover:scale-105 active:scale-95 cursor-pointer`}
                        >
                          <span>{lang === 'bn' ? 'এক্সপ্লোর করুন' : 'Explore'}</span>
                          <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover:translate-x-1.5 transition-transform duration-300" />
                        </button>
                      </div>
                    </div>

                    <div className="relative shrink-0 flex flex-col items-end">
                      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl border flex items-center justify-center mb-1 sm:mb-2 self-end shadow-2xs group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300 ${theme.iconBg}`}>
                        <IconTag className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                      </div>
                      {cat.imageUrl && (
                        <img
                          src={cat.imageUrl}
                          alt={cat.name}
                          className="w-24 h-18 sm:w-38 sm:h-26 object-cover rounded-xl border border-white/90 shadow-2xs group-hover:scale-105 transition-transform duration-500"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* 4. "জনপ্রিয় পণ্য" (Popular Products) Section */}
      <ScrollReveal delay={0} duration={350}>
        <section id="catalog-section" className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-6">
          
          {/* Section Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-5 h-1.5 bg-[#009245] rounded-full inline-block" />
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {inPageTab === 'wishlist'
                  ? (lang === 'bn' ? 'আমার পছন্দের পণ্যসমূহ' : 'My Favorite Products')
                  : publicCategory !== 'all' && currentCategoryObj
                  ? (lang === 'bn' ? `${currentCategoryObj.name} কালেকশন` : `${currentCategoryObj.name} Collection`)
                  : (lang === 'bn' ? 'জনপ্রিয় পণ্য' : 'Popular Products')}
              </h2>
            </div>

            <button
              onClick={() => {
                setInPageTab('all');
                setSelectedSubCategory(null);
              }}
              className="text-xs sm:text-sm font-bold text-slate-700 hover:text-[#009245] transition-colors flex items-center gap-1 group cursor-pointer"
            >
              <span>{lang === 'bn' ? 'সব দেখুন' : 'View All'}</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Unified Single-Line Action Strip (Strict 1-Line on Mobile) */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white rounded-xl border border-slate-200/80 text-xs flex-nowrap w-full">
            {/* Two Main Tabs/Pills */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 min-w-0">
              <button
                onClick={() => {
                  setInPageTab('all');
                  setSelectedSubCategory(null);
                }}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  inPageTab !== 'wishlist'
                    ? 'bg-[#009245] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {lang === 'bn' ? 'সকল পণ্য' : 'All Products'}
              </button>
              
              <button
                onClick={() => {
                  setInPageTab('wishlist');
                  setSelectedSubCategory(null);
                }}
                className={`px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-black transition-all cursor-pointer flex items-center gap-1 shrink-0 whitespace-nowrap ${
                  inPageTab === 'wishlist'
                    ? 'bg-rose-500 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Heart className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${inPageTab === 'wishlist' ? 'fill-white text-white' : 'text-slate-400'}`} />
                <span>{lang === 'bn' ? 'আমার পছন্দ' : 'My Favorites'}</span>
                <span className={`text-[9px] sm:text-[10px] font-bold px-1 sm:px-1.5 py-0.2 rounded-full font-mono shrink-0 ${
                  inPageTab === 'wishlist' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {wishlistItems.length}
                </span>
              </button>
            </div>

            {/* Sort Selector Dropdown */}
            <div className="flex items-center shrink-0">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="bg-slate-50 hover:bg-slate-100 border border-slate-200/90 rounded-lg px-2 py-1 sm:py-1.5 text-slate-800 text-[10.5px] sm:text-xs font-semibold focus:outline-none focus:border-[#009245] cursor-pointer transition-colors"
              >
                <option value="default">{lang === 'bn' ? 'ডিফল্ট সাজানো' : 'Default'}</option>
                <option value="newest">{lang === 'bn' ? 'নতুন পণ্য' : 'Newest'}</option>
                <option value="price_asc">{lang === 'bn' ? 'কম দাম থেকে বেশি' : 'Price: Low to High'}</option>
                <option value="price_desc">{lang === 'bn' ? 'বেশি দাম থেকে কম' : 'Price: High to Low'}</option>
              </select>
            </div>
          </div>

          {/* Case 1: When inPageTab is 'all' and no subcategory is selected: Render Subcategory Collection Groups */}
          {inPageTab === 'all' && selectedSubCategory === null ? (
            <div className="space-y-4">
              {categoryGroups.map((group) => (
                <div
                  key={group.id}
                  className={`${group.bgColor} border ${group.borderColor} rounded-2xl sm:rounded-3xl p-3 sm:p-5 space-y-2.5 sm:space-y-3.5 shadow-2xs`}
                >
                  {/* Group Header */}
                  <div className="flex items-center justify-between pb-0.5 sm:pb-1">
                    <div>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span
                          className="w-3 sm:w-4 h-1 sm:h-1.5 rounded-full inline-block"
                          style={{ backgroundColor: group.accentColor }}
                        />
                        <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-tight">
                          {lang === 'bn' ? group.titleBn : group.titleEn}
                        </h3>
                      </div>
                      {group.subtitleBn && (
                        <p className="text-[10px] sm:text-xs text-slate-600 font-normal mt-0.5 line-clamp-1">
                          {lang === 'bn' ? group.subtitleBn : group.subtitleEn}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Sub-categories Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 sm:gap-3">
                    {group.items.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          setPublicSearch('');
                          setSelectedPublicSubcategory(item.nameBn);
                          setPublicCategory(publicCategory !== 'all' ? publicCategory : 'shop');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="group cursor-pointer bg-white rounded-xl border border-slate-200/90 p-1.5 sm:p-2.5 hover:shadow-md hover:-translate-y-1 hover:border-[#009245] transition-all duration-300 flex flex-col justify-between active:scale-95"
                      >
                        <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-slate-50 mb-1 flex items-center justify-center">
                          <img
                            src={item.image}
                            alt={item.nameBn}
                            className="w-full h-full object-cover object-center rounded-lg group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="pt-0.5 pb-1">
                          <h4 className="text-[8.5px] sm:text-xs font-black text-slate-900 group-hover:text-[#009245] transition-colors leading-tight whitespace-nowrap overflow-visible tracking-tight">
                            {lang === 'bn' ? item.nameBn : item.nameEn}
                          </h4>
                        </div>
                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-100">
                          <span className="bg-emerald-50 text-[#009245] font-extrabold text-[8px] sm:text-[10px] px-1.5 py-0.5 rounded-md border border-emerald-200/60 shadow-2xs">
                            {item.count} {lang === 'bn' ? 'পণ্য' : 'items'}
                          </span>
                          <div className="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full bg-slate-100 group-hover:bg-[#009245] text-slate-500 group-hover:text-white flex items-center justify-center transition-colors shrink-0">
                            <ChevronRight className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Case 2: When a subcategory is selected or when inPageTab is 'wishlist' */
            <div className="space-y-4">
              {selectedSubCategory && (
                <div className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-slate-200/80 shadow-2xs">
                  <button
                    onClick={() => setSelectedSubCategory(null)}
                    className="text-xs font-bold text-slate-800 hover:text-[#009245] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'সব কালেকশনে ফিরে যান' : 'Back to All Collections'}</span>
                  </button>
                  <span className="text-xs font-black text-[#009245] bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {selectedSubCategory} ({sortedAndFilteredProducts.length} {lang === 'bn' ? 'টি পণ্য' : 'items'})
                  </span>
                </div>
              )}

              {/* Products Grid */}
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-3 animate-pulse">
                      <div className="aspect-square bg-slate-100 rounded-xl" />
                      <div className="h-4 bg-slate-100 rounded w-3/4" />
                      <div className="h-4 bg-slate-100 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ) : sortedAndFilteredProducts.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-2xl border border-slate-200/80 p-8 space-y-3">
                  <p className="text-slate-500 font-medium text-sm">
                    {inPageTab === 'wishlist'
                      ? (lang === 'bn' ? 'আপনার পছন্দের তালিকায় কোনো পণ্য নেই।' : 'No items in wishlist.')
                      : (lang === 'bn' ? 'এই ক্যাটাগরিতে কোনো পণ্য পাওয়া যায়নি।' : 'No products found in this category.')}
                  </p>
                  {selectedSubCategory && (
                    <button
                      onClick={() => setSelectedSubCategory(null)}
                      className="px-4 py-2 bg-[#009245] text-white text-xs font-bold rounded-full hover:bg-[#007a3a] transition-colors cursor-pointer"
                    >
                      {lang === 'bn' ? 'সব কালেকশন দেখুন' : 'View All Collections'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
                  {sortedAndFilteredProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      compact={true}
                      onCardClick={() => setViewingProduct(product)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

        </section>
      </ScrollReveal>
    </div>
  );
};
