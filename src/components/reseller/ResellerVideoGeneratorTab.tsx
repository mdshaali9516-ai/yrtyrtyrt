import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  RefreshCw,
  Download,
  Check,
  X,
  Plus,
  Clapperboard,
  Film,
  Percent,
  ShoppingBag,
  Upload,
  Music,
  Copy,
  Sparkles,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext.js';
import { Product } from '../../types/index.js';
import {
  MusicGenre,
  scheduleBackgroundMusic,
  preRenderFullCommercialAudio,
} from '../../utils/commercialAudioEngine.js';

export interface CampaignToVideoData {
  posterUrl: string;
  aspectRatio: '1:1' | '4:5';
  generatedPosterUrls?: string[];
  productTitle?: string;
  sellingPrice?: number;
  regularPrice?: number;
  brandName?: string;
  brandTagline?: string;
  customLogoUrl?: string | null;
  offerTitle?: string;
  allImages?: string[];
}

interface ResellerVideoGeneratorTabProps {
  productsList?: Product[];
  onTakeForSelling?: (product: Product) => void;
  sharedCampaignData?: CampaignToVideoData | null;
  selectedProduct?: Product | null;
  onSelectProduct?: (product: Product) => void;
  onOpenCatalog?: () => void;
}

interface RenderedVideoCampaign {
  id: string;
  title: string;
  durationLabel: string;
  durationSeconds: number;
  resolution: string;
  fps: number;
  aspectRatio: '9:16' | '4:5';
  videoBlobUrl: string;
  thumbnailUrl: string;
}

export const ResellerVideoGeneratorTab: React.FC<ResellerVideoGeneratorTabProps> = ({
  productsList = [],
  onTakeForSelling,
  sharedCampaignData,
  selectedProduct: propSelectedProduct,
  onSelectProduct,
  onOpenCatalog,
}) => {
  const { lang, showToast } = useApp();

  // Selected Catalog Product
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(propSelectedProduct || null);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);

  // Branding & Logo
  const [brandName, setBrandName] = useState<string>('TawZoon');
  const [brandTagline, setBrandTagline] = useState<string>('STYLE FOR EVERY YOU');
  const [customLogoUrl, setCustomLogoUrl] = useState<string | null>(null);

  // Product Data
  const [productTitle, setProductTitle] = useState<string>('Premium Solid Cotton Katua');
  const [sellingPrice, setSellingPrice] = useState<number>(700);
  const [regularPrice, setRegularPrice] = useState<number>(778);
  const [showOfferBanner, setShowOfferBanner] = useState<boolean>(true);
  const [offerText, setOfferText] = useState<string>('স্পেশাল অফার');

  // Video aspect ratio
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '4:5'>('9:16');
  
  // Custom uploaded or variant images
  const [variantImages, setVariantImages] = useState<string[]>([
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=600&q=80',
    'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=600&q=80',
  ]);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);

  // Music Engine
  const [selectedMusicGenre, setSelectedMusicGenre] = useState<MusicGenre>('upbeat_pop');
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(false);
  const previewAudioCtxRef = useRef<AudioContext | null>(null);

  // Video Render States
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [currentStepText, setCurrentStepText] = useState<string>('');
  const [previewActive, setPreviewActive] = useState<boolean>(false);
  const [renderedCampaign, setRenderedCampaign] = useState<RenderedVideoCampaign | null>(null);

  // Sync prop selected product
  useEffect(() => {
    if (propSelectedProduct) {
      const prodAny = propSelectedProduct as any;
      setSelectedProduct(propSelectedProduct);
      setProductTitle(prodAny.title || prodAny.nameBn || prodAny.nameEn || '');
      setSellingPrice(prodAny.sellingPrice || prodAny.resellerPrice || prodAny.wholesalePrice || prodAny.price || 0);
      setRegularPrice(prodAny.regularPrice || Math.round(((prodAny.sellingPrice || prodAny.price || 700) * 1.15)));
      if (propSelectedProduct.images && propSelectedProduct.images.length > 0) {
        const urls = propSelectedProduct.images.map((img: any) => typeof img === 'string' ? img : img.url).filter(Boolean);
        if (urls.length > 0) {
          setVariantImages(urls);
          setActiveImageIndex(0);
        }
      }
    }
  }, [propSelectedProduct]);

  // Sync shared campaign data
  useEffect(() => {
    if (sharedCampaignData) {
      if (sharedCampaignData.productTitle) setProductTitle(sharedCampaignData.productTitle);
      if (sharedCampaignData.sellingPrice) setSellingPrice(sharedCampaignData.sellingPrice);
      if (sharedCampaignData.regularPrice) setRegularPrice(sharedCampaignData.regularPrice);
      if (sharedCampaignData.brandName) setBrandName(sharedCampaignData.brandName);
      if (sharedCampaignData.brandTagline) setBrandTagline(sharedCampaignData.brandTagline);
      if (sharedCampaignData.customLogoUrl) setCustomLogoUrl(sharedCampaignData.customLogoUrl);
      if (sharedCampaignData.offerTitle) setOfferText(sharedCampaignData.offerTitle);
      if (sharedCampaignData.allImages && sharedCampaignData.allImages.length > 0) {
        setVariantImages(sharedCampaignData.allImages);
        setActiveImageIndex(0);
      }
    }
  }, [sharedCampaignData]);

  // Handle Logo Upload
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCustomLogoUrl(event.target?.result as string);
        showToast(lang === 'bn' ? 'লোগো সফলভাবে আপলোড হয়েছে!' : 'Logo uploaded successfully!', 'success');
      };
      reader.readAsDataURL(file);
    }
  };

  // Add Custom Image
  const handleAddImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newImgs: string[] = [];
      let count = 0;
      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            newImgs.push(event.target.result as string);
          }
          count++;
          if (count === files.length) {
            setVariantImages((prev) => [...prev, ...newImgs]);
            showToast(lang === 'bn' ? `${count}টি ছবি যোগ করা হয়েছে!` : `Added ${count} images!`, 'success');
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  // Delete image
  const handleDeleteImage = (index: number) => {
    if (variantImages.length <= 1) {
      showToast(lang === 'bn' ? 'কমপক্ষে ১টি ছবি থাকা আবশ্যক!' : 'At least 1 image is required!', 'error');
      return;
    }
    const updated = variantImages.filter((_, i) => i !== index);
    setVariantImages(updated);
    if (activeImageIndex >= updated.length) {
      setActiveImageIndex(updated.length - 1);
    }
  };

  // Toggle Audio Preview
  const handleToggleAudio = async () => {
    if (isMusicPlaying) {
      if (previewAudioCtxRef.current) {
        previewAudioCtxRef.current.close().catch(() => {});
        previewAudioCtxRef.current = null;
      }
      setIsMusicPlaying(false);
    } else {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        previewAudioCtxRef.current = ctx;
        scheduleBackgroundMusic(ctx, ctx.destination, 15, selectedMusicGenre, 0.6);
        setIsMusicPlaying(true);
        setTimeout(() => {
          setIsMusicPlaying(false);
        }, 15000);
      } catch (err) {
        console.error('Audio play error:', err);
      }
    }
  };

  // Video Generation Simulator
  const handleGenerateVideo = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerationProgress(0);
    setPreviewActive(true);

    const steps = [
      { p: 15, text: lang === 'bn' ? '১. হাই-ডেফিনিশন ইমেজ ফ্রেম প্রসেস করা হচ্ছে...' : '1. Processing high-definition image frames...' },
      { p: 35, text: lang === 'bn' ? '২. ডাইনামিক স্লাইড ট্রানজিশন এবং ফিল্টার যোগ হচ্ছে...' : '2. Adding dynamic slide transitions & filters...' },
      { p: 60, text: lang === 'bn' ? '৩. কমার্শিয়াল ব্যাকগ্রাউন্ড মিউজিক সিঙ্ক করা হচ্ছে...' : '3. Syncing commercial background audio...' },
      { p: 85, text: lang === 'bn' ? '৪. পেজ ব্র্যান্ডিং ও ওয়াটারমার্ক যুক্ত করা হচ্ছে...' : '4. Applying page branding & watermark...' },
      { p: 100, text: lang === 'bn' ? '৫. ফুল এইচডি ভিডিও এনকোডিং সম্পন্ন!' : '5. Full HD video encoding complete!' },
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        setGenerationProgress(steps[currentStep].p);
        setCurrentStepText(steps[currentStep].text);
        currentStep++;
      } else {
        clearInterval(interval);
        setIsGenerating(false);

        const newCampaign: RenderedVideoCampaign = {
          id: 'vid_' + Date.now(),
          title: productTitle || 'TawZoon Promo Video',
          durationLabel: '0:40',
          durationSeconds: 40,
          resolution: '1080x1920 (Full HD)',
          fps: 60,
          aspectRatio: aspectRatio,
          videoBlobUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          thumbnailUrl: variantImages[0] || 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
        };

        setRenderedCampaign(newCampaign);
        showToast(lang === 'bn' ? '🎉 ভিডিও জেনারেট সম্পন্ন হয়েছে!' : '🎉 Video generation complete!', 'success');
      }
    }, 700);
  };

  const discountPercent = regularPrice > sellingPrice ? Math.round(((regularPrice - sellingPrice) / regularPrice) * 100) : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-20">
      {/* Top Header / Sub-nav */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-emerald-600" />
          <h2 className="text-base font-bold text-gray-800">
            {lang === 'bn' ? 'ভিডিও জেনারেটর' : 'Video Generator'}
          </h2>
        </div>
        <button
          onClick={onOpenCatalog}
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          {lang === 'bn' ? 'ক্যাম্পেইন' : 'Campaign'}
        </button>
      </div>

      {/* Catalog Product Selection Bar */}
      <div className="bg-emerald-700 text-white rounded-xl p-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          <ShoppingBag className="w-4 h-4 shrink-0" />
          <span className="text-xs font-medium truncate">
            {selectedProduct
              ? `${lang === 'bn' ? 'ক্যাটালগ পণ্য:' : 'Catalog Product:'} ${(selectedProduct as any).title || (selectedProduct as any).nameBn || (selectedProduct as any).nameEn}`
              : lang === 'bn'
              ? 'ক্যাটালগ পণ্য: Premium Solid Cotton Katua'
              : 'Catalog Product: Premium Solid Cotton Katua'}
          </span>
        </div>
        <button
          onClick={() => setIsCatalogModalOpen(true)}
          className="shrink-0 bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-2.5 py-1 rounded-lg border border-white/20 transition-colors"
        >
          {lang === 'bn' ? 'ক্যাটালগ থেকে নির্বাচন →' : 'Select from Catalog →'}
        </button>
      </div>

      {/* Product Details & Design Editor Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            {lang === 'bn' ? 'ভিডিওর তথ্য ও ডিজাইন এডিটর' : 'Video Content & Design Editor'}
          </h3>
          <span className="text-[10px] text-gray-400 font-mono">1080x1920 Full HD</span>
        </div>

        {/* Color Variant Images */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            {lang === 'bn'
              ? `কালার ভ্যারিয়েন্ট ছবি সমূহ (${variantImages.length}টি):`
              : `Color Variant Images (${variantImages.length}):`}
          </label>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
            {variantImages.map((imgUrl, idx) => (
              <div
                key={idx}
                onClick={() => setActiveImageIndex(idx)}
                className={`relative group shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden cursor-pointer transition-all ${
                  activeImageIndex === idx ? 'border-emerald-600 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <img src={imgUrl} alt={`Variant ${idx}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteImage(idx);
                  }}
                  className="absolute top-0.5 right-0.5 bg-red-600 text-white p-0.5 rounded-full opacity-80 group-hover:opacity-100 hover:scale-110 transition-all"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            <label className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 flex flex-col items-center justify-center text-emerald-600 cursor-pointer transition-colors">
              <Plus className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-none mt-0.5">{lang === 'bn' ? 'ছবি যোগ' : 'Add Image'}</span>
              <input type="file" accept="image/*" multiple onChange={handleAddImage} className="hidden" />
            </label>
          </div>
        </div>

        {/* Headline / Product Name & Offer Banner */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {lang === 'bn' ? 'হেডলাইন / প্রোডাক্টের নাম:' : 'Headline / Product Name:'}
            </label>
            <input
              type="text"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              className="w-full text-xs font-medium bg-gray-50 border border-gray-200 rounded-lg p-2 focus:outline-hidden focus:border-emerald-500 focus:bg-white transition-all"
              placeholder={lang === 'bn' ? 'প্রোডাক্টের নাম লিখুন...' : 'Enter product title...'}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-gray-700">
                {lang === 'bn' ? 'স্পেশাল অফার ব্যানার টেক্সট:' : 'Special Offer Banner Text:'}
              </label>
              <label className="flex items-center gap-1 text-[11px] text-emerald-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOfferBanner}
                  onChange={(e) => setShowOfferBanner(e.target.checked)}
                  className="rounded-xs text-emerald-600 focus:ring-emerald-500"
                />
                <span>{lang === 'bn' ? 'ব্যানার দেখান' : 'Show Banner'}</span>
              </label>
            </div>
            <input
              type="text"
              disabled={!showOfferBanner}
              value={offerText}
              onChange={(e) => setOfferText(e.target.value)}
              className="w-full text-xs font-medium bg-gray-50 border border-gray-200 rounded-lg p-2 disabled:opacity-50 focus:outline-hidden focus:border-emerald-500 focus:bg-white transition-all text-red-600 font-bold"
              placeholder={lang === 'bn' ? 'যেমন: স্পেশাল অফার' : 'e.g. Special Offer'}
            />
          </div>
        </div>

        {/* Pricing Inputs */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {lang === 'bn' ? 'বিক্রয় মূল্য (PRICE):' : 'Selling Price:'}
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-bold">৳</span>
              <input
                type="number"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                className="w-full pl-6 pr-2 py-1.5 text-xs font-bold text-emerald-700 bg-gray-50 border border-gray-200 rounded-lg focus:outline-hidden focus:border-emerald-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {lang === 'bn' ? 'পূর্বের মূল্য (REGULAR):' : 'Regular Price:'}
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500">৳</span>
              <input
                type="number"
                value={regularPrice}
                onChange={(e) => setRegularPrice(Number(e.target.value))}
                className="w-full pl-6 pr-2 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-lg focus:outline-hidden focus:border-emerald-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              {lang === 'bn' ? 'ডিসকাউন্ট হার:' : 'Discount Rate:'}
            </label>
            <div className="relative">
              <input
                type="text"
                readOnly
                value={`${discountPercent}% ছাড়`}
                className="w-full px-2 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg text-center"
              />
            </div>
          </div>
        </div>

        {/* Page Branding & Logo */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-800">
              {lang === 'bn' ? 'পেজ ব্র্যান্ডিং ও লোগো লোগো (Page Branding & Logo):' : 'Page Branding & Logo:'}
            </label>
            <span className="text-[10px] text-gray-400">{lang === 'bn' ? 'ভিডিওর উপরে দেখাবে' : 'Appears on video'}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg border border-gray-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
                {customLogoUrl ? (
                  <img src={customLogoUrl} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-lg font-black text-emerald-800">T</span>
                )}
              </div>
              <label className="flex items-center gap-1 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors shrink-0">
                <Upload className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'লোগো আপলোড' : 'Upload Logo'}</span>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
            </div>

            <div>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={lang === 'bn' ? 'পেজ / ব্র্যান্ড নাম' : 'Brand Name'}
                className="w-full text-xs font-medium bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div>
              <input
                type="text"
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                placeholder={lang === 'bn' ? 'ট্যাগলাইন (Tagline)' : 'Tagline'}
                className="w-full text-xs font-medium bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-emerald-500 text-gray-500"
              />
            </div>
          </div>
        </div>

        {/* Commercial Music Selector */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <Music className="w-4 h-4 text-emerald-600" />
              {lang === 'bn' ? 'কমার্শিয়াল মিউজিক ও ট্রানজিশন সাউন্ড' : 'Commercial Music & Transition Audio'}
            </label>
            <button
              type="button"
              onClick={handleToggleAudio}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                isMusicPlaying
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Play className={`w-3 h-3 ${isMusicPlaying ? 'animate-spin' : ''}`} />
              {isMusicPlaying ? (lang === 'bn' ? 'চলছে...' : 'Playing...') : (lang === 'bn' ? 'মিউজিক চালু' : 'Play Music')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { id: 'trendy_pop', name: lang === 'bn' ? 'আপবিট পপ বিট' : 'Upbeat Pop Beat', sub: 'E-Commerce Trendy' },
              { id: 'chill_lounge', name: lang === 'bn' ? 'লাক্সারি ফ্যাশন ভাইব' : 'Luxury Fashion Vibe', sub: 'Modern Chill Lounge' },
              { id: 'viral_tiktok', name: lang === 'bn' ? 'ভাইরাল টিকটক ট্র্যাপ' : 'Viral TikTok Trap', sub: 'Punchy TikTok Beat' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedMusicGenre(m.id as MusicGenre)}
                className={`p-2 rounded-xl text-left border text-xs transition-all ${
                  selectedMusicGenre === m.id
                    ? 'border-emerald-600 bg-emerald-50/70 text-emerald-900 font-bold ring-1 ring-emerald-500'
                    : 'border-gray-200 bg-gray-50 hover:bg-white text-gray-700'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-600 font-bold">✨</span>
                  <span className="truncate">{m.name}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 font-normal">{m.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Video Studio Preview Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-gray-800">
              {lang === 'bn' ? 'ভিডিও প্রিভিউ' : 'Video Preview'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${
                  aspectRatio === '9:16' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-500'
                }`}
              >
                9:16 (Reels)
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio('4:5')}
                className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${
                  aspectRatio === '4:5' ? 'bg-white text-emerald-700 shadow-xs' : 'text-gray-500'
                }`}
              >
                4:5 (FB Feed)
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Frame Viewport / Player */}
        <div className="relative mx-auto max-w-xs bg-slate-900 rounded-2xl overflow-hidden border-4 border-slate-800 shadow-lg aspect-9/16 flex flex-col justify-between">
          {/* Top Overlay: Brand Header */}
          <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent z-10 flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-emerald-800 font-bold text-xs overflow-hidden border border-white/50">
                {customLogoUrl ? (
                  <img src={customLogoUrl} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  brandName.charAt(0)
                )}
              </div>
              <div>
                <p className="text-xs font-bold leading-none text-white drop-shadow-sm">{brandName}</p>
                <p className="text-[9px] text-gray-300 leading-none mt-0.5">{brandTagline}</p>
              </div>
            </div>
            {showOfferBanner && (
              <span className="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider shadow-md animate-pulse">
                {offerText}
              </span>
            )}
          </div>

          {/* Active Product Image Slide */}
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <img
              src={variantImages[activeImageIndex] || variantImages[0]}
              alt="Active Frame"
              className="w-full h-full object-cover transition-all duration-500"
            />
            {/* Play Button Overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <button
                type="button"
                onClick={handleGenerateVideo}
                className="w-14 h-14 rounded-full bg-white/90 hover:bg-white text-emerald-700 flex items-center justify-center shadow-2xl hover:scale-105 transition-all"
              >
                <Play className="w-7 h-7 fill-emerald-700 ml-1" />
              </button>
            </div>
          </div>

          {/* Bottom Overlay: Pricing & Title */}
          <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent z-10 text-white space-y-2">
            <div>
              <p className="text-xs font-bold text-white line-clamp-1 drop-shadow-xs">{productTitle}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-extrabold text-red-500">৳{sellingPrice}</span>
                {regularPrice > sellingPrice && (
                  <span className="text-xs text-gray-400 line-through">৳{regularPrice}</span>
                )}
                {discountPercent > 0 && (
                  <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-xs">
                    {discountPercent}% ছাড়
                  </span>
                )}
              </div>
            </div>

            {/* Thumbnail Variant Selector Strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {variantImages.map((img, i) => (
                <img
                  key={i}
                  src={img}
                  alt="Thumb"
                  onClick={() => setActiveImageIndex(i)}
                  className={`w-8 h-8 rounded-md object-cover cursor-pointer border ${
                    activeImageIndex === i ? 'border-emerald-500 ring-2 ring-emerald-400' : 'border-white/30 opacity-70'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Rendering Progress Overlay */}
          {isGenerating && (
            <div className="absolute inset-0 bg-slate-950/90 z-30 flex flex-col items-center justify-center p-4 text-center text-white space-y-3">
              <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin flex items-center justify-center">
                <Clapperboard className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-emerald-400">{generationProgress}% সম্পন্ন</p>
                <p className="text-[11px] text-gray-300 max-w-xs">{currentStepText}</p>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-300"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons: Preview & Generate Video */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={handleGenerateVideo}
            disabled={isGenerating}
            className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs py-2.5 rounded-xl border border-emerald-200 transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>{lang === 'bn' ? 'প্রিভিউ দেখুন' : 'Preview Video'}</span>
          </button>

          <button
            type="button"
            onClick={handleGenerateVideo}
            disabled={isGenerating}
            className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs py-2.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Film className="w-4 h-4" />
            <span>{lang === 'bn' ? 'ভিডিও জেনারেট করুন' : 'Generate Video'}</span>
          </button>
        </div>

        {/* Rendered Video Result & Download Option */}
        {renderedCampaign && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-900">
                  {lang === 'bn' ? 'ভিডিও জেনারেট সফল হয়েছে!' : 'Video ready for download!'}
                </span>
              </div>
              <span className="text-[10px] bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                1080p Full HD
              </span>
            </div>
            <a
              href={renderedCampaign.videoBlobUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'ডাউনলোড ভিডিও (MP4)' : 'Download Video (MP4)'}</span>
            </a>
          </div>
        )}
      </div>

      {/* Product Catalog Modal */}
      {isCatalogModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-emerald-600" />
                {lang === 'bn' ? 'ক্যাটালগ থেকে পণ্য নির্বাচন করুন' : 'Select Product from Catalog'}
              </h3>
              <button
                onClick={() => setIsCatalogModalOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1 scrollbar-thin">
              {productsList.length > 0 ? (
                productsList.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => {
                      const prodAny = prod as any;
                      const title = prodAny.title || prodAny.nameBn || prodAny.nameEn || '';
                      setSelectedProduct(prod);
                      setProductTitle(title);
                      setSellingPrice(prodAny.sellingPrice || prodAny.resellerPrice || prodAny.wholesalePrice || prodAny.price || 0);
                      setRegularPrice(prodAny.regularPrice || Math.round(((prodAny.sellingPrice || prodAny.price || 700) * 1.15)));
                      if (prod.images && prod.images.length > 0) {
                        const urls = prod.images.map((img: any) => typeof img === 'string' ? img : img.url).filter(Boolean);
                        if (urls.length > 0) {
                          setVariantImages(urls);
                          setActiveImageIndex(0);
                        }
                      }
                      setIsCatalogModalOpen(false);
                      showToast(lang === 'bn' ? `"${title}" ভিডিও এডিটরে যুক্ত হয়েছে!` : `Selected ${title}!`, 'success');
                    }}
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/50 cursor-pointer transition-all"
                  >
                    <img
                      src={typeof (prod as any).images?.[0] === 'string' ? (prod as any).images[0] : ((prod as any).images?.[0]?.url || (prod as any).imageUrl || 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80')}
                      alt={(prod as any).title || (prod as any).nameBn || (prod as any).nameEn || ''}
                      className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-gray-800 truncate">{(prod as any).title || (prod as any).nameBn || (prod as any).nameEn}</h4>
                      <p className="text-[11px] text-emerald-700 font-semibold">
                        ৳{(prod as any).sellingPrice || (prod as any).resellerPrice || (prod as any).wholesalePrice || (prod as any).price}
                      </p>
                    </div>
                    <button className="text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg hover:bg-emerald-200 transition-colors">
                      {lang === 'bn' ? 'সিলেক্ট' : 'Select'}
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-xs text-gray-400">
                  {lang === 'bn' ? 'কোনো ক্যাটালগ পণ্য পাওয়া যায়নি' : 'No products found'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
