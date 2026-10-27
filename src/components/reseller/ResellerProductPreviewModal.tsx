import React, { useState } from 'react';
import {
  Download,
  Copy,
  Check,
  Star,
  Heart,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Link2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Product } from '../../types/index.js';
import { getAdjustedSellingPrice, getAdjustedRegularPrice, getResellerProfitPerUnit, getResellerWholesalePrice } from '../../utils/pricing.js';
import { getProductSizes } from '../../utils/productSizes.js';
import { isCategoryMatch } from '../ShopCategoryPage.js';
import { ResellerOrderCheckoutModal, CheckoutOrderItem } from './ResellerOrderCheckoutModal.js';

interface ResellerProductPreviewModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onTakeForSelling?: (product: Product) => void;
}

export const ResellerProductPreviewModal: React.FC<ResellerProductPreviewModalProps> = ({
  product,
  isOpen,
  onClose,
  onTakeForSelling,
}) => {
  const { lang, employee, brandSettings, addToCart, wishlistItems = [], toggleWishlist, showToast } = useApp();
  const isWishlisted = product ? wishlistItems.some(p => p.id === product.id) : false;
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPost, setCopiedPost] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [zoomMode, setZoomMode] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  // Sizes setup
  const availableSizes = getProductSizes(product);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  const isGadgetOrOther = product ? (
    isCategoryMatch(product.categorySlug, 'gadgets') ||
    isCategoryMatch(product.categorySlug, 'gajet') ||
    isCategoryMatch(product.categorySlug, 'others') ||
    isCategoryMatch(product.categorySlug, 'other') ||
    availableSizes.length === 0
  ) : false;

  const [customSellingPrice, setCustomSellingPrice] = useState<number | string>(() => {
    if (!product) return 0;
    const isGOrO = isCategoryMatch(product.categorySlug, 'gadgets') ||
      isCategoryMatch(product.categorySlug, 'gajet') ||
      isCategoryMatch(product.categorySlug, 'others') ||
      isCategoryMatch(product.categorySlug, 'other') ||
      availableSizes.length === 0;
    return isGOrO ? 0 : getAdjustedSellingPrice(product, employee, brandSettings);
  });
  const [quantity, setQuantity] = useState<number>(1);
  const [isDirectCheckoutOpen, setIsDirectCheckoutOpen] = useState(false);

  // Adjusted pricing
  const adjustedSellingPrice = product ? getAdjustedSellingPrice(product, employee, brandSettings) : 0;
  const adjustedRegularPrice = product ? getAdjustedRegularPrice(product, employee, brandSettings) : 0;
  const commission = product ? getResellerProfitPerUnit(product, employee, brandSettings) : 0;

  // Reset custom price, quantity & unselect size when product changes/opens
  React.useEffect(() => {
    if (product && isOpen) {
      const sizes = getProductSizes(product);
      const isGOrO = isCategoryMatch(product.categorySlug, 'gadgets') ||
        isCategoryMatch(product.categorySlug, 'gajet') ||
        isCategoryMatch(product.categorySlug, 'others') ||
        isCategoryMatch(product.categorySlug, 'other') ||
        sizes.length === 0;
      const adjPrice = getAdjustedSellingPrice(product, employee, brandSettings);
      setCustomSellingPrice(isGOrO ? 0 : adjPrice);
      setSelectedSize(null);
      setQuantity(1);
      setIsDirectCheckoutOpen(false);
    }
  }, [product?.id, isOpen]);

  // Thumbnail list scroll management
  const thumbnailScrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);

  // Filter images only (exclude video URLs)
  const images = product?.images && product.images.length > 0
    ? product.images.filter(img => img.url && !img.url.endsWith('.mp4')).map(img => img.url)
    : [product?.imageUrl || '/images/product_shop_dress_1790244714775.jpg'];

  const activeImage = images[activeImageIndex] || images[0];

  const checkThumbnailScroll = () => {
    if (thumbnailScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = thumbnailScrollRef.current;
      setCanScrollDown(scrollHeight - scrollTop - clientHeight > 8);
      setCanScrollUp(scrollTop > 8);
    }
  };

  React.useEffect(() => {
    if (isOpen && product) {
      checkThumbnailScroll();
      const el = thumbnailScrollRef.current;
      if (!el) return;

      let ro: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          checkThumbnailScroll();
        });
        ro.observe(el);
      }

      const timer = setTimeout(checkThumbnailScroll, 150);
      window.addEventListener('resize', checkThumbnailScroll);

      return () => {
        if (ro) ro.disconnect();
        clearTimeout(timer);
        window.removeEventListener('resize', checkThumbnailScroll);
      };
    }
  }, [images, isOpen, product]);

  if (!isOpen || !product) return null;

  const showInModalNotice = (msg: string, duration = 2200) => {
    setDownloadNotice(msg);
    setTimeout(() => setDownloadNotice(null), duration);
  };

  const handleScrollThumbnailsDown = () => {
    if (thumbnailScrollRef.current) {
      thumbnailScrollRef.current.scrollBy({ top: 120, behavior: 'smooth' });
      setTimeout(checkThumbnailScroll, 250);
    }
  };

  const handleScrollThumbnailsUp = () => {
    if (thumbnailScrollRef.current) {
      thumbnailScrollRef.current.scrollBy({ top: -120, behavior: 'smooth' });
      setTimeout(checkThumbnailScroll, 250);
    }
  };

  // Category name formatting: Keeps up to 2 full words without breaking single words like "কাতুয়া"
  const rawCategoryName = product.subcategoryBn || product.categorySlug || 'কাতুয়া';
  const getFormattedCategoryBadge = (name: string): string => {
    if (!name) return 'কাতুয়া';
    const words = name.trim().split(/\s+/);
    if (words.length <= 2) {
      if (name.length <= 14) return name;
      return name.slice(0, 12) + '...';
    }
    return words.slice(0, 2).join(' ') + '...';
  };
  const displayCategoryBadge = getFormattedCategoryBadge(rawCategoryName);

  const baseCostPrice = getResellerWholesalePrice(product, employee, brandSettings);

  const starCount = product.starRating || 5;
  const regularPrice = adjustedRegularPrice > adjustedSellingPrice ? adjustedRegularPrice : Math.round(adjustedSellingPrice * 1.25);
  const discountPercent = regularPrice > adjustedSellingPrice
    ? Math.round(((regularPrice - adjustedSellingPrice) / regularPrice) * 100)
    : 10;
  const ratingVal = product.starRating ? Number(product.starRating).toFixed(1) : '5.0';

  // Live custom pricing & validation
  const livePrice = customSellingPrice !== '' && !isNaN(Number(customSellingPrice)) && Number(customSellingPrice) > 0
    ? Number(customSellingPrice)
    : (isGadgetOrOther ? 0 : adjustedSellingPrice);

  const isPriceValid = isGadgetOrOther
    ? (customSellingPrice !== '' && customSellingPrice !== 0 && !isNaN(Number(customSellingPrice)) && Number(customSellingPrice) >= baseCostPrice && Number(customSellingPrice) > 0)
    : (livePrice >= baseCostPrice);

  // Reseller profit calculation (বিক্রয়মূল্য - পাইকারি মূল্য)
  const liveProfit = customSellingPrice !== '' && !isNaN(Number(customSellingPrice)) ? Math.max(0, Number(customSellingPrice) - baseCostPrice) : 0;

  // Copy Shareable Link
  const handleCopyShareableLink = () => {
    const link = employee
      ? `${window.location.origin}/?ref=${employee.id}&product=${product.productCode}`
      : `${window.location.origin}/?product=${product.productCode}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  // Copy Product Code
  const handleCopyCode = () => {
    navigator.clipboard.writeText(product.productCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2200);
  };

  // Download Single Image
  const handleDownloadSingle = async (imgUrl: string, idx: number) => {
    try {
      showInModalNotice('ছবি ডাউনলোড শুরু হচ্ছে...', 1500);
      const response = await fetch(imgUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const safeName = (product.nameBn || 'product').replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '_');
      link.download = `${product.productCode || 'TNX'}_${safeName}_${idx + 1}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      showInModalNotice('ছবি ডাউনলোড সম্পন্ন হয়েছে✓', 2200);
    } catch {
      const link = document.createElement('a');
      link.href = imgUrl;
      link.target = '_blank';
      link.download = `${product.productCode || 'TNX'}_${idx + 1}.jpg`;
      link.click();
      showInModalNotice('ছবি ডাউনলোড সম্পন্ন হয়েছে✓', 2200);
    }
  };

  // Download All Images (One by one sequentially)
  const handleDownloadAllImages = async () => {
    setIsDownloadingAll(true);
    showInModalNotice(`সবগুলো (${images.length}টি) ছবি ডাউনলোড হচ্ছে...`, 2000);

    for (let i = 0; i < images.length; i++) {
      try {
        const imgUrl = images[i];
        const response = await fetch(imgUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        const safeName = (product.nameBn || 'product').replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '_');
        link.download = `${product.productCode || 'TNX'}_${safeName}_photo_${i + 1}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        await new Promise(r => setTimeout(r, 450));
      } catch (err) {
        console.error('Failed to download image:', err);
      }
    }

    setIsDownloadingAll(false);
    showInModalNotice('সবগুলো ছবি ডাউনলোড সম্পন্ন হয়েছে✓', 3000);
  };

  // Copy Full Marketing Post
  const handleCopyMarketingPost = () => {
    const desc = product.shortDescBn || product.fullDescBn || '';
    const sizes = product.sizes && product.sizes.length > 0
      ? product.sizes.join(', ')
      : '';

    const text = `🛍️ পণ্য: ${product.nameBn}
📌 প্রডাক্ট কোড: ${product.productCode}
💰 অফার বিক্রয়মূল্য: ৳${product.sellingPrice.toLocaleString()} (রেগুলার ৳${regularPrice.toLocaleString()})
⭐ কাস্টমার রেটিং: ${ratingVal} / 5.0
${sizes ? `📐 উপলব্ধ সাইজ: ${sizes}\n` : ''}${desc ? `\n📝 পণ্যের বিবরণ:\n${desc}\n` : ''}
🚚 সারাদেশে দ্রুত হোম ডেলিভারি সুবিধা!
💵 ক্যাশ অন ডেলিভারি (পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন)
🛒 অর্ডার করতে এখনই আপনার নাম, মোবাইল নম্বর ও ঠিকানা লিখে মেসেজ করুন!`;

    navigator.clipboard.writeText(text);
    setCopiedPost(true);
    setTimeout(() => setCopiedPost(false), 2200);
  };

  return (
    <div className="space-y-3 sm:space-y-4 w-full max-w-full animate-in fade-in duration-200">
      
      {/* 1. Top Header Bar with Back Button, Category Badge, Link Copy & Code (Strict Single-Line Row) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-2 sm:p-3 shadow-2xs flex flex-nowrap items-center justify-between gap-1 sm:gap-2 w-full overflow-hidden">
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 overflow-hidden">
          <button
            type="button"
            onClick={onClose}
            className="px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-0.5 sm:gap-1 transition-colors cursor-pointer shrink-0 active:scale-95 whitespace-nowrap"
            title={lang === 'bn' ? 'ফিরে যান' : 'Back'}
          >
            <ChevronLeft className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <span>{lang === 'bn' ? 'ফিরে যান' : 'Back'}</span>
          </button>

          {/* Category Badge */}
          <span
            className="text-[9.5px] sm:text-xs font-black text-[#009245] bg-emerald-50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg border border-emerald-200/80 font-mono shrink-0 whitespace-nowrap max-w-[75px] sm:max-w-[120px] truncate inline-block"
            title={rawCategoryName}
          >
            {displayCategoryBadge}
          </span>

          {/* Product Link Button */}
          <button
            type="button"
            onClick={handleCopyShareableLink}
            className="flex items-center gap-0.5 sm:gap-1 cursor-pointer whitespace-nowrap bg-emerald-50 hover:bg-emerald-100 px-1.5 sm:px-2 py-1 rounded-lg border border-emerald-200/80 transition-colors shrink-0 text-[9.5px] sm:text-xs font-bold text-[#009245]"
            title="লিংক কপি করতে ক্লিক করুন"
          >
            <Link2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#009245] shrink-0" />
            <span>{copiedLink ? '✓ লিংক কপি' : (lang === 'bn' ? 'প্রোডাক্ট লিংক' : 'Product Link')}</span>
          </button>
        </div>

        {/* Product Code */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <button
            type="button"
            onClick={handleCopyCode}
            className="text-[9.5px] sm:text-xs text-slate-600 font-mono font-bold hover:text-[#009245] transition-colors cursor-pointer bg-slate-50 px-1.5 sm:px-2 py-1 rounded-lg border border-slate-200 whitespace-nowrap shrink-0"
            title="কোড কপি করতে ক্লিক করুন"
          >
            {copiedCode ? '✓ কোড কপি' : `Code: #${product.productCode}`}
          </button>
        </div>
      </div>

      {/* 2. Main Product Content Box */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-5 shadow-2xs relative">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 items-start">
            
            {/* LEFT COLUMN: Gallery & Marketing actions */}
            <div className="space-y-3.5">
              
              {/* গ্যালারি (উলম্ব থাম্বনেইল + বড় লম্বাটে ডিসপ্লে) */}
              {/* গ্যালারি (উলম্ব থাম্বনেইল + বড় লম্বাটে ডিসপ্লে) */}
          <div className="flex flex-row gap-2 sm:gap-3.5 items-stretch w-full max-w-full md:max-w-[560px] h-[340px] sm:h-[380px] md:h-[500px] lg:h-[530px]">
            
            {/* থাম্বনেইল কলাম (কোনো আবদ্ধকারী বর্ডার শেপ ছাড়া সম্পূর্ণ মুক্ত ও ক্লিন) */}
            <div className="relative flex flex-col items-center w-[46px] sm:w-[56px] shrink-0 h-full py-0.5">
              {canScrollUp && (
                <button
                  type="button"
                  onClick={handleScrollThumbnailsUp}
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white hover:bg-slate-100 text-slate-700 hover:text-[#009245] shadow-xs border border-slate-200 flex items-center justify-center transition-all cursor-pointer z-20"
                  title={lang === 'bn' ? 'উপরে স্ক্রল করুন' : 'Scroll Up'}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
              )}

              <div
                ref={thumbnailScrollRef}
                onScroll={checkThumbnailScroll}
                className="h-full w-full overflow-y-auto flex flex-col items-center gap-1.5 sm:gap-2 scrollbar-none py-1 scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIndex(idx)}
                    className={`w-[44px] h-[44px] sm:w-[54px] sm:h-[54px] min-w-[44px] min-h-[44px] sm:min-w-[54px] sm:min-h-[54px] max-w-[44px] max-h-[44px] sm:max-w-[54px] sm:max-h-[54px] aspect-square rounded-xl overflow-hidden cursor-pointer bg-white shrink-0 transition-all p-0.5 flex items-center justify-center ${
                      activeImageIndex === idx
                        ? 'border-2 border-[#009245] shadow-xs'
                        : 'border border-slate-200 hover:border-slate-300 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt="thumb" className="w-full h-full object-cover aspect-square rounded-lg" />
                  </button>
                ))}
              </div>

              {canScrollDown && (
                <button
                  type="button"
                  onClick={handleScrollThumbnailsDown}
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-white hover:bg-slate-100 text-slate-700 hover:text-[#009245] shadow-xs border border-slate-200 flex items-center justify-center transition-all cursor-pointer z-20"
                  title={lang === 'bn' ? 'নিচে স্ক্রল করুন' : 'Scroll Down'}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* মূল ডিসপ্লে (মোবাইলে হালকা ছোট, ডেস্কটপে বড় ও সুষম অনুপাতে আকর্ষণীয় ফ্রেম) */}
            <div className="flex-1 h-full min-w-0">
              <div
                onMouseMove={(e) => {
                  if (!zoomMode) return;
                  const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(100, ((e.clientX - left) / width) * 100));
                  const y = Math.max(0, Math.min(100, ((e.clientY - top) / height) * 100));
                  setMousePos({ x, y });
                }}
                onTouchMove={(e) => {
                  if (!zoomMode || !e.touches[0]) return;
                  const touch = e.touches[0];
                  const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(100, ((touch.clientX - left) / width) * 100));
                  const y = Math.max(0, Math.min(100, ((touch.clientY - top) / height) * 100));
                  setMousePos({ x, y });
                }}
                className="relative h-full w-full rounded-2xl overflow-hidden bg-slate-50 border border-slate-200/90 flex items-center justify-center p-2 group shadow-inner transition-all duration-200 select-none touch-none"
              >
                {/* Discount Badge */}
                {discountPercent > 0 && (
                  <span className="absolute top-2.5 left-2.5 z-10 text-[9.5px] sm:text-xs font-black text-white bg-rose-600 px-1.5 sm:px-2 py-0.5 rounded-md leading-none shadow-xs">
                    {discountPercent}% ছাড়
                  </span>
                )}

                {/* HD Full Image Display: কোনো কানি-কোনা কাটবে না, যেকোনো সাইজ সম্পূর্ণ ফিট হবে */}
                <img
                  src={activeImage}
                  alt={product.nameBn}
                  className={`max-w-full max-h-full w-auto h-auto object-contain rounded-xl transition-transform duration-150 ${
                    zoomMode ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                  style={{
                    transform: zoomMode ? 'scale(2.5)' : 'scale(1)',
                    transformOrigin: `${mousePos.x}% ${mousePos.y}%`,
                  }}
                  loading="eager"
                />

                {/* Single Image Download Floating Icon (ব্যাকগ্রাউন্ড ছাড়া ক্লিন ও বড়) */}
                <button
                  type="button"
                  onClick={() => handleDownloadSingle(activeImage, activeImageIndex)}
                  className="absolute bottom-2.5 left-2.5 p-1 text-slate-700 hover:text-[#009245] transition-all hover:scale-115 active:scale-90 cursor-pointer z-10 focus:outline-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
                  title="ছবি ডাউনলোড করুন"
                >
                  <Download className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>

                {/* Wishlist Heart Icon (রিসেলার প্যানেলের মতো হুবহু ক্লিন ও প্রফেশনাল হার্ট আইকন) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWishlist(product);
                  }}
                  className="absolute top-2.5 right-2.5 p-1 transition-transform hover:scale-110 active:scale-95 cursor-pointer z-10 focus:outline-none"
                  title={lang === 'bn' ? 'পছন্দের তালিকায় রাখুন/বাদ দিন' : 'Toggle favorite'}
                >
                  <Heart
                    className={`w-5 h-5 sm:w-6 sm:h-6 transition-colors ${
                      isWishlisted
                        ? 'fill-rose-600 text-rose-600 drop-shadow-sm'
                        : 'text-slate-400 hover:text-rose-600 drop-shadow-[0_1px_2px_rgba(255,255,255,0.9)]'
                    }`}
                  />
                </button>

                {/* Zoom Toggle Floating Button (জুম আইকন, ব্যাকগ্রাউন্ড ছাড়া এবং মোবাইল ড্র্যাগ সাপোর্টেড) */}
                <button
                  type="button"
                  onClick={() => setZoomMode(!zoomMode)}
                  className={`absolute bottom-2.5 right-2.5 p-1 transition-all cursor-pointer z-10 focus:outline-none hover:scale-115 active:scale-90 ${
                    zoomMode
                      ? 'text-[#009245] drop-shadow-[0_2px_8px_rgba(0,146,69,0.6)]'
                      : 'text-slate-700 hover:text-[#009245] drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]'
                  }`}
                  title={zoomMode ? 'জুম বন্ধ করুন' : 'জুম করুন (ট্যাপ করে ড্র্যাগ করুন)'}
                >
                  {zoomMode ? (
                    <ZoomOut className="w-5 h-5 sm:w-6 sm:h-6" />
                  ) : (
                    <ZoomIn className="w-5 h-5 sm:w-6 sm:h-6" />
                  )}
                </button>
              </div>
            </div>

          </div>

          {/* স্টার রেটিং এবং পোস্ট কপি ও সব ডাউনলোড বাটন */}
          <div className="flex items-center justify-between gap-1 sm:gap-1.5 pt-1.5 border-t border-slate-100">
            {/* স্টার রেটিং ব্যাজ */}
            <div className="flex items-center gap-1 bg-[#fffbeb] border border-[#fef3c7] px-2 sm:px-2.5 py-1.5 rounded-full shadow-3xs shrink-0">
              <Star className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-amber-400 text-amber-500 shrink-0" />
              <span className="text-[11px] sm:text-xs md:text-sm font-black text-[#d97706] font-mono">{ratingVal}</span>
              <span className="text-[9px] sm:text-[10px] md:text-xs text-[#b45309] font-bold">({lang === 'bn' ? 'রেটিং' : 'Rating'})</span>
            </div>

            {/* বাটনসমূহ */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleCopyMarketingPost}
                className="px-2 sm:px-2.5 py-1.5 rounded-full border border-slate-200 text-[10px] sm:text-xs md:text-sm font-black text-slate-700 hover:border-[#009245] hover:text-[#009245] hover:bg-[#f0faf3] transition-colors inline-flex items-center gap-1 cursor-pointer shadow-3xs shrink-0 whitespace-nowrap"
              >
                {copiedPost ? <Check className="w-3.5 h-3.5 text-[#009245]" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                <span>{copiedPost ? '✓ কপি' : (lang === 'bn' ? 'পোস্ট কপি' : 'Copy Post')}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadAllImages}
                disabled={isDownloadingAll}
                className="px-2 sm:px-2.5 py-1.5 rounded-full border border-slate-200 text-[10px] sm:text-xs md:text-sm font-black text-slate-700 hover:border-[#009245] hover:text-[#009245] hover:bg-[#f0faf3] transition-colors inline-flex items-center gap-1 cursor-pointer shadow-3xs shrink-0 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>{isDownloadingAll ? (lang === 'bn' ? 'ডাউনলোড...' : 'Down...') : (lang === 'bn' ? 'সব ডাউনলোড' : 'All Download')}</span>
              </button>
            </div>
          </div>

            </div>

            {/* RIGHT COLUMN: Title, Pricing, Selection, Description & Actions */}
            <div className="space-y-3.5">

          {/* প্রোডাক্টের নাম (হেডলাইন বড় হলেও ১-লাইনে অটো-এডজাস্ট ফিট হবে, নিচে কোনো 'কাতুয়া' থাকবে না) */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <h2
              className={`font-black text-slate-900 leading-tight whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0 ${
                (product.nameBn?.length || 0) > 30
                  ? 'text-[11px] sm:text-xs'
                  : (product.nameBn?.length || 0) > 18
                  ? 'text-xs sm:text-sm'
                  : 'text-sm'
              }`}
              title={product.nameBn}
            >
              {product.nameBn}
            </h2>

            {/* "স্টকে আছে" পালসিং স্পটলাইট ব্যাজ */}
            <div className="flex items-center gap-1.5 text-xs font-black text-[#009245] bg-[#eafff3] px-2.5 py-1 rounded-full border border-[#bbf7d0] shadow-2xs shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#009245]"></span>
              </span>
              <span>{lang === 'bn' ? 'স্টকে আছে' : 'In Stock'}</span>
            </div>
          </div>

          {/* দামের প্রফেশনাল ডিজাইন (মূল দাম, বিক্রি দাম, কমিশন) */}
          <div className="grid grid-cols-3 bg-gradient-to-r from-emerald-50/50 via-slate-50/50 to-emerald-50/50 rounded-2xl p-2 sm:p-2.5 border border-emerald-100/90 text-center shadow-3xs divide-x divide-slate-200/80">
            <div className="px-1 flex flex-col justify-center">
              <span className="text-[10px] sm:text-[10.5px] font-black text-slate-500 block mb-0.5 whitespace-nowrap">{lang === 'bn' ? 'মূল দাম' : 'Base Price'}</span>
              <span className="text-sm sm:text-base font-black text-slate-900 font-mono tracking-tight">
                ৳{(baseCostPrice * quantity).toLocaleString()}
              </span>
            </div>
            <div className="px-1 flex flex-col justify-center">
              <span className="text-[10px] sm:text-[10.5px] font-black text-slate-500 block mb-0.5 whitespace-nowrap">{lang === 'bn' ? 'বিক্রি দাম' : 'Selling Price'}</span>
              <span className="text-sm sm:text-base font-black text-rose-600 font-mono tracking-tight">
                ৳{(livePrice * quantity).toLocaleString()}
              </span>
            </div>
            <div className="px-1 bg-emerald-100/40 rounded-r-xl flex flex-col justify-center py-1">
              <span className="text-[10px] sm:text-[10.5px] font-black text-emerald-800 block mb-0.5 whitespace-nowrap">{lang === 'bn' ? 'আপনার প্রফিট' : 'Your Profit'}</span>
              <span className="text-sm sm:text-base font-black text-[#009245] font-mono tracking-tight">
                +৳{(liveProfit * quantity).toLocaleString()}
              </span>
            </div>
          </div>

          {/* ইন্টারঅ্যাক্টিভ সাইজ সিলেক্টর ও কাস্টম বিক্রি দাম ঘর (Interactive Reseller Custom Cart Box) */}
          <div className="p-3 bg-slate-50/90 rounded-2xl border border-slate-200/80 space-y-2.5 shadow-3xs">
            
            {/* ১. সাইজ নির্বাচন (M, L, XL, XXL) */}
            {!isGadgetOrOther && availableSizes.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs md:text-sm font-black text-slate-800 flex items-center gap-1">
                    <span>{lang === 'bn' ? 'সাইজ সিলেক্ট করুন:' : 'Select Size:'}</span>
                    <span className="text-[#009245]">*</span>
                  </label>
                  <span className="text-[10.5px] font-bold font-mono">
                    {lang === 'bn' ? 'সিলেক্টেড:' : 'Selected:'}{' '}
                    {selectedSize ? (
                      <span className="text-[#009245] font-black">{selectedSize}</span>
                    ) : (
                      <span className="text-amber-600 font-bold">{lang === 'bn' ? 'বাছাই করা হয়নি' : 'None'}</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {availableSizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      className={`px-3 py-1 text-xs font-black rounded-xl border transition-all cursor-pointer ${
                        selectedSize === size
                          ? 'bg-[#009245] text-white border-[#009245] shadow-xs scale-105'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-[#009245]/50 hover:bg-emerald-50/50'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ২. ২-কলাম লেআউট: কাস্টম বিক্রয়মূল্য ইনপুট (বাম) ও পরিমাণ ১-পিস/২-পিস সিলেক্টর (ডান) */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/70">
              
              {/* বাম পাশের ঘর: কাস্টমারের বিক্রয়মূল্য ইনপুট */}
              <div className="p-2 bg-white rounded-xl border border-slate-200 space-y-1 shadow-3xs">
                <div className="flex items-center justify-between gap-1">
                  <label className="text-[10.5px] font-black text-slate-800 block whitespace-nowrap">
                    {lang === 'bn' ? 'বিক্রয়মূল্য (৳):' : 'Selling Price (৳):'}
                  </label>
                  {isPriceValid && (
                    <span className="text-[10px] font-black text-[#009245] font-mono whitespace-nowrap">
                      +৳{(liveProfit * quantity).toLocaleString()}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute left-2.5 top-1.5 text-xs font-black text-slate-400 font-mono">৳</span>
                  <input
                    type="number"
                    value={customSellingPrice}
                    onChange={(e) => {
                      const rawVal = e.target.value;
                      if (rawVal === '') {
                        setCustomSellingPrice('');
                      } else {
                        const num = Number(rawVal);
                        setCustomSellingPrice(isNaN(num) ? '' : num);
                      }
                    }}
                    className={`w-full pl-6 pr-2 py-1 text-xs font-black font-mono rounded-lg border outline-none transition-colors ${
                      isPriceValid
                        ? 'bg-slate-50 border-slate-200 focus:border-[#009245] text-slate-900 focus:bg-white'
                        : 'bg-rose-50 border-rose-300 text-rose-900 focus:border-rose-500'
                    }`}
                    placeholder={isGadgetOrOther ? '0' : product.sellingPrice.toString()}
                  />
                </div>
              </div>

              {/* ডান পাশের ঘর: পরিমাণ সিলেক্টর (১ পিস, ২ পিস...) */}
              <div className="p-2 bg-white rounded-xl border border-slate-200 space-y-1 shadow-3xs flex flex-col justify-between">
                <label className="text-[10.5px] font-black text-slate-800 block whitespace-nowrap">
                  {lang === 'bn' ? 'পরিমাণ (পিস):' : 'Quantity:'}
                </label>

                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setQuantity(prev => Math.max(1, prev - 1))}
                    className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <Minus className="w-3 h-3" />
                  </button>

                  <div className="flex items-center justify-center gap-0.5 px-1 min-w-0">
                    <input
                      type="number"
                      min={1}
                      value={quantity || ''}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setQuantity(isNaN(val) || val < 1 ? 1 : val);
                      }}
                      className="w-8 text-center text-xs font-black text-slate-900 font-mono bg-transparent outline-none p-0 border-none"
                    />
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">{lang === 'bn' ? 'পিস' : 'pcs'}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setQuantity(prev => prev + 1)}
                    className="w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

            </div>

            {/* ১-লাইনের প্রফেশনাল এরর মেসেজ */}
            {!isPriceValid && (
              <p className="text-[10.5px] font-bold text-rose-600 leading-none whitespace-nowrap overflow-hidden text-ellipsis pt-0.5">
                {isGadgetOrOther && (customSellingPrice === '' || customSellingPrice === 0)
                  ? '❌ কাস্টমারের কাছে বিক্রয়মূল্য লিখুন!'
                  : `❌ বিক্রয়মূল্য পাইকারি মূল্য (৳${baseCostPrice.toLocaleString()}) এর কম হতে পারবে না!`}
              </p>
            )}

          </div>

          {/* পণ্যের বিবরণ সেকশন */}
          <div className="bg-slate-50/80 rounded-2xl p-2.5 sm:p-3 border border-slate-200/60 space-y-0.5">
            <span className="text-xs md:text-sm font-black text-slate-800 block">
              {lang === 'bn' ? 'পণ্যের বিবরণ:' : 'Description:'}
            </span>
            <p className="text-[11.5px] text-slate-600 leading-normal font-medium whitespace-pre-line">
              {product.shortDescBn || product.fullDescBn || 'এখানে পণ্যের বিস্তারিত তথ্য থাকবে। প্রিমিয়াম কোয়ালিটি ও চমৎকার ফিনিশিং।'}
            </p>
          </div>

          {/* ইন-মোডাল ১-লাইনের নিখুঁত কনফার্মেশন পপআপ (মোবাইল ফ্রেমের ভেতরে) */}
          {(copiedLink || copiedCode || copiedPost || downloadNotice) && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-[#009245] text-white px-3.5 py-1.5 rounded-full shadow-2xl text-[10.5px] font-black flex items-center gap-1.5 whitespace-nowrap max-w-[92%] border border-emerald-300/40 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
              <Check className="w-3.5 h-3.5 text-white shrink-0" />
              <span className="whitespace-nowrap font-sans font-bold">
                {downloadNotice
                  ? downloadNotice
                  : copiedLink
                  ? 'প্রোডাক্ট লিংক কপি হয়েছে✓'
                  : copiedCode
                  ? 'কোড নম্বর কপি হয়েছে✓'
                  : 'পোস্ট বিবরণ কপি হয়েছে✓'}
              </span>
            </div>
          )}

          {/* ২-বাটন রো: ১. কার্টে যোগ করুন (কার্টে যুক্ত হয়ে ক্যাটালগে থাকবে) ও ২. সরাসরি অর্ডার করুন (ডাইরেক্ট অর্ডারের প্রসেসিংয়ে চলে যাবে) */}
          {(() => {
            const canProceed = isGadgetOrOther
              ? (isPriceValid && quantity >= 1)
              : (isPriceValid && Boolean(selectedSize) && quantity >= 1);
            return (
          <div className="pt-0.5 grid grid-cols-2 gap-2">
            {/* বাটন ১: কার্টে যোগ করুন */}
            <button
              type="button"
              disabled={!canProceed}
              onClick={() => {
                if (!canProceed) return;
                const customizedProduct: Product = {
                  ...product,
                  sellingPrice: livePrice,
                  commissionRate: liveProfit,
                  imageUrl: activeImage,
                  sizes: isGadgetOrOther ? [] : [selectedSize as string],
                  quantity: quantity,
                  originalProductId: product.id,
                };
                addToCart(customizedProduct);
                onClose();
              }}
              className="py-3 px-2 text-xs sm:text-sm font-black text-emerald-900 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-2xl shadow-2xs transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed truncate"
              title={lang === 'bn' ? 'কার্টে যোগ করে পরবর্তীতে একসাথে অর্ডার করুন' : 'Add to Cart'}
            >
              <ShoppingBag className="w-4 h-4 shrink-0 text-[#009245]" />
              <span className="truncate">
                {!isGadgetOrOther && !selectedSize
                  ? (lang === 'bn' ? 'সাইজ বাছুন' : 'Select Size')
                  : !isPriceValid
                  ? (lang === 'bn' ? 'মূল্য দিন' : 'Enter Price')
                  : !quantity || quantity < 1
                  ? (lang === 'bn' ? 'পরিমাণ দিন' : 'Select Quantity')
                  : (lang === 'bn' ? 'কার্টে যোগ করুন' : 'Add to Cart')}
              </span>
            </button>

            {/* বাটন ২: সরাসরি অর্ডার করুন / অর্ডারে যুক্ত করুন */}
            <button
              type="button"
              disabled={!canProceed}
              onClick={() => {
                if (!canProceed || !product) return;

                const isAddingToOrder = typeof window !== 'undefined' && sessionStorage.getItem('tawzoon_reseller_is_adding_to_order') === 'true';
                if (isAddingToOrder) {
                  try {
                    const existingItemsRaw = sessionStorage.getItem('tawzoon_reseller_pending_order_items');
                    let currentItems: CheckoutOrderItem[] = existingItemsRaw ? JSON.parse(existingItemsRaw) : [];
                    if (!Array.isArray(currentItems)) currentItems = [];

                    const existingIndex = currentItems.findIndex(i =>
                      i.originalProductId === product.id && (isGadgetOrOther || (i.size || '') === (selectedSize || ''))
                    );

                    if (existingIndex >= 0) {
                      currentItems[existingIndex] = {
                        ...currentItems[existingIndex],
                        quantity: currentItems[existingIndex].quantity + quantity,
                        sellingPrice: livePrice,
                        profit: liveProfit,
                      };
                    } else {
                      const newItem: CheckoutOrderItem = {
                        id: `${product.id}_${isGadgetOrOther ? 'std' : (selectedSize || 'std')}_${Date.now()}`,
                        nameBn: product.nameBn,
                        productCode: product.productCode,
                        imageUrl: activeImage,
                        size: isGadgetOrOther ? undefined : (selectedSize || undefined),
                        quantity: quantity,
                        sellingPrice: livePrice,
                        profit: liveProfit,
                        originalProductId: product.id,
                      };
                      currentItems.push(newItem);
                    }

                    sessionStorage.setItem('tawzoon_reseller_pending_order_items', JSON.stringify(currentItems));
                    sessionStorage.removeItem('tawzoon_reseller_is_adding_to_order');
                    window.dispatchEvent(new Event('tawzoon_reseller_order_mode_changed'));

                    showToast(lang === 'bn' ? '✓ পণ্যটি সফলভাবে অর্ডারে যুক্ত হয়েছে!' : '✓ Product added to order!', 'success');
                    onClose();

                    window.dispatchEvent(
                      new CustomEvent('tawzoon_open_reseller_checkout', {
                        detail: { items: currentItems }
                      })
                    );
                    return;
                  } catch (err) {
                    console.error('Failed to add product to pending reseller order:', err);
                  }
                }

                setIsDirectCheckoutOpen(true);
              }}
              className={`py-3 px-2 text-xs sm:text-sm font-black text-white rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed truncate ${
                !isGadgetOrOther && !selectedSize
                  ? 'bg-amber-500 hover:bg-amber-600'
                  : !isPriceValid
                  ? 'bg-rose-500 hover:bg-rose-600'
                  : 'bg-[#009245] hover:bg-[#007a3a]'
              }`}
            >
              <ArrowRight className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {!isGadgetOrOther && !selectedSize
                  ? (lang === 'bn' ? '⚠️ সাইজ সিলেক্ট করুন' : 'Select Size')
                  : !isPriceValid
                  ? (lang === 'bn' ? '⚠️ বিক্রয়মূল্য দিন' : 'Enter Selling Price')
                  : !quantity || quantity < 1
                  ? (lang === 'bn' ? '⚠️ সঠিক পরিমাণ দিন' : 'Enter Quantity')
                  : typeof window !== 'undefined' && sessionStorage.getItem('tawzoon_reseller_is_adding_to_order') === 'true'
                  ? (lang === 'bn' ? (isGadgetOrOther ? '+ অর্ডারে যুক্ত করুন' : `+ অর্ডারে যুক্ত করুন (${selectedSize})`) : (isGadgetOrOther ? '+ Add to Order' : `+ Add to Order (${selectedSize})`))
                  : (lang === 'bn' ? (isGadgetOrOther ? 'অর্ডার করুন' : `অর্ডার করুন (${selectedSize})`) : (isGadgetOrOther ? 'Order Now' : `Order Now (${selectedSize})`))}
              </span>
            </button>
          </div>
            );
          })()}

        </div>
      </div>
    </div>

      {/* Direct Order Checkout Modal (হুবহু অর্ডারের প্রসেসিং) */}
      {isDirectCheckoutOpen && (
        <ResellerOrderCheckoutModal
          isOpen={isDirectCheckoutOpen}
          onClose={() => {
            setIsDirectCheckoutOpen(false);
            onClose();
          }}
          items={[
            {
              id: `${product.id}_${selectedSize || 'std'}`,
              nameBn: product.nameBn,
              productCode: product.productCode,
              imageUrl: activeImage,
              size: selectedSize || undefined,
              quantity: quantity,
              sellingPrice: livePrice,
              profit: liveProfit,
              originalProductId: product.id,
            },
          ]}
          onOrderSuccess={() => {}}
        />
      )}
    </div>
  );
};
