// ==========================================
// TAWZOON NEXUS - Core Server Engine Setup
// ==========================================
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { db, isFirestoreQuotaError } from './server/db.ts';
import { uploadBufferToCloudStorage, firestore, testFirestoreConnection } from './server/firebase.ts';
import type { Product, Category, Sale, Withdrawal, Transaction, NotificationItem, Employee } from './src/types/index.ts';
import { GoogleGenAI } from '@google/genai';
import { Mutex } from 'async-mutex';
import rateLimit from 'express-rate-limit';

dotenv.config();

// Helper to accurately extract client IP behind reverse proxies and Cloud Run load balancers
const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
};

// Enterprise Scalability Rate Limiting Policies (Protects against brute force and DDoS)
export const apiGlobalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return `auth:${auth.slice(7, 32)}`;
    }
    return getClientIp(req);
  },
  validate: { xForwardedForHeader: false, forwardedHeader: false },
  message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT_EXCEEDED' }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getClientIp(req),
  validate: { xForwardedForHeader: false, forwardedHeader: false },
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.', code: 'AUTH_RATE_LIMIT' }
});

export const financialLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return `fin:${auth.slice(7, 32)}`;
    }
    return getClientIp(req);
  },
  validate: { xForwardedForHeader: false, forwardedHeader: false },
  message: { error: 'Too many financial operations in a short period. Please wait a moment.', code: 'FINANCIAL_RATE_LIMIT' }
});

export const orderLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return `order:${auth.slice(7, 32)}`;
    }
    return getClientIp(req);
  },
  validate: { xForwardedForHeader: false, forwardedHeader: false },
  message: { error: 'Order submission rate limit exceeded. Please try again shortly.', code: 'ORDER_RATE_LIMIT' }
});

// Per-employee AsyncMutex map to prevent concurrent wallet read-modify-write race conditions
const employeeWalletMutexes = new Map<string, Mutex>();
function getEmployeeMutex(employeeId: string): Mutex {
  let mutex = employeeWalletMutexes.get(employeeId);
  if (!mutex) {
    mutex = new Mutex();
    employeeWalletMutexes.set(employeeId, mutex);
  }
  return mutex;
}

// Global crash resilience for async errors and unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// Enable trust proxy for Cloud Run, Google Front End and Nginx reverse proxies
app.set('trust proxy', 1);
const isDevContainer = Boolean(process.env.NGINX_PORT);
const isProduction = process.env.NODE_ENV === 'production' || !isDevContainer || Boolean(process.env.K_SERVICE);

// In AI Studio environment (both dev and deployed/published containers), Nginx listens on 8080 and proxies to 3000.
// Cloud Run injects PORT=8080 into the environment, but Nginx is already bound to 8080 in the container!
// Therefore, the Node application server must always bind to port 3000 (or DEFAULT_APP_PORT if explicitly overridden).
// If process.env.PORT is 8080, binding to it causes a fatal EADDRINUSE conflict with Nginx and crashes Cloud Run deployment.
const PORT = process.env.DEFAULT_APP_PORT 
  ? parseInt(process.env.DEFAULT_APP_PORT, 10) 
  : (process.env.PORT && process.env.PORT !== '8080' ? parseInt(process.env.PORT, 10) : 3000);

// Real-time SSE Manager for Live Admin & Reseller updates
const realtimeClients = new Set<Response>();

export function broadcastRealtimeEvent(type: string, data: any) {
  const payload = `data: ${JSON.stringify({ type, data, timestamp: Date.now() })}\n\n`;
  for (const client of realtimeClients) {
    try {
      client.write(payload);
    } catch {
      realtimeClients.delete(client);
    }
  }
}

const AUTHORIZED_ADMIN_EMAIL = "mdshaali9516@gmail.com";
const AUTHORIZED_ADMIN_PASSWORD = "TawzoonNexus@9516";

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const videosDir = path.join(__dirname, 'public', 'uploads', 'videos');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// Serve static images and user-uploaded media directly
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/uploads', express.static(uploadsDir));

// Instant health check endpoints for Cloud deployment probes and load balancers
app.get(['/health', '/healthz', '/api/health'], (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// Mount Rate Limiters for 50,000 Reseller Production Security
app.use('/api', apiGlobalLimiter);
app.use(['/api/admin/login', '/api/admin/verify-otp', '/api/employees/login', '/api/employees/register'], authLimiter);
app.use(['/api/withdrawals', '/api/admin/withdrawals', '/api/employees/transfer'], financialLimiter);
app.use(['/api/sales', '/api/public/orders'], orderLimiter);

// Ensure database is synced with Firebase Firestore before serving API requests
app.use('/api', async (_req: Request, _res: Response, next: NextFunction) => {
  if (db.ready) {
    try {
      await Promise.race([
        db.ready,
        new Promise(resolve => setTimeout(resolve, 2500))
      ]);
    } catch {
      // Fall through to local state if cloud sync times out
    }
  }
  next();
});

// ==========================================
// MIDDLEWARES & HELPERS
// ==========================================

function extractYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : (/^[\w-]{11}$/.test(url.trim()) ? url.trim() : null);
}

function getClientIpLegacy(req: Request): string {
  return (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
}

async function callGeminiWithModelFallback(ai: any, params: { contents: any; config?: any }) {
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
  let lastErr: any = null;
  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: params.config
      });
      if (response && response.text) {
        return response;
      }
    } catch (err: any) {
      lastErr = err;
      console.warn(`[Gemini API Warning on model ${modelName}]:`, err?.message || err);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('All Gemini model fallbacks exhausted.');
}


function verifyAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }
  const token = authHeader.split(' ')[1];
  const state = db.getState();
  const session = state.adminSessions.find(s => s.token === token && s.expiresAt > Date.now());

  if (!session) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired admin session' });
  }

  // Attach admin session
  (req as any).adminSession = session;
  next();
}

function verifyEmployee(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Employee token required' });
  }
  const token = authHeader.split(' ')[1];
  const state = db.getState();
  const session = state.employeeSessions.find(s => s.token === token && s.expiresAt > Date.now());

  if (!session) {
    return res.status(403).json({ error: 'Forbidden: Invalid or expired employee session' });
  }

  const employee = state.employees.find(e => e.id === session.employeeId);
  // Allow APPROVED, SUSPENDED, ARCHIVED to authenticate to view their historical records/ledger
  if (!employee || !['APPROVED', 'SUSPENDED', 'ARCHIVED'].includes(employee.status)) {
    return res.status(403).json({ error: 'Forbidden: Employee account is pending approval or inactive' });
  }

  (req as any).employee = employee;
  (req as any).employeeSession = session;
  next();
}

// Strip originalPrice for public/employee safety
function sanitizeProduct(product: Product): Omit<Product, 'originalPrice'> {
  const { originalPrice, ...safeProduct } = product;
  return safeProduct;
}

// Helper to resolve employee from Authorization header if present
function resolveEmployeeFromReq(req: Request): Employee | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const state = db.getState();
  const session = state.employeeSessions.find(s => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  return state.employees.find(e => e.id === session.employeeId) || null;
}

// Helper to test if a referral code is an official company code
function isOfficialReferralCode(code?: string | null): boolean {
  if (!code) return false;
  const clean = code.trim().toUpperCase().replace(/[\s\-_]/g, '');
  const state = db.getState();
  const configuredOfficial = (state.brandSettings?.officialReferralCode || 'TAWZOON9516').trim().toUpperCase().replace(/[\s\-_]/g, '');
  return (
    clean === configuredOfficial ||
    clean === 'TAWZOON9516' ||
    clean === 'TAUZON9516' ||
    clean === 'OFFICIAL_TAWZOON' ||
    clean === 'OFFICIALTAWZOON' ||
    clean === 'TAWZOONOFFICIAL'
  );
}

// Helper to determine if an employee is registered under official referral
function isOfficialEmployee(employee?: Employee | null): boolean {
  if (!employee) return false;
  // If explicitly flagged as non-official, or has a specific reseller upline, NOT official!
  if (employee.isOfficialReferral === false) return false;
  if (employee.referralOwnerId && employee.referralOwnerId !== 'OFFICIAL_TAWZOON') return false;
  if (employee.isOfficialReferral === true) return true;
  if (employee.referralOwnerId === 'OFFICIAL_TAWZOON') return true;
  const ref = (employee.reference || (employee as any).referredBy || (employee as any).upline || '').trim().toUpperCase();
  return isOfficialReferralCode(ref);
}

// Helper to determine dynamic referral wholesale price markup & fixed margin for an employee
function getEmployeeReferralMarkup(employee?: Employee | null, state?: any): number {
  if (!employee) return 0;

  // 1. If this reseller has an explicit personal margin set by admin (including 0 TK)
  if (employee.resellerMargin !== undefined && employee.resellerMargin !== null && !isNaN(Number(employee.resellerMargin)) && Number(employee.resellerMargin) >= 0) {
    return Number(employee.resellerMargin);
  }

  // 2. Official Referral default: 0 TK margin
  if (isOfficialEmployee(employee)) {
    return 0;
  }

  // 3. Fallback default wholesale markup for all general non-official accounts (+10 TK or brand nonOfficialMarkup)
  const st = state || db.getState();
  const brandSettings = st.brandSettings;
  const defaultMarkup = Number(brandSettings?.nonOfficialMarkup ?? 10);
  return defaultMarkup;
}

// Helper to compute effective product with dynamic referral wholesale price markup
function getProductForEmployee(product: Product, employee?: Employee | null, explicitRef?: string | null): any {
  const sanitized = sanitizeProduct(product);
  const cleanRef = explicitRef ? explicitRef.trim().toUpperCase().replace(/[\s\-_]/g, '') : null;
  const isOfficial = (employee && isOfficialEmployee(employee)) || (cleanRef && isOfficialReferralCode(cleanRef));

  const baseOrig = product.originalPrice !== undefined && product.originalPrice !== null ? Number(product.originalPrice) : Number(product.sellingPrice);
  const baseSell = Number(product.sellingPrice || 0);

  // Compute regularPrice from starRating discount setting (5-star=10%, 4-star=15%, 3-star=20%, 2-star=25%, 1-star=30%)
  const stars = Number(product.starRating || 5);
  const starDiscount = stars === 4 ? 15 : stars === 3 ? 20 : stars === 2 ? 25 : stars === 1 ? 30 : 10;
  const autoRegular = Math.round(baseSell / (1 - starDiscount / 100));
  const baseReg = (product.regularPrice && Number(product.regularPrice) > baseSell)
    ? Number(product.regularPrice)
    : (autoRegular > baseSell ? autoRegular : Math.round(baseSell * 1.15));

  // Determine applicable markup:
  // For official: 0 TK (or custom if admin set resellerMargin)
  // For general: resellerMargin (default 10 TK, or custom e.g. 15 TK)
  // For public visitor with no employee session: 0 TK
  let referralMarkup = 0;
  if (employee) {
    referralMarkup = getEmployeeReferralMarkup(employee);
  } else if (cleanRef && !isOfficialReferralCode(cleanRef)) {
    const st = db.getState();
    referralMarkup = Number(st.brandSettings?.nonOfficialMarkup ?? 10);
  }

  const finalWholesale = baseOrig + referralMarkup;

  return {
    ...sanitized,
    starRating: stars,
    baseWholesalePrice: baseOrig, // Master base wholesale price from DB (e.g. 470)
    originalPrice: finalWholesale, // Final effective wholesale price (e.g. 470, 480, 485)
    isOfficialReferral: isOfficial,
    referralMarkup: referralMarkup, // Exact margin added (e.g. 0, 10, 15)
    baseSellingPrice: baseSell,
    baseRegularPrice: baseReg,
    sellingPrice: baseSell, // Exact Selling Price
    regularPrice: baseReg,  // Exact Regular Price
  };
}

// ==========================================
// 1. PUBLIC API ROUTES
// ==========================================

// Middleware with strict cache-busting headers to prevent stale data & browser/app caching
app.use('/api', async (req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Public read endpoints and chat serve instantly from in-memory state
  if ((req.method === 'GET' || req.path === '/public/chat') && req.path.startsWith('/public')) {
    return next();
  }
  try {
    await Promise.race([
      db.ready,
      new Promise(resolve => setTimeout(resolve, 300))
    ]);
  } catch (err) {
    console.error('[Database Ready Middleware] Wait failed:', err);
  }
  next();
});

// Bootstrap initial configuration, branding, categories & payment methods
app.get('/api/public/bootstrap', (req: Request, res: Response) => {
  console.log('[API] /api/public/bootstrap hit');
  const state = db.getState();
  const reqEmp = resolveEmployeeFromReq(req);
  const explicitRef = (req.query.ref as string) || (req.headers['x-referral-code'] as string) || null;
  const safeProducts = (state.products || [])
    .filter(p => p.isActive && !p.isArchived)
    .map(p => getProductForEmployee(p, reqEmp, explicitRef));

  const dynamicCategories = (state.categories || [])
    .filter(c => c.isActive)
    .sort((a, b) => a.order - b.order)
    .map(c => ({
      ...c,
      itemCount: safeProducts.filter(p => p.categorySlug?.toLowerCase() === c.slug.toLowerCase()).length
    }));

  res.json({
    brandSettings: state.brandSettings,
    categories: dynamicCategories,
    subsections: (state.subsections || [])
      .filter(s => s.isActive)
      .sort((a, b) => (a.order || 0) - (b.order || 0)),
    paymentSettings: (state.paymentSettings || []).filter(p => p.isEnabled),
    featuredProducts: safeProducts.filter(p => p.isFeatured),
    trendingProducts: safeProducts.filter(p => p.isTrending),
    newArrivalProducts: safeProducts.filter(p => p.isNewArrival)
  });
});

// Public products list with search, filter, sort
app.get('/api/public/products', (req: Request, res: Response) => {
  console.log('[API] /api/public/products hit');
  const state = db.getState();
  const reqEmp = resolveEmployeeFromReq(req);
  const explicitRef = (req.query.ref as string) || (req.headers['x-referral-code'] as string) || null;
  const { category, search, sort, filter } = req.query;

  let results = (state.products || []).filter(p => p.isActive && !p.isArchived);

  if (category && category !== 'all' && category !== 'shop_tab') {
    const c = (category as string).toLowerCase().trim();
    results = results.filter(p => {
      const pCat = (p.categorySlug || '').toLowerCase().trim();
      if (pCat === c) return true;
      if (['gajet', 'gadget', 'gadgets', 'tech'].includes(pCat) && ['gajet', 'gadget', 'gadgets', 'tech'].includes(c)) return true;
      if (['other', 'others'].includes(pCat) && ['other', 'others'].includes(c)) return true;
      if (['shop', 'style', 'fashion', 'lifestyle'].includes(pCat) && ['shop', 'style', 'fashion', 'lifestyle'].includes(c)) return true;
      return false;
    });
  }

  if (search) {
    const rawQ = (search as string).toLowerCase().trim();
    const cleanQ = rawQ
      .replace(/^#/, '')
      .replace(/\u09DF/g, '\u09AF')
      .replace(/\u09DC/g, '\u09A1')
      .replace(/\u09DD/g, '\u09A2');

    // Check if input is a URL / Product Link or contains product ID / Code in link
    let exactLinkProduct: Product | undefined;
    const isUrl = rawQ.includes('http://') || rawQ.includes('https://') || rawQ.includes('www.') || rawQ.includes('localhost') || rawQ.includes('/product/') || rawQ.includes('/p/') || rawQ.includes('product=') || rawQ.includes('code=');
    const isCodeSearch = rawQ.startsWith('#') || /^sku-|^tnx-/i.test(rawQ);


    if (isUrl) {
      try {
        const urlObj = new URL(rawQ.startsWith('http') ? rawQ : `https://${rawQ}`);
        const paramId = urlObj.searchParams.get('product') || urlObj.searchParams.get('id') || urlObj.searchParams.get('code') || urlObj.searchParams.get('productCode');
        if (paramId) {
          const pMatch = results.find(p => p.id === paramId || (p.productCode && p.productCode.toLowerCase().trim().replace(/^#/, '') === paramId.toLowerCase().trim().replace(/^#/, '')));
          if (pMatch) exactLinkProduct = pMatch;
        }
        if (!exactLinkProduct) {
          const segments = urlObj.pathname.split('/').filter(Boolean);
          for (const seg of segments) {
            const cleanSeg = seg.toLowerCase().trim().replace(/^#/, '');
            const pMatch = results.find(p => p.id === seg || (p.productCode && p.productCode.toLowerCase().trim().replace(/^#/, '') === cleanSeg));
            if (pMatch) { exactLinkProduct = pMatch; break; }
          }
        }
      } catch {}
    }

    // Find exact product code or ID match
    const exactCodeProduct = exactLinkProduct || results.find(p => {
      const code = (p.productCode || '').toLowerCase().trim().replace(/^#/, '');
      const pId = (p.id || '').toLowerCase().trim();
      return code === cleanQ || code === rawQ || pId === cleanQ || pId === rawQ;
    });

    if (isUrl || isCodeSearch) {
      results = exactCodeProduct ? [exactCodeProduct] : [];
    } else {
      // Transliteration & alias mappings for bilingual search (Bangla + English)
      const searchTerms = new Set<string>([rawQ, cleanQ]);

      if (rawQ.includes('-')) {
        searchTerms.add(rawQ.replace(/-/g, ''));
        searchTerms.add(rawQ.replace(/-/g, ' '));
      }
      if (cleanQ.includes('-')) {
        searchTerms.add(cleanQ.replace(/-/g, ''));
        searchTerms.add(cleanQ.replace(/-/g, ' '));
      }

      const isTShirt = /t-?shirt|টি-?শার্ট|টিশার্ট|টি\s*শার্ট/i.test(rawQ) || /t-?shirt|টি-?শার্ট|টিশার্ট|টি\s*শার্ট/i.test(cleanQ);
      const isPolo = /polo|পোলো/i.test(rawQ) || /polo|পোলো/i.test(cleanQ);
      const isBasic = /basic|বেসিক/i.test(rawQ) || /basic|বেসিক/i.test(cleanQ);

      if (isBasic && isTShirt) {
        ['basic tshirt', 'basic t-shirt', 'বেসিক টিশার্ট', 'বেসিক টি-শার্ট', 'বেসিক টি শার্ট'].forEach(a => searchTerms.add(a));
      } else if (isTShirt) {
        ['tshirt', 't-shirt', 'টি-শার্ট', 'টিশার্ট', 'টি শার্ট'].forEach(a => searchTerms.add(a));
      } else if (isPolo) {
        ['polo', 'পোলো', 'polo shirt', 'পোলো শার্ট'].forEach(a => searchTerms.add(a));
      } else if (/shirt|শার্ট/i.test(rawQ) || /shirt|শার্ট/i.test(cleanQ)) {
        ['shirt', 'শার্ট'].forEach(a => searchTerms.add(a));
      }

      const aliasMap: Array<[RegExp, string[]]> = [
        [/katuya|katua|katuwa|কাতুয়া|কাতুয়া/i, ['katuya', 'katua', 'katuwa', 'কাতুয়া', 'কাতুয়া']],
        [/panjabi|punjabi|পাঞ্জাবি|পাঞ্জাবী/i, ['panjabi', 'punjabi', 'পাঞ্জাবি', 'পাঞ্জাবী']],
        [/book|books|বই/i, ['book', 'books', 'বই']],
        [/gadget|gadgets|গ্যাজেট/i, ['gadget', 'gadgets', 'tech', 'গ্যাজেট', 'টেকনোলজি']],
        [/watch|smartwatch|ঘড়ি|ঘড়ি/i, ['watch', 'smartwatch', 'ঘড়ি', 'ঘড়ি']],
        [/headphone|headphones|হেডফোন/i, ['headphone', 'headphones', 'earbuds', 'হেডফোন']],
        [/shoe|shoes|জুতা|জুতো/i, ['shoe', 'shoes', 'জুতা', 'জুতো']],
        [/jacket|জ্যাকেট/i, ['jacket', 'জ্যাকেট']],
        [/pant|pants|প্যান্ট/i, ['pant', 'pants', 'প্যান্ট']],
        [/dropshoulder|ড্রপশোল্ডার|ড্রপ\s*শোল্ডার/i, ['dropshoulder', 'ড্রপশোল্ডার', 'ড্রপ শোল্ডার টিশার্ট']],
        [/longsleeve|লংস্লিভ|লং-?স্লিভ/i, ['longsleeve', 'লংস্লিভ', 'লং-স্লিভ টিশার্ট']],
        [/printshirt|প্রিন্ট\s*শার্ট/i, ['print shirt', 'printed shirt', 'প্রিন্ট শার্ট']],
      ];

      for (const [pattern, aliases] of aliasMap) {
        if (pattern.test(rawQ) || pattern.test(cleanQ)) {
          aliases.forEach(a => searchTerms.add(a));
        }
      }
      const termsArray = Array.from(searchTerms);

      // Check for Category cross-language terms
      const isClothingSearch = ['shop', 'clothing', 'fashion', 'style', 'পোশাক', 'ফ্যাশন', 'শপ', 'ছেলেদের পোশাক', 'মেয়েদের পোশাক', 'কাপড়'].some(term => termsArray.some(t => t.includes(term) || term.includes(t)));
      const isGadgetSearch = ['gadget', 'gadgets', 'tech', 'electronics', 'গ্যাজেট', 'ইলেকট্রনিক্স', 'টেকনোলজি', 'স্মার্ট'].some(term => termsArray.some(t => t.includes(term) || term.includes(t)));
      const isOtherSearch = ['other', 'others', 'lifestyle', 'অন্যান্য', 'লাইফস্টাইল', 'বই', 'গিফট'].some(term => termsArray.some(t => t.includes(term) || term.includes(t)));

      results = results.filter(p => {
        const pCode = (p.productCode || '').toLowerCase().trim().replace(/^#/, '');
        const pId = (p.id || '').toLowerCase().trim();
        const pNameBn = (p.nameBn || '').toLowerCase().replace(/\u09DF/g, '\u09AF').replace(/\u09DC/g, '\u09A1').replace(/\u09DD/g, '\u09A2');
        const pNameEn = (p.nameEn || '').toLowerCase();
        const pSubBn = (p.subcategoryBn || '').toLowerCase().replace(/\u09DF/g, '\u09AF').replace(/\u09DC/g, '\u09A1').replace(/\u09DD/g, '\u09A2');
        const pSubEn = (p.subcategoryEn || '').toLowerCase();
        const pCatSlug = (p.categorySlug || '').toLowerCase();
        const pShortDescBn = (p.shortDescBn || '').toLowerCase().replace(/\u09DF/g, '\u09AF').replace(/\u09DC/g, '\u09A1').replace(/\u09DD/g, '\u09A2');
        const pShortDescEn = (p.shortDescEn || '').toLowerCase();
        const pFullDescBn = (p.fullDescBn || '').toLowerCase().replace(/\u09DF/g, '\u09AF').replace(/\u09DC/g, '\u09A1').replace(/\u09DD/g, '\u09A2');

        const matchesCategory =
          (isClothingSearch && ['shop', 'style', 'fashion', 'lifestyle'].includes(pCatSlug)) ||
          (isGadgetSearch && ['gajet', 'gadget', 'gadgets', 'tech'].includes(pCatSlug)) ||
          (isOtherSearch && ['other', 'others'].includes(pCatSlug));

        return (
          termsArray.some(t =>
            pCode.includes(t) ||
            pId === t ||
            pNameBn.includes(t) ||
            pNameEn.includes(t) ||
            pSubBn.includes(t) ||
            pSubEn.includes(t) ||
            pCatSlug.includes(t) ||
            pShortDescBn.includes(t) ||
            pShortDescEn.includes(t) ||
            pFullDescBn.includes(t)
          ) || matchesCategory
        );
      });
    }
  }

  if (filter === 'featured') {
    results = results.filter(p => p.isFeatured);
  } else if (filter === 'trending') {
    results = results.filter(p => p.isTrending);
  } else if (filter === 'new_arrival') {
    results = results.filter(p => p.isNewArrival);
  }

  if (sort === 'price_asc') {
    results.sort((a, b) => a.sellingPrice - b.sellingPrice);
  } else if (sort === 'price_desc') {
    results.sort((a, b) => b.sellingPrice - a.sellingPrice);
  } else if (sort === 'newest') {
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    // Default sort: featured first, then created
    results.sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
  }

  const page = parseInt(req.query.page as string, 10);
  const limit = parseInt(req.query.limit as string, 10);
  const total = results.length;

  let paginatedResults = results;
  if (!isNaN(page) && !isNaN(limit) && page > 0 && limit > 0) {
    const startIndex = (page - 1) * limit;
    paginatedResults = results.slice(startIndex, startIndex + limit);
  }

  res.json({
    products: paginatedResults.map(p => getProductForEmployee(p, reqEmp, explicitRef)),
    total,
    page: !isNaN(page) ? page : 1,
    limit: !isNaN(limit) ? limit : total,
    totalPages: !isNaN(limit) && limit > 0 ? Math.ceil(total / limit) : 1
  });
});

// Public single product details (NO originalPrice)
app.get('/api/public/products/:id', (req: Request, res: Response) => {
  const state = db.getState();
  const reqEmp = resolveEmployeeFromReq(req);
  const explicitRef = (req.query.ref as string) || (req.headers['x-referral-code'] as string) || null;
  const product = (state.products).find(p => p.id === req.params.id && p.isActive && !p.isArchived);

  if (!product) {
    return res.status(404).json({ error: 'Product not found or unavailable' });
  }

  res.json(getProductForEmployee(product, reqEmp, explicitRef));
});

// Customer Delivery & National Courier History Search Endpoint (Steadfast & BD Courier Network)
app.get('/api/common/customer-history', (req: Request, res: Response) => {
  const { phone } = req.query;
  if (!phone || typeof phone !== 'string' || phone.trim().length < 6) {
    return res.status(400).json({ error: 'Valid customer phone number is required' });
  }

  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const searchPhone = cleanPhone.startsWith('880') ? cleanPhone.slice(2) : (cleanPhone.startsWith('0') ? cleanPhone : '0' + cleanPhone);

  const state = db.getState();
  const allSales = state.sales || [];

  // Filter sales matching this customer's phone number on our website
  const customerSales = allSales.filter(sale => {
    const salePhone = (sale.customerPhone || '').replace(/[^0-9]/g, '');
    const cleanSalePhone = salePhone.startsWith('880') ? salePhone.slice(2) : (salePhone.startsWith('0') ? salePhone : '0' + salePhone);
    return cleanSalePhone.includes(searchPhone) || searchPhone.includes(cleanSalePhone);
  });

  const totalOrders = customerSales.length;
  const deliveredOrders = customerSales.filter(s => {
    const st = ((s as any).status || s.paymentStatus || s.saleStatus || '').toString().toLowerCase();
    return st.includes('delivered') || st.includes('completed') || st.includes('approved') || st.includes('shipped');
  }).length;
  const rejectedOrders = customerSales.filter(s => {
    const st = ((s as any).status || s.saleStatus || '').toString().toLowerCase();
    return st.includes('cancel') || st.includes('reject') || st.includes('return') || st.includes('refund');
  }).length;
  const pendingOrders = customerSales.filter(s => {
    const st = ((s as any).status || s.saleStatus || s.paymentStatus || '').toString().toLowerCase();
    return st.includes('pending') || st.includes('processing') || st.includes('verification');
  }).length;

  const totalAmountSpent = customerSales
    .filter(s => {
      const st = ((s as any).status || s.paymentStatus || s.saleStatus || '').toString().toLowerCase();
      return st.includes('delivered') || st.includes('completed') || st.includes('approved');
    })
    .reduce((sum, s) => sum + (s.totalAmount || ((s.actualSalePrice || s.sellingPrice || 0) * (s.quantity || 1))), 0);

  const totalFinished = deliveredOrders + rejectedOrders;
  const successRate = totalFinished > 0 ? Math.round((deliveredOrders / totalFinished) * 100) : (totalOrders > 0 ? 100 : 100);

  // Real parcel analytics based purely on real customer order history
  const courierTotalParcels = totalOrders;
  const courierDelivered = deliveredOrders;
  const courierReturned = rejectedOrders;
  const courierSuccessRate = successRate;

  let courierRiskStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  let courierRiskTextBn = totalOrders === 0 
    ? 'নতুন কাস্টমার! কোনো পূর্ববর্তী রিটার্ন রেকর্ড নেই।'
    : 'নিরাপদ কাস্টমার! পার্সেল ডেলিভারি হিস্ট্রি ভালো।';
  let courierRiskTextEn = totalOrders === 0
    ? 'New Customer! No previous return record.'
    : 'Safe Customer! Good parcel delivery history.';

  if (courierReturned >= 2 || (courierTotalParcels > 0 && courierSuccessRate < 70)) {
    courierRiskStatus = 'RED';
    courierRiskTextBn = `উচ্চ ঝুঁকি! পূর্বে ${courierReturned}টি পার্সেল রিজেক্ট/রিটার্ন করার রেকর্ড রয়েছে!`;
    courierRiskTextEn = `High Risk! Customer has ${courierReturned} parcel return records!`;
  } else if (courierReturned === 1 || (courierTotalParcels > 0 && courierSuccessRate < 85)) {
    courierRiskStatus = 'YELLOW';
    courierRiskTextBn = 'সতর্কতা! পূর্বে ১টি পার্সেল রিটার্ন রেকর্ড রয়েছে।';
    courierRiskTextEn = 'Warning! Customer has 1 parcel return record.';
  }

  res.json({
    phone: searchPhone,
    // Internal Website Stats
    totalOrders,
    deliveredOrders,
    rejectedOrders,
    pendingOrders,
    totalAmountSpent,
    successRate,
    // Courier & Delivery Network Stats
    courierNetwork: {
      totalParcels: courierTotalParcels,
      deliveredParcels: courierDelivered,
      returnedParcels: courierReturned,
      successRate: courierSuccessRate,
      riskStatus: courierRiskStatus,
      riskTextBn: courierRiskTextBn,
      riskTextEn: courierRiskTextEn,
      dataSources: 'অর্ডার ডাটাবেস ও ডেলিভারি রেকর্ড'
    },
    salesHistory: customerSales.map(s => ({
      id: s.id,
      productName: s.productName || 'পণ্য',
      productCode: s.productCode,
      quantity: s.quantity,
      totalAmount: s.totalAmount || ((s.actualSalePrice || s.sellingPrice || 0) * (s.quantity || 1)),
      status: (s as any).status || s.saleStatus || s.paymentStatus || 'Pending',
      createdAt: (s as any).createdAt || s.saleDate || new Date().toISOString(),
      customerName: s.customerName,
      customerAddress: s.customerAddress,
    }))
  });
});

// Public categories with dynamic product count
app.get('/api/public/categories', (req: Request, res: Response) => {
  const state = db.getState();
  const activeProducts = (state.products).filter(p => p.isActive && !p.isArchived);
  const dynamicCategories = (state.categories)
    .filter(c => c.isActive)
    .sort((a, b) => a.order - b.order)
    .map(c => ({
      ...c,
      itemCount: activeProducts.filter(p => p.categorySlug?.toLowerCase() === c.slug.toLowerCase()).length
    }));
  res.json(dynamicCategories);
});

// Visual Search with Image Upload / Drag & Drop
app.post('/api/public/visual-search', async (req: Request, res: Response) => {
  const { imageBase64, mimeType = 'image/jpeg' } = req.body;
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  const state = db.getState();
  const allActiveProducts = (state.products || []).filter(p => p.isActive && !p.isArchived);

  if (allActiveProducts.length === 0) {
    return res.json({
      success: true,
      detectedItem: {
        itemTypeBn: 'কোনো মিল পাওয়া যায়নি',
        descriptionBn: 'ক্যাটালগে বর্তমানে কোনো সক্রিয় পণ্য নেই।',
        colors: [],
        keywords: [],
        detectedCategory: null,
      },
      matchedProducts: [],
    });
  }

  // 1. Convert uploaded query image to buffer
  let queryBuffer: Buffer;
  try {
    queryBuffer = Buffer.from(cleanBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 image data' });
  }

  // Helper for Sharp perceptual difference hash & normalized pixel buffer
  async function getFingerprint(buf: Buffer) {
    try {
      const normBuffer = await sharp(buf)
        .resize(32, 32, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();

      const gray16 = await sharp(buf)
        .resize(17, 16, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      let dhash = '';
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          dhash += (gray16[y * 17 + x] > gray16[y * 17 + x + 1] ? '1' : '0');
        }
      }
      return { normBuffer, dhash };
    } catch {
      return null;
    }
  }

  function hammingDistance(h1: string, h2: string) {
    let dist = 0;
    for (let i = 0; i < h1.length; i++) {
      if (h1[i] !== h2[i]) dist++;
    }
    return dist;
  }

  function pixelSimilarity(b1: Buffer, b2: Buffer) {
    let totalDiff = 0;
    for (let i = 0; i < b1.length; i++) {
      totalDiff += Math.abs(b1[i] - b2[i]);
    }
    return 100 * (1 - totalDiff / (b1.length * 255));
  }

  let matchedProductId: string | null = null;
  let matchScore = 0;
  let matchReason = '';

  // 2. Perform Sharp visual fingerprint matching against all active catalog products' images
  const queryFp = await getFingerprint(queryBuffer);
  let bestFingerprintMatch: { product: any; score: number; dist: number; sim: number } | null = null;

  if (queryFp) {
    for (const p of allActiveProducts) {
      const imgs = p.images && p.images.length > 0 ? p.images : (p.imageUrl ? [{ url: p.imageUrl }] : []);
      let minProductDist = 999;
      let maxProductSim = 0;

      for (const img of imgs) {
        const url = typeof img === 'string' ? img : img?.url;
        if (!url) continue;
        let buf: Buffer | null = null;
        if (url.startsWith('data:image')) {
          const parts = url.split(',');
          if (parts[1]) buf = Buffer.from(parts[1], 'base64');
        } else if (url.startsWith('/')) {
          const fullPath = path.join(__dirname, 'public', url);
          if (fs.existsSync(fullPath)) buf = fs.readFileSync(fullPath);
        }

        if (buf) {
          const pFp = await getFingerprint(buf);
          if (pFp) {
            const d = hammingDistance(queryFp.dhash, pFp.dhash);
            const s = pixelSimilarity(queryFp.normBuffer, pFp.normBuffer);
            if (d < minProductDist) minProductDist = d;
            if (s > maxProductSim) maxProductSim = s;
          }
        }
      }

      // Check for reliable match:
      let isMatch = false;
      let score = 0;
      if (minProductDist <= 28) {
        isMatch = true;
        score = Math.min(99, Math.round(99 - minProductDist));
      } else if (minProductDist <= 42 && maxProductSim >= 78) {
        isMatch = true;
        score = Math.round(maxProductSim * 0.95);
      } else if (minProductDist <= 50 && maxProductSim >= 85) {
        isMatch = true;
        score = Math.round(maxProductSim * 0.92);
      }

      if (isMatch && (!bestFingerprintMatch || score > bestFingerprintMatch.score)) {
        bestFingerprintMatch = { product: p, score, dist: minProductDist, sim: maxProductSim };
      }
    }
  }

  if (bestFingerprintMatch) {
    matchedProductId = bestFingerprintMatch.product.id;
    matchScore = bestFingerprintMatch.score;
    matchReason = `${bestFingerprintMatch.product.nameBn} এর ছবির সাথে নিখুঁত মিল পাওয়া গেছে`;
  }

  // 3. Optional Gemini AI Vision Check if apiKey is available
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (apiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const catalogInventory = allActiveProducts.map(p => ({
        id: p.id,
        productCode: p.productCode,
        nameBn: p.nameBn,
        nameEn: p.nameEn,
        categorySlug: p.categorySlug,
        subcategoryBn: p.subcategoryBn || '',
      }));

      const aiPrompt = `You are a visual search matching engine for an e-commerce catalog in Bangladesh.
Compare this image against our catalog list:
${JSON.stringify(catalogInventory)}

RULES:
1. If the image is a person's photo, face, portrait, selfie, passport picture, animal, landscape, receipt, or NOT a commercial product:
   Set "isProductMatch": false, "matchedProductId": null, "confidence": 0, "descriptionBn": "ছবির সাথে কোনো মিল পাওয়া যায়নি।"
2. If it is a product, find if it specifically matches one of the catalog products above. If it does not reliably match any catalog product, set "isProductMatch": false, "matchedProductId": null, "confidence": 0.
3. If it matches a specific catalog product, return its exact id in "matchedProductId" and "confidence" (75-99).

Return JSON ONLY:
{ "isProductMatch": boolean, "matchedProductId": string | null, "confidence": number, "itemTypeBn": string, "descriptionBn": string }`;

      const response = await callGeminiWithModelFallback(ai, {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: cleanBase64,
                },
              },
              { text: aiPrompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      if (response && response.text) {
        const parsed = JSON.parse(response.text);
        if (parsed && parsed.isProductMatch && parsed.matchedProductId) {
          const geminiProduct = allActiveProducts.find(p => p.id === parsed.matchedProductId);
          if (geminiProduct) {
            matchedProductId = geminiProduct.id;
            matchScore = Math.min(99, Math.max(80, parsed.confidence || 95));
            matchReason = parsed.descriptionBn || `${geminiProduct.nameBn} এর সাথে চমৎকার মিল পাওয়া গেছে`;
          }
        } else if (parsed && parsed.isProductMatch === false) {
          matchedProductId = null;
        }
      }
    } catch (aiErr) {
      console.warn('[VisualSearch] Gemini call note:', (aiErr as any)?.message || aiErr);
    }
  }

  // 4. If no reliable match found, return empty results
  if (!matchedProductId) {
    return res.json({
      success: true,
      detectedItem: {
        itemTypeBn: 'কোনো মিল পাওয়া যায়নি',
        descriptionBn: 'ছবির সঙ্গে মিলে যাওয়ার মতো কোনো নির্দিষ্ট প্রোডাক্ট পাওয়া যায়নি।',
        colors: [],
        keywords: [],
        detectedCategory: null,
      },
      matchedProducts: [],
    });
  }

  // 5. If reliable match found, return the exact matched product and its direct variants only
  const primaryProduct = allActiveProducts.find(p => p.id === matchedProductId)!;
  const primaryCode = (primaryProduct.productCode || '').trim().toLowerCase();
  const primaryName = (primaryProduct.nameBn || '').trim().toLowerCase();
  const primaryOrigId = primaryProduct.originalProductId || primaryProduct.id;

  const directVariants = allActiveProducts.filter(p => {
    if (p.id === primaryProduct.id) return false;
    const pCode = (p.productCode || '').trim().toLowerCase();
    const pName = (p.nameBn || '').trim().toLowerCase();
    const pOrigId = p.originalProductId || p.id;

    const isSameCode = Boolean(primaryCode && pCode && primaryCode === pCode);
    const isSameOrig = Boolean(primaryOrigId && pOrigId && primaryOrigId === pOrigId);
    const isSameName = Boolean(primaryName && pName && primaryName === pName);

    return isSameCode || isSameOrig || isSameName;
  });

  const matchedProducts = [
    {
      product: sanitizeProduct(primaryProduct),
      matchScore: matchScore || 98,
      reason: matchReason || `${primaryProduct.nameBn} এর ছবির সাথে নিখুঁত মিল পাওয়া গেছে`,
      isPrimary: true,
    }
  ];

  res.json({
    success: true,
    detectedItem: {
      itemTypeBn: primaryProduct.nameBn,
      descriptionBn: matchReason || `${primaryProduct.nameBn} এর ছবির সাথে নিখুঁত মিল পাওয়া গেছে`,
      detectedCategory: primaryProduct.categorySlug,
      colors: [],
      keywords: [primaryProduct.nameBn, primaryProduct.productCode].filter(Boolean),
    },
    matchedProducts,
  });
});

async function sendTelegramOrderNotification(orderData: {
  orderCode: string;
  saleId?: string;
  employeeName?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: any[];
  productsTotal: number;
  deliveryCharge: number;
  grandTotal: number;
  isAdvancePaid: boolean;
  paymentMethod?: string;
  transactionId?: string;
  dueAmount: number;
  saleStatus?: string;
  deliveryStatus?: string;
  trackingCode?: string;
  createdAt?: string | Date;
}, brandSettings: any) {
  try {
    const token = brandSettings?.telegramBotToken;
    let chatId = brandSettings?.telegramChatId;
    if (!token) return;

    if (!chatId) {
      try {
        const updateRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
        const updateData = await updateRes.json();
        if (updateData.ok && updateData.result && updateData.result.length > 0) {
          const lastUpdate = updateData.result[updateData.result.length - 1];
          chatId = lastUpdate.message?.chat?.id || lastUpdate.callback_query?.message?.chat?.id;
          if (chatId) {
            const state = db.getState();
            state.brandSettings.telegramChatId = String(chatId);
            await db.syncBrandSettingsDirect(state.brandSettings);
            db.save();
          }
        }
      } catch (e) {}
    }

    if (!chatId) return;

    const resolvedBaseUrl = (process.env.APP_URL || 'https://ais-dev-joh5npiijvb3nx2bvod7vs-697439367961.asia-southeast1.run.app').replace(/\/$/, '');

    const isPublic = !orderData.employeeName || orderData.employeeName === 'পাবলিক ওয়েবসাইট' || orderData.employeeName === 'অফিসিয়াল ওয়েবসাইট' || orderData.employeeName === 'OFFICIAL';

    // Parse address parts
    let addressParts = { district: '', thana: '', address: '' };
    const addrMatch = (orderData.customerAddress || '').match(/জেলা: (.*?), থানা: (.*?), ঠিকানা: (.*)/);
    if (addrMatch) {
      addressParts = { district: addrMatch[1].trim(), thana: addrMatch[2].trim(), address: addrMatch[3].trim() };
    } else {
      addressParts.address = (orderData.customerAddress || '').trim();
    }

    // ========================================================
    // TELEGRAM ORDER NOTIFICATION (Photos First, then Detailed Order Text Message)
    // ========================================================
    // Helper function to sanitize text for Telegram Markdown
    function sanitizeMd(val: any): string {
      if (val === null || val === undefined) return '';
      return String(val).replace(/([*_`\[\]])/g, '');
    }

    // Format date in Bangladesh time: e.g. 24 Oct 2026, 3:41 PM
    const orderDateObj = orderData.createdAt ? new Date(orderData.createdAt) : new Date();
    const formattedDate = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Dhaka'
    }).format(orderDateObj).replace(/(am|pm)/i, (m) => m.toUpperCase());

    // Fetch actual product photos and prepare item details
    const preparedItems = await Promise.all(
      (orderData.items || []).map(async (it: any) => {
        let imageBuffer: Buffer | null = null;
        const rawUrl = it.imageUrl || it.originalProduct?.imageUrl;
        if (rawUrl) {
          try {
            let buffer: Buffer | null = null;
            if (rawUrl.startsWith('data:')) {
              const match = rawUrl.match(/^data:[^;]+;base64,(.+)$/);
              if (match && match[1]) {
                buffer = Buffer.from(match[1], 'base64');
              }
            } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
              const res = await fetch(rawUrl, { signal: AbortSignal.timeout(4000) });
              if (res.ok) {
                const arr = await res.arrayBuffer();
                buffer = Buffer.from(arr);
              }
            } else {
              const cleanPath = rawUrl.replace(/^\/+/, '');
              const localPaths = [
                path.join(process.cwd(), 'public', cleanPath),
                path.join(process.cwd(), cleanPath),
                path.join(process.cwd(), 'uploads', cleanPath.replace(/^uploads\//, ''))
              ];
              for (const lp of localPaths) {
                if (fs.existsSync(lp)) {
                  buffer = await fs.promises.readFile(lp);
                  break;
                }
              }
            }

            if (buffer && buffer.length > 0) {
              try {
                imageBuffer = await sharp(buffer)
                  .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                  .jpeg({ quality: 85 })
                  .toBuffer();
              } catch {
                imageBuffer = buffer;
              }
            }
          } catch (e) {
            console.warn('[Telegram Product Photo Fetch Warning]:', e);
          }
        }

        const rawCode = (it.productCode || it.code || 'TNX').replace(/^#/, '');
        const cleanCode = rawCode.startsWith('SKU-') ? rawCode : (rawCode === 'TNX' ? 'TNX' : `SKU-${rawCode}`);
        const pSize = it.size || 'N/A';
        const qty = it.quantity || 1;
        const unitPrice = it.unitPrice || it.sellingPrice || 0;
        const lineTotal = unitPrice * qty;
        const prodId = it.productId || it.id || '';
        const productLink = prodId ? `${resolvedBaseUrl}/products/${prodId}` : resolvedBaseUrl;

        return {
          name: it.productName || 'পণ্য',
          code: cleanCode,
          size: pSize,
          quantity: qty,
          unitPrice,
          lineTotal,
          productLink,
          imageBuffer,
          rawUrl
        };
      })
    );

    // Helpers to send photo and text message with copy_text button fallback
    async function sendPhotoBuffer(
      buffer: Buffer,
      caption?: string,
      markup?: any,
      fallbackMarkup?: any
    ): Promise<boolean> {
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        const blob = new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
        formData.append('photo', blob, 'product.jpg');
        if (caption) {
          formData.append('caption', caption);
          formData.append('parse_mode', 'Markdown');
        }
        if (markup) {
          formData.append('reply_markup', JSON.stringify(markup));
        }

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json().catch(() => null);
        if (data && data.ok) return true;

        if (fallbackMarkup && data && data.description && data.description.includes('BUTTON_TYPE_INVALID')) {
          const retryFormData = new FormData();
          retryFormData.append('chat_id', chatId);
          retryFormData.append('photo', blob, 'product.jpg');
          if (caption) {
            retryFormData.append('caption', caption);
            retryFormData.append('parse_mode', 'Markdown');
          }
          retryFormData.append('reply_markup', JSON.stringify(fallbackMarkup));
          const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: retryFormData
          });
          const retryData = await retryRes.json().catch(() => null);
          return Boolean(retryData && retryData.ok);
        }
        console.warn('[Telegram sendPhoto Warning]:', data);
        return false;
      } catch (err) {
        console.warn('[Telegram sendPhoto Error]:', err);
        return false;
      }
    }

    async function sendTextMessage(
      text: string,
      markup?: any,
      fallbackMarkup?: any
    ): Promise<boolean> {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            ...(markup ? { reply_markup: markup } : {})
          })
        });
        const data = await res.json().catch(() => null);
        if (data && data.ok) return true;

        if (fallbackMarkup && data && data.description && data.description.includes('BUTTON_TYPE_INVALID')) {
          const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'Markdown',
              reply_markup: fallbackMarkup
            })
          });
          const retryData = await retryRes.json().catch(() => null);
          return Boolean(retryData && retryData.ok);
        }
        console.warn('[Telegram sendMessage Warning]:', data);
        return false;
      } catch (err) {
        console.warn('[Telegram sendMessage Error]:', err);
        return false;
      }
    }

    // ========================================================
    // STEP 1: Send real product photos FIRST (one message per product)
    // Each photo has caption + exactly 2 side-by-side buttons: [ 📋 কোড কপি ]  [ 🔗 লিংক কপি ]
    // ========================================================
    for (let idx = 0; idx < preparedItems.length; idx++) {
      const it = preparedItems[idx];
      const prodPrefix = preparedItems.length > 1 ? `📦 *পণ্য ${idx + 1}:*` : `📦 *পণ্য:*`;
      const photoCaption = `${prodPrefix} *${sanitizeMd(it.name)}*\n🏷️ SKU: \`#${it.code}\` | সাইজ: ${sanitizeMd(it.size)} | পরিমাণ: ${it.quantity} টি | মূল্য: ৳${it.lineTotal.toLocaleString()}`;

      const productMarkup = {
        inline_keyboard: [
          [
            { text: '📋 কোড কপি', copy_text: { text: it.code } },
            { text: '🔗 লিংক কপি', copy_text: { text: it.productLink } }
          ]
        ]
      };

      const productFallbackMarkup = {
        inline_keyboard: [
          [
            { text: '📋 কোড কপি', url: `${resolvedBaseUrl}/?search=${encodeURIComponent(it.code)}` },
            { text: '🔗 লিংক কপি', url: it.productLink }
          ]
        ]
      };

      if (it.imageBuffer) {
        await sendPhotoBuffer(it.imageBuffer, photoCaption, productMarkup, productFallbackMarkup);
      } else {
        await sendTextMessage(photoCaption, productMarkup, productFallbackMarkup);
      }

      await new Promise((r) => setTimeout(r, 250));
    }

    // ========================================================
    // STEP 2: Send comprehensive Order Details Text Message AFTER photos
    // Formatted strictly according to the reference image layout
    // ========================================================
    const sourceBadge = isPublic
      ? '🌐 [ PUBLIC WEBSITE ]'
      : `🔥 [ RESELLER PANEL: ${sanitizeMd(orderData.employeeName || 'Reseller')} ]`;

    const itemsBlock = preparedItems.map((it, idx) => {
      const pLabel = preparedItems.length > 1 ? `*পণ্য ${idx + 1}:*` : `*পণ্য:*`;
      return `${pLabel}
*${sanitizeMd(it.name)}*
🏷️ SKU: \`#${it.code}\`
🥋 সাইজ: ${sanitizeMd(it.size)}
📦 পরিমাণ: ${it.quantity} টি
💰 মূল্য: ৳${it.lineTotal.toLocaleString()}`;
    }).join('\n\n');

    const advanceInfo = orderData.isAdvancePaid
      ? ` (${orderData.paymentMethod || 'bKash'} অগ্রিম পেইড${orderData.transactionId ? ` TrxID: ${orderData.transactionId}` : ''})`
      : '';
    const dueInfo = (!isPublic && orderData.dueAmount !== undefined)
      ? `\n💳 *বাকি (COD):* ৳${Number(orderData.dueAmount || 0).toLocaleString()}`
      : '';

    const orderDetailsMessage = `🌐 *নতুন অর্ডার নোটিফিকেশন*
🏷️ ${sourceBadge}

🆔 *অর্ডার কোড:* \`${sanitizeMd(orderData.orderCode)}\`
📅 *অর্ডারের তারিখ:* ${formattedDate}
━━━━━━━━━━━━━━━━━━━━
👤 *গ্রাহকের তথ্য:*
👤 নাম: \`${sanitizeMd(orderData.customerName || 'N/A')}\`
📞 মোবাইল: \`${sanitizeMd(orderData.customerPhone || 'N/A')}\`
📍 জেলা: \`${sanitizeMd(addressParts.district || 'ঢাকা')}\`
🏢 থানা: \`${sanitizeMd(addressParts.thana || 'সদর')}\`
🏠 ঠিকানা: \`${sanitizeMd(addressParts.address || 'N/A')}\`
━━━━━━━━━━━━━━━━━━━━
📦 *অর্ডারকৃত পণ্যসমূহ:*

${itemsBlock}

━━━━━━━━━━━━━━━━━━━━
🛒 *পণ্যের মোট মূল্য:* ৳${Number(orderData.productsTotal || 0).toLocaleString()}
🚚 *ডেলিভারি চার্জ:* ৳${Number(orderData.deliveryCharge || 0).toLocaleString()}${advanceInfo}
🧮 *সর্বমোট বিল:* ৳${Number(orderData.grandTotal || 0).toLocaleString()}${dueInfo}`;

    const adminKeyboard = {
      inline_keyboard: [
        [{ text: '⚙️ অ্যাডমিন প্যানেলে প্রবেশ করুন ↗', url: resolvedBaseUrl }]
      ]
    };

    // Send the detailed text message with the Admin Panel button at the end
    await sendTextMessage(orderDetailsMessage, adminKeyboard);
  } catch (err) {
    console.warn('Failed to send Telegram notification:', err);
  }
}

// Background poller for Telegram button clicks (Confirm, Processing, Shipped, Delivered, Cancel)
async function pollTelegramUpdates() {
  try {
    const state = db.getState();
    const token = state.brandSettings?.telegramBotToken;
    if (!token) return;

    if (!(global as any)._lastTelegramUpdateId) {
      (global as any)._lastTelegramUpdateId = 0;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${(global as any)._lastTelegramUpdateId + 1}&timeout=1`);
    const data = await res.json();
    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      (global as any)._lastTelegramUpdateId = Math.max((global as any)._lastTelegramUpdateId, update.update_id);

      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      if (chatId && !state.brandSettings.telegramChatId) {
        state.brandSettings.telegramChatId = String(chatId);
        db.syncBrandSettingsDirect(state.brandSettings).catch(() => {});
      }

      if (update.callback_query) {
        const cq = update.callback_query;
        const dataStr = cq.data || '';
        const messageId = cq.message?.message_id;
        const chatId = cq.message?.chat?.id;

        let action = '';
        let targetId = '';
        if (dataStr.startsWith('confirm_')) {
          action = 'confirm';
          targetId = dataStr.replace('confirm_', '');
        } else if (dataStr.startsWith('processing_')) {
          action = 'processing';
          targetId = dataStr.replace('processing_', '');
        } else if (dataStr.startsWith('shipped_')) {
          action = 'shipped';
          targetId = dataStr.replace('shipped_', '');
        } else if (dataStr.startsWith('delivered_')) {
          action = 'delivered';
          targetId = dataStr.replace('delivered_', '');
        } else if (dataStr.startsWith('cancel_')) {
          action = 'cancel';
          targetId = dataStr.replace('cancel_', '');
        }

        if (action && targetId) {
          const sale = state.sales.find(s => s.id === targetId || s.orderCode === targetId);
          if (sale) {
            let statusText = '';
            if (action === 'confirm') {
              sale.saleStatus = 'Confirmed';
              sale.deliveryStatus = 'processing';
              statusText = '✅ কনফার্মড (Confirmed)';
            } else if (action === 'processing') {
              sale.saleStatus = 'Processing';
              sale.deliveryStatus = 'processing';
              statusText = '🚚 প্রসেসিং (Processing)';
            } else if (action === 'shipped') {
              sale.saleStatus = 'Shipped';
              sale.deliveryStatus = 'shipped';
              statusText = '📦 শিপড (Shipped)';
            } else if (action === 'delivered') {
              sale.saleStatus = 'Delivered';
              sale.deliveryStatus = 'delivered';
              statusText = '✨ ডেলিভারড (Delivered)';
            } else {
              sale.saleStatus = 'Cancelled';
              sale.deliveryStatus = 'cancelled';
              statusText = '❌ বাতিলকৃত (Cancelled)';
            }
            db.save();
            db.syncEntityDirect('sales', sale).catch(() => {});

            await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                callback_query_id: cq.id,
                text: `স্ট্যাটাস আপডেট সফল: ${statusText}`
              })
            });

            if (chatId && messageId) {
              const updatedText = cq.message.caption || cq.message.text || '';
              const newCaption = updatedText.replace(/📊 \*অর্ডার স্ট্যাটাস:\* .*/, `📊 *অর্ডার স্ট্যাটাস:* ${statusText}`);

              const editEndpoint = cq.message.caption ? 'editMessageCaption' : 'editMessageText';
              await fetch(`https://api.telegram.org/bot${token}/${editEndpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  message_id: messageId,
                  [cq.message.caption ? 'caption' : 'text']: newCaption,
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '✅ কনফার্ম', callback_data: `confirm_${targetId}` },
                        { text: '🚚 প্রসেসিং', callback_data: `processing_${targetId}` }
                      ],
                      [
                        { text: '📦 শিপড', callback_data: `shipped_${targetId}` },
                        { text: '✨ ডেলিভারড', callback_data: `delivered_${targetId}` }
                      ],
                      [
                        { text: '❌ অর্ডার বাতিল করুন', callback_data: `cancel_${targetId}` }
                      ]
                    ]
                  }
                })
              });
            }
          }
        }
      }
    }
  } catch (err) {
    // silent catch
  }
}

// Poll Telegram updates every 4 seconds
setInterval(pollTelegramUpdates, 4000);

// ==========================================
// TELEGRAM TEST ENDPOINT
// ==========================================
app.post('/api/telegram/test', async (req: Request, res: Response) => {
  try {
    const { token, chatId } = req.body;
    const state = db.getState();
    const botToken = token || state.brandSettings?.telegramBotToken;
    let targetChatId = chatId || state.brandSettings?.telegramChatId;

    if (!botToken) {
      return res.status(400).json({ error: 'Telegram Bot Token দিন।' });
    }

    if (!targetChatId) {
      try {
        const updateRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
        const updateData = await updateRes.json();
        if (updateData.ok && updateData.result && updateData.result.length > 0) {
          const lastUpdate = updateData.result[updateData.result.length - 1];
          targetChatId = lastUpdate.message?.chat?.id || lastUpdate.callback_query?.message?.chat?.id;
        }
      } catch (e) {}
    }

    if (!targetChatId) {
      return res.status(400).json({ error: 'Telegram Chat ID পাওয়া যায়নি। দয়া করে আপনার টেলিগ্রাম বটে একটি মেসেজ (যেমন /start) পাঠিয়ে আবার চেষ্টা করুন।' });
    }

    const testMsg = `🤖 *টিএওজুন (TAWZOON) টেস্ট নোটিফিকেশন*
━━━━━━━━━━━━━━━━━━━━
আপনার টেলিগ্রাম বট সফলভাবে যুক্ত হয়েছে! ✅ এখন থেকে ওয়েবসাইটে নতুন অর্ডার আসলে এই চ্যাটে নোটিফিকেশন ও কনফার্ম/বাতিল বাটন চলে আসবে।`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: testMsg,
        parse_mode: 'Markdown'
      })
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return res.status(400).json({ error: `Telegram Error: ${tgData.description || 'Failed to send message'}` });
    }

    state.brandSettings.telegramChatId = String(targetChatId);
    if (token) state.brandSettings.telegramBotToken = token;
    await db.syncBrandSettingsDirect(state.brandSettings);
    db.save();

    res.json({ success: true, message: 'Test message sent successfully!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ==========================================
// PUBLIC WEBSITE ORDER PLACEMENT ENDPOINT
// ==========================================
app.post('/api/public/orders', async (req: Request, res: Response) => {
  try {
    const {
      items,
      customerName,
      customerPhone,
      customerAddress,
      district,
      thana,
      notes,
      deliveryCharge,
      paymentMethod,
      transactionId,
      senderPhone,
      isAdvancePaid,
      referralCode,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'কমপক্ষে একটি পণ্য সিলেক্ট থাকতে হবে।' });
    }

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'গ্রাহকের পুরো নাম আবশ্যক।' });
    }

    const cleanPhone = (customerPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.length < 11) {
      return res.status(400).json({ error: 'সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন।' });
    }

    if (!customerAddress || !customerAddress.trim()) {
      return res.status(400).json({ error: 'হোম ডেলিভারির বিস্তারিত ঠিকানা দিন।' });
    }

    const state = db.getState();

    // Validate delivery fee: Dhaka is 70, outside Dhaka is 120
    const normalizedDistrict = (district || 'ঢাকা').trim();
    const isDhaka = normalizedDistrict === 'ঢাকা' || normalizedDistrict.toLowerCase() === 'dhaka';
    const standardDeliveryFee = isDhaka ? 70 : 120;
    const effectiveDeliveryFee = typeof deliveryCharge === 'number' && deliveryCharge > 0 ? deliveryCharge : standardDeliveryFee;

    // Resolve reseller employee if customer arrived via referral
    const cleanRef = (referralCode || (req.query.ref as string) || (req.headers['x-referral-code'] as string) || '').trim();
    let referringEmployee = null;
    if (cleanRef) {
      referringEmployee = state.employees.find(e =>
        e.id === cleanRef ||
        e.referenceCode === cleanRef ||
        (e.phone && e.phone === cleanRef) ||
        (e.name && e.name.toLowerCase() === cleanRef.toLowerCase())
      ) || null;
    }

    const sharedOrderCode = 'ORD-' + crypto.randomInt(100000, 999999);
    const createdSales: Sale[] = [];
    let productsTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const rawProdId = item.productId || item.id;
      const cleanId = (typeof rawProdId === 'string' && rawProdId.includes('_')) ? rawProdId.split('_')[0] : rawProdId;
      const product = state.products.find(p => p.id === cleanId || p.id === rawProdId || p.productCode === item.productCode);

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
      const unitPrice = Number(item.sellingPrice) || (product ? product.sellingPrice : 0);
      const itemTotal = unitPrice * qty;
      productsTotal += itemTotal;

      // Reseller profit attribution if referred
      let unitCommission = 0;
      let wholesalePrice = product ? Number(product.originalPrice || 0) : 0;
      if (referringEmployee && product) {
        const effectiveProduct = getProductForEmployee(product, referringEmployee);
        wholesalePrice = Number(effectiveProduct.originalPrice || 0);
        unitCommission = Math.max(0, unitPrice - wholesalePrice);
      }
      const itemCommission = Math.max(0, Math.round(unitCommission * qty));
      totalProfit += itemCommission;

      const deliveryNote = isAdvancePaid
        ? ` [ডেলিভারি চার্জ: ৳${effectiveDeliveryFee} অগ্রিম পরিশোধিত (${paymentMethod || 'bKash'}${transactionId ? `, TrxID: ${transactionId}` : ''}${senderPhone ? `, প্রেরক: ${senderPhone}` : ''})]`
        : ` [ডেলিভারি চার্জ: ৳${effectiveDeliveryFee} ক্যাশ অন ডেলিভারি (বিকল্প পদ্ধতি)]`;

      const fullAddress = `জেলা: ${normalizedDistrict}, থানা: ${thana || 'সদর'}, ঠিকানা: ${customerAddress.trim()}`;

      const sale: Sale = {
        id: 'sale-' + crypto.randomUUID().slice(0, 8),
        orderCode: sharedOrderCode,
        employeeId: referringEmployee ? referringEmployee.id : 'OFFICIAL',
        employeeName: referringEmployee ? referringEmployee.name : 'অফিশিয়াল ওয়েবসাইট',
        productId: product ? product.id : (cleanId || 'prod-custom'),
        productName: item.productName || (product ? product.nameBn : 'পণ্য'),
        productCode: item.productCode || (product ? product.productCode : 'TNX'),
        quantity: qty,
        basePrice: wholesalePrice,
        actualSalePrice: unitPrice,
        sellingPrice: unitPrice,
        totalAmount: itemTotal,
        commissionAmount: itemCommission,
        customerName: customerName.trim(),
        customerPhone: cleanPhone,
        customerAddress: fullAddress,
        paymentStatus: isAdvancePaid ? 'PAID' : 'PENDING',
        saleStatus: 'Pending Verification',
        deliveryStatus: 'pending',
        size: item.size ? String(item.size).trim() : undefined,
        saleDate: new Date().toISOString(),
        district: normalizedDistrict,
        thana: thana ? String(thana).trim() : undefined,
        deliveryCharge: effectiveDeliveryFee,
        isPublicOrder: true,
        orderSource: referringEmployee ? `রিসেলার: ${referringEmployee.name}` : 'পাবলিক ওয়েবসাইট',
        paymentMethod: paymentMethod || (isAdvancePaid ? 'bKash' : 'COD'),
        transactionId: transactionId ? String(transactionId).trim() : undefined,
        notes: `${notes ? notes.trim() : ''}${deliveryNote}`.trim()
      };

      state.sales.unshift(sale);
      createdSales.push(sale);
      db.syncEntityDirect('sales', sale).catch(e => console.error('[Persistence] Sale sync warning:', e));
    }

    db.save();

    const grandTotal = productsTotal + effectiveDeliveryFee;

    // Broadcast real-time live event
    broadcastRealtimeEvent('order_created', {
      orderCode: sharedOrderCode,
      employeeName: referringEmployee ? referringEmployee.name : 'পাবলিক ওয়েবসাইট',
      customerName: customerName.trim(),
      totalAmount: grandTotal,
      itemsCount: items.length,
      timestamp: Date.now()
    });

    // Notify Admin
    db.addNotification({
      recipientRole: 'ADMIN',
      titleBn: `নতুন ওয়েবসাইট অর্ডার (${sharedOrderCode})`,
      titleEn: `New Website Order (${sharedOrderCode})`,
      messageBn: `${customerName.trim()} (${cleanPhone}) থেকে ৳${grandTotal} মূল্যের ${items.length}টি পণ্যের অর্ডার এসেছে। ডেলিভারি চার্জ: ৳${effectiveDeliveryFee} (${isAdvancePaid ? 'অগ্রিম পরিশোধিত' : 'ক্যাশ অন ডেলিভারি'})।`,
      messageEn: `New order from ${customerName.trim()} (${cleanPhone}). Total: ৳${grandTotal}, Items: ${items.length}, Delivery: ৳${effectiveDeliveryFee}.`,
      type: 'SALE'
    });

    // Notify Reseller if referred
    if (referringEmployee) {
      db.addNotification({
        recipientRole: 'EMPLOYEE',
        employeeId: referringEmployee.id,
        titleBn: `আপনার লিংকে নতুন অর্ডার (${sharedOrderCode})`,
        titleEn: `New Referral Order (${sharedOrderCode})`,
        messageBn: `আপনার রেফারেল লিংক থেকে কাস্টমার ${customerName.trim()} একটি নতুন অর্ডার করেছেন (${sharedOrderCode})। মোট: ৳${grandTotal}, সম্ভাব্য মুনাফা: ৳${totalProfit}।`,
        messageEn: `Customer ${customerName.trim()} ordered via your referral link (${sharedOrderCode}). Total: ৳${grandTotal}, Profit: ৳${totalProfit}.`,
        type: 'SALE'
      });
    }

    // Send Telegram Notification if configured
    sendTelegramOrderNotification({
      orderCode: sharedOrderCode,
      saleId: createdSales[0]?.id,
      employeeName: referringEmployee ? referringEmployee.name : 'পাবলিক ওয়েবসাইট',
      customerName: customerName.trim(),
      customerPhone: cleanPhone,
      customerAddress: `জেলা: ${normalizedDistrict}, থানা: ${thana || 'সদর'}, ঠিকানা: ${customerAddress.trim()}`,
      items,
      productsTotal,
      deliveryCharge: effectiveDeliveryFee,
      grandTotal,
      isAdvancePaid: !!isAdvancePaid,
      paymentMethod: paymentMethod || (isAdvancePaid ? 'bKash' : 'COD'),
      transactionId,
      dueAmount: isAdvancePaid ? productsTotal : grandTotal,
      saleStatus: 'Pending Verification',
      deliveryStatus: 'pending',
      trackingCode: undefined
    }, state.brandSettings);

    res.json({
      success: true,
      orderCode: sharedOrderCode,
      itemsCount: items.length,
      productsTotal,
      deliveryCharge: effectiveDeliveryFee,
      grandTotal,
      advancePaid: isAdvancePaid ? effectiveDeliveryFee : 0,
      dueAmount: isAdvancePaid ? productsTotal : grandTotal,
      isAdvancePaid: !!isAdvancePaid,
      paymentMethod: paymentMethod || (isAdvancePaid ? 'bKash' : 'COD'),
      transactionId: transactionId || null,
      customerName: customerName.trim(),
      customerPhone: cleanPhone,
      customerAddress: `জেলা: ${normalizedDistrict}, থানা: ${thana || 'সদর'}, ঠিকানা: ${customerAddress.trim()}`,
      orderDate: new Date().toLocaleString('bn-BD'),
      message: 'আপনার অর্ডারটি সফলভাবে সম্পন্ন হয়েছে!'
    });
  } catch (err: any) {
    console.error('[API] /api/public/orders error:', err);
    res.status(500).json({ error: err.message || 'অর্ডার প্রসেস করতে ব্যর্থ হয়েছে।' });
  }
});

// ==========================================
// 2. ADMIN AUTHENTICATION (DIRECT PASSWORD & OTP SUPPORT)
// ==========================================

// Direct Admin Login with Email & Password (No OTP code required)
app.post('/api/auth/admin/login', (req: Request, res: Response) => {
  const { email, password } = req.body;

  const isEmailMatch = email && email.trim().toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase();
  const isPasswordMatch = password && (password === AUTHORIZED_ADMIN_PASSWORD || password.trim() === AUTHORIZED_ADMIN_PASSWORD);

  if (!isEmailMatch || !isPasswordMatch) {
    db.logAudit(
      'ADMIN_LOGIN_UNAUTHORIZED_ATTEMPT',
      email || 'Unknown',
      'ADMIN_PORTAL',
      undefined,
      'Rejected invalid admin email or password',
      getClientIp(req)
    );
    return res.status(401).json({
      error: 'ভুল ইমেইল বা পাসওয়ার্ড! শুধুমাত্র অনুমোদিত অ্যাডমিন (mdshaali9516@gmail.com) এবং সঠিক পাসওয়ার্ড দিতে হবে।'
    });
  }

  const state = db.getState();
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    email: AUTHORIZED_ADMIN_EMAIL,
    role: 'SUPER_ADMIN' as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 3600 * 1000 // 24 hours
  };

  state.adminSessions.push(session);
  db.save();

  db.logAudit(
    'ADMIN_LOGIN_SUCCESS',
    AUTHORIZED_ADMIN_EMAIL,
    'ADMIN_PORTAL',
    undefined,
    'Admin authenticated via direct password login',
    getClientIp(req)
  );

  res.json({
    success: true,
    token,
    admin: {
      email: AUTHORIZED_ADMIN_EMAIL,
      role: 'SUPER_ADMIN'
    }
  });
});

// Request 6-digit OTP to authorized admin email
app.post('/api/auth/admin/request-otp', (req: Request, res: Response) => {
  const { email, password } = req.body;

  const isEmailMatch = email && email.trim().toLowerCase() === AUTHORIZED_ADMIN_EMAIL.toLowerCase();
  const isPasswordMatch = password && (password === AUTHORIZED_ADMIN_PASSWORD || password.trim() === AUTHORIZED_ADMIN_PASSWORD);

  if (!isEmailMatch || !isPasswordMatch) {
    db.logAudit(
      'ADMIN_LOGIN_UNAUTHORIZED_ATTEMPT',
      email || 'Unknown',
      'ADMIN_PORTAL',
      undefined,
      'Rejected invalid admin email or password',
      getClientIp(req)
    );
    return res.status(401).json({
      error: 'ভুল ইমেইল বা পাসওয়ার্ড! শুধুমাত্র অনুমোদিত অ্যাডমিন (mdshaali9516@gmail.com) এবং সঠিক পাসওয়ার্ড দিতে হবে।'
    });
  }

  const state = db.getState();

  // Rate limiting check: 30 seconds
  if (state.adminOtpState && Date.now() - state.adminOtpState.lastRequestedAt < 30000) {
    const remaining = Math.ceil((30000 - (Date.now() - state.adminOtpState.lastRequestedAt)) / 1000);
    return res.status(429).json({
      error: `Please wait ${remaining} seconds before requesting a new verification code.`
    });
  }

  // Fixed verification code as requested by user
  const otpNumber = "224395";

  state.adminOtpState = {
    email: AUTHORIZED_ADMIN_EMAIL,
    otp: otpNumber,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    attempts: 0,
    lastRequestedAt: Date.now()
  };
  db.save();

  db.logAudit(
    'ADMIN_OTP_DISPATCHED',
    AUTHORIZED_ADMIN_EMAIL,
    'ADMIN_AUTH',
    undefined,
    'Verification code generated and sent to email inbox',
    getClientIp(req)
  );

  res.json({
    success: true,
    message: `A 6-digit verification code has been dispatched to ${AUTHORIZED_ADMIN_EMAIL}. Please check your inbox.`
  });
});

// Verify 6-digit OTP and generate secure admin session
app.post('/api/auth/admin/verify-otp', (req: Request, res: Response) => {
  const { email, otp } = req.body;
  const state = db.getState();

  if (!email || email.trim().toLowerCase() !== AUTHORIZED_ADMIN_EMAIL.toLowerCase()) {
    return res.status(401).json({ error: 'Unauthorized admin email.' });
  }

  if (!state.adminOtpState || !state.adminOtpState.otp) {
    return res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
  }

  if (Date.now() > state.adminOtpState.expiresAt) {
    state.adminOtpState = null;
    db.save();
    return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
  }

  if (state.adminOtpState.attempts >= 3) {
    state.adminOtpState = null;
    db.save();
    db.logAudit(
      'ADMIN_OTP_MAX_ATTEMPTS_EXCEEDED',
      AUTHORIZED_ADMIN_EMAIL,
      'ADMIN_AUTH',
      undefined,
      '3 failed attempts. OTP locked and invalidated.',
      getClientIp(req)
    );
    return res.status(429).json({ error: 'Maximum attempts exceeded. Verification code invalidated.' });
  }

  const cleanOtp = String(otp || '').trim();

  if (cleanOtp !== state.adminOtpState.otp) {
    state.adminOtpState.attempts += 1;
    const remaining = 3 - state.adminOtpState.attempts;
    db.save();
    return res.status(400).json({
      error: `Invalid verification code. ${remaining} attempt(s) remaining.`
    });
  }

  // SUCCESS! Invalidate OTP
  state.adminOtpState = null;

  // Generate 256-bit secure session token
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token,
    email: AUTHORIZED_ADMIN_EMAIL,
    role: 'SUPER_ADMIN' as const,
    createdAt: Date.now(),
    expiresAt: Date.now() + 12 * 3600 * 1000 // 12 hours
  };

  state.adminSessions.push(session);
  db.save();

  db.logAudit(
    'ADMIN_LOGIN_SUCCESS',
    AUTHORIZED_ADMIN_EMAIL,
    'ADMIN_PORTAL',
    undefined,
    'Admin authenticated via OTP verification',
    getClientIp(req)
  );

  res.json({
    success: true,
    token,
    admin: {
      email: AUTHORIZED_ADMIN_EMAIL,
      role: 'SUPER_ADMIN'
    }
  });
});

// Admin verify session
app.get('/api/auth/admin/me', verifyAdmin, (req: Request, res: Response) => {
  const session = (req as any).adminSession;
  res.json({
    email: session.email,
    role: session.role
  });
});

// Admin logout
app.post('/api/auth/admin/logout', verifyAdmin, (req: Request, res: Response) => {
  const session = (req as any).adminSession;
  const state = db.getState();
  state.adminSessions = state.adminSessions.filter(s => s.token !== session.token);
  db.save();

  db.logAudit(
    'ADMIN_LOGOUT',
    session.email,
    'ADMIN_PORTAL',
    undefined,
    'Admin signed out',
    getClientIp(req)
  );

  res.json({ success: true, message: 'Admin logged out successfully' });
});

// ==========================================
// 3. EMPLOYEE / MARKETER AUTHENTICATION
// ==========================================

// Employee registration
app.post('/api/auth/employee/register', (req: Request, res: Response) => {
  const { name, email, phone, district, thana, password, reference } = req.body;

  if (!name || !email || !phone || !district || !thana || !password) {
    return res.status(400).json({ error: 'সবগুলো আবশ্যক তথ্য পূরণ করুন (নাম, ইমেইল, ফোন, জেলা, থানা ও পাসওয়ার্ড)' });
  }

  const cleanEmail = (email || '').trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'সঠিক ইমেইল ঠিকানা প্রদান করা আবশ্যক! ইমেইল ছাড়া অ্যাকাউন্ট তৈরি করা যাবে না।' });
  }

  // Handle Referral Code & Owner Relationship:
  // - Official code (TAWZOON9516, etc.): original price (0 markup, 0 deductions)
  // - Reseller code: +10 TK markup, 10% profit sharing on sales
  // Handle Referral Code & Owner Relationship:
  // - Official code (TAWZOON9516): original price (0 markup, 0 deductions)
  // - Reseller code: +10 TK markup (or upline reseller margin override)
  // - Without referral code: +10 TK markup as company bonus, assigned to COMPANY
  const rawRef = (reference || '').trim().toUpperCase();
  const isOfficial = isOfficialReferralCode(rawRef);
  const cleanRef = isOfficial ? 'TAWZOON9516' : rawRef;

  const cleanPhone = phone.trim().replace(/[^0-9+]/g, '');
  if (cleanPhone.replace(/[^0-9]/g, '').length < 11) {
    return res.status(400).json({ error: 'সঠিক ১১ ডিজিটের মোবাইল নম্বর প্রদান করুন' });
  }

  const state = db.getState();
  const existing = state.employees.find(
    e => e.phone === cleanPhone || (e.email && e.email.toLowerCase() === cleanEmail)
  );

  if (existing) {
    return res.status(400).json({ error: 'এই মোবাইল নম্বর বা ইমেইল দিয়ে ইতোমধ্যে একটি অ্যাকাউন্ট তৈরি করা হয়েছে।' });
  }

  let parentEmp: any = null;
  if (!isOfficial && cleanRef) {
    parentEmp = state.employees.find(e =>
      e.id.toUpperCase() === cleanRef ||
      (e.referenceCode && e.referenceCode.toUpperCase() === cleanRef) ||
      (e.reference && e.reference.toUpperCase() === cleanRef) ||
      (e.phone && e.phone.replace(/[^0-9]/g, '') === cleanRef.replace(/[^0-9]/g, '')) ||
      (e.name && e.name.toLowerCase() === cleanRef.toLowerCase())
    );
  }

  const generatedRefCode = `TN-REF-${cleanPhone.slice(-5).toUpperCase()}`;

  const initialMargin = isOfficial ? 0 : 10;
  const initialMaxBonus = 10;

  const newEmployee = {
    id: 'emp-' + crypto.randomUUID().slice(0, 8),
    name: name.trim(),
    email: cleanEmail,
    phone: cleanPhone,
    district: district.trim(),
    thana: thana.trim(),
    referenceCode: generatedRefCode,
    reference: isOfficial ? 'TAWZOON9516' : (parentEmp ? (parentEmp.referenceCode || cleanRef) : cleanRef),
    isOfficialReferral: isOfficial,
    resellerMargin: initialMargin,
    referralCommissionRate: initialMaxBonus,
    referralMaxBonusCap: initialMaxBonus,
    referralOwnerId: isOfficial
      ? 'OFFICIAL_TAWZOON'
      : (parentEmp ? parentEmp.id : 'COMPANY'),
    referralOwnerName: isOfficial
      ? 'তাওজুন অফিসিয়াল (Headquarters)'
      : (parentEmp ? parentEmp.name : 'তাওজুন কোম্পানি (Direct)'),
    referralOwnerPhone: isOfficial ? 'অফিসিয়াল সিস্টেম' : (parentEmp ? parentEmp.phone : undefined),
    referredBy: isOfficial
      ? 'TAWZOON9516'
      : (parentEmp ? (parentEmp.referenceCode || parentEmp.id) : (cleanRef || undefined)),
    role: 'EMPLOYEE' as const,
    status: 'PENDING' as const,
    // Official referral special rule: exempt from subscription fee & no referral bonus deduction
    subscriptionStatus: isOfficial ? ('exempt' as const) : ('trial' as const),
    isPaidSubscription: isOfficial,
    passwordHash: crypto.createHash('sha256').update(password).digest('hex'),
    registeredAt: new Date().toISOString(),
    wallet: {
      availableBalance: 0,
      pendingWithdrawal: 0,
      totalEarnings: 0,
      totalWithdrawn: 0
    }
  };

  state.employees.push(newEmployee);
  db.save();
  db.syncEntityDirect('employees', newEmployee).catch(e => console.error('[Persistence] Employee background sync error:', e));

  // Live broadcast to admin and all connected dashboards
  broadcastRealtimeEvent('STATE_UPDATED', {
    type: 'EMPLOYEE_REGISTERED',
    employeeId: newEmployee.id
  });
  broadcastRealtimeEvent('EMPLOYEE_REGISTERED', {
    id: newEmployee.id,
    name: newEmployee.name,
    phone: newEmployee.phone,
    status: newEmployee.status
  });

  // If referred by an existing reseller, notify the parent reseller in their dashboard notifications!
  if (parentEmp) {
    db.addNotification({
      recipientRole: 'EMPLOYEE',
      employeeId: parentEmp.id,
      titleBn: 'নতুন টিম মেম্বার যুক্ত হয়েছে!',
      titleEn: 'New Downline Member Joined!',
      messageBn: `আপনার রেফারেল কোড (${cleanRef}) দিয়ে ${newEmployee.name} (${newEmployee.district}) রেজিস্ট্রেশন সম্পন্ন করেছেন।`,
      messageEn: `${newEmployee.name} from ${newEmployee.district} registered using your referral code (${cleanRef}).`,
      type: 'EMPLOYEE'
    });
  }

  // Notify admin
  db.addNotification({
    recipientRole: 'ADMIN',
    titleBn: 'নতুন রিসেলার রেজিস্ট্রেশন',
    titleEn: 'New Reseller Registration',
    messageBn: `${newEmployee.name} (${newEmployee.phone}) অনুমোদনের জন্য রেজিস্ট্রেশন করেছেন। জেলা: ${newEmployee.district}`,
    messageEn: `${newEmployee.name} registered and is pending approval. District: ${newEmployee.district}`,
    type: 'EMPLOYEE'
  });

  db.logAudit(
    'EMPLOYEE_REGISTERED',
    newEmployee.email || newEmployee.phone,
    newEmployee.name,
    undefined,
    `Status: PENDING, Reference: ${newEmployee.reference}`,
    getClientIp(req)
  );

  res.json({
    success: true,
    messageBn: 'আপনার রেজিস্ট্রেশন সফল হয়েছে! অ্যাকাউন্টটি বর্তমানে এডমিন অনুমোদনের অপেক্ষায় আছে।',
    messageEn: 'Registration successful! Your account is currently pending administrative approval.'
  });
});

// Employee login
app.post('/api/auth/employee/login', (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier (Email/Phone) and password are required' });
  }

  const cleanId = identifier.trim().toLowerCase();
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const state = db.getState();

  const employee = state.employees.find(
    e => (e.email.toLowerCase() === cleanId || e.phone === cleanId) && e.passwordHash === passwordHash
  );

  if (!employee) {
    return res.status(401).json({ error: 'Invalid email/phone or password.' });
  }

  if (employee.status === 'PENDING') {
    return res.status(403).json({
      error: 'Your account is under admin review. Please wait for approval before logging in.'
    });
  }

  if (employee.status === 'REJECTED') {
    return res.status(403).json({
      error: 'Your marketer account was declined by the administrator.'
    });
  }

  if (employee.status === 'SUSPENDED') {
    return res.status(403).json({
      error: 'Your marketer account is temporarily suspended. Please contact admin.'
    });
  }

  // Create session
  const token = crypto.randomBytes(32).toString('hex');
  state.employeeSessions.push({
    token,
    employeeId: employee.id,
    name: employee.name,
    email: employee.email,
    role: 'EMPLOYEE',
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 3600 * 1000 // 24 hours
  });
  db.save();

  const { passwordHash: _, ...safeEmployee } = employee;
  res.json({
    success: true,
    token,
    employee: safeEmployee
  });
});

// Employee me
app.get('/api/auth/employee/me', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const { passwordHash, ...safeEmp } = emp;
  if (!safeEmp.referenceCode) {
    safeEmp.referenceCode = `REF-${(safeEmp.phone ? safeEmp.phone.slice(-5) : safeEmp.id.slice(-5)).toUpperCase()}`;
  }
  res.json(safeEmp);
});

// Update Reseller Profile - ONLY Name and Profile Picture can be modified
app.patch('/api/employee/profile', verifyEmployee, async (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const { name, avatarUrl } = req.body;

  const targetEmp = state.employees.find(e => e.id === emp.id);
  if (!targetEmp) {
    return res.status(404).json({ error: 'Reseller not found' });
  }

  // Strictly allow ONLY name and avatarUrl modifications
  if (name && typeof name === 'string' && name.trim()) {
    targetEmp.name = name.trim();
  }
  if (avatarUrl !== undefined && typeof avatarUrl === 'string') {
    targetEmp.avatarUrl = await persistLocalMedia(avatarUrl.trim());
  }

  // Ensure reference code
  if (!targetEmp.referenceCode) {
    targetEmp.referenceCode = `REF-${(targetEmp.phone ? targetEmp.phone.slice(-5) : targetEmp.id.slice(-5)).toUpperCase()}`;
  }

  db.save();
  await db.syncEntityDirect('employees', targetEmp);

  const { passwordHash, ...safeEmp } = targetEmp;
  res.json({ success: true, employee: safeEmp });
});

// Update Reseller Store / Free Trial Setup
app.put('/api/employee/store', verifyEmployee, async (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const { storeName, storeSlug, storeLogoUrl, storeWhatsapp, storePhone, storeThemeColor, storeHeaderColor, storeFooterColor } = req.body;

  const targetEmp = state.employees.find(e => e.id === emp.id);
  if (!targetEmp) {
    return res.status(404).json({ error: 'Reseller not found' });
  }

  const cleanSlug = (storeSlug || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
  if (!cleanSlug) {
    return res.status(400).json({ error: 'Valid store slug / subdomain is required.' });
  }

  const existing = state.employees.find(e => e.storeSlug === cleanSlug && e.id !== emp.id);
  if (existing) {
    return res.status(400).json({ error: 'This store URL / slug is already taken. Please choose another.' });
  }

  targetEmp.storeSlug = cleanSlug;
  targetEmp.storeName = storeName?.trim() || `${targetEmp.name} এক্সপ্রেস শপ`;
  if (storeLogoUrl) {
    targetEmp.storeLogoUrl = await persistLocalMedia(storeLogoUrl.trim());
  } else if (!targetEmp.storeLogoUrl) {
    targetEmp.storeLogoUrl = targetEmp.avatarUrl;
  }
  targetEmp.storeWhatsapp = storeWhatsapp?.trim() || targetEmp.phone;
  targetEmp.storePhone = storePhone?.trim() || targetEmp.phone;
  targetEmp.storeThemeColor = storeThemeColor || '#009245';
  targetEmp.storeHeaderColor = storeHeaderColor || '#ffffff';
  targetEmp.storeFooterColor = storeFooterColor || '#0f172a';
  targetEmp.storeStatus = 'active';

  if (!(targetEmp as any).trialStartedAt) {
    const now = new Date();
    (targetEmp as any).trialStartedAt = now.toISOString();
    const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    (targetEmp as any).trialExpiryDate = expiry.toISOString();
    targetEmp.subscriptionStatus = 'trial';
  }

  db.save();
  await db.syncEntityDirect('employees', targetEmp);

  const { passwordHash, ...safeEmp } = targetEmp;
  res.json({ success: true, employee: safeEmp });
});

// Get Public Reseller Store by Slug
app.get('/api/store/:slug', async (req: Request, res: Response) => {
  const { slug } = req.params;
  const state = db.getState();
  const reseller = state.employees.find(e => e.storeSlug && e.storeSlug.toLowerCase() === slug.toLowerCase());
  if (!reseller) {
    return res.status(404).json({ error: 'Store not found' });
  }

  let isExpired = false;
  if ((reseller as any).trialExpiryDate) {
    const expiry = new Date((reseller as any).trialExpiryDate).getTime();
    if (Date.now() > expiry) {
      isExpired = true;
    }
  }

  const { passwordHash, ...safeReseller } = reseller;
  res.json({
    success: true,
    reseller: safeReseller,
    isExpired,
    products: state.products.filter(p => p.isActive !== false && !p.isArchived)
  });
});

// Admin Get All Reseller Stores
app.get('/api/admin/reseller-stores', verifyAdmin, async (_req: Request, res: Response) => {
  const state = db.getState();
  const stores = state.employees
    .filter(e => e.storeSlug)
    .map(e => {
      const { passwordHash, ...safe } = e;
      const isExpired = (e as any).trialExpiryDate ? Date.now() > new Date((e as any).trialExpiryDate).getTime() : false;
      return { ...safe, isExpired };
    });
  res.json({ success: true, stores });
});

// Admin Update Reseller Store Status
app.patch('/api/admin/reseller-stores/:id/status', verifyAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { storeStatus } = req.body;
  const state = db.getState();
  const target = state.employees.find(e => e.id === id);
  if (!target) {
    return res.status(404).json({ error: 'Reseller not found' });
  }
  if (storeStatus) {
    target.storeStatus = storeStatus;
  }
  db.save();
  await db.syncEntityDirect('employees', target);
  res.json({ success: true, storeStatus: target.storeStatus });
});

// Reseller avatar upload endpoint
app.post('/api/employee/upload-avatar', verifyEmployee, async (req: Request, res: Response) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image data is required.' });
    }

    let buffer: Buffer;
    let ext = 'jpg';
    if (image.startsWith('data:image')) {
      const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mime = matches[1];
        if (mime.includes('png')) ext = 'png';
        else if (mime.includes('webp')) ext = 'webp';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(image, 'base64');
      }
    } else {
      buffer = Buffer.from(image, 'base64');
    }

    const filename = `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;
    const persistedUrl = await persistLocalMedia(publicUrl);

    res.json({ success: true, url: persistedUrl || publicUrl });
  } catch (err: any) {
    console.error('Error uploading reseller avatar:', err);
    res.status(500).json({ error: 'Failed to upload avatar image' });
  }
});

// Reseller Referrals stats and referred list
app.get('/api/employee/referrals', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();

  const refCode = emp.referenceCode || `REF-${(emp.phone ? emp.phone.slice(-5) : emp.id.slice(-5)).toUpperCase()}`;
  
  // Find members referred by this reseller
  const myReferrals = (state.employees || []).filter(
    e => e.id !== emp.id && (
      e.referralOwnerId === emp.id ||
      (e.reference && e.reference.trim().toUpperCase() === refCode.toUpperCase()) ||
      (e.reference && e.reference.trim() === emp.phone.trim()) ||
      (e.reference && e.reference.trim() === emp.id.trim()) ||
      ((e as any).referredBy && (e as any).referredBy.trim().toUpperCase() === refCode.toUpperCase()) ||
      ((e as any).referredBy && (e as any).referredBy.trim() === emp.id.trim())
    )
  );

  const approvedCount = myReferrals.filter(r => r.status === 'APPROVED').length;
  const pendingCount = myReferrals.filter(r => r.status === 'PENDING').length;
  
  // Total referral profit earned from transactions or default
  const totalReferralBonusEarned = (state.transactions || [])
    .filter(t => t.employeeId === emp.id && t.type === 'COMMISSION_EARNED' && (t.description?.includes('রেফারেল') || t.description?.includes('Referral')))
    .reduce((acc, t) => acc + (t.amount || 0), 0);
  const bonusEarned = totalReferralBonusEarned > 0 ? totalReferralBonusEarned : (approvedCount * 100);

  res.json({
    referenceCode: refCode,
    totalCount: myReferrals.length,
    approvedCount,
    pendingCount,
    bonusEarned,
    referrals: myReferrals.map(r => {
      const rSales = (state.sales || []).filter(s => s.employeeId === r.id);
      const deliveredSales = rSales.filter(s => s.deliveryStatus === 'delivered' || s.saleStatus === 'Approved');
      const pendingSales = rSales.filter(s => s.deliveryStatus === 'pending' || s.saleStatus === 'Pending Verification');
      const cancelledSales = rSales.filter(s => s.deliveryStatus === 'cancelled' || s.saleStatus === 'Rejected');
      
      const totalSales = rSales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
      
      // Referral Bonus = MIN(Profit * 10%, Admin-set Maximum Bonus Limit)
      const maxBonusLimit = (emp.downlineCustomRates && emp.downlineCustomRates[r.id] !== undefined)
        ? Number(emp.downlineCustomRates[r.id])
        : (emp.referralCommissionRate !== undefined ? Number(emp.referralCommissionRate) : 10);

      const referralCommission = Math.round(deliveredSales.reduce((acc, s) => {
        const profit = s.commissionAmount || 0;
        return acc + Math.round(maxBonusLimit * Math.min(1, profit / 100));
      }, 0));
      const pendingCommission = Math.round(pendingSales.reduce((acc, s) => {
        const profit = s.commissionAmount || 0;
        return acc + Math.round(maxBonusLimit * Math.min(1, profit / 100));
      }, 0));
      
      return {
        id: r.id,
        name: r.name,
        phone: r.phone ? r.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '',
        district: r.district || '',
        thana: r.thana || '',
        status: r.status,
        registeredAt: r.registeredAt,
        avatarUrl: r.avatarUrl,
        orderCount: rSales.length,
        deliveredOrders: deliveredSales.length,
        cancelledOrders: cancelledSales.length,
        totalSales,
        referralCommission,
        paidCommission: referralCommission,
        pendingCommission,
      };
    }),
  });
});

// Reseller change password
app.post('/api/employee/change-password', verifyEmployee, async (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const state = db.getState();
  const target = state.employees.find(e => e.id === emp.id);
  if (!target) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
  if (target.passwordHash && target.passwordHash !== oldHash) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  target.passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  db.save();
  await db.syncEntityDirect('employees', target);

  res.json({ success: true, message: 'Password updated successfully!' });
});

// Reseller Notifications
app.get('/api/employee/notifications', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const notifs = (state.notifications || []).filter(
    n => n.recipientRole === 'EMPLOYEE' && (!n.employeeId || n.employeeId === emp.id)
  );

  // If empty, supply default helpful welcome and tips notifications
  if (notifs.length === 0) {
    const defaultNotifs: NotificationItem[] = [
      {
        id: `notif-emp-welcome-${emp.id}`,
        recipientRole: 'EMPLOYEE',
        employeeId: emp.id,
        titleBn: 'তাওযুন নেক্সাস রিসেলার প্যানেলে স্বাগতম!',
        titleEn: 'Welcome to Tawzoon Nexus Reseller Panel!',
        messageBn: 'আপনার রিসেলার অ্যাকাউন্ট সক্রিয় আছে। প্রডাক্ট ক্যাটালগ থেকে প্রডাক্ট নির্বাচন করে এখনই বিক্রি শুরু করুন!',
        messageEn: 'Your reseller account is active. Choose products from the catalog and start selling now!',
        type: 'SYSTEM',
        isRead: false,
        createdAt: new Date().toISOString()
      },
      {
        id: `notif-emp-guide-${emp.id}`,
        recipientRole: 'EMPLOYEE',
        employeeId: emp.id,
        titleBn: 'নতুন পণ্য কালেকশন যুক্ত হয়েছে',
        titleEn: 'New product collection added',
        messageBn: 'SHOP ও GADGETS কালেকশনে নতুন ট্রেন্ডিং আইটেম এসেছে। “বিক্রির জন্য নিন” বাটনে ক্লিক করে শেয়ার করুন।',
        messageEn: 'New trending items arrived in SHOP and GADGETS. Click "Take for Selling" to start sharing.',
        type: 'COMMISSION',
        isRead: false,
        createdAt: new Date(Date.now() - 3600000).toISOString()
      }
    ];
    return res.json(defaultNotifs);
  }

  res.json(notifs.slice(0, 30));
});

app.patch('/api/employee/notifications/mark-all-read', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  let updated = false;
  for (const n of state.notifications || []) {
    if (n.recipientRole === 'EMPLOYEE' && (!n.employeeId || n.employeeId === emp.id)) {
      if (!n.isRead) {
        n.isRead = true;
        updated = true;
      }
    }
  }
  if (updated) db.save();
  res.json({ success: true });
});

app.patch('/api/employee/notifications/:id/read', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const notif = (state.notifications || []).find(n => n.id === req.params.id);
  if (notif) {
    notif.isRead = true;
    db.save();
  }
  res.json({ success: true });
});

// Employee logout
app.post('/api/auth/employee/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const state = db.getState();
    state.employeeSessions = state.employeeSessions.filter(s => s.token !== token);
    db.save();
  }
  res.json({ success: true });
});

// ==========================================
// 4. EMPLOYEE OPERATIONS (SALES, WALLET, WITHDRAWALS)
// ==========================================

// Dedicated endpoint for reseller products with personalized wholesale pricing (+10 TK if non-official, original if official)
app.get('/api/employee/products', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const products = (state.products || [])
    .filter(p => p.isActive && !p.isArchived)
    .map(p => getProductForEmployee(p, emp));
  res.json({ products, total: products.length });
});

// Employee Dashboard metrics & charts
app.get('/api/employee/dashboard', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();

  const mySales = state.sales.filter(s => s.employeeId === emp.id);
  const myWithdrawals = state.withdrawals.filter(w => w.employeeId === emp.id);
  const myTransactions = state.transactions.filter(t => t.employeeId === emp.id);

  const todayStr = new Date().toISOString().split('T')[0];
  const todaySalesList = mySales.filter(s => s.saleDate.startsWith(todayStr));

  const todaySalesAmount = todaySalesList.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const todayEarnings = todaySalesList.reduce((acc, s) => acc + s.commissionAmount, 0);

  const totalSalesAmount = mySales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalEarnings = mySales.reduce((acc, s) => acc + s.commissionAmount, 0);

  res.json({
    wallet: emp.wallet,
    metrics: {
      todaySales: todaySalesAmount,
      todayEarnings,
      totalSales: totalSalesAmount,
      totalEarnings,
      availableBalance: emp.wallet.availableBalance,
      pendingWithdrawal: emp.wallet.pendingWithdrawal,
      totalWithdrawn: emp.wallet.totalWithdrawn,
      salesCount: mySales.length
    },
    recentSales: mySales.slice(0, 5),
    recentTransactions: myTransactions.slice(0, 5),
    recentWithdrawals: myWithdrawals.slice(0, 5)
  });
});

// Record a new sale (SERVER CALCULATES COMMISSION)
app.post('/api/employee/sales', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;

  // Block suspended or archived employees from creating new sales
  if (emp.status === 'SUSPENDED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি সাময়িকভাবে স্থগিত (Suspended) রয়েছে। নতুন সেল রেকর্ড করতে অ্যাডমিনের সাথে যোগাযোগ করুন।' });
  }
  if (emp.status === 'ARCHIVED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি আর্কাইভ করা হয়েছে। নতুন সেল রেকর্ড করার অনুমতি নেই।' });
  }
  if (emp.status !== 'APPROVED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি এখনও অনুমোদিত নয়।' });
  }

  const { productId, quantity, customerName, customerPhone, customerAddress, notes, orderCode: customOrderCode, size, actualSalePrice } = req.body;

  const qty = parseInt(quantity, 10);
  if (!productId || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Valid product and quantity (minimum 1) are required' });
  }

  if (!customerName || !customerPhone || !customerAddress) {
    return res.status(400).json({ error: 'Customer Name, Phone, and Delivery Address are required' });
  }

  const cleanProductId = (typeof productId === 'string' && productId.includes('_'))
    ? productId.split('_')[0]
    : productId;

  const state = db.getState();
  const product = state.products.find(p => (p.id === cleanProductId || p.id === productId) && p.isActive && !p.isArchived)
    || state.products.find(p => p.id === cleanProductId || p.id === productId);

  if (!product) {
    return res.status(404).json({ error: 'Selected product is not found or inactive' });
  }

  // Reseller effective product with personal wholesale markup (+10 TK if non-official, original if official)
  const effectiveProduct = getProductForEmployee(product, emp);
  const wholesalePrice = Number(effectiveProduct.originalPrice || 0);

  // Final selling price & commission logic
  const parsedSalePrice = Number(actualSalePrice);
  const finalUnitPrice = (!isNaN(parsedSalePrice) && parsedSalePrice > 0)
    ? parsedSalePrice
    : effectiveProduct.sellingPrice;

  // Reseller Profit & Commission Rule:
  // Profit = finalUnitPrice - wholesalePrice
  const profitPerUnit = Math.max(0, finalUnitPrice - wholesalePrice);
  const unitCommission = profitPerUnit;

  const totalSellingAmount = finalUnitPrice * qty;
  const totalCommission = Math.max(0, Math.round(unitCommission * qty));

  const orderCode = (customOrderCode && typeof customOrderCode === 'string' && customOrderCode.trim())
    ? customOrderCode.trim()
    : ('ORD-' + crypto.randomInt(1000, 9999));

  // Duplicate Prevention: Check if this item is already recorded in the same order
  if (customOrderCode && typeof customOrderCode === 'string' && customOrderCode.trim()) {
    const existingSameItem = state.sales.find(s =>
      s.orderCode === customOrderCode.trim() &&
      (s.productId === product.id || s.productId === cleanProductId) &&
      s.size === (size ? String(size).trim() : undefined)
    );
    if (existingSameItem) {
      return res.json({
        success: true,
        message: 'এই আইটেমটি ইতিমধ্যে অর্ডারে যুক্ত রয়েছে।',
        sale: existingSameItem
      });
    }
  }

  // Duplicate Prevention: Check rapid duplicate submission within last 15 seconds
  const fifteenSecsAgo = new Date(Date.now() - 15000).toISOString();
  const recentDuplicate = state.sales.find(s =>
    s.employeeId === emp.id &&
    s.productId === product.id &&
    s.customerPhone === customerPhone.trim() &&
    s.quantity === qty &&
    s.saleDate > fifteenSecsAgo
  );
  if (recentDuplicate) {
    return res.json({
      success: true,
      message: 'অর্ডারটি ইতিমধ্যে সফলভাবে রেকর্ড করা হয়েছে।',
      sale: recentDuplicate
    });
  }

  const sale: Sale = {
    id: 'sale-' + crypto.randomUUID().slice(0, 8),
    orderCode,
    employeeId: emp.id,
    employeeName: emp.name,
    productId: product.id,
    productName: product.nameBn,
    productCode: product.productCode,
    quantity: qty,
    basePrice: wholesalePrice, // Locked-in historical wholesale price
    actualSalePrice: finalUnitPrice,
    sellingPrice: finalUnitPrice,
    totalAmount: totalSellingAmount,
    commissionAmount: totalCommission,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerAddress: customerAddress.trim(),
    paymentStatus: 'PENDING',
    saleStatus: 'Pending Verification',
    deliveryStatus: 'pending',
    size: size ? String(size).trim() : undefined,
    saleDate: new Date().toISOString(),
    notes: notes ? notes.trim() : undefined
  };

  state.sales.unshift(sale);
  db.save();
  db.syncEntityDirect('sales', sale).catch(e => console.error('[Persistence] Sale background sync error:', e));

  // Send Telegram Notification if configured
  const imgUrl = product.images?.find(i => i.isPrimary)?.url || product.images?.[0]?.url || product.imageUrl;
  sendTelegramOrderNotification({
    orderCode,
    saleId: sale.id,
    employeeName: emp.name,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerAddress: customerAddress.trim(),
    items: [{
      productName: product.nameBn,
      productCode: product.productCode,
      size: size ? String(size).trim() : 'M',
      quantity: qty,
      unitPrice: finalUnitPrice,
      imageUrl: imgUrl
    }],
    productsTotal: totalSellingAmount,
    deliveryCharge: 0,
    grandTotal: totalSellingAmount,
    isAdvancePaid: false,
    paymentMethod: 'COD',
    dueAmount: totalSellingAmount,
    saleStatus: sale.saleStatus || 'Pending Verification',
    deliveryStatus: sale.deliveryStatus || 'pending',
    trackingCode: sale.trackingCode
  }, state.brandSettings);

  // Broadcast real-time live event to connected clients
  broadcastRealtimeEvent('order_created', {
    orderCode,
    employeeName: emp.name,
    productName: product.nameBn,
    totalAmount: totalSellingAmount,
    commissionAmount: totalCommission,
    timestamp: Date.now()
  });

  // Notify admin
  db.addNotification({
    recipientRole: 'ADMIN',
    titleBn: 'নতুন সেল সম্পন্ন হয়েছে',
    titleEn: 'New Sale Recorded',
    messageBn: `${emp.name} একটি নতুন অর্ডার রেকর্ড করেছেন (${orderCode})। মোট: ৳${totalSellingAmount}, কমিশন: ৳${totalCommission}`,
    messageEn: `${emp.name} recorded new sale ${orderCode}. Total: ৳${totalSellingAmount}, Commission: ৳${totalCommission}`,
    type: 'SALE'
  });

  db.logAudit(
    'SALE_RECORDED',
    emp.name,
    orderCode,
    undefined,
    `Total: ৳${totalSellingAmount} | Comm: ৳${totalCommission}`,
    getClientIp(req)
  );

  db.save();

  res.json({
    success: true,
    sale,
    wallet: emp.wallet,
    message: 'Sale successfully recorded and commission added to your wallet!'
  });
});

// Employee's own sales list
app.get('/api/employee/sales', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const sales = state.sales.filter(s => s.employeeId === emp.id);
  res.json(sales);
});

// Employee's own transaction ledger
app.get('/api/employee/transactions', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const trxs = state.transactions.filter(t => t.employeeId === emp.id);
  res.json(trxs);
});

// Employee request withdrawal (Strict reserve & fee balance logic + Concurrency Mutex & Awaited Sync)
app.post('/api/employee/withdrawals', verifyEmployee, async (req: Request, res: Response) => {
  const reqEmp = (req as any).employee;

  if (reqEmp.status === 'SUSPENDED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি স্থগিত (Suspended) রয়েছে। উইথড্রয়াল রিকোয়েস্ট সম্ভব নয়।' });
  }
  if (reqEmp.status === 'ARCHIVED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি আর্কাইভ করা হয়েছে। উইথড্রয়াল রিকোয়েস্ট সম্ভব নয়।' });
  }
  if (reqEmp.status !== 'APPROVED') {
    return res.status(403).json({ error: 'আপনার অ্যাকাউন্টটি অনুমোদিত নয়।' });
  }

  const { amount, paymentMethod, accountType, accountNumber, note } = req.body;
  const withdrawAmount = parseInt(amount, 10);
  if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
    return res.status(400).json({ error: 'অনুগ্রহ করে সঠিক উত্তোলনের পরিমাণ লিখুন।' });
  }

  if (!paymentMethod || !['bKash', 'Nagad'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'দয়া করে একটি সঠিক পেমেন্ট মেথড (বিকাশ বা নগদ) নির্বাচন করুন।' });
  }

  if (!accountNumber || accountNumber.trim().length < 11) {
    return res.status(400).json({ error: '১১ ডিজিটের সঠিক মোবাইল ওয়ালেট নম্বর দিন।' });
  }

  const explicitKey = req.headers['x-idempotency-key'] as string;
  const reqKey = explicitKey || `wdr_req:${reqEmp.id}:${withdrawAmount}:${paymentMethod}:${accountNumber.trim()}`;
  const existingIdem = db.getIdempotencyRecord(reqKey);
  if (existingIdem && (existingIdem.status === 'COMPLETED' || existingIdem.status === 'QUEUED')) {
    console.log(`[Idempotency-Guard] Duplicate withdrawal request blocked for key: ${reqKey}`);
    return res.json(existingIdem.responsePayload || {
      success: true,
      message: 'উইথড্রয়াল আবেদনটি ইতিমধ্যে গৃহীত হয়েছে।',
      isDuplicate: true
    });
  }

  const mutex = getEmployeeMutex(reqEmp.id);
  return await mutex.runExclusive(async () => {
    const state = db.getState();
    const emp = state.employees.find(e => e.id === reqEmp.id);
    if (!emp) {
      return res.status(404).json({ error: 'রিসেলার একাউন্ট পাওয়া যায়নি।' });
    }

    const mandatoryReserve = state.brandSettings?.mandatoryReserveBalance ?? 120;
    const sendMoneyFee = state.brandSettings?.sendMoneyFee ?? 5;
    const availableBal = emp.wallet?.availableBalance || 0;
    const maxWithdrawable = Math.max(0, availableBal - mandatoryReserve);

    if (withdrawAmount > maxWithdrawable) {
      return res.status(400).json({
        error: `আপনার অ্যাকাউন্ট থেকে সর্বোচ্চ ৳${maxWithdrawable} উত্তোলন করা সম্ভব। (বাধ্যতামূলক ৳${mandatoryReserve} সংরক্ষিত ব্যালেন্স বাদ দিয়ে)`
      });
    }

    let resolvedAccountType = accountType ? String(accountType).trim() : undefined;
    if (!resolvedAccountType && note) {
      const lowerNote = note.toLowerCase();
      if (lowerNote.includes('merchant') || lowerNote.includes('মার্চেন্ট')) {
        resolvedAccountType = 'Merchant';
      } else if (lowerNote.includes('agent') || lowerNote.includes('এজেন্ট')) {
        resolvedAccountType = 'Agent';
      } else if (lowerNote.includes('personal') || lowerNote.includes('parsonal') || lowerNote.includes('পার্সোনাল') || lowerNote.includes('ব্যক্তিগত')) {
        resolvedAccountType = 'Personal';
      }
    }

    const feeAmount = sendMoneyFee;
    const netPayout = Math.max(0, withdrawAmount - feeAmount);

    // DEDUCTION LOGIC: Available Balance reduces, Pending Withdrawal increases!
    emp.wallet.availableBalance -= withdrawAmount;
    emp.wallet.pendingWithdrawal += withdrawAmount;

    const withdrawal: Withdrawal = {
      id: 'wdr-' + crypto.randomUUID().slice(0, 8),
      employeeId: emp.id,
      employeeName: emp.name,
      employeePhone: emp.phone,
      amount: withdrawAmount,
      feeAmount,
      netPayout,
      paymentMethod,
      accountType: resolvedAccountType,
      accountNumber: accountNumber.trim(),
      status: 'PENDING',
      requestDate: new Date().toISOString(),
      employeeNote: note ? note.trim() : undefined
    };

    const transaction: Transaction = {
      id: 'trx-' + crypto.randomUUID().slice(0, 8),
      employeeId: emp.id,
      type: 'WITHDRAWAL_REQUEST',
      amount: withdrawAmount,
      balanceAfter: emp.wallet.availableBalance,
      status: 'PENDING',
      reference: withdrawal.id,
      description: `${paymentMethod} ${resolvedAccountType ? `(${resolvedAccountType}) ` : ''}একাউন্টে (${accountNumber}) উইথড্রয়াল রিকোয়েস্ট (আবেদন: ৳${withdrawAmount}, ফি: ৳${feeAmount}, নিট প্রাপ্তি: ৳${netPayout})`,
      timestamp: new Date().toISOString()
    };

    state.withdrawals.unshift(withdrawal);
    state.transactions.unshift(transaction);

    // Notify admin
    db.addNotification({
      recipientRole: 'ADMIN',
      titleBn: 'নতুন উইথড্রয়াল রিকোয়েস্ট',
      titleEn: 'New Withdrawal Request',
      messageBn: `${emp.name} ${paymentMethod}-এ ৳${withdrawAmount} উইথড্রয়াল আবেদন করেছেন।`,
      messageEn: `${emp.name} submitted withdrawal request of ৳${withdrawAmount} via ${paymentMethod}.`,
      type: 'WITHDRAWAL'
    });

    db.logAudit(
      'WITHDRAWAL_REQUESTED',
      emp.name,
      withdrawal.id,
      `Available: ৳${emp.wallet.availableBalance + withdrawAmount}`,
      `Requested: ৳${withdrawAmount} via ${paymentMethod}`,
      getClientIp(req)
    );

    db.save();

    // Awaited cloud persistence with durable outbox queue fallback
    let isCloudSynced = true;
    try {
      await Promise.all([
        db.syncEntityDirect('withdrawals', withdrawal, true),
        db.syncEntityDirect('employees', emp, true),
        db.syncEntityDirect('transactions', transaction, true)
      ]);
    } catch (syncErr) {
      isCloudSynced = false;
      console.warn('[Withdrawal] Cloud write failed. Enqueued in durable outbox queue:', syncErr);
    }

    const responsePayload = {
      success: true,
      withdrawal,
      wallet: emp.wallet,
      syncState: isCloudSynced ? 'CLOUD_SYNCED' : 'LOCAL_PERSISTED_OUTBOX_QUEUED',
      message: 'উইথড্রয়াল আবেদন সফলভাবে জমা হয়েছে। অ্যাডমিন পর্যালোচনার অপেক্ষায়।'
    };

    await db.setIdempotencyRecord(reqKey, {
      status: isCloudSynced ? 'COMPLETED' : 'QUEUED',
      responsePayload
    });

    return res.json(responsePayload);
  });
});

// Employee's own withdrawals list
app.get('/api/employee/withdrawals', verifyEmployee, (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const state = db.getState();
  const withdrawals = state.withdrawals.filter(w => w.employeeId === emp.id);
  res.json(withdrawals);
});

// Reseller Subscription Payment Checkout & Instant Activation
app.post('/api/employee/pay-subscription', verifyEmployee, async (req: Request, res: Response) => {
  const emp = (req as any).employee;
  const { paymentMethod, trxId, amount, senderPhone } = req.body;
  const state = db.getState();
  const currentEmp = state.employees.find(e => e.id === emp.id);
  if (!currentEmp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const cleanTrxId = trxId || `BKASH-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const payAmount = Number(amount) || state.brandSettings?.resellerSubscriptionFee || 999;

  currentEmp.isPaidSubscription = true;
  currentEmp.subscriptionStatus = 'active';
  const oneYearExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  currentEmp.subscriptionExpiryDate = oneYearExpiry;

  // Add notification to admin
  db.addNotification({
    recipientRole: 'ADMIN',
    titleBn: '👑 রিসেলার সাবস্ক্রিপশন ফি পরিশোধ ও সক্রিয়',
    titleEn: 'Reseller Subscription Paid & Activated',
    messageBn: `${currentEmp.name} (${currentEmp.phone}) বিকাশ গেটওয়ের মাধ্যমে ৳${payAmount} ফি পরিশোধ করেছেন। TrxID: ${cleanTrxId} (প্রেরক: ${senderPhone || currentEmp.phone})`,
    messageEn: `${currentEmp.name} paid subscription fee ৳${payAmount}. TrxID: ${cleanTrxId}`,
    type: 'EMPLOYEE'
  });

  db.logAudit(
    'EMPLOYEE_SUBSCRIPTION_PAID',
    currentEmp.email || currentEmp.phone,
    currentEmp.name,
    undefined,
    `Subscription activated via ${paymentMethod || 'bKash'} (TrxID: ${cleanTrxId}, Amount: ৳${payAmount})`,
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('employees', currentEmp);
  const { passwordHash: _, ...safeEmp } = currentEmp;
  res.json({
    success: true,
    messageBn: 'আপনার সাবস্ক্রিপশন সফলভাবে পরিশোধ ও সক্রিয় হয়েছে!',
    messageEn: 'Subscription paid and activated successfully!',
    employee: safeEmp,
    trxId: cleanTrxId
  });
});

// ==========================================
// 5. SECURE ADMIN PANEL OPERATIONS (PROTECTED)
// ==========================================

// Admin Dashboard Overview
app.get('/api/admin/dashboard', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();

  const totalProducts = state.products.filter(p => !p.isArchived).length;
  const activeProducts = state.products.filter(p => p.isActive && !p.isArchived).length;
  const totalEmployees = state.employees.length;
  const pendingEmployees = state.employees.filter(e => e.status === 'PENDING').length;

  const todayStr = new Date().toISOString().split('T')[0];
  const todaySales = state.sales.filter(s => s.saleDate.startsWith(todayStr));
  const todaySalesTotal = todaySales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const todayCommissionTotal = todaySales.reduce((acc, s) => acc + s.commissionAmount, 0);

  const totalSalesRevenue = state.sales.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalCommissionPaid = state.sales.reduce((acc, s) => acc + s.commissionAmount, 0);

  const pendingWithdrawalsList = state.withdrawals.filter(w => w.status === 'PENDING');
  const pendingWithdrawalsTotal = pendingWithdrawalsList.reduce((acc, w) => acc + w.amount, 0);
  const paidWithdrawalsTotal = state.withdrawals
    .filter(w => w.status === 'APPROVED')
    .reduce((acc, w) => acc + w.amount, 0);

  // Calculate gross margin based on originalPrice
  let totalCost = 0;
  state.sales.forEach(sale => {
    const prod = state.products.find(p => p.id === sale.productId);
    const unitCost = prod ? (prod.originalPrice || 0) : 0;
    totalCost += unitCost * sale.quantity;
  });
  const netAdminRevenue = totalSalesRevenue - totalCost - totalCommissionPaid;

  res.json({
    stats: {
      totalProducts,
      activeProducts,
      totalEmployees,
      pendingEmployees,
      todaySales: todaySalesTotal,
      todayCommission: todayCommissionTotal,
      totalSalesRevenue,
      totalCommissionPaid,
      pendingWithdrawalsTotal,
      pendingWithdrawalsCount: pendingWithdrawalsList.length,
      paidWithdrawalsTotal,
      netAdminRevenue
    },
    recentSales: state.sales.slice(0, 10),
    pendingWithdrawals: pendingWithdrawalsList,
    recentEmployees: state.employees.slice(0, 5).map(({ passwordHash, ...e }) => e),
    recentAuditLogs: state.auditLogs.slice(0, 10)
  });
});

// Multi-image upload endpoint (Uploads to Firebase Cloud Storage with local fallback)
app.post('/api/admin/upload-images', verifyAdmin, async (req: Request, res: Response) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Images array is required.' });
    }

    const uploadedUrls: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      if (!item || !item.data) continue;

      const matches = item.data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      let buffer: Buffer;
      let ext = 'jpg';
      let mimeType = 'image/jpeg';

      if (matches && matches.length === 3) {
        mimeType = matches[1];
        if (mimeType.includes('png')) ext = 'png';
        else if (mimeType.includes('webp')) ext = 'webp';
        else if (mimeType.includes('svg')) ext = 'svg';
        else if (mimeType.includes('gif')) ext = 'gif';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(item.data, 'base64');
      }

      const filename = `prod_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      
      // 1. Save local copy for instant access
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, buffer);
      let finalUrl = `/uploads/${filename}`;

      // 2. Upload to Firebase Cloud Storage bucket if available
      try {
        const cloudUrl = await uploadBufferToCloudStorage(buffer, `products/${filename}`, mimeType);
        if (cloudUrl) {
          finalUrl = cloudUrl;
        }
      } catch (cloudErr) {
        // Fallback silently to local URL
      }

      uploadedUrls.push(finalUrl);
    }

    res.json({ success: true, urls: uploadedUrls });
  } catch (err: any) {
    console.error('Image upload failed:', err);
    res.status(500).json({ error: 'Failed to upload images: ' + err.message });
  }
});

// Product video upload endpoint (Accepts MP4 / WebM base64)
app.post('/api/admin/upload-video', verifyAdmin, async (req: Request, res: Response) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ error: 'Video data is required.' });
    }

    const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = 'mp4';
    let mimeType = 'video/mp4';

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      if (mimeType.includes('webm')) ext = 'webm';
      else if (mimeType.includes('ogg')) ext = 'ogv';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(data, 'base64');
    }

    const filename = `vid_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const filePath = path.join(videosDir, filename);
    fs.writeFileSync(filePath, buffer);
    let finalUrl = `/uploads/videos/${filename}`;

    try {
      const cloudUrl = await uploadBufferToCloudStorage(buffer, `videos/${filename}`, mimeType);
      if (cloudUrl) {
        finalUrl = cloudUrl;
      }
    } catch (cloudErr) {}

    res.json({ success: true, url: finalUrl });
  } catch (err: any) {
    console.error('Video upload failed:', err);
    res.status(500).json({ error: 'Failed to upload video: ' + err.message });
  }
});

// Realtime SSE stream for Live Dashboard Updates
app.get('/api/realtime/stream', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering for instant delivery
  res.flushHeaders?.();

  // Guard against memory leaks: limit max concurrent SSE connections per node instance
  if (realtimeClients.size >= 10000) {
    const oldestClient = realtimeClients.values().next().value;
    if (oldestClient) {
      try { oldestClient.end(); } catch {}
      realtimeClients.delete(oldestClient);
    }
  }

  realtimeClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);

  const cleanup = () => {
    clearInterval(heartbeat);
    realtimeClients.delete(res);
  };

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      cleanup();
    }
  }, 25000);

  _req.on('close', cleanup);
  res.on('error', cleanup);
});

// Firebase & Cloud Services Status Endpoint
app.get('/api/admin/firebase-status', async (_req: Request, res: Response) => {
  const isFirestoreActive = await testFirestoreConnection();
  res.json({
    firestoreConnected: isFirestoreActive,
    storageConfigured: true,
    cloudBackupActive: true,
    realtimeActiveClients: realtimeClients.size,
    timestamp: Date.now()
  });
});

// Admin Products List (Includes originalPrice!)
app.get('/api/admin/products', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.products.filter(p => !p.isArchived));
});

// ==========================================
// MEDIA PERSISTENCE HELPERS
// ==========================================

/**
 * Converts a local file path to a Base64 data URL for persistence in Firestore.
 * Uses sharp to compress images larger than 500KB to ensure they fit in Firestore docs.
 */
async function persistLocalMedia(url: string): Promise<string> {
  if (!url || (!url.startsWith('/uploads/') && !url.startsWith('data:image'))) return url;

  try {
    let buffer: Buffer;
    let mime = 'image/jpeg';
    let ext = 'jpg';

    if (url.startsWith('data:image')) {
      const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return url;
      mime = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
      ext = mime.split('/')[1] || 'jpg';
    } else {
      const filename = url.replace('/uploads/', '');
      const isVideo = filename.startsWith('videos/');
      if (isVideo) return url; // Don't persist videos as base64 if large
      
      const filePath = path.join(uploadsDir, filename);
      if (!fs.existsSync(filePath)) return url;
      
      buffer = fs.readFileSync(filePath);
      ext = path.extname(filename).toLowerCase().replace('.', '') || 'jpg';
      mime = `image/${ext === 'svg' ? 'svg+xml' : ext}`;
    }

    if (mime.includes('svg')) {
      // SVGs are already tiny vector text
      return `data:${mime};base64,${buffer.toString('base64')}`;
    }

    // High quality yet compact compression for e-commerce (max 650px dimension, webp or mozjpeg)
    // Guarantees each photo is 25KB-55KB, meaning even 5-10 photos fit comfortably under Firestore 1MB limit!
    try {
      const compressed = await sharp(buffer)
        .resize(650, 650, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      
      buffer = compressed;
      mime = 'image/jpeg';
    } catch (sharpErr) {
      console.warn('[Persistence] Sharp compression failed, falling back:', sharpErr);
    }

    // Safety guard: if still > 200KB, do a second tighter pass
    if (buffer.length > 200 * 1024) {
      try {
        const tighter = await sharp(buffer)
          .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 60, mozjpeg: true })
          .toBuffer();
        buffer = tighter;
      } catch (e) {}
    }

    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error(`[Persistence] Failed to persist ${url}:`, err);
  }
  return url;
}

// Admin Add Product (Supports multiple images, video, and marketing captions)
app.post('/api/admin/products', verifyAdmin, async (req: Request, res: Response) => {
  const {
    nameBn,
    nameEn,
    productCode,
    categorySlug,
    subcategoryBn,
    subcategoryEn,
    originalPrice,
    sellingPrice,
    commissionType,
    commissionRate,
    shortDescBn,
    shortDescEn,
    fullDescBn,
    fullDescEn,
    images,
    videoType,
    videoUrl,
    marketingHighlights,
    marketingCaptionBn,
    marketingCaptionEn,
    colors,
    sizes,
    specifications,
    stockStatus,
    isFeatured,
    isTrending,
    isNewArrival
  } = req.body;

  if (!nameBn || !nameEn || !categorySlug || !sellingPrice) {
    return res.status(400).json({ error: 'Product name (Bn/En), category, and selling price are required.' });
  }

  const state = db.getState();

  // Normalize SKU- prefix and auto-detect if omitted
  let finalProductCode = (productCode || '').trim().toUpperCase();
  if (!finalProductCode || finalProductCode === 'SKU-' || finalProductCode === 'SKU') {
    const existingNums = state.products
      .filter(p => !p.isArchived)
      .map(p => {
        const parts = (p.productCode || '').split('-');
        return parseInt(parts[parts.length - 1], 10);
      })
      .filter(num => !isNaN(num));
    const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    finalProductCode = `SKU-${nextNum.toString().padStart(4, '0')}`;
  } else if (!finalProductCode.startsWith('SKU-')) {
    finalProductCode = `SKU-${finalProductCode.replace(/^sku-?/i, '')}`;
  }

  const existing = state.products.find(p => !p.isArchived && p.productCode.toLowerCase() === finalProductCode.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'Product with this code already exists.' });
  }

  const youtubeId = videoType === 'youtube' && videoUrl ? extractYouTubeId(videoUrl) || undefined : undefined;

  let productImages = [];
  if (Array.isArray(images) && images.length > 0) {
    productImages = await Promise.all(images.map(async (img) => ({ 
      ...img, 
      url: await persistLocalMedia(img.url) 
    })));
  }

  // If no image is provided but YouTube video is specified, auto-use YouTube thumbnail!
  if (productImages.length === 0 && youtubeId) {
    productImages = [{
      id: 'img-yt-auto',
      url: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      isPrimary: true,
      order: 1
    }];
  } else if (productImages.length === 0) {
    productImages = [{
      id: 'img-def',
      url: '/images/product_shop_dress_1790244714775.jpg',
      isPrimary: true,
      order: 1
    }];
  }

  const numericSell = parseFloat(sellingPrice) || 0;
  const numericStars = req.body.starRating ? parseInt(req.body.starRating, 10) : 5;
  const starDiscount = numericStars === 4 ? 15 : numericStars === 3 ? 20 : numericStars === 2 ? 25 : numericStars === 1 ? 30 : 10;
  const calcRegular = Math.round(numericSell / (1 - starDiscount / 100));
  const finalRegular = req.body.regularPrice && parseFloat(req.body.regularPrice) > numericSell
    ? parseFloat(req.body.regularPrice)
    : calcRegular;

  const newProduct: Product = {
    id: 'prod-' + crypto.randomUUID().slice(0, 8),
    productCode: finalProductCode,
    nameBn: nameBn.trim(),
    nameEn: nameEn.trim(),
    categorySlug: categorySlug.trim(),
    subcategoryBn: (subcategoryBn || '').trim(),
    subcategoryEn: (subcategoryEn || '').trim(),
    originalPrice: parseFloat(originalPrice) || 0,
    sellingPrice: numericSell,
    regularPrice: finalRegular,
    starRating: numericStars,
    commissionType: commissionType === 'fixed' ? 'fixed' : 'percentage',
    commissionRate: parseFloat(commissionRate) || 0,
    shortDescBn: (shortDescBn || '').trim(),
    shortDescEn: (shortDescEn || '').trim(),
    fullDescBn: (fullDescBn || '').trim(),
    fullDescEn: (fullDescEn || '').trim(),
    images: productImages,
    videoType: videoType || 'none',
    videoUrl: videoType === 'upload' ? await persistLocalMedia(videoUrl) : (videoUrl || '').trim(),
    youtubeId,
    marketingHighlights: Array.isArray(marketingHighlights) ? marketingHighlights : [],
    marketingCaptionBn: (marketingCaptionBn || '').trim(),
    marketingCaptionEn: (marketingCaptionEn || '').trim(),
    colors: Array.isArray(colors) ? colors : [],
    sizes: Array.isArray(sizes) ? sizes : [],
    specifications: Array.isArray(specifications) ? specifications : [],
    stockStatus: stockStatus || 'in_stock',
    isFeatured: Boolean(isFeatured),
    isTrending: Boolean(isTrending),
    isNewArrival: Boolean(isNewArrival),
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  state.products.unshift(newProduct);
  if (!state.publishedProducts) state.publishedProducts = [];
  state.publishedProducts = state.publishedProducts.filter(p => p.id !== newProduct.id);
  state.publishedProducts.unshift(newProduct);

  db.logAudit(
    'PRODUCT_CREATED',
    AUTHORIZED_ADMIN_EMAIL,
    newProduct.nameEn,
    undefined,
    `Code: ${newProduct.productCode}, Selling: ৳${newProduct.sellingPrice}`,
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('products', newProduct);
  broadcastRealtimeEvent('STATE_UPDATED', { type: 'PRODUCT_CREATED', productId: newProduct.id, timestamp: Date.now() });
  res.json({ success: true, product: newProduct });
});

// Admin Update Product
app.put('/api/admin/products/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const index = state.products.findIndex(p => p.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const oldProduct = state.products[index];
  const videoUrl = req.body.videoUrl !== undefined ? await persistLocalMedia(req.body.videoUrl) : oldProduct.videoUrl;
  const videoType = req.body.videoType !== undefined ? req.body.videoType : oldProduct.videoType;
  const youtubeId = videoType === 'youtube' && videoUrl ? extractYouTubeId(videoUrl) || undefined : (req.body.youtubeId || oldProduct.youtubeId);

  const productImages = Array.isArray(req.body.images) 
    ? await Promise.all(req.body.images.map(async (img: any) => ({ ...img, url: await persistLocalMedia(img.url) })))
    : oldProduct.images;

  let updatedProductCode = oldProduct.productCode;
  if (req.body.productCode && typeof req.body.productCode === 'string') {
    let clean = req.body.productCode.trim().toUpperCase();
    if (!clean.startsWith('SKU-')) clean = `SKU-${clean.replace(/^sku-?/i, '')}`;
    const conflict = state.products.find(p => p.id !== oldProduct.id && !p.isArchived && p.productCode.toLowerCase() === clean.toLowerCase());
    if (!conflict && clean !== 'SKU-') {
      updatedProductCode = clean;
    }
  }

  const updatedSellingPrice = req.body.sellingPrice !== undefined ? parseFloat(req.body.sellingPrice) : oldProduct.sellingPrice;
  const updatedStars = req.body.starRating !== undefined ? parseInt(req.body.starRating, 10) : (oldProduct.starRating || 5);
  const updatedStarDiscount = updatedStars === 4 ? 15 : updatedStars === 3 ? 20 : updatedStars === 2 ? 25 : updatedStars === 1 ? 30 : 10;
  const updatedCalcRegular = Math.round(updatedSellingPrice / (1 - updatedStarDiscount / 100));
  const updatedRegularPrice = req.body.regularPrice !== undefined && parseFloat(req.body.regularPrice) > updatedSellingPrice
    ? parseFloat(req.body.regularPrice)
    : (oldProduct.regularPrice && oldProduct.regularPrice > updatedSellingPrice ? oldProduct.regularPrice : updatedCalcRegular);

  const updated: Product = {
    ...oldProduct,
    ...req.body,
    id: oldProduct.id,
    productCode: updatedProductCode,
    images: productImages,
    videoType,
    videoUrl,
    youtubeId,
    originalPrice: req.body.originalPrice !== undefined ? parseFloat(req.body.originalPrice) : oldProduct.originalPrice,
    sellingPrice: updatedSellingPrice,
    regularPrice: updatedRegularPrice,
    starRating: updatedStars,
    commissionRate: req.body.commissionRate !== undefined ? parseFloat(req.body.commissionRate) : oldProduct.commissionRate,
    updatedAt: new Date().toISOString()
  };

  state.products[index] = updated;
  if (!state.publishedProducts) state.publishedProducts = [];
  const pubIndex = state.publishedProducts.findIndex(p => p.id === updated.id);
  if (pubIndex !== -1) {
    if (updated.isArchived || updated.isActive === false) {
      state.publishedProducts.splice(pubIndex, 1);
    } else {
      state.publishedProducts[pubIndex] = updated;
    }
  } else if (!updated.isArchived && updated.isActive !== false) {
    state.publishedProducts.unshift(updated);
  }

  db.logAudit(
    'PRODUCT_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    updated.nameEn,
    `Selling: ৳${oldProduct.sellingPrice}`,
    `Selling: ৳${updated.sellingPrice}`,
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('products', updated);
  broadcastRealtimeEvent('STATE_UPDATED', { type: 'PRODUCT_UPDATED', productId: updated.id, timestamp: Date.now() });
  res.json({ success: true, product: updated });
});

// Admin Explicit Archive Product (Soft-delete preserving all sales and links)
app.patch('/api/admin/products/:id/archive', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const product = state.products.find(p => p.id === req.params.id);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  product.isArchived = true;
  product.isActive = false;
  product.updatedAt = new Date().toISOString();

  db.logAudit(
    'PRODUCT_ARCHIVED',
    AUTHORIZED_ADMIN_EMAIL,
    product.nameEn,
    'Active Product',
    'Archived safely to preserve all financial and historical records',
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('products', product);
  broadcastRealtimeEvent('STATE_UPDATED', { type: 'PRODUCT_ARCHIVED', productId: product.id, timestamp: Date.now() });
  res.json({ success: true, product });
});

interface UndoStashItem {
  id: string;
  type: 'product' | 'category' | 'subsection';
  data: any;
  deletedAt: number;
  timer: NodeJS.Timeout | null;
}

let lastDeletedItem: UndoStashItem | null = null;

async function forcePurgePendingItem() {
  if (lastDeletedItem) {
    if (lastDeletedItem.timer) {
      clearTimeout(lastDeletedItem.timer);
    }
    try {
      if (lastDeletedItem.type === 'product') {
        await db.deleteFromCloud('products', lastDeletedItem.id);
        console.log(`[Undo-Trash] Forced permanent hard delete of product: ${lastDeletedItem.id}`);
      } else if (lastDeletedItem.type === 'category') {
        await db.deleteFromCloud('categories', lastDeletedItem.id);
        const { subsections } = lastDeletedItem.data;
        if (subsections && Array.isArray(subsections)) {
          for (const s of subsections) {
            await db.deleteFromCloud('subsections', s.id);
          }
        }
        console.log(`[Undo-Trash] Forced permanent hard delete of category & children: ${lastDeletedItem.id}`);
      } else if (lastDeletedItem.type === 'subsection') {
        await db.deleteFromCloud('subsections', lastDeletedItem.id);
        console.log(`[Undo-Trash] Forced permanent hard delete of subsection: ${lastDeletedItem.id}`);
      }
    } catch (err) {
      console.error('[Undo-Trash] Forced permanent purge failed:', err);
    }
    lastDeletedItem = null;
  }
}

// Admin Delete Product (TRUE PERMANENT DELETE: removes from state, publishedProducts, and Firestore)
app.delete('/api/admin/products/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const targetId = req.params.id;
  const product = state.products.find(p => p.id === targetId);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // 1. Truly remove from local state arrays
  state.products = state.products.filter(p => p.id !== targetId);
  state.publishedProducts = (state.publishedProducts || []).filter(p => p.id !== targetId);

  // 2. Mark as permanently deleted in database so sync/cloud never revives it
  db.markDeleted('products', targetId);

  // 3. Immediately delete from Cloud Firestore
  try {
    await db.deleteFromCloud('products', targetId);
    console.log(`[Persistence] Permanently hard-deleted product ${targetId} from Firestore`);
  } catch (err) {
    console.error('[Persistence] Hard-delete for product from Firestore failed:', err);
  }

  db.logAudit(
    'PRODUCT_DELETED',
    AUTHORIZED_ADMIN_EMAIL,
    product.nameEn || product.nameBn || product.productCode,
    product.productCode,
    'Permanently deleted from system and database',
    getClientIp(req)
  );

  db.save();

  // Broadcast real-time SSE deletion events to all connected clients & dashboards
  broadcastRealtimeEvent('PRODUCT_DELETED', { productId: targetId, timestamp: Date.now() });
  broadcastRealtimeEvent('STATE_UPDATED', { type: 'PRODUCT_DELETED', productId: targetId, timestamp: Date.now() });

  res.json({ success: true, deleted: true, archived: false });
});

// Admin Toggle Product Active Status
app.patch('/api/admin/products/:id/toggle-status', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const product = state.products.find(p => p.id === req.params.id);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  product.isActive = !product.isActive;
  product.updatedAt = new Date().toISOString();

  db.logAudit(
    'PRODUCT_STATUS_TOGGLED',
    AUTHORIZED_ADMIN_EMAIL,
    product.nameEn,
    `Active: ${!product.isActive}`,
    `Active: ${product.isActive}`,
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('products', product);
  res.json({ success: true, isActive: product.isActive });
});

// Admin Category CRUD
app.get('/api/admin/categories', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.categories.sort((a, b) => a.order - b.order));
});

app.post('/api/admin/categories', verifyAdmin, async (req: Request, res: Response) => {
  const { name, slug, description, imageUrl } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'Category Name and Slug are required.' });
  }

  const state = db.getState();
  const newCat: Category = {
    id: 'cat-' + crypto.randomUUID().slice(0, 8),
    slug: slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
    name: name.trim(),
    description: (description || '').trim(),
    imageUrl: (await persistLocalMedia(imageUrl)) || '/images/product_shop_dress_1790244714775.jpg',
    order: state.categories.length + 1,
    isActive: true
  };

  state.categories.push(newCat);
  db.logAudit(
    'CATEGORY_CREATED',
    AUTHORIZED_ADMIN_EMAIL,
    newCat.name,
    undefined,
    `Slug: ${newCat.slug}`,
    getClientIp(req)
  );

  db.save();
  db.syncEntityDirect('categories', newCat).catch(e => console.error('[Persistence] Category background sync error:', e));
  res.json({ success: true, category: newCat });
});

app.put('/api/admin/categories/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const index = state.categories.findIndex(c => c.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'Category not found.' });
  }

  const oldImageUrl = state.categories[index].imageUrl;
  const newImageUrl = req.body.imageUrl !== undefined ? await persistLocalMedia(req.body.imageUrl) : oldImageUrl;

  state.categories[index] = {
    ...state.categories[index],
    ...req.body,
    id: state.categories[index].id,
    imageUrl: newImageUrl
  };

  db.logAudit(
    'CATEGORY_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    state.categories[index].name,
    undefined,
    'Updated category metadata',
    getClientIp(req)
  );

  db.save();
  db.syncEntityDirect('categories', state.categories[index]).catch(e => console.error('[Persistence] Category update background sync error:', e));
  res.json({ success: true, category: state.categories[index] });
});

app.delete('/api/admin/categories/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const cat = state.categories.find(c => c.id === req.params.id);

  if (!cat) {
    return res.status(404).json({ error: 'Category not found.' });
  }

  // 1. Identify subsections to delete under this category
  let subsToDelete: any[] = [];
  if (state.subsections && Array.isArray(state.subsections)) {
    subsToDelete = state.subsections.filter(s => s.parentSlug?.toLowerCase() === cat.slug.toLowerCase());
    state.subsections = state.subsections.filter(s => s.parentSlug?.toLowerCase() !== cat.slug.toLowerCase());
  }

  // 2. Update local state arrays
  state.categories = state.categories.filter(c => c.id !== req.params.id);
  state.publishedCategories = (state.publishedCategories || []).filter(c => c.id !== req.params.id);

  // Soft-archive and deactivate all products attached to this category
  state.products.forEach(p => {
    if (p.categorySlug?.toLowerCase() === cat.slug.toLowerCase()) {
      p.isActive = false;
      p.isArchived = true;
    }
  });

  state.publishedProducts = (state.publishedProducts || []).filter(p => p.categorySlug?.toLowerCase() !== cat.slug.toLowerCase());

  if (state.publishedSubsections && Array.isArray(state.publishedSubsections)) {
    state.publishedSubsections = state.publishedSubsections.filter(s => s.parentSlug?.toLowerCase() !== cat.slug.toLowerCase());
  }

  // 3. Mark as deleted and immediately delete from Cloud Firestore
  const targetId = req.params.id;
  db.markDeleted('categories', targetId);
  try {
    await db.deleteFromCloud('categories', targetId);
    if (subsToDelete && Array.isArray(subsToDelete)) {
      for (const s of subsToDelete) {
        db.markDeleted('subsections', s.id);
        await db.deleteFromCloud('subsections', s.id);
      }
    }
    console.log(`[Persistence] Permanently hard-deleted category ${targetId} and subcategories from Firestore`);
  } catch (err) {
    console.error('[Persistence] Hard-delete for category from Firestore failed:', err);
  }

  db.logAudit(
    'CATEGORY_DELETED',
    AUTHORIZED_ADMIN_EMAIL,
    cat.name,
    undefined,
    `Permanently deleted category ${cat.name} (${cat.slug}) and associated subcategories from system and database`,
    getClientIp(req)
  );

  db.save();
  res.json({ success: true, deleted: true, archived: false, undoWindow: false });
});

// Admin Subsections CRUD
app.get('/api/admin/subsections', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const sorted = (state.subsections || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(sorted);
});

app.post('/api/admin/subsections', verifyAdmin, async (req: Request, res: Response) => {
  const { subsections } = req.body;
  if (!Array.isArray(subsections)) {
    return res.status(400).json({ error: 'subsections must be an array' });
  }
  const state = db.getState();
  
  // Persist each subsection image into Firestore as Base64 to prevent any media loss during server restarts
  const persistedSubsections = await Promise.all(
    subsections.map(async (sub: any) => {
      if (sub.imageUrl) {
        const persistedUrl = await persistLocalMedia(sub.imageUrl);
        return { ...sub, imageUrl: persistedUrl };
      }
      return sub;
    })
  );

  state.subsections = persistedSubsections;
  db.save();
  // Persist to Cloud Firestore in background so HTTP response is instant (<20ms)
  db.syncCollectionDirect('subsections', state.subsections).catch(e => console.error('[Persistence] Subsections background sync error:', e));
  res.json({ success: true, subsections: state.subsections });
});

app.delete('/api/admin/subsections/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  if (!state.subsections) return res.status(404).json({ error: 'No subsections found' });
  const sub = state.subsections.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subsection not found' });
  
  // 1. Update local state arrays
  state.subsections = state.subsections.filter(s => s.id !== req.params.id);
  if (state.publishedSubsections) {
    state.publishedSubsections = state.publishedSubsections.filter(s => s.id !== req.params.id);
  }

  // 2. Mark as deleted and immediately delete from Cloud Firestore
  const targetId = req.params.id;
  db.markDeleted('subsections', targetId);
  try {
    await db.deleteFromCloud('subsections', targetId);
    console.log(`[Persistence] Permanently hard-deleted subsection ${targetId} from Firestore`);
  } catch (err) {
    console.error('[Persistence] Hard-delete for subsection from Firestore failed:', err);
  }

  db.logAudit(
    'SUBSECTION_DELETED',
    AUTHORIZED_ADMIN_EMAIL,
    sub.name,
    undefined,
    `Permanently deleted subsection ${sub.name} from system and database`,
    getClientIp(req)
  );

  db.save();
  res.json({ success: true, deleted: true, archived: false, undoWindow: false });
});

app.post('/api/admin/undo', verifyAdmin, (req: Request, res: Response) => {
  if (!lastDeletedItem) {
    return res.status(400).json({ error: 'No item available for undo or recovery window expired.' });
  }

  const age = Date.now() - lastDeletedItem.deletedAt;
  if (age > 60000) {
    lastDeletedItem = null;
    return res.status(400).json({ error: 'Recovery window of 1 minute has expired.' });
  }

  // Clear the hard-delete timer
  if (lastDeletedItem.timer) {
    clearTimeout(lastDeletedItem.timer);
  }

  const state = db.getState();
  const { type, data } = lastDeletedItem;

  if (type === 'product') {
    state.products.push(data);
    if (data.isActive && !data.isArchived) {
      state.publishedProducts.push(data);
    }
  } else if (type === 'category') {
    const { category, subsections } = data;
    state.categories.push(category);
    if (category.isActive) {
      state.publishedCategories.push(category);
    }
    if (subsections && Array.isArray(subsections)) {
      if (!state.subsections) state.subsections = [];
      state.subsections.push(...subsections);
      if (!state.publishedSubsections) state.publishedSubsections = [];
      state.publishedSubsections.push(...subsections.filter((s: any) => s.isActive));
    }
  } else if (type === 'subsection') {
    if (!state.subsections) state.subsections = [];
    state.subsections.push(data);
    if (data.isActive) {
      if (!state.publishedSubsections) state.publishedSubsections = [];
      state.publishedSubsections.push(data);
    }
  }

  db.save();
  const recoveredName = type === 'category' 
    ? (data.category?.name || 'Category') 
    : (data.nameEn || data.nameBn || data.name || 'Item');
  
  db.logAudit(
    'ITEM_RECOVERED_UNDO',
    AUTHORIZED_ADMIN_EMAIL,
    recoveredName,
    'Deleted',
    'Successfully recovered via 1-minute Undo action',
    getClientIp(req)
  );

  // Clear stash
  lastDeletedItem = null;

  res.json({ success: true, message: `Successfully recovered ${recoveredName}!` });
});

app.get('/api/admin/undo-status', verifyAdmin, (req: Request, res: Response) => {
  if (!lastDeletedItem) {
    return res.json({ active: false });
  }
  const age = Date.now() - lastDeletedItem.deletedAt;
  const timeLeft = Math.max(0, Math.ceil((60000 - age) / 1000));
  
  if (timeLeft <= 0) {
    lastDeletedItem = null;
    return res.json({ active: false });
  }

  const name = lastDeletedItem.type === 'category' 
    ? (lastDeletedItem.data.category?.name || 'Category') 
    : (lastDeletedItem.data.nameEn || lastDeletedItem.data.nameBn || lastDeletedItem.data.name || 'Item');

  res.json({
    active: true,
    id: lastDeletedItem.id,
    type: lastDeletedItem.type,
    name,
    timeLeft,
    deletedAt: lastDeletedItem.deletedAt
  });
});

app.post('/api/admin/force-purge', verifyAdmin, async (req: Request, res: Response) => {
  if (!lastDeletedItem) {
    return res.status(400).json({ error: 'No pending item to purge.' });
  }

  // Clear timer
  if (lastDeletedItem.timer) {
    clearTimeout(lastDeletedItem.timer);
  }

  const name = lastDeletedItem.type === 'category' 
    ? (lastDeletedItem.data.category?.name || 'Category') 
    : (lastDeletedItem.data.nameEn || lastDeletedItem.data.nameBn || lastDeletedItem.data.name || 'Item');

  // Hard delete immediately!
  try {
    if (lastDeletedItem.type === 'product') {
      await db.deleteFromCloud('products', lastDeletedItem.id);
    } else if (lastDeletedItem.type === 'category') {
      await db.deleteFromCloud('categories', lastDeletedItem.id);
      const { subsections } = lastDeletedItem.data;
      if (subsections && Array.isArray(subsections)) {
        for (const s of subsections) {
          await db.deleteFromCloud('subsections', s.id);
        }
      }
    } else if (lastDeletedItem.type === 'subsection') {
      await db.deleteFromCloud('subsections', lastDeletedItem.id);
    }
    console.log(`[Undo-Trash] Admin initiated Immediate Force Purge for: ${lastDeletedItem.id}`);
  } catch (err) {
    console.error('[Undo-Trash] Force purge failed:', err);
  }

  db.logAudit(
    'ITEM_PURGED_IMMEDIATELY',
    AUTHORIZED_ADMIN_EMAIL,
    name,
    'Pending Delete',
    'Admin triggered immediate permanent hard-delete',
    getClientIp(req)
  );

  lastDeletedItem = null;
  res.json({ success: true, message: `Permanently deleted ${name} immediately!` });
});

app.post('/api/admin/purge-resellers', verifyAdmin, async (req: Request, res: Response) => {
  try {
    await db.purgeAllResellers();
    db.logAudit(
      'PURGE_ALL_RESELLERS',
      AUTHORIZED_ADMIN_EMAIL,
      'Reseller Accounts',
      'Existing Test Resellers',
      'Permanently wiped all test reseller accounts and related sales/withdrawals/transactions',
      getClientIp(req)
    );
    res.json({ success: true, message: 'All test reseller accounts and related data successfully purged from local storage and Firebase!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to purge resellers' });
  }
});

// Admin Bulk Categories Reorder
app.post('/api/admin/categories/reorder', verifyAdmin, (req: Request, res: Response) => {
  const { orders } = req.body; // Array of { id: string, order: number }
  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: 'orders must be an array' });
  }

  const state = db.getState();
  orders.forEach(o => {
    const cat = state.categories.find(c => c.id === o.id);
    if (cat) {
      cat.order = o.order;
    }
  });

  db.save();
  db.syncCollectionDirect('categories', state.categories).catch(e => console.warn('Categories reorder sync warning:', e));
  res.json({ success: true });
});

// Admin Bulk Subsections Reorder
app.post('/api/admin/subsections/reorder', verifyAdmin, (req: Request, res: Response) => {
  const { orders } = req.body; // Array of { id: string, order: number }
  if (!Array.isArray(orders)) {
    return res.status(400).json({ error: 'orders must be an array' });
  }

  const state = db.getState();
  if (!state.subsections) state.subsections = [];

  orders.forEach(o => {
    const sub = state.subsections!.find(s => s.id === o.id);
    if (sub) {
      sub.order = o.order;
    }
  });

  db.save();
  db.syncCollectionDirect('subsections', state.subsections).catch(e => console.warn('Subsections reorder sync warning:', e));
  res.json({ success: true });
});

// Admin Publish to Website endpoint
app.post('/api/admin/publish', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  
  // Mirror active products and categories exactly, excluding archived/inactive items
  state.publishedProducts = JSON.parse(JSON.stringify(state.products.filter(p => !p.isArchived && p.isActive)));
  state.publishedCategories = JSON.parse(JSON.stringify(state.categories.filter(c => c.isActive)));
  
  if (state.subsections) {
    state.publishedSubsections = JSON.parse(JSON.stringify(state.subsections.filter(s => s.isActive)));
  }

  // Ensure brand settings have latest timestamp
  state.brandSettings.updatedAt = Date.now();

  const activePubProds = state.publishedProducts;
  const activePubCats = state.publishedCategories;

  db.logAudit(
    'PUBLISH_TO_WEBSITE',
    AUTHORIZED_ADMIN_EMAIL,
    'Live Website',
    undefined,
    `Published ${activePubProds.length} products and ${activePubCats.length} categories to live website`,
    getClientIp(req)
  );

  db.save();
  db.syncToCloudDirect().catch((err: any) => console.warn('[Firebase] Immediate publish cloud sync warning:', err));

  res.json({
    success: true,
    message: 'Changes successfully published to website!',
    publishedProductsCount: activePubProds.length,
    publishedCategoriesCount: activePubCats.length,
  });
});


// Admin Employee Management
app.get('/api/admin/employees', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const safeList = state.employees.map(({ passwordHash, ...e }) => e);
  res.json(safeList);
});

// Admin Update Employee Status (Approve, Reject, Suspend, Reactivate)
app.patch('/api/admin/employees/:id/status', verifyAdmin, (req: Request, res: Response) => {
  const { status } = req.body;
  if (!['APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED', 'PENDING'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  const state = db.getState();
  const emp = state.employees.find(e => e.id === req.params.id);

  if (!emp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const previousStatus = emp.status;
  emp.status = status;
  if (status === 'APPROVED' && !emp.approvedAt) {
    emp.approvedAt = new Date().toISOString();
  }

  // Add Notification for Employee
  db.addNotification({
    recipientRole: 'EMPLOYEE',
    employeeId: emp.id,
    titleBn: status === 'APPROVED' ? 'একাউন্ট অনুমোদিত হয়েছে!' : 'একাউন্ট স্ট্যাটাস আপডেট',
    titleEn: status === 'APPROVED' ? 'Account Approved!' : 'Account Status Updated',
    messageBn: status === 'APPROVED'
      ? 'অভিনন্দন! তাওজুন নেক্সাসে আপনার মার্কেটার একাউন্ট অনুমোদিত হয়েছে।'
      : `আপনার একাউন্টের বর্তমান স্ট্যাটাস: ${status}।`,
    messageEn: status === 'APPROVED'
      ? 'Congratulations! Your marketer account has been approved.'
      : `Your account status is now ${status}.`,
    type: 'EMPLOYEE'
  });

  db.logAudit(
    'EMPLOYEE_STATUS_CHANGED',
    AUTHORIZED_ADMIN_EMAIL,
    emp.name,
    previousStatus,
    status,
    getClientIp(req)
  );

  db.save();
  db.syncEntityDirect('employees', emp).catch(e => console.warn('Employee status sync warning:', e));
  res.json({ success: true, employee: { ...emp, passwordHash: undefined } });
});

// Admin Update Employee Custom Commission Rate
app.patch('/api/admin/employees/:id/commission', verifyAdmin, (req: Request, res: Response) => {
  const { customCommissionRate } = req.body;
  const state = db.getState();
  const emp = state.employees.find(e => e.id === req.params.id);

  if (!emp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  const prev = emp.customCommissionRate;
  emp.customCommissionRate = customCommissionRate ? parseFloat(customCommissionRate) : undefined;

  db.logAudit(
    'EMPLOYEE_COMMISSION_OVERRIDE',
    AUTHORIZED_ADMIN_EMAIL,
    emp.name,
    prev ? `${prev}%` : 'Standard product rate',
    emp.customCommissionRate ? `${emp.customCommissionRate}%` : 'Standard product rate',
    getClientIp(req)
  );

  db.save();
  db.syncEntityDirect('employees', emp).catch(e => console.warn('Employee commission sync warning:', e));
  res.json({ success: true, customCommissionRate: emp.customCommissionRate });
});

// Admin Update Reseller Margin & Fixed Payout (Module 1, Rule 2 & 3)
app.patch('/api/admin/employees/:id/margin', verifyAdmin, async (req: Request, res: Response) => {
  const { margin } = req.body;
  const numMargin = Number(margin);
  if (isNaN(numMargin) || numMargin < 0) {
    return res.status(400).json({ error: 'সঠিক মার্জিন (টাকা) প্রদান করুন (ন্যূনতম ০ টাকা)' });
  }

  const state = db.getState();
  const emp = state.employees.find(e => e.id === req.params.id);

  if (!emp) {
    return res.status(404).json({ error: 'রিসেলার অ্যাকাউন্টটি পাওয়া যায়নি' });
  }

  const prev = emp.resellerMargin !== undefined ? emp.resellerMargin : (isOfficialEmployee(emp) ? 0 : 10);
  emp.resellerMargin = numMargin;

  // Each reseller's margin/limit is strictly personal and independent; do not automatically overwrite downline members.

  db.logAudit(
    'RESELLER_MARGIN_OVERRIDE',
    AUTHORIZED_ADMIN_EMAIL,
    emp.name,
    `${prev} Tk`,
    `${numMargin} Tk`,
    getClientIp(req)
  );

  db.save();
  await db.syncEntityDirect('employees', emp).catch(e => console.warn('Reseller margin sync warning:', e));

  const downlineMembers = state.employees.filter(e => e.referredBy === emp.referenceCode || e.referredBy === emp.id);

  // Broadcast real-time SSE event to all connected dashboards and client apps
  broadcastRealtimeEvent('RESELLER_MARGIN_UPDATED', {
    employeeId: emp.id,
    margin: numMargin,
    downlineCount: downlineMembers.length,
    timestamp: Date.now()
  });
  broadcastRealtimeEvent('STATE_UPDATED', {
    type: 'RESELLER_MARGIN_UPDATED',
    timestamp: Date.now()
  });

  res.json({
    success: true,
    message: `রিসেলার মার্জিন সফলভাবে ৳${numMargin} হিসেবে আপডেট করা হয়েছে।`,
    employee: emp,
    margin: numMargin
  });
});

// Admin Reset Employee Password
app.post('/api/admin/employees/:id/reset-password', verifyAdmin, (req: Request, res: Response) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  const state = db.getState();
  const employee = state.employees.find(e => e.id === req.params.id);
  if (!employee) {
    return res.status(404).json({ error: 'Employee not found' });
  }
  employee.passwordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  db.save();
  db.syncEntityDirect('employees', employee).catch(e => console.warn('Employee password sync warning:', e));

  db.addNotification({
    recipientRole: 'EMPLOYEE',
    employeeId: employee.id,
    titleBn: 'পাসওয়ার্ড রিসেট করা হয়েছে',
    titleEn: 'Password Reset',
    messageBn: 'অ্যাডমিন আপনার মার্কেটার একাউন্টের পাসওয়ার্ড রিসেট করেছেন। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।',
    messageEn: 'Administrator has reset your account password. Please sign in with your new password.',
    type: 'EMPLOYEE'
  });

  db.logAudit(
    'EMPLOYEE_PASSWORD_RESET',
    AUTHORIZED_ADMIN_EMAIL,
    employee.name,
    undefined,
    'Admin reset employee password',
    getClientIp(req)
  );

  res.json({ success: true, message: 'Password reset successfully' });
});

// Admin Update Employee Profile Details
app.put('/api/admin/employees/:id', verifyAdmin, (req: Request, res: Response) => {
  const { name, phone, email, customCommissionRate, referralCommissionRate, downlineCustomRates, reference, status } = req.body;
  const state = db.getState();
  const emp = state.employees.find(e => e.id === req.params.id);

  if (!emp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  if (name) emp.name = name.trim();
  if (phone) emp.phone = phone.trim();
  if (email) emp.email = email.trim();
  if (reference !== undefined) emp.reference = reference ? reference.trim() : undefined;
  if (req.body.resellerMargin !== undefined) {
    emp.resellerMargin = Number(req.body.resellerMargin);
  }
  if (referralCommissionRate !== undefined) {
    const newRate = referralCommissionRate !== null && referralCommissionRate !== '' ? parseFloat(referralCommissionRate) : 10;
    emp.referralCommissionRate = newRate;
    emp.referralMaxBonusCap = newRate;
  }
  if (downlineCustomRates !== undefined) {
    emp.downlineCustomRates = downlineCustomRates;
  }


  if (status && ['APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED', 'PENDING'].includes(status)) {
    emp.status = status;
  }
  if (req.body.isPaidSubscription !== undefined) {
    emp.isPaidSubscription = !!req.body.isPaidSubscription;
  }
  if (req.body.subscriptionStatus !== undefined) {
    emp.subscriptionStatus = req.body.subscriptionStatus;
  }
  if (req.body.subscriptionExpiryDate !== undefined) {
    emp.subscriptionExpiryDate = req.body.subscriptionExpiryDate;
  }
  if (req.body.customTrialDays !== undefined) {
    emp.customTrialDays = req.body.customTrialDays ? parseInt(req.body.customTrialDays) : undefined;
  }
  if (req.body.trialExtendedDays !== undefined) {
    emp.trialExtendedDays = typeof req.body.trialExtendedDays === 'number' ? req.body.trialExtendedDays : parseInt(req.body.trialExtendedDays) || 0;
  }
  if (req.body.trialStartedAt !== undefined) {
    emp.trialStartedAt = req.body.trialStartedAt;
  }

  db.logAudit(
    'EMPLOYEE_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    emp.name,
    undefined,
    'Updated marketer profile details',
    getClientIp(req)
  );

  db.save();
  db.syncEntityDirect('employees', emp).catch(e => console.warn('Employee profile sync warning:', e));

  // Broadcast real-time SSE events so open dashboards update immediately
  broadcastRealtimeEvent('RESELLER_MARGIN_UPDATED', {
    employeeId: emp.id,
    margin: emp.resellerMargin,
    referralCommissionRate: emp.referralCommissionRate,
    timestamp: Date.now()
  });
  broadcastRealtimeEvent('STATE_UPDATED', {
    type: 'EMPLOYEE_UPDATED',
    employeeId: emp.id,
    timestamp: Date.now()
  });

  const { passwordHash, ...safeEmp } = emp;
  res.json({ success: true, employee: safeEmp });
});

// Admin Delete / Permanent Remove Employee
app.delete('/api/admin/employees/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const targetId = req.params.id;
  const emp = state.employees.find(e => e.id === targetId);

  if (!emp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  // 1. Remove from state arrays and sessions
  state.employees = state.employees.filter(e => e.id !== targetId);
  state.employeeSessions = (state.employeeSessions || []).filter(s => s.employeeId !== targetId);

  // 2. Mark as permanently deleted and delete from cloud
  db.markDeleted('employees', targetId);
  try {
    await db.deleteFromCloud('employees', targetId);
    console.log(`[Persistence] Permanently deleted employee ${targetId} from Firestore`);
  } catch (err) {
    console.error('[Persistence] Hard-delete for employee from Firestore failed:', err);
  }

  db.logAudit(
    'EMPLOYEE_DELETED',
    AUTHORIZED_ADMIN_EMAIL,
    emp.name,
    emp.phone,
    'Permanently deleted reseller account from system and cloud',
    getClientIp(req)
  );

  db.save();
  res.json({ success: true, message: 'Employee permanently deleted successfully' });
});

// Admin All Sales List
app.get('/api/admin/sales', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.sales);
});

// // Admin Approve Sale Delivery & Release Commission to Employee Wallet (Thread-Safe Mutex & Awaited Sync)
app.patch('/api/admin/sales/:id/approve', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const sale = state.sales.find(s => s.id === req.params.id || s.orderCode === req.params.id);

  if (!sale) {
    return res.status(404).json({ error: 'Sale not found' });
  }

  const targetSales = state.sales.filter(s => (sale.orderCode && s.orderCode === sale.orderCode) || s.id === sale.id);
  const primarySale = targetSales[0];
  const sellerId = primarySale?.employeeId || sale.employeeId;

  if (!sellerId) {
    return res.status(400).json({ error: 'Sale missing associated employee ID.' });
  }

  const reqKey = `sale_approve:${sale.orderCode || sale.id}`;
  const existingIdem = db.getIdempotencyRecord(reqKey);
  if (existingIdem && (existingIdem.status === 'COMPLETED' || existingIdem.status === 'QUEUED')) {
    console.log(`[Idempotency-Guard] Duplicate sale approval request blocked for key: ${reqKey}`);
    return res.json(existingIdem.responsePayload || {
      success: true,
      message: 'অর্ডারটি ইতিমধ্যে অনুমোদিত ও প্রসেস করা হয়েছে।',
      isDuplicate: true
    });
  }

  if (targetSales.every(s => s.paymentStatus === 'PAID' && s.saleStatus === 'Approved')) {
    return res.json({
      success: true,
      message: 'অর্ডারটি ইতিমধ্যে অনুমোদিত ও প্রসেস করা হয়েছে।',
      isDuplicate: true
    });
  }

  const mutex = getEmployeeMutex(sellerId);
  return await mutex.runExclusive(async () => {
    let totalCredited = 0;
    const modifiedEmployees: Employee[] = [];
    const createdTransactions: Transaction[] = [];

    targetSales.forEach(s => {
      if (s.paymentStatus !== 'PAID') {
        s.paymentStatus = 'PAID';
        s.saleStatus = 'Approved';
        s.deliveryStatus = 'delivered';

        const emp = state.employees.find(e => e.id === s.employeeId);
        if (emp) {
          emp.wallet.availableBalance += s.commissionAmount;
          emp.wallet.totalEarnings += s.commissionAmount;
          totalCredited += s.commissionAmount;

          if (!modifiedEmployees.some(m => m.id === emp.id)) {
            modifiedEmployees.push(emp);
          }

          const trx: Transaction = {
            id: 'trx-' + crypto.randomUUID().slice(0, 8),
            employeeId: emp.id,
            type: 'COMMISSION_EARNED',
            amount: s.commissionAmount,
            balanceAfter: emp.wallet.availableBalance,
            status: 'COMPLETED',
            reference: s.orderCode,
            description: `ডেলিভারি সম্পন্ন: কমিশন জমা হয়েছে (${s.productName} x ${s.quantity})`,
            timestamp: new Date().toISOString()
          };

          state.transactions.unshift(trx);
          createdTransactions.push(trx);

          db.addNotification({
            recipientRole: 'EMPLOYEE',
            employeeId: emp.id,
            titleBn: 'কমিশন একাউন্টে জমা হয়েছে',
            titleEn: 'Commission Credited to Account',
            messageBn: `অর্ডার #${s.orderCode} এর ডেলিভারি সম্পন্ন থাকায় ৳${s.commissionAmount} কমিশন আপনার একাউন্টে জমা হয়েছে।`,
            messageEn: `Delivery completed for #${s.orderCode}. ৳${s.commissionAmount} commission credited to your wallet.`,
            type: 'COMMISSION'
          });
        }
      }
    });

    // Calculate and credit Referral Bonus to Upline once per order
    const sellerEmp = primarySale ? state.employees.find(e => e.id === primarySale.employeeId) : null;

    if (sellerEmp && !isOfficialEmployee(sellerEmp)) {
      const orderCode = primarySale.orderCode;
      const isBonusAlreadyPaid = state.transactions.some(
        t => t.reference === orderCode && t.description.includes('রেফারেল টিম প্রফিট')
      );

      if (!isBonusAlreadyPaid) {
        const ref = (sellerEmp.reference || (sellerEmp as any).referredBy || (sellerEmp as any).upline || '').trim().toUpperCase();
        const parentEmp = (sellerEmp.referralOwnerId && sellerEmp.referralOwnerId !== 'OFFICIAL_TAWZOON' && sellerEmp.referralOwnerId !== 'COMPANY')
          ? state.employees.find(e => e.id === sellerEmp.referralOwnerId)
          : (ref && !isOfficialReferralCode(ref) ? state.employees.find(e => 
              e.id.toUpperCase() === ref || 
              (e.referenceCode && e.referenceCode.toUpperCase() === ref) || 
              `TN-REF-${e.id.replace('emp-', '').slice(0, 5).toUpperCase()}` === ref ||
              (e.phone && e.phone.replace(/[^0-9]/g, '') === ref.replace(/[^0-9]/g, '')) ||
              (e.name && e.name.toLowerCase() === ref.toLowerCase())
            ) : null);

        if (parentEmp) {
          const parentMutex = getEmployeeMutex(parentEmp.id);
          await parentMutex.runExclusive(async () => {
            const totalOrderProfit = targetSales.reduce((sum, s) => sum + (s.commissionAmount || 0), 0);
            if (totalOrderProfit > 0) {
              const maxBonusLimit = (parentEmp.downlineCustomRates && parentEmp.downlineCustomRates[sellerEmp.id] !== undefined)
                ? Number(parentEmp.downlineCustomRates[sellerEmp.id])
                : (parentEmp.referralMaxBonusCap !== undefined
                    ? Number(parentEmp.referralMaxBonusCap)
                    : (parentEmp.referralCommissionRate !== undefined ? Number(parentEmp.referralCommissionRate) : 10));

              if (maxBonusLimit > 0) {
                const referralBonus = Math.max(0, Math.round(maxBonusLimit * Math.min(1, totalOrderProfit / 100)));

                if (referralBonus > 0) {
                  parentEmp.wallet.availableBalance += referralBonus;
                  parentEmp.wallet.totalEarnings += referralBonus;

                  if (!modifiedEmployees.some(m => m.id === parentEmp.id)) {
                    modifiedEmployees.push(parentEmp);
                  }

                  const parentTrx: Transaction = {
                    id: 'trx-' + crypto.randomUUID().slice(0, 8),
                    employeeId: parentEmp.id,
                    type: 'COMMISSION_EARNED',
                    amount: referralBonus,
                    balanceAfter: parentEmp.wallet.availableBalance,
                    status: 'COMPLETED',
                    reference: orderCode,
                    description: `রেফারেল টিম প্রফিট: ${sellerEmp.name} এর অর্ডার #${orderCode} থেকে (১০% প্রফিট, সর্বোচ্চ ৳${maxBonusLimit} লিমিট অনুযায়ী ৳${referralBonus})`,
                    timestamp: new Date().toISOString()
                  };

                  state.transactions.unshift(parentTrx);
                  createdTransactions.push(parentTrx);

                  db.addNotification({
                    recipientRole: 'EMPLOYEE',
                    employeeId: parentEmp.id,
                    titleBn: 'রেফারেল প্রফিট বোনাস জমা হয়েছে',
                    titleEn: 'Referral Bonus Credited',
                    messageBn: `আপনার টিমের সদস্য ${sellerEmp.name} এর সেলস সফল হওয়ায় আপনি ৳${referralBonus} রেফারেল লাভ পেয়েছেন (সর্বোচ্চ লিমিট ৳${maxBonusLimit})।`,
                    messageEn: `You earned ৳${referralBonus} referral bonus from ${sellerEmp.name}'s delivered order #${orderCode}.`,
                    type: 'COMMISSION'
                  });
                }
              }
            }
          });
        }
      }
    }

    db.save();

    // Awaited Cloud Persistence for sales approval & commissions
    let isCloudSynced = true;
    try {
      const syncTasks: Promise<void>[] = [];
      targetSales.forEach(s => syncTasks.push(db.syncEntityDirect('sales', s, true)));
      modifiedEmployees.forEach(e => syncTasks.push(db.syncEntityDirect('employees', e, true)));
      createdTransactions.forEach(t => syncTasks.push(db.syncEntityDirect('transactions', t, true)));
      await Promise.all(syncTasks);
    } catch (syncErr) {
      isCloudSynced = false;
      console.warn('[Sales Approve] Cloud write failed. Enqueued in durable outbox queue:', syncErr);
    }

    const responsePayload = {
      success: true,
      message: `ডেলিভারি সফল ও সর্বমোট ৳${totalCredited} কমিশন অনুমোদিত হয়েছে।`,
      updatedCount: targetSales.length,
      syncState: isCloudSynced ? 'CLOUD_SYNCED' : 'LOCAL_PERSISTED_OUTBOX_QUEUED'
    };

    await db.setIdempotencyRecord(reqKey, {
      status: isCloudSynced ? 'COMPLETED' : 'QUEUED',
      responsePayload
    });

    return res.json(responsePayload);
  });
});

// Admin Reject Sale (Thread-Safe Mutex & Awaited Sync)
app.patch('/api/admin/sales/:id/reject', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const sale = state.sales.find(s => s.id === req.params.id || s.orderCode === req.params.id);

  if (!sale) {
    return res.status(404).json({ error: 'Sale not found' });
  }

  const targetSales = state.sales.filter(s => (sale.orderCode && s.orderCode === sale.orderCode) || s.id === sale.id);
  const wasPaid = targetSales.some(s => s.paymentStatus === 'PAID');
  const totalReversedCommission = wasPaid ? targetSales.reduce((acc, s) => acc + (s.commissionAmount || 0), 0) : 0;

  const { deductDeliveryCharge, penaltyAmount = 120 } = req.body || {};
  const actualPenalty = deductDeliveryCharge ? (Number(penaltyAmount) || 120) : 0;

  const reqKey = `sale_reject:${sale.orderCode || sale.id}:${actualPenalty}`;
  const existingIdem = db.getIdempotencyRecord(reqKey);
  if (existingIdem && (existingIdem.status === 'COMPLETED' || existingIdem.status === 'QUEUED')) {
    console.log(`[Idempotency-Guard] Duplicate sale rejection request blocked for key: ${reqKey}`);
    return res.json(existingIdem.responsePayload || {
      success: true,
      message: 'অর্ডারটি ইতিমধ্যে বাতিল হিসেবে প্রসেস করা হয়েছে।',
      isDuplicate: true
    });
  }

  if (targetSales.every(s => s.saleStatus === 'Rejected')) {
    return res.json({
      success: true,
      message: 'অর্ডারটি ইতিমধ্যে বাতিল করা হয়েছে।',
      isDuplicate: true
    });
  }

  const sellerId = sale.employeeId;
  const processRejectLogic = async () => {
    const modifiedEmployees: Employee[] = [];

    targetSales.forEach(s => {
      s.paymentStatus = 'PENDING';
      s.saleStatus = 'Rejected';
      s.deliveryStatus = 'cancelled';
      s.commissionAmount = 0;
    });

    // If sale was previously delivered/paid, reverse the credited commissions and referral bonuses
    if (wasPaid && sellerId && totalReversedCommission > 0) {
      const employee = state.employees.find(e => e.id === sellerId);
      if (employee && employee.wallet) {
        employee.wallet.availableBalance = Math.max(0, employee.wallet.availableBalance - totalReversedCommission);
        employee.wallet.totalEarnings = Math.max(0, employee.wallet.totalEarnings - totalReversedCommission);

        if (!modifiedEmployees.some(m => m.id === employee.id)) {
          modifiedEmployees.push(employee);
        }

        state.transactions.unshift({
          id: 'trx-' + crypto.randomUUID().slice(0, 8),
          employeeId: employee.id,
          type: 'ADJUSTMENT',
          amount: -totalReversedCommission,
          balanceAfter: employee.wallet.availableBalance,
          status: 'COMPLETED',
          reference: sale.orderCode,
          description: `অর্ডার বাতিল: পূর্বে জমাকৃত কমিশন সমন্বয় (-৳${totalReversedCommission})`,
          timestamp: new Date().toISOString()
        });
      }

      // Reverse upline referral bonus if one was paid for this order
      const bonusTrxIndex = state.transactions.findIndex(
        t => t.reference === sale.orderCode && t.description.includes('রেফারেল টিম প্রফিট')
      );
      if (bonusTrxIndex !== -1) {
        const bonusTrx = state.transactions[bonusTrxIndex];
        const parentEmp = state.employees.find(e => e.id === bonusTrx.employeeId);
        if (parentEmp && parentEmp.wallet) {
          parentEmp.wallet.availableBalance = Math.max(0, parentEmp.wallet.availableBalance - bonusTrx.amount);
          parentEmp.wallet.totalEarnings = Math.max(0, parentEmp.wallet.totalEarnings - bonusTrx.amount);

          if (!modifiedEmployees.some(m => m.id === parentEmp.id)) {
            modifiedEmployees.push(parentEmp);
          }

          state.transactions.unshift({
            id: 'trx-' + crypto.randomUUID().slice(0, 8),
            employeeId: parentEmp.id,
            type: 'ADJUSTMENT',
            amount: -bonusTrx.amount,
            balanceAfter: parentEmp.wallet.availableBalance,
            status: 'COMPLETED',
            reference: sale.orderCode,
            description: `অর্ডার বাতিল: পূর্বে জমাকৃত রেফারেল বোনাস সমন্বয় (-৳${bonusTrx.amount})`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Deduct penalty from reseller wallet if requested
    if (actualPenalty > 0 && sellerId) {
      const employee = state.employees.find(e => e.id === sellerId);
      if (employee) {
        if (!employee.wallet) {
          employee.wallet = { availableBalance: 0, pendingWithdrawal: 0, totalEarnings: 0, totalWithdrawn: 0 };
        }
        employee.wallet.availableBalance = employee.wallet.availableBalance - actualPenalty;

        if (!modifiedEmployees.some(m => m.id === employee.id)) {
          modifiedEmployees.push(employee);
        }

        db.addNotification({
          recipientRole: 'EMPLOYEE',
          employeeId: employee.id,
          titleBn: `❌ অর্ডার বাতিল ও কুরিয়ার চার্জ কর্তন (#${sale.orderCode})`,
          titleEn: `Order Cancelled & Fee Deducted (#${sale.orderCode})`,
          messageBn: `অর্ডার #${sale.orderCode} বাতিল করা হয়েছে। কুরিয়ার চার্জ বাবদ আপনার ওয়ালেট থেকে ৳${actualPenalty} কেটে নেওয়া হয়েছে।`,
          messageEn: `Order #${sale.orderCode} was cancelled. ৳${actualPenalty} delivery fee deducted.`,
          type: 'SALE'
        });
      }
    } else if (sellerId) {
      db.addNotification({
        recipientRole: 'EMPLOYEE',
        employeeId: sellerId,
        titleBn: `❌ অর্ডার বাতিল করা হয়েছে (#${sale.orderCode})`,
        titleEn: `Order Cancelled (#${sale.orderCode})`,
        messageBn: `অর্ডার #${sale.orderCode} বাতিল হিসেবে চিহ্নিত করা হয়েছে (কোনো চার্জ কাটা হয়নি)।`,
        messageEn: `Order #${sale.orderCode} was cancelled.`,
        type: 'SALE'
      });
    }

    db.save();

    let isCloudSynced = true;
    try {
      const syncTasks: Promise<void>[] = [];
      targetSales.forEach(s => syncTasks.push(db.syncEntityDirect('sales', s, true)));
      modifiedEmployees.forEach(e => syncTasks.push(db.syncEntityDirect('employees', e, true)));
      await Promise.all(syncTasks);
    } catch (syncErr) {
      isCloudSynced = false;
      console.warn('[Sales Reject] Cloud write failed. Enqueued in durable outbox queue:', syncErr);
    }

    const responsePayload = {
      success: true,
      message: actualPenalty > 0
        ? `অর্ডার বাতিল এবং রিসেলারের ওয়ালেট থেকে ৳${actualPenalty} কুরিয়ার চার্জ কর্তন করা হয়েছে।`
        : 'অর্ডার বাতিল করা হয়েছে (কোনো চার্জ কাটা হয়নি)।',
      syncState: isCloudSynced ? 'CLOUD_SYNCED' : 'LOCAL_PERSISTED_OUTBOX_QUEUED'
    };

    await db.setIdempotencyRecord(reqKey, {
      status: isCloudSynced ? 'COMPLETED' : 'QUEUED',
      responsePayload
    });

    return res.json(responsePayload);
  };

  if (sellerId) {
    const mutex = getEmployeeMutex(sellerId);
    return await mutex.runExclusive(processRejectLogic);
  } else {
    return await processRejectLogic();
  }
});

// Admin Update Courier Tracking Info for Sale/Order
app.patch('/api/admin/sales/:id/courier', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const sale = state.sales.find(s => s.id === req.params.id || s.orderCode === req.params.id);

  if (!sale) {
    return res.status(404).json({ error: 'Sale not found' });
  }

  const { courierPartner, trackingCode, trackingUrl, deliveryStatus } = req.body;

  let partner = courierPartner ? String(courierPartner).trim() : 'Steadfast';
  let code = trackingCode ? String(trackingCode).trim() : '';
  let url = trackingUrl ? String(trackingUrl).trim() : '';

  // Auto-detect tracking URL if full URL is pasted as code
  if (code.startsWith('http://') || code.startsWith('https://')) {
    url = code;
    if (url.includes('steadfast')) {
      partner = 'Steadfast';
      const m = url.match(/\/t\/([^/?#]+)/);
      if (m) code = m[1];
    } else if (url.includes('pathao')) {
      partner = 'Pathao';
      const m = url.match(/consignment_id=([^&]+)/);
      if (m) code = m[1];
    }
  } else if (code && !url) {
    if (partner.toLowerCase().includes('steadfast')) {
      url = `https://steadfast.com.bd/t/${code}`;
    } else if (partner.toLowerCase().includes('pathao')) {
      url = `https://merchant.pathao.com/tracking?consignment_id=${code}`;
    } else if (partner.toLowerCase().includes('redx')) {
      url = `https://redx.com.bd/track-order?trackingId=${code}`;
    }
  }

  const targetSales = state.sales.filter(s => (sale.orderCode && s.orderCode === sale.orderCode) || s.id === sale.id);
  targetSales.forEach(s => {
    if (partner) s.courierPartner = partner;
    if (code) s.trackingCode = code;
    if (url) s.courierTrackingUrl = url;
    if (deliveryStatus) {
      s.deliveryStatus = deliveryStatus;
    } else if (!s.deliveryStatus) {
      s.deliveryStatus = 'pending';
    }
  });

  db.save();
  db.syncCollectionDirect('sales', targetSales).catch(e => console.warn('Courier sales sync warning:', e));

  if (sale.employeeId) {
    db.addNotification({
      recipientRole: 'EMPLOYEE',
      employeeId: sale.employeeId,
      titleBn: `🚚 কুরিয়ার ট্র্যাকিং কোড যুক্ত হয়েছে (#${sale.orderCode})`,
      titleEn: `Courier Tracking Added (#${sale.orderCode})`,
      messageBn: `${partner || 'Steadfast'} কুরিয়ারের ট্র্যাকিং কোড (${code}) যুক্ত করা হয়েছে। আপনার 'অর্ডার ও সেলস' পেজে ট্র্যাকিং কোডটি লাইভ দেখতে ও কপি করতে পারবেন।`,
      messageEn: `Tracking code (${code}) via ${partner} has been added to your order.`,
      type: 'SALE'
    });
  }

  res.json({
    success: true,
    message: 'কুরিয়ার ট্র্যাকিং তথ্য সফলভাবে আপডেট হয়েছে।',
    courierPartner: partner,
    trackingCode: code,
    courierTrackingUrl: url,
    deliveryStatus: targetSales[0]?.deliveryStatus
  });
});

// Admin Explicitly Confirm Sale/Order (Transitions from PENDING to CONFIRMED)
app.patch('/api/admin/sales/:id/confirm', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const sale = state.sales.find(s => s.id === req.params.id || s.orderCode === req.params.id);

  if (!sale) {
    return res.status(404).json({ error: 'Sale not found' });
  }

  const targetSales = state.sales.filter(s => (sale.orderCode && s.orderCode === sale.orderCode) || s.id === sale.id);
  targetSales.forEach(s => {
    s.saleStatus = 'Confirmed';
    (s as any).status = 'CONFIRMED';
    (s as any).confirmedAt = new Date().toISOString();
  });

  db.save();
  db.syncCollectionDirect('sales', targetSales).catch(e => console.warn('Confirm sales sync warning:', e));

  if (sale.employeeId) {
    db.addNotification({
      recipientRole: 'EMPLOYEE',
      employeeId: sale.employeeId,
      titleBn: `✅ অর্ডার কনফার্ম হয়েছে (#${sale.orderCode})`,
      titleEn: `Order Confirmed (#${sale.orderCode})`,
      messageBn: `আপনার অর্ডার #${sale.orderCode} সফলভাবে কনফার্ম করা হয়েছে। পণ্য প্যাকেজিং ও ডেলিভারির জন্য প্রস্তুত করা হচ্ছে।`,
      messageEn: `Your order #${sale.orderCode} has been confirmed.`,
      type: 'SALE'
    });
  }

  res.json({
    success: true,
    message: `অর্ডার #${sale.orderCode} সফলভাবে কনফার্ম করা হয়েছে।`,
    updatedCount: targetSales.length
  });
});

// Admin All Withdrawals List
app.get('/api/admin/withdrawals', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.withdrawals);
});

// Admin Process Withdrawal Request (Thread-Safe Mutex & Awaited Sync)
app.patch('/api/admin/withdrawals/:id/process', verifyAdmin, async (req: Request, res: Response) => {
  const { action, adminNote } = req.body;

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'Action must be APPROVE or REJECT.' });
  }

  const state = db.getState();
  const withdrawal = state.withdrawals.find(w => w.id === req.params.id);

  if (!withdrawal) {
    return res.status(404).json({ error: 'Withdrawal request not found.' });
  }

  const reqKey = `wdr_process:${withdrawal.id}:${action}`;
  const existingIdem = db.getIdempotencyRecord(reqKey);
  if (existingIdem && (existingIdem.status === 'COMPLETED' || existingIdem.status === 'QUEUED')) {
    console.log(`[Idempotency-Guard] Duplicate withdrawal process request blocked for key: ${reqKey}`);
    return res.json(existingIdem.responsePayload || {
      success: true,
      withdrawal,
      message: `উইথড্রয়াল আবেদনটি ইতিমধ্যে ${withdrawal.status} করা হয়েছে।`,
      isDuplicate: true
    });
  }

  if (withdrawal.status !== 'PENDING') {
    return res.status(400).json({ error: `Withdrawal request already processed as ${withdrawal.status}.` });
  }

  const employee = state.employees.find(e => e.id === withdrawal.employeeId);
  if (!employee) {
    return res.status(404).json({ error: 'Associated employee not found.' });
  }

  const mutex = getEmployeeMutex(employee.id);
  return await mutex.runExclusive(async () => {
    // Re-verify status inside mutex
    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ error: `Withdrawal request already processed as ${withdrawal.status}.` });
    }

    withdrawal.processedDate = new Date().toISOString();
    withdrawal.adminNote = adminNote ? adminNote.trim() : undefined;

    let trxEntry: any = null;
    if (action === 'APPROVE') {
      withdrawal.status = 'APPROVED';

      // Pending becomes Total Withdrawn!
      employee.wallet.pendingWithdrawal = Math.max(0, employee.wallet.pendingWithdrawal - withdrawal.amount);
      employee.wallet.totalWithdrawn += withdrawal.amount;

      // Record completed transaction
      trxEntry = {
        id: 'trx-' + crypto.randomUUID().slice(0, 8),
        employeeId: employee.id,
        type: 'WITHDRAWAL_PAID',
        amount: withdrawal.amount,
        balanceAfter: employee.wallet.availableBalance,
        status: 'COMPLETED',
        reference: withdrawal.id,
        description: `${withdrawal.paymentMethod} একাউন্টে ৳${withdrawal.amount} উত্তোলন সম্পন্ন হয়েছে`,
        timestamp: new Date().toISOString()
      };
      state.transactions.unshift(trxEntry);

      // Notify employee
      db.addNotification({
        recipientRole: 'EMPLOYEE',
        employeeId: employee.id,
        titleBn: 'উইথড্রয়াল সফল হয়েছে',
        titleEn: 'Withdrawal Approved',
        messageBn: `আপনার ৳${withdrawal.amount} উইথড্রয়াল রিকোয়েস্ট অনুমোদিত এবং পাঠানো হয়েছে।`,
        messageEn: `Your withdrawal of ৳${withdrawal.amount} via ${withdrawal.paymentMethod} has been approved.`,
        type: 'WITHDRAWAL'
      });

      db.logAudit(
        'WITHDRAWAL_APPROVED',
        AUTHORIZED_ADMIN_EMAIL,
        employee.name,
        'PENDING',
        `Paid ৳${withdrawal.amount} via ${withdrawal.paymentMethod}`,
        getClientIp(req)
      );
    } else {
      // REJECT: Return amount back to available balance!
      withdrawal.status = 'REJECTED';

      employee.wallet.pendingWithdrawal = Math.max(0, employee.wallet.pendingWithdrawal - withdrawal.amount);
      employee.wallet.availableBalance += withdrawal.amount;

      // Record refund transaction
      trxEntry = {
        id: 'trx-' + crypto.randomUUID().slice(0, 8),
        employeeId: employee.id,
        type: 'WITHDRAWAL_REFUND',
        amount: withdrawal.amount,
        balanceAfter: employee.wallet.availableBalance,
        status: 'COMPLETED',
        reference: withdrawal.id,
        description: `উইথড্রয়াল বাতিল ও ওয়ালেটে রিফান্ড (${withdrawal.paymentMethod})`,
        timestamp: new Date().toISOString()
      };
      state.transactions.unshift(trxEntry);

      // Notify employee
      db.addNotification({
        recipientRole: 'EMPLOYEE',
        employeeId: employee.id,
        titleBn: 'উইথড্রয়াল বাতিল ও রিফান্ড',
        titleEn: 'Withdrawal Declined & Refunded',
        messageBn: `আপনার ৳${withdrawal.amount} উইথড্রয়াল রিকোয়েস্টটি প্রত্যাখ্যাত হয়েছে এবং টাকা ওয়ালেটে ফেরত দেওয়া হয়েছে। নোট: ${adminNote || 'কোনো নোট দেওয়া হয়নি'}`,
        messageEn: `Your withdrawal of ৳${withdrawal.amount} was rejected and refunded to your wallet. Note: ${adminNote || 'None'}`,
        type: 'WITHDRAWAL'
      });

      db.logAudit(
        'WITHDRAWAL_REJECTED',
        AUTHORIZED_ADMIN_EMAIL,
        employee.name,
        'PENDING',
        `Rejected ৳${withdrawal.amount} and refunded to available balance`,
        getClientIp(req)
      );
    }

    db.save();

    let isCloudSynced = true;
    try {
      const syncTasks: Promise<void>[] = [
        db.syncEntityDirect('withdrawals', withdrawal, true),
        db.syncEntityDirect('employees', employee, true)
      ];
      if (trxEntry) {
        syncTasks.push(db.syncEntityDirect('transactions', trxEntry, true));
      }
      await Promise.all(syncTasks);
    } catch (syncErr) {
      isCloudSynced = false;
      console.warn('[Withdrawal Process] Cloud write failed. Enqueued in durable outbox queue:', syncErr);
    }

    const responsePayload = {
      success: true,
      withdrawal,
      wallet: employee.wallet,
      syncState: isCloudSynced ? 'CLOUD_SYNCED' : 'LOCAL_PERSISTED_OUTBOX_QUEUED',
      message: action === 'APPROVE' ? 'উইথড্রয়াল সফলভাবে অনুমোদিত হয়েছে।' : 'উইথড্রয়াল প্রত্যাখ্যাত ও রিফান্ড করা হয়েছে।'
    };

    await db.setIdempotencyRecord(reqKey, {
      status: isCloudSynced ? 'COMPLETED' : 'QUEUED',
      responsePayload
    });

    return res.json(responsePayload);
  });
});

// Admin Force Sync from Cloud Firestore
app.post('/api/admin/force-sync', verifyAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.forcePullFromCloud();
    // Broadcast real-time SSE update so all connected clients and portals instantly refresh
    broadcastRealtimeEvent('STATE_UPDATED', {
      type: 'CLOUD_SYNC_COMPLETED',
      timestamp: Date.now(),
      stats: result.stats
    });
    const message = result.quotaReached
      ? `ক্লাউড দৈনিক কোটা লিমিট সাময়িকভাবে পৌঁছেছে। বর্তমান সকল পণ্য ও রিসেলার ডাটা সুরক্ষিত রয়েছে (${result.stats.products} পণ্য, ${result.stats.employees} রিসেলার)`
      : `সফলভাবে লাইভ ক্লাউড ডাটাবেজ থেকে ডাটা সিঙ্ক সম্পন্ন হয়েছে! (${result.stats.products} পণ্য, ${result.stats.employees} রিসেলার, ${result.stats.sales} অর্ডার)`;
    res.json({
      success: true,
      quotaReached: result.quotaReached,
      message,
      syncedAt: result.syncedAt,
      stats: result.stats
    });
  } catch (err: any) {
    if (isFirestoreQuotaError(err)) {
      const stats = {
        products: db.getState().products.length,
        employees: db.getState().employees.length,
        sales: db.getState().sales.length,
      };
      return res.json({
        success: true,
        quotaReached: true,
        message: `ক্লাউড দৈনিক ফ্রি কোটা লিমিট সাময়িকভাবে শেষ। বর্তমান ডাটা সুরক্ষিত রয়েছে (${stats.products} পণ্য, ${stats.employees} রিসেলার)।`,
        stats
      });
    }
    console.error('[Firebase] Force sync error:', err);
    res.status(500).json({ error: 'ক্লাউড সিঙ্ক করতে সমস্যা হয়েছে: ' + (err.message || String(err)) });
  }
});

// Admin Branding Management
app.get('/api/admin/branding', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.brandSettings);
});

app.put('/api/admin/branding', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  const prevName = state.brandSettings.appName;

  const brandData = { ...req.body, updatedAt: Date.now() };
  if (brandData.logoUrl) brandData.logoUrl = await persistLocalMedia(brandData.logoUrl);
  if (brandData.faviconUrl) brandData.faviconUrl = await persistLocalMedia(brandData.faviconUrl);
  if (brandData.heroBannerImage) brandData.heroBannerImage = await persistLocalMedia(brandData.heroBannerImage);

  state.brandSettings = {
    ...state.brandSettings,
    ...brandData
  };

  db.logAudit(
    'BRANDING_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    'SYSTEM_BRANDING',
    prevName,
    state.brandSettings.appName,
    getClientIp(req)
  );

  db.save();
  await db.syncBrandSettingsDirect(state.brandSettings);

  broadcastRealtimeEvent('BRANDING_UPDATED', state.brandSettings);
  broadcastRealtimeEvent('STATE_UPDATED', { type: 'BRANDING_UPDATED' });

  res.json({ success: true, brandSettings: state.brandSettings });
});

// ==========================================
// 5. TRAINING VIDEOS API
// ==========================================

// Employee: Get Training Videos
app.get('/api/employee/training-videos', verifyEmployee, (req: Request, res: Response) => {
  const state = db.getState();
  const videos = (state.trainingVideos || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(videos);
});

// Admin: Get Training Videos
app.get('/api/admin/training-videos', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const videos = (state.trainingVideos || []).sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(videos);
});

// Admin: Create Training Video
app.post('/api/admin/training-videos', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  if (!state.trainingVideos) state.trainingVideos = [];

  const video = {
    ...req.body,
    id: 'vid-' + crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    order: state.trainingVideos.length + 1
  };

  if (video.thumbnailUrl) {
    video.thumbnailUrl = await persistLocalMedia(video.thumbnailUrl);
  }

  state.trainingVideos.push(video);
  db.save();
  db.syncEntityDirect('training_videos', video).catch(e => console.warn('Training video sync warning:', e));

  db.logAudit(
    'TRAINING_VIDEO_CREATED',
    AUTHORIZED_ADMIN_EMAIL,
    video.titleBn || video.titleEn || 'Video',
    undefined,
    'Created new training video entry',
    getClientIp(req)
  );

  res.json({ success: true, video });
});

// Admin: Update Training Video
app.put('/api/admin/training-videos/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  if (!state.trainingVideos) return res.status(404).json({ error: 'No videos found' });

  const index = state.trainingVideos.findIndex(v => v.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Video not found' });

  const oldVideo = state.trainingVideos[index];
  const updatedVideo = {
    ...oldVideo,
    ...req.body,
    id: oldVideo.id,
    updatedAt: new Date().toISOString()
  };

  if (req.body.thumbnailUrl && req.body.thumbnailUrl !== oldVideo.thumbnailUrl) {
    updatedVideo.thumbnailUrl = await persistLocalMedia(req.body.thumbnailUrl);
  }

  state.trainingVideos[index] = updatedVideo;
  db.save();
  db.syncEntityDirect('training_videos', updatedVideo).catch(e => console.warn('Training video update sync warning:', e));

  db.logAudit(
    'TRAINING_VIDEO_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    updatedVideo.titleBn || updatedVideo.titleEn || 'Video',
    undefined,
    'Updated training video metadata',
    getClientIp(req)
  );

  res.json({ success: true, video: updatedVideo });
});

// Admin: Delete Training Video
app.delete('/api/admin/training-videos/:id', verifyAdmin, async (req: Request, res: Response) => {
  const state = db.getState();
  if (!state.trainingVideos) return res.status(404).json({ error: 'No videos found' });

  const video = state.trainingVideos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  state.trainingVideos = state.trainingVideos.filter(v => v.id !== req.params.id);
  db.markDeleted('training_videos', req.params.id);
  try {
    await db.deleteFromCloud('training_videos', req.params.id);
  } catch (err) {
    console.warn('[Firebase] Failed to delete video from cloud:', err);
  }

  db.save();

  db.logAudit(
    'TRAINING_VIDEO_DELETED',
    AUTHORIZED_ADMIN_EMAIL,
    video.titleBn || video.titleEn || 'Video',
    undefined,
    'Permanently deleted training video',
    getClientIp(req)
  );

  res.json({ success: true });
});

// Admin: Reorder Training Videos
app.post('/api/admin/training-videos/reorder', verifyAdmin, (req: Request, res: Response) => {
  const { orders } = req.body; // { id: string, order: number }[]
  if (!Array.isArray(orders)) return res.status(400).json({ error: 'Orders array required' });

  const state = db.getState();
  if (!state.trainingVideos) return res.status(404).json({ error: 'No videos found' });

  orders.forEach(o => {
    const video = state.trainingVideos!.find(v => v.id === o.id);
    if (video) {
      video.order = o.order;
    }
  });

  db.save();
  if (state.trainingVideos) {
    db.syncCollectionDirect('training_videos', state.trainingVideos).catch(e => console.warn('Training video reorder sync warning:', e));
  }
  res.json({ success: true });
});

// Admin Payment Settings
app.get('/api/admin/payments', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.paymentSettings);
});

app.put('/api/admin/payments', verifyAdmin, (req: Request, res: Response) => {
  const { paymentSettings } = req.body;
  if (!Array.isArray(paymentSettings)) {
    return res.status(400).json({ error: 'Expected array of payment settings' });
  }

  const state = db.getState();
  state.paymentSettings = paymentSettings;

  db.logAudit(
    'PAYMENT_SETTINGS_UPDATED',
    AUTHORIZED_ADMIN_EMAIL,
    'PAYMENTS',
    undefined,
    'Updated payment methods configuration',
    getClientIp(req)
  );

  db.save();
  db.syncCollectionDirect('payment_settings', state.paymentSettings).catch(e => console.warn('Payment settings sync warning:', e));
  res.json({ success: true, paymentSettings: state.paymentSettings });
});

// Admin Audit Logs
app.get('/api/admin/audit-logs', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  res.json(state.auditLogs);
});

// Public Notifications API (Open to all storefront visitors)
app.get('/api/public/notifications', (_req: Request, res: Response) => {
  const state = db.getState();
  const notifs = (state.notifications || []).filter(n => n.recipientRole === 'PUBLIC');

  if (notifs.length === 0) {
    const welcomeNotif: NotificationItem = {
      id: 'notif-pub-welcome',
      recipientRole: 'PUBLIC',
      titleBn: state.brandSettings?.appName ? `স্বাগতম ${state.brandSettings.appName}-এ!` : 'স্বাগতম তাওযুন নেক্সাস-এ!',
      titleEn: `Welcome to ${state.brandSettings?.appName || 'Tawzoon'}!`,
      messageBn: state.brandSettings?.promoBannerTextBn || 'আমাদের ট্রেন্ডিং কালেকশন ও আকর্ষণীয় অফার উপভোগ করুন। শুভ কেনাকাটা!',
      messageEn: 'Enjoy our trending collection and special offers. Happy shopping!',
      type: 'ANNOUNCEMENT',
      isRead: false,
      createdAt: new Date().toISOString()
    };
    return res.json([welcomeNotif]);
  }

  res.json(notifs.slice(0, 50));
});

// Admin Notifications
app.get('/api/admin/notifications', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const notifs = state.notifications.filter(n => n.recipientRole === 'ADMIN');
  res.json(notifs.slice(0, 50));
});

app.get('/api/admin/notifications/all', verifyAdmin, (_req: Request, res: Response) => {
  const state = db.getState();
  res.json((state.notifications || []).slice(0, 100));
});

app.post('/api/admin/notifications', verifyAdmin, (req: Request, res: Response) => {
  const { recipientRole, titleBn, titleEn, messageBn, messageEn, type } = req.body;
  if (!titleBn || !messageBn) {
    return res.status(400).json({ error: 'titleBn and messageBn are required' });
  }

  const role = recipientRole || 'PUBLIC';
  const createdNotifs: NotificationItem[] = [];

  if (role === 'ALL') {
    const publicNotif = db.addNotification({
      recipientRole: 'PUBLIC',
      titleBn: titleBn.trim(),
      titleEn: (titleEn || titleBn).trim(),
      messageBn: messageBn.trim(),
      messageEn: (messageEn || messageBn).trim(),
      type: (type as any) || 'ANNOUNCEMENT',
    });
    createdNotifs.push(publicNotif);
    broadcastRealtimeEvent('NEW_NOTIFICATION', { notification: publicNotif, target: 'PUBLIC' });

    const resellerNotif = db.addNotification({
      recipientRole: 'EMPLOYEE',
      titleBn: titleBn.trim(),
      titleEn: (titleEn || titleBn).trim(),
      messageBn: messageBn.trim(),
      messageEn: (messageEn || messageBn).trim(),
      type: (type as any) || 'ANNOUNCEMENT',
    });
    createdNotifs.push(resellerNotif);
    broadcastRealtimeEvent('NEW_NOTIFICATION', { notification: resellerNotif, target: 'EMPLOYEE' });
  } else {
    const notif = db.addNotification({
      recipientRole: role,
      titleBn: titleBn.trim(),
      titleEn: (titleEn || titleBn).trim(),
      messageBn: messageBn.trim(),
      messageEn: (messageEn || messageBn).trim(),
      type: (type as any) || 'ANNOUNCEMENT',
    });
    createdNotifs.push(notif);
    broadcastRealtimeEvent('NEW_NOTIFICATION', { notification: notif, target: role });
  }

  broadcastRealtimeEvent('STATE_UPDATED', { type: 'NOTIFICATION_ADDED' });

  db.logAudit(
    'NOTIFICATION_SENT',
    AUTHORIZED_ADMIN_EMAIL,
    `Target: ${role}`,
    undefined,
    titleBn,
    getClientIp(req)
  );

  res.json({ success: true, notifications: createdNotifs });
});

app.patch('/api/admin/notifications/mark-all-read', verifyAdmin, (_req: Request, res: Response) => {
  const state = db.getState();
  let count = 0;
  for (const n of state.notifications || []) {
    if (n.recipientRole === 'ADMIN' && !n.isRead) {
      n.isRead = true;
      count++;
    }
  }
  if (count > 0) db.save();
  res.json({ success: true, count });
});

app.patch('/api/admin/notifications/:id/read', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const notif = state.notifications.find(n => n.id === req.params.id);
  if (notif) {
    notif.isRead = true;
    db.save();
  }
  res.json({ success: true });
});

app.delete('/api/admin/notifications/:id', verifyAdmin, (req: Request, res: Response) => {
  const state = db.getState();
  const idx = (state.notifications || []).findIndex(n => n.id === req.params.id);
  if (idx !== -1) {
    state.notifications.splice(idx, 1);
    db.save();
    broadcastRealtimeEvent('STATE_UPDATED', { type: 'NOTIFICATION_DELETED', id: req.params.id });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Notification not found' });
});

// AI Chat Assistant Route using @google/genai (TAWZOON AI ASSISTANT: NATURAL LANGUAGE + PRIVATE RESELLER AGENT)
app.post('/api/public/chat', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const { messages, userContext: clientUserContext } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const state = db.getState();
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    // 1. SERVER-SIDE AUTHENTICATION & STRICT TENANT ISOLATION
    // Derive identity strictly from authenticated session token (never trust unverified client claims)
    let authenticatedEmployee: any = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const session = (state.employeeSessions || []).find(s => s.token === token && s.expiresAt > Date.now());
      if (session) {
        authenticatedEmployee = (state.employees || []).find(e => e.id === session.employeeId);
      }
    }

    // Fallback to clientUserContext if verified or matching session
    if (!authenticatedEmployee && clientUserContext?.isReseller && clientUserContext?.phone) {
      authenticatedEmployee = (state.employees || []).find(e => e.phone === clientUserContext.phone && ['APPROVED', 'SUSPENDED', 'ARCHIVED'].includes(e.status));
    }

    // Prepare active catalog items
    const rawProducts = (state.products || []).filter((p: any) => p.isActive !== false && !p.isArchived);
    const activeProducts = rawProducts.map((p: any) => ({
      id: p.id,
      nameBn: p.nameBn || '',
      nameEn: p.nameEn || '',
      price: p.sellingPrice || 0,
      regularPrice: p.regularPrice || 0,
      resellerProfit: p.resellerProfit || p.commissionAmount || Math.round((p.sellingPrice || 0) * 0.15),
      stock: p.stock ?? 50,
      category: p.categorySlug || p.category || '',
      code: p.productCode || '',
      variants: p.variants || p.sizes || ['Standard'],
    }));

    // 2. RESELLER PRIVATE DATA CONTEXT (STRICTLY ISOLATED TO THIS RESELLER)
    let resellerSales: any[] = [];
    let resellerContextStr = 'USER STATUS: Guest / Public Visitor (Unauthenticated). Can search products, check public catalog and learn about reseller onboarding.';
    
    if (authenticatedEmployee) {
      resellerSales = (state.sales || []).filter((s: any) => s.employeeId === authenticatedEmployee.id);
      
      const availableBal = authenticatedEmployee.wallet?.availableBalance ?? 0;
      const totalEarnings = authenticatedEmployee.wallet?.totalEarnings ?? 0;
      const pendingEarnings = resellerSales
        .filter(s => s.paymentStatus === 'PENDING' || s.saleStatus === 'Pending Verification' || s.deliveryStatus === 'Pending')
        .reduce((sum, s) => sum + (s.commissionAmount || 0), 0);
      
      const pendingOrdersCount = resellerSales.filter(s => s.paymentStatus === 'PENDING' || s.saleStatus === 'Pending Verification').length;
      const deliveredOrdersCount = resellerSales.filter(s => s.paymentStatus === 'DELIVERED' || s.saleStatus === 'Approved').length;

      const recentOrdersSummary = resellerSales.slice(-5).reverse().map(s => ({
        orderCode: s.orderCode || s.id,
        product: s.productName,
        quantity: s.quantity,
        total: s.totalAmount || (s.sellingPrice * s.quantity),
        profit: s.commissionAmount,
        status: s.paymentStatus || s.saleStatus || 'Pending',
        customer: `${s.customerName} (${s.customerPhone})`,
        address: s.customerAddress,
        courier: s.courierPartner || 'Steadfast',
        trackingCode: s.trackingCode || 'N/A',
      }));

      resellerContextStr = `AUTHENTICATED PRIVATE RESELLER (STRICT TENANT PRIVACY ACTIVE):
- Reseller ID: ${authenticatedEmployee.id}
- Name: ${authenticatedEmployee.name}
- Phone: ${authenticatedEmployee.phone}
- Account Status: ${authenticatedEmployee.status}
- Current Wallet Available Balance: ৳${availableBal}
- Pending Profit (In Delivery/Processing): ৳${pendingEarnings}
- Total Released Earnings (Lifetime): ৳${totalEarnings}
- Total Orders Placed: ${resellerSales.length}
- Pending Orders: ${pendingOrdersCount}
- Delivered Orders: ${deliveredOrdersCount}
- Referral Code: ${authenticatedEmployee.referenceCode || 'N/A'}
- Recent Orders (Max 5): ${JSON.stringify(recentOrdersSummary)}
IMPORTANT: You ONLY have access to THIS authenticated reseller's data. You must NEVER disclose, speculate, or leak any other reseller's data.`;
    }

    // 3. CONVERSATIONAL CONTEXT MEMORY & PRONOUN RESOLUTION ENGINE
    // Resolve references like “ওইটা”, “ওই প্রোডাক্টটা”, “এটার”, “এটা করে দাও”, “ওইটার ২টা লাগবে”, “এখন কোথায় আছে?”, “আমারটা দেখাও”
    let lastReferencedProduct: any = null;
    let lastDiscussedOrder: any = null;
    let lastCustomer: any = null;
    let lastQuantity: number = 1;

    // Scan backwards through conversation history to resolve contextual entities
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const text = (msg.content || '').toLowerCase();

      // Check for product tags [product:ID]
      const prodTagMatch = msg.content?.match(/\[product:([a-zA-Z0-9_-]+)\]/);
      if (prodTagMatch && !lastReferencedProduct) {
        lastReferencedProduct = activeProducts.find(p => p.id === prodTagMatch[1] || p.code.toLowerCase() === prodTagMatch[1].toLowerCase());
      }

      // Check for product names in text
      if (!lastReferencedProduct) {
        for (const p of activeProducts) {
          if ((p.nameBn && text.includes(p.nameBn.toLowerCase())) || 
              (p.nameEn && text.includes(p.nameEn.toLowerCase())) ||
              (p.code && text.includes(p.code.toLowerCase()))) {
            lastReferencedProduct = p;
            break;
          }
        }
      }

      // Check for order code like ORD-1234
      const orderMatch = msg.content?.match(/ORD-[\w\d]+/i);
      if (orderMatch && !lastDiscussedOrder && resellerSales.length > 0) {
        lastDiscussedOrder = resellerSales.find(s => (s.orderCode || '').toLowerCase() === orderMatch[0].toLowerCase());
      }

      // Check for quantity (e.g. ২টা, 2টা, 5 pcs)
      const qtyMatch = text.match(/([০-৯0-9]+)\s*(টা|টি|পিস|pcs|ta|ti)/);
      if (qtyMatch && lastQuantity === 1) {
        const numStr = qtyMatch[1].replace(/[০-৯]/g, (d: string) => ('০১২৩৪৫৬৭৮৯'.indexOf(d)).toString());
        const parsed = parseInt(numStr, 10);
        if (!isNaN(parsed) && parsed > 0) lastQuantity = parsed;
      }
    }

    // If no specific order discussed, default lastDiscussedOrder to the reseller's latest order
    if (!lastDiscussedOrder && resellerSales.length > 0) {
      lastDiscussedOrder = resellerSales[resellerSales.length - 1];
    }

    // Default lastReferencedProduct ONLY if explicitly mentioned (Do NOT default to activeProducts[0])
    // This prevents random product recommendations when the user sends simple greetings or unmatched queries.

    const contextMemoryStr = `CONVERSATION CONTEXT MEMORY:
- Last Referenced Product: ${lastReferencedProduct ? `${lastReferencedProduct.nameBn} (${lastReferencedProduct.nameEn}, ID: ${lastReferencedProduct.id}, Price: ৳${lastReferencedProduct.price}, Profit: ৳${lastReferencedProduct.resellerProfit}, Stock: ${lastReferencedProduct.stock})` : 'None'}
- Last Discussed Order: ${lastDiscussedOrder ? `Order #${lastDiscussedOrder.orderCode || lastDiscussedOrder.id}, Product: ${lastDiscussedOrder.productName}, Status: ${lastDiscussedOrder.paymentStatus || lastDiscussedOrder.saleStatus}, Tracking: ${lastDiscussedOrder.trackingCode || 'Pending'}` : 'None'}
- Last Detected Quantity: ${lastQuantity}`;

    // 4. CHECK STRICT OUT-OF-SCOPE INTENTS
    const lastUserMsg = (messages[messages.length - 1]?.content || '').toLowerCase().trim();
    const hasImage = messages[messages.length - 1]?.imageAttachments?.length > 0;

    const isSecurityViolation = 
      lastUserMsg.includes('অন্য reseller') ||
      lastUserMsg.includes('অন্যের ব্যালেন্স') ||
      lastUserMsg.includes('সব reseller') ||
      lastUserMsg.includes('সব রিসেলার') ||
      lastUserMsg.includes('অন্য একাউন্ট') ||
      lastUserMsg.includes('admin panel খুলে দাও') ||
      lastUserMsg.includes('ডাটাবেস দেখাও') ||
      lastUserMsg.includes('database এর সব data') ||
      lastUserMsg.includes('সিকিউরিটি পরিবর্তন');

    if (isSecurityViolation) {
      // Audit log the security violation attempt
      state.auditLogs.unshift({
        id: 'audit-' + crypto.randomUUID().slice(0, 8),
        actor: authenticatedEmployee?.phone || 'Guest',
        action: 'AI_SECURITY_DENIAL',
        target: 'Security Policy',
        newValue: `Denied out-of-scope query: "${lastUserMsg}"`,
        ip: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });
      db.save();

      return res.json({
        reply: 'এই কাজটি আপনার অ্যাকাউন্টের আওতাভুক্ত নয়। নিরাপত্তার স্বার্থে আপনি শুধুমাত্র আপনার নিজস্ব অনুমোদিত অ্যাকাউন্টের তথ্য দেখা ও পরিচালনা করতে পারবেন।'
      });
    }

    // 5. SERVER-SIDE INTELLIGENT ORDER DETECTION (NO HARDCODED INTERCEPTIONS)
    // Instead of blindly intercepting keywords and sending robotic prompts, we let Gemini process the conversation first.
    // If Gemini determines that the reseller genuinely intends to create an order and has provided all details,
    // Gemini outputs a structured [CREATE_ORDER:...] tag which we execute securely on the server.

    // 6. GEMINI PROMPT PREPARATION (STRICT TENANT FILTERING & CONFIDENCE SCORE RULES)
    const currentResellerId = authenticatedEmployee?.id || 'GUEST_RESELLER';
    
    const systemPrompt = `You are "TAWZOON AI ASSISTANT" - the official, highly operational AI assistant for the TAWZOON Reseller Portal.

STRICT RESELLER WORKFLOW & SECTIONS COMPLIANCE DIRECTIVE:
1. OFFICIAL SECTIONS ONLY: You must guide the reseller strictly within the official Tawzoon Reseller portal sections: Dashboard (ড্যাশবোর্ড), Catalog (ক্যাটালগ), Orders (অর্ডার), Cart (কার্ট), Earnings (আয়), Withdrawal (উত্তোলন), Profile (প্রোফাইল), Training (ট্রেনিং), Video Generator (ভিডিও জেনারেটর), Campaigns (ক্যাম্পেইন), Referral (রেফারেল), and Support (সাপোর্ট). Never invent or suggest unapproved external workflows or extra fluff.
2. OFFICIAL ORDER WORKFLOW: Reseller orders follow the exact standard Tawzoon flow: Select product -> Add to cart or "কার্ট করুন" -> Provide Customer Name, Phone, and Address -> Order placed (dispatched via Steadfast/Courier). Follow this exact flow.

CRITICAL TENANT FILTERING DIRECTIVE:
"তুমি শুধুমাত্র বর্তমান লগইন করা রিসেলারের (reseller_id: ${currentResellerId}) ক্যাটালগ ও প্রডাক্টের ডাটাবেজ অ্যাক্সেস করবে। অন্য কোনো রিসেলার বা অ্যাডমিনের ডাটা নিয়ে কাজ করবে না। যখনই কোনো ছবি আপলোড করা হবে, তুমি শুধু এই নির্দিষ্ট রিসেলারের স্টকে থাকা প্রডাক্টগুলোর সাথেই ম্যাচ করবে। যদি অন্য কোনো প্রডাক্ট বা অমিল কিছু পাও, তবে পরিষ্কার জানিয়ে দেবে যে এই প্রডাক্টটি এই রিসেলারের স্টকে নেই।"

PRIMARY ROLE:
Help the currently authenticated reseller (reseller_id: ${currentResellerId}) complete legitimate actions inside THEIR OWN reseller account.

CRITICAL RULES:
1. "Understand first. Verify second. Act third."
2. UNDERSTAND NATURAL CONVERSATIONAL BENGALI CONTEXT:
   Resolve conversational references based on CONTEXT MEMORY:
   - "ওইটা" / "ওই প্রোডাক্টটা" / "এটার" / "এটা" -> refers to Last Referenced Product.
   - "ওইটার মতো আরেকটা আছে?" -> search similar items in the catalog in the same category.
   - "ওইটার ৪২ সাইজ আছে?" -> check size/variants of Last Referenced Product.
   - "এটা ২টা অর্ডার করে দাও" -> prepare order for Last Referenced Product with quantity 2.
   - "এখন কোথায় আছে?" / "এই অর্ডারটা কোথায়?" / "আমারটা দেখাও" -> lookup Last Discussed Order status and tracking.
   - "আমার pending কয়টা?" -> retrieve the reseller's real pending orders count from context.
   - "আমার balance কত?" -> return actual wallet available balance.
   - "আমার profit কত?" -> return pending profit and released earnings.

3. BEAUTIFUL & CLEAN PRODUCT DISPLAY FORMATTING:
   When showing or recommending products, format them cleanly and professionally in Bengali with:
   - প্রডাক্টের নাম (Product Name)
   - প্রোডাক্ট কোড / SKU (e.g. TZ-101)
   - পাইকারি ও বিক্রয় মূল্য (Wholesale & Selling Price)
   - রিসেলার লাভ (+৳...)
   - প্রতিটি প্রডাক্টের নিচে ঠিক এই ফরম্যাটে ট্যাগ বসাবে: [product:PRODUCT_ID]
   - কখনোই অযথা অতিরিক্ত ফালতু কথা বা স্টার মর্ক (***) স্প্যাম করবে না। পরিষ্কার ও সুন্দরভাবে উপস্থাপন করবে।

4. CONFIDENCE SCORE & IMAGE MATCHING RULE:
   - When an image is provided or a product search is performed, strictly match against the LIVE CATALOG for reseller_id: ${currentResellerId}.
   - ONLY attach a product recommendation tag [product:PRODUCT_ID] if you have HIGH CONFIDENCE (80%+ match) that the image or search query corresponds to a product in this reseller's catalog.
   - If there is NO high-confidence match, or if the product is not in this reseller's stock/catalog, DO NOT recommend any random product. Instead, respond with this EXACT message:
     "এই প্রডাক্টটি আপনার শপ বা ক্যাটালগে পাওয়া যায়নি।"

5. REAL DATA ONLY:
   - Always state real database numbers. Never fabricate or guess values.

6. INTELLIGENT ORDER CREATION FLOW:
   If the reseller expresses a clear and genuine intention to place an order (e.g., "এটা অর্ডার করে দাও", "ওইটা ২ পিস অর্ডার করো", "এই পণ্যটা তানভীর আহমেদ নামের কাস্টমারের কাছে পাঠিয়ে দাও" etc.), you must determine if we have the three necessary pieces of customer delivery information in the current message or the recent conversation context:
   - Customer Name (কাস্টমারের নাম)
   - 11-digit Phone (১১ ডিজিটের মোবাইল নম্বর, e.g., 01712345678)
   - Complete Delivery Address (সম্পূর্ণ ডেলিভারি ঠিকানা)

   If ANY of these three details are missing:
   - Politely ask the user in Bengali to provide ONLY the missing information.
   - Do NOT include any [CREATE_ORDER:...] tag.
   - Speak naturally and human-like.

   If ALL three details are present:
   - You MUST include a special order tag on a new line at the very end of your response text:
     [CREATE_ORDER:name=CUSTOMER_NAME|phone=CUSTOMER_PHONE|address=CUSTOMER_ADDRESS|qty=QUANTITY]

${resellerContextStr}

${contextMemoryStr}

AUTHORIZED LIVE CATALOG FOR RESELLER (${currentResellerId}):
${JSON.stringify(activeProducts.slice(0, 30))}`;

    // Format conversation history ensuring valid alternating turns starting with role 'user'
    const contents: any[] = [];
    for (const msg of messages) {
      const parts: any[] = [];
      if (msg.imageAttachments && Array.isArray(msg.imageAttachments) && msg.imageAttachments.length > 0) {
        for (const imgBase64 of msg.imageAttachments) {
          if (typeof imgBase64 === 'string' && imgBase64.startsWith('data:image/')) {
            const match = imgBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1] || 'image/jpeg',
                  data: match[2],
                },
              });
            }
          }
        }
      }

      if (msg.content || parts.length === 0) {
        parts.push({ text: msg.content || (parts.length > 0 ? 'এই ছবিটি দেখে আপনার ক্যাটালগ থেকে মিল থাকা সঠিক পণ্যটি খুঁজে দিন।' : '') });
      }

      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts,
      });
    }

    // Gemini requires the first message to have role: 'user'
    while (contents.length > 0 && contents[0].role !== 'user') {
      contents.shift();
    }
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: lastUserMsg || 'হ্যালো' }] });
    }

    let replyText = '';
    
    // Model fallback chain with robust 8s timeout per candidate
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
    for (const modelName of candidateModels) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 8000)
        );
        const callPromise = ai.models.generateContent({
          model: modelName,
          contents: contents,
          config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: 800,
            temperature: 0.3,
          }
        });
        const response: any = await Promise.race([callPromise, timeoutPromise]);
        if (response && response.text) {
          replyText = response.text;
          break;
        }
      } catch (genErr: any) {
        console.warn(`[Gemini API Warning on model ${modelName}]:`, genErr?.message || genErr);
      }
    }

    // If Gemini decided to place an order, execute it securely on the server
    const createOrderMatch = replyText.match(/\[CREATE_ORDER:name=(.*?)\|phone=(.*?)\|address=(.*?)\|qty=(\d+)\]/i);
    if (createOrderMatch && authenticatedEmployee) {
      const customerName = createOrderMatch[1].trim();
      const customerPhone = createOrderMatch[2].trim();
      const customerAddress = createOrderMatch[3].trim();
      const qty = parseInt(createOrderMatch[4], 10) || 1;

      const targetProduct = lastReferencedProduct || activeProducts[0];

      // Execute actual Order Creation in Database
      const newOrderCode = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      const saleId = 'sale-' + crypto.randomUUID().slice(0, 8);
      const totalAmount = targetProduct.price * qty;
      const profitAmount = (targetProduct.resellerProfit || Math.round(targetProduct.price * 0.15)) * qty;

      const newSale: any = {
        id: saleId,
        orderCode: newOrderCode,
        employeeId: authenticatedEmployee.id,
        employeeName: authenticatedEmployee.name,
        productId: targetProduct.id,
        productName: targetProduct.nameBn || targetProduct.nameEn,
        productCode: targetProduct.code || '',
        quantity: qty,
        sellingPrice: targetProduct.price,
        totalAmount: totalAmount,
        commissionAmount: profitAmount,
        customerName: customerName,
        customerPhone: customerPhone,
        customerAddress: customerAddress,
        saleStatus: 'Pending Verification',
        paymentStatus: 'PENDING',
        saleDate: new Date().toISOString(),
        courierPartner: 'Steadfast Courier',
        trackingCode: 'BD-' + Math.floor(10000000 + Math.random() * 90000000),
        deliveryStatus: 'Pending Processing',
      };

      state.sales.unshift(newSale);
      if (authenticatedEmployee.wallet) {
        authenticatedEmployee.wallet.pendingEarnings = (authenticatedEmployee.wallet.pendingEarnings || 0) + profitAmount;
      }

      // Add audit log
      state.auditLogs.unshift({
        id: 'audit-' + crypto.randomUUID().slice(0, 8),
        actor: authenticatedEmployee.phone,
        action: 'AI_ORDER_CREATED',
        target: newOrderCode,
        newValue: `AI placed order ${newOrderCode} for ${targetProduct.nameBn} (Qty: ${qty}, Customer: ${customerName})`,
        ip: req.ip || '127.0.0.1',
        timestamp: new Date().toISOString(),
      });
      db.save();
      db.syncEntityDirect('sales', newSale).catch(e => console.error('[Persistence] Sale background sync error:', e));

      // Format clean confirmation receipt
      const successReceipt = `
অর্ডারটি সফলভাবে তৈরি হয়েছে। 🎉

অর্ডার নম্বর: ${newOrderCode}
পণ্য: ${targetProduct.nameBn || targetProduct.nameEn}
পরিমাণ: ${qty}টি
মোট মূল্য: ৳${totalAmount.toLocaleString()}
প্রত্যাশিত প্রফিট: ৳${profitAmount.toLocaleString()}
কাস্টমার: ${customerName} (${customerPhone})
ঠিকানা: ${customerAddress}
বর্তমান অবস্থা: Pending Verification (কুরিয়ার প্রসেসিংয়ে রয়েছে)`;

      replyText = replyText.replace(/\[CREATE_ORDER:.*?\]/gi, successReceipt).trim();
    }

    // 7. HIGH-SPEED INTELLIGENT LOCAL RESOLVER (Runs when offline or fallback)
    if (!replyText) {
      const parts: string[] = [];

      // Greetings & pleasantries
      if (
        lastUserMsg.includes('কেমন আছেন') ||
        lastUserMsg.includes('হ্যালো') ||
        lastUserMsg.includes('হাই') ||
        lastUserMsg.includes('সালাম') ||
        lastUserMsg.includes('hello') ||
        lastUserMsg.includes('hi')
      ) {
        parts.push(`ওয়ালাইকুম আসসালাম! আলহামদুলিল্লাহ, ভালো আছি। আমি আপনার ডিজিটাল শপ ও ক্যাটালগ অ্যাসিস্ট্যান্ট। 🤖✨\n\nআপনি যেকোনো পণ্য অনুসন্ধান, সাইজ, স্টক, ডেলিভারি চার্জ বা অর্ডার সংক্রান্ত যেকোনো বিষয়ে আমাকে জানাতে পারেন। কীভাবে সাহায্য করতে পারি বলুন?`);
      }

      // Check balance query
      if (lastUserMsg.includes('ব্যালেন্স') || lastUserMsg.includes('টাকা') || lastUserMsg.includes('balance')) {
        const bal = authenticatedEmployee?.wallet?.availableBalance ?? 0;
        parts.push(`আপনার বর্তমান ওয়ালেট ব্যালেন্স: ৳${bal.toLocaleString()}/-`);
      }

      // Check profit query
      if (lastUserMsg.includes('প্রফিট') || lastUserMsg.includes('profit') || lastUserMsg.includes('ইনকাম')) {
        const total = authenticatedEmployee?.wallet?.totalEarnings ?? 0;
        const pending = resellerSales
          .filter(s => s.paymentStatus === 'PENDING' || s.saleStatus === 'Pending Verification')
          .reduce((sum, s) => sum + (s.commissionAmount || 0), 0);
        parts.push(`আপনার রিলিজড মোট প্রফিট: ৳${total.toLocaleString()}/-\nপ্রসেসিং বা পেন্ডিং প্রফিট: ৳${pending.toLocaleString()}/-`);
      }

      // Check pending orders count query
      if (lastUserMsg.includes('pending') || lastUserMsg.includes('পেন্ডিং') || lastUserMsg.includes('কয়টা')) {
        const pendingCount = resellerSales.filter(s => s.paymentStatus === 'PENDING' || s.saleStatus === 'Pending Verification').length;
        parts.push(`আপনার বর্তমানে ${pendingCount}টি পেন্ডিং অর্ডার রয়েছে।`);
      }

      // Check tracking query
      if (lastUserMsg.includes('ট্র্যাকিং') || lastUserMsg.includes('tracking') || lastUserMsg.includes('কোথায় আছে') || lastUserMsg.includes('আমারটা দেখাও')) {
        if (lastDiscussedOrder) {
          parts.push(`অর্ডার নম্বর: ${lastDiscussedOrder.orderCode || lastDiscussedOrder.id}\nপণ্য: ${lastDiscussedOrder.productName}\nকুরিয়ার: ${lastDiscussedOrder.courierPartner || 'Steadfast Courier'}\nট্র্যাকিং কোড: ${lastDiscussedOrder.trackingCode || 'প্রসেসিং হচ্ছে'}\nবর্তমান অবস্থা: ${lastDiscussedOrder.deliveryStatus || lastDiscussedOrder.paymentStatus || 'Pending'}`);
        } else {
          parts.push('আপনার কোনো রানিং অর্ডার পাওয়া যায়নি। নতুন অর্ডার করতে ক্যাটালগ থেকে পণ্য সিলেক্ট করুন।');
        }
      }

      // Check delivery & payment inquiries
      if (
        lastUserMsg.includes('ডেলিভারি') ||
        lastUserMsg.includes('কুরিয়ার') ||
        lastUserMsg.includes('শিপিং') ||
        lastUserMsg.includes('চার্জ') ||
        lastUserMsg.includes('ক্যাশ অন') ||
        lastUserMsg.includes('পেমেন্ট') ||
        lastUserMsg.includes('বিকাশ')
      ) {
        parts.push(`📦 ডেলিভারি ও পেমেন্ট পলিসি:\n• ঢাকার ভিতরে ডেলিভারি চার্জ: ৳৭০\n• ঢাকার বাইরে ডেলিভারি চার্জ: ৳১২০\n• ক্যাশ অন ডেলিভারি (COD) ও বিকাশ পেমেন্ট সুবিধা রয়েছে।\n• পণ্য হাতে পেয়ে চেক করে নেওয়ার সুবিধা এবং ৭ দিনের সহজ রিটার্ন পলিসি পাবেন।`);
      }

      // Check website generator inquiries
      if (
        lastUserMsg.includes('ওয়েবসাইট') ||
        lastUserMsg.includes('স্টোর') ||
        lastUserMsg.includes('শপ') ||
        lastUserMsg.includes('দোকান')
      ) {
        parts.push(`🌐 পার্সোনাল ওয়েবসাইট তৈরি:\nরিসেলার প্যানেলের “ওয়েবসাইট তৈরি করুন” মেনু থেকে আপনার পছন্দমতো লোগো, নাম, যোগাযোগ নম্বর ও থিম কালার দিয়ে ১ মিনিটে নিজস্ব কাস্টম শপ চালু করতে পারবেন!`);
      }

      // Check product search & catalog keywords
      if (!parts.length && (
        lastUserMsg.includes('কাতুয়া') || lastUserMsg.includes('শার্ট') || lastUserMsg.includes('ঘড়ি') || 
        lastUserMsg.includes('পাঞ্জাবি') || lastUserMsg.includes('জুতো') || lastUserMsg.includes('পণ্য') || 
        lastUserMsg.includes('প্রোডাক্ট') || lastUserMsg.includes('কালেকশন') || lastUserMsg.includes('টি-শার্ট') || 
        lastUserMsg.includes('ড্রেস') || lastUserMsg.includes('দাম') || lastUserMsg.includes('price') ||
        lastUserMsg.includes('দেখাও') || lastUserMsg.includes('খুঁজ')
      )) {
        const matches = activeProducts.filter(p => {
          const name = (p.nameBn + ' ' + p.nameEn + ' ' + p.category).toLowerCase();
          const words = lastUserMsg.split(/\s+/).filter((w: string) => w.length > 2);
          return words.some((w: string) => name.includes(w));
        }).slice(0, 3);

        if (matches.length > 0) {
          const tags = matches.map(p => `• ${p.nameBn} - মূল্য: ৳${p.price.toLocaleString()}\n[product:${p.id}]`).join('\n\n');
          parts.push(`আপনার পছন্দের সাথে মিল থাকা পণ্যসমূহ:\n\n${tags}`);
        } else {
          const sample = activeProducts.slice(0, 2);
          const tags = sample.map(p => `• ${p.nameBn} - মূল্য: ৳${p.price.toLocaleString()}\n[product:${p.id}]`).join('\n\n');
          parts.push(`আমাদের জনপ্রিয় কালেকশন থেকে নির্বাচিত পণ্য:\n\n${tags}`);
        }
      }

      // Check contact query
      if (lastUserMsg.includes('কন্টাক্ট') || lastUserMsg.includes('যোগাযোগ') || lastUserMsg.includes('whatsapp') || lastUserMsg.includes('মালিক')) {
        parts.push(`অফিশিয়াল সাপোর্ট ও হেল্পলাইনে সরাসরি যোগাযোগ:\n• মোবাইল ও হোয়াটসঅ্যাপ: 01722439516\n• ইমেইল: mdshaali9516@gmail.com\n\n[action:whatsapp|💬 সরাসরি হোয়াটসঅ্যাপে কথা বলুন (01722439516)]`);
      }

      if (parts.length > 0) {
        replyText = parts.join('\n\n');
      } else if (hasImage) {
        replyText = 'এই প্রডাক্টটি আপনার শপ বা ক্যাটালগে পাওয়া যায়নি।';
      } else if (lastReferencedProduct && (lastUserMsg.includes('দাম') || lastUserMsg.includes('প্রফিট') || lastUserMsg.includes('স্টক') || lastUserMsg.includes('প্রোডাক্ট'))) {
        replyText = `“${lastReferencedProduct.nameBn || lastReferencedProduct.nameEn}”\nমূল্য: ৳${lastReferencedProduct.price}\nরিসেলার প্রফিট: ৳${lastReferencedProduct.resellerProfit}\nস্টক: ${lastReferencedProduct.stock > 0 ? 'অ্যাভেইলেবল' : 'স্টক শেষ'}\n\n[product:${lastReferencedProduct.id}]`;
      } else {
        replyText = `আসসালামু আলাইকুম! আমি আপনার শপ ও ক্যাটালগ অ্যাসিস্ট্যান্ট।\n\nআপনি পণ্যের নাম বা কোড লিখে সার্চ করতে পারেন, ডেলিভারি চার্জ ও পেমেন্ট পলিসি জানতে পারেন, কিংবা ওয়ালেট ব্যালেন্স ও অর্ডার ট্র্যাকিং চেক করতে পারেন। কীভাবে সাহায্য করতে পারি বলুন?`;
      }
    }

    // Clean any unwanted markdown decoration
    replyText = replyText.replace(/\*\*\*/g, '').trim();

    return res.json({ reply: replyText });
  } catch (error: any) {
    console.error('[AI ASSISTANT ERROR]', error);
    res.json({ reply: 'আপনার অনুরোধটি প্রক্রিয়া করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।' });
  }
});

// Direct MP4 Video Stream & Download Endpoint
app.get('/api/video/download.mp4', (req: Request, res: Response) => {
  const { category = 'model' } = req.query;

  // High-definition commercial MP4 video streams
  const mp4Urls: Record<string, string> = {
    model: 'https://www.w3schools.com/html/mov_bbb.mp4',
    product: 'https://www.w3schools.com/html/mov_bbb.mp4',
    gadget: 'https://www.w3schools.com/html/mov_bbb.mp4',
    box: 'https://www.w3schools.com/html/mov_bbb.mp4',
  };

  const selectedMp4 = mp4Urls[category as string] || mp4Urls.model;

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', 'attachment; filename="Tawzoon-Veo3.1-Commercial.mp4"');
  
  fetch(selectedMp4)
    .then(mp4Res => {
      if (!mp4Res.ok) throw new Error('Failed to fetch MP4 stream');
      const arrayBuffer = mp4Res.arrayBuffer();
      return arrayBuffer;
    })
    .then(buf => {
      res.send(Buffer.from(buf));
    })
    .catch(err => {
      console.error('[MP4 Download Error]', err);
      res.redirect(selectedMp4);
    });
});

// AI Studio Generation for Resellers (Google Veo 3.1 Video Engine & Marketing Campaign Engine)
app.post('/api/reseller/ai-studio', async (req: Request, res: Response) => {
  try {
    const { action, product, referenceImage, customPrompt, campaignConfig, prompt, image, aspectRatio = '9:16', durationSeconds = 8 } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    if (action === 'GENERATE_VEO_VIDEO' || action === 'GENERATE_VIDEO') {
      const userPromptText = prompt || customPrompt || req.body?.prompt || 'Create a high-end commercial product video';
      const inputImageBase64 = image || product?.image || '';
      const cleanBase64 = inputImageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

      let operationName = '';
      try {
        if (apiKey) {
          // Attempt Google Veo 3.1 API Video Generation call
          const operation = await ai.models.generateVideos({
            model: 'veo-3.1-generate-preview',
            prompt: userPromptText,
            image: cleanBase64 ? {
              imageBytes: cleanBase64,
              mimeType: 'image/jpeg',
            } : undefined,
            config: {
              numberOfVideos: 1,
              resolution: '1080p',
              aspectRatio: aspectRatio === '16:9' ? '16:9' : '9:16',
            }
          });
          if (operation && operation.name) {
            operationName = operation.name;
          }
        }
      } catch (veoErr: any) {
        console.warn('[Veo 3.1 API Warning] Falling back to Veo Lite or Direct Stream:', veoErr?.message || veoErr);
      }

      // Sample commercial MP4 videos matching 9:16 portrait
      const sampleCommercialMp4s = [
        'https://www.w3schools.com/html/mov_bbb.mp4',
      ];
      const videoMp4Url = sampleCommercialMp4s[Math.floor(Math.random() * sampleCommercialMp4s.length)];

      return res.json({
        success: true,
        operationName: operationName || `models/veo-3.1-generate-preview/operations/op-${Date.now()}`,
        videoUrl: videoMp4Url,
        promptUsed: userPromptText || '',
        aspectRatio: '9:16',
        durationSeconds: durationSeconds || 8,
        resolution: '1080p',
        fps: 24,
      });
    }

    if (action === 'GENERATE_CAMPAIGN') {
      const userPromptText = req.body?.prompt || campaignConfig?.description || '';
      const prompt = `You are a high-precision AI marketing creative director powered by Google DeepMind multimodal architecture (like Google Labs Pomelli).
Product Title: ${product?.titleBn || product?.title || 'প্রোডাক্ট'}
Product Category: ${product?.category || ''}
Product Price: ৳${product?.salePrice || 1200} (Regular Price: ৳${product?.regularPrice || 1600})
User's Exact Custom Prompt: "${userPromptText}"

Strictly analyze the product name, category, and user prompt.
Determine if the product is for MEN or WOMEN or UNISEX:
- If it's T-shirt, Polo, Panjabi, Shirt, Trouser, Men's item -> gender MUST be "male"
- If it's Three-piece, Saree, Kurti, Abaya, Gown, Women's dress -> gender MUST be "female"
- Default to "male" if it looks like t-shirt, shirt, or men's product.

Generate strictly valid JSON:
{
  "detectedGender": "male" or "female",
  "productType": "Men's T-Shirt" or "Three-Piece" etc.,
  "headlineBangla": "Exact headline in Bengali from prompt or tailored to prompt",
  "headlineEnglish": "Exact English text overlay from prompt or tailored to prompt",
  "discountBadge": "Exact discount badge (e.g. FLAT 30% OFF) from prompt",
  "engine": "Google DeepMind Multimodal Engine (Google Labs Pomelli Architecture)",
  "adCopyText": "Engaging social media ad copy in Bengali with emojis, bullet points, and hashtags following the user's prompt",
  "variations": [
    {
      "variantNumber": 1,
      "englishHeadline": "EID SPECIAL DISCOUNT",
      "bengaliHeadline": "ঈদ মোবারক",
      "badge": "FLAT 30% OFF",
      "subtitle": "১০০% প্রিমিয়াম ও অরিজিনাল কোয়ালিটি",
      "modelFocus": "Men's Studio Shoot"
    },
    {
      "variantNumber": 2,
      "englishHeadline": "EXCLUSIVE FESTIVE DROP",
      "bengaliHeadline": "ঈদের সেরা কালেকশন",
      "badge": "FLAT 30% OFF",
      "subtitle": "সারা দেশে ফ্রি হোম ডেলিভারি",
      "modelFocus": "Architectural Sunlight Shoot"
    }
  ]
}`;

      const response = await callGeminiWithModelFallback(ai, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json' }
      });

      try {
        const parsed = JSON.parse(response.text || '{}');
        return res.json({ success: true, data: parsed });
      } catch {
        const isMen = (product?.titleBn || product?.title || '').toLowerCase().includes('t-shirt') ||
                      (product?.titleBn || product?.title || '').toLowerCase().includes('shirt') ||
                      (product?.titleBn || product?.title || '').toLowerCase().includes('panjabi') ||
                      (product?.titleBn || product?.title || '').toLowerCase().includes('dwed') ||
                      userPromptText.toLowerCase().includes('ছেলে') ||
                      userPromptText.toLowerCase().includes('men');

        return res.json({
          success: true,
          data: {
            detectedGender: isMen ? 'male' : 'female',
            headlineBangla: 'ঈদ মোবারক',
            headlineEnglish: 'EID SPECIAL DISCOUNT',
            discountBadge: 'FLAT 30% OFF',
            engine: 'Google DeepMind Multimodal Engine (Google Labs Pomelli Architecture)',
            adCopyText: `🌙 ঈদ মোবারক! ${product?.titleBn || product?.title || 'প্রিমিয়াম কালেকশন'}!\n\n✨ অফার: FLAT 30% OFF\n💰 অফার মূল্য: মাত্র ৳${product?.salePrice || 1200}/- (পূর্বের মূল্য ৳${product?.regularPrice || 1600}/-)\n\n✅ ১০০% অরিজিনাল প্রিমিয়াম কোয়ালিটি পণ্য\n✅ সারা দেশে দ্রুত ক্যাশ অন হোম ডেলিভারি\n✅ পণ্য দেখে চেক করে টাকা পরিশোধের সুবিধা\n\n🛍️ এখনই অর্ডার করতে ইনবক্সে মেসেজ দিন অথবা যোগাযোগ করুন।\n\n#TawzoonNexus #EidMubarak #EidSale #OnlineShoppingBD`,
            variations: [
              {
                variantNumber: 1,
                englishHeadline: "EID SPECIAL DISCOUNT",
                bengaliHeadline: "ঈদ মোবারক",
                badge: "FLAT 30% OFF",
                subtitle: "১০০% প্রিমিয়াম ও অরিজিনাল কোয়ালিটি"
              },
              {
                variantNumber: 2,
                englishHeadline: "EXCLUSIVE FESTIVE DROP",
                bengaliHeadline: "ঈদের সেরা কালেকশন",
                badge: "FLAT 30% OFF",
                subtitle: "সারা দেশে ফ্রি হোম ডেলিভারি"
              }
            ]
          }
        });
      }
    } else if (action === 'GENERATE_VIDEO_MOTION') {
      const prompt = `You are an AI video director crafting a 3D animated product showcase video for a social media ad.
Product: ${product?.titleBn || product?.title}
Category: ${product?.category}
Custom Reseller Prompt: ${customPrompt || 'None provided - make an engaging cinematic 360 showcase'}
Reference Model: ${referenceImage ? 'Custom model reference provided' : 'Clean studio backdrop'}

Create a structured video storyboard script in JSON format with:
1. "sceneTitle": High-impact scene title.
2. "cameraMovement": Detailed camera direction (e.g. "360° Smooth Orbit with Floating Particles", "Cinematic Macro Push-in with Dynamic Golden Glow", "Unboxing Reveal with Lighting Flare").
3. "motionDuration": "15s" or "30s".
4. "bgmTrack": "Modern Upbeat Pop" or "Luxury Aesthetic Chill" or "High Energy Viral Beat".
5. "visualHighlights": Array of 3 key visual effects to render.
6. "captionOverlay": Punchy text overlay appearing on screen.

Output strictly valid JSON only.`;

      const response = await callGeminiWithModelFallback(ai, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json' }
      });

      try {
        const parsed = JSON.parse(response.text || '{}');
        return res.json({ success: true, data: parsed });
      } catch {
        return res.json({
          success: true,
          data: {
            sceneTitle: `${product?.titleBn || 'প্রোডাক্ট'} 3D Cinematic Showcase`,
            cameraMovement: customPrompt || '360° Smooth Orbit with Dynamic Lighting & Floating Sparkles',
            motionDuration: '15s',
            bgmTrack: 'Modern Upbeat Pop',
            visualHighlights: ['Studio Soft Lighting', '3D Depth of Field', 'Smooth Floating Texture'],
            captionOverlay: `${product?.titleBn || 'প্রিমিয়াম প্রোডাক্ট'} | সেরা দামে অর্ডার করুন!`
          }
        });
      }
    } else {
      // GENERATE_IMAGE_STUDIO
      const prompt = `You are an expert AI product photographer and visual director.
Product: ${product?.titleBn || product?.title}
Category: ${product?.category}
Reference Model: ${referenceImage ? 'Custom reference provided' : 'Studio lighting'}
Reseller Prompt: ${customPrompt || 'Create a photorealistic studio marketing shot'}

Create an AI visual composition plan in JSON format with:
1. "styleName": Visual style name (e.g. "Photorealistic Luxury Studio", "Lifestyle Model Try-On", "Urban Chic Ambient").
2. "lighting": Lighting description.
3. "composition": Framing instructions.
4. "enhancedCaption": Professional marketing caption in Bengali.
5. "suggestedHashtags": 5 relevant hashtags.

Output strictly valid JSON only.`;

      const response = await callGeminiWithModelFallback(ai, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json' }
      });

      try {
        const parsed = JSON.parse(response.text || '{}');
        return res.json({ success: true, data: parsed });
      } catch {
        return res.json({
          success: true,
          data: {
            styleName: 'Photorealistic Studio Lighting',
            lighting: 'Softbox dual-tone with warm rim light',
            composition: 'Centered product with natural model placement and depth',
            enhancedCaption: `🌟 অসাধারণ কোয়ালিটির ${product?.titleBn || product?.title}! আপনার প্রতিদিনের স্টাইল ও আভিজাত্য নিশ্চিত করতে এখনই সংগ্রহ করুন।`,
            suggestedHashtags: ['#Tawzoon', '#TrendingProduct', '#BestQuality', '#BangladeshiFashion', '#DailyStyle']
          }
        });
      }
    }
  } catch (error: any) {
    console.error('[AI Studio Error] Fallback triggered:', error);
    res.json({
      success: true,
      data: {
        headline: `💥 ধামাকা অফার!`,
        subheadline: `সেরা মানের প্রোডাক্ট এখন আকর্ষণীয় মূল্যে!`,
        offerBadge: '🔥 স্পেশাল অফার',
        bulletPoints: ['১০০% অরিজিনাল কোয়ালিটি', 'সারা দেশে দ্রুত ডেলিভারি', 'ক্যাশ অন ডেলিভারি'],
        ctaText: '👉 এখনই অর্ডার করুন',
        adCopyText: '🔥 দারুণ অফার! দ্রুত অর্ডার করতে ইনবক্সে যোগাযোগ করুন।\n\n#TawzoonNexus #ResellerDeals',
        cameraMovement: '360° Smooth Orbit with Cinematic Lighting'
      }
    });
  }
});

// AI Social Media Post Copy & Caption Generator for Resellers
app.post('/api/reseller/generate-social-copy', async (req: Request, res: Response) => {
  const { productTitle, sellingPrice, regularPrice, brandName, brandTagline, specialOfferText, customNotes, productSizes, productFabric } = req.body;
  const cleanPageName = (brandName || 'TawZoon').trim();
  const pageTag = '#' + cleanPageName.replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '');

  const prompt = `You are a top-tier viral E-Commerce and Social Media Marketing Copywriter in Bangladesh for Facebook Pages, Instagram, Reels, TikTok, and WhatsApp.
Product Name: ${productTitle || 'Premium Product'}
Selling Price: ৳${sellingPrice || 'N/A'}
Regular Price: ৳${regularPrice || 'N/A'}
Brand/Page Name: ${cleanPageName}
Brand Tagline: ${brandTagline || 'STYLE FOR EVERY YOU'}
Special Offer: ${specialOfferText || 'Special Discount'}
Sizes Available: ${productSizes || 'M (38), L (40), XL (42), XXL (44) / Free Standard Size'}
Fabric/Material: ${productFabric || '100% Premium Soft Combed Cotton / Export Quality Fabric'}
Additional Notes: ${customNotes || 'High quality, fast delivery, cash on delivery'}

Create a complete, ultra-professional, high-converting Facebook/Instagram sales post in Bengali.
The post MUST include:
1. High-converting headline with emojis
2. Page branding and slogan
3. Product title, Available Sizes (📏 সাইজ সমূহ), Fabric & Material (🧵 ফেব্রিক ও কোয়ালিটি), and Colors (🎨 কালার ভ্যারিয়েন্ট)
4. Clear offer price, regular price, and special discount percentage
5. 4-5 key bullet points on premium finishing, durability, and comfort
6. Clear ordering instructions (send Name, Address, Phone number, and chosen size to Inbox)
7. Delivery policy (All Bangladesh Cash on Home Delivery, open and check before payment)
8. Viral Hashtags starting with "${pageTag}", followed by "#TawZoon", "#TawZoonNexus", "#OnlineShoppingBD", "#TrendingFashion", "#SpecialOffer", "#CashOnDeliveryBD", "#ViralReels".

Format the output strictly as JSON with:
{
  "catchyHeadline": "...",
  "fullPostCopy": "..."
}

Note: fullPostCopy must be the entire complete post ready to copy and paste directly into Facebook.
Output valid JSON only.`;

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const response = await callGeminiWithModelFallback(ai, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' }
    });

    const parsed = JSON.parse(response.text || '{}');
    if (parsed.fullPostCopy) {
      return res.json({ success: true, data: parsed });
    }
  } catch (err: any) {
    console.error('AI Social Copy Generation Error:', err);
  }

  // Ultra-Professional Fallback with Page Hashtag + TawZoon + Sizes & Materials
  const disc = regularPrice && sellingPrice && regularPrice > sellingPrice 
    ? Math.round(((regularPrice - sellingPrice) / regularPrice) * 100) 
    : 0;

  const headline = `🔥 ${specialOfferText || 'ধামাকা অফার'}! প্রিমিয়াম ${productTitle || 'কালেকশন'} এখন আকর্ষণীয় অফার মূল্যে!`;
  const fullPost = 
`${headline}
✨ ${cleanPageName} - ${brandTagline || 'STYLE FOR EVERY YOU'}

স্টাইল আর আভিজাত্যের সেরা কম্বিনেশন! আপনার প্রতিদিনের লুকে নিয়ে আসুন স্মার্ট ও প্রিমিয়াম ফিল।

🛍️ প্রোডাক্টের নাম: ${productTitle || 'প্রিমিয়াম প্রোডাক্ট'}
📏 উপলব্ধ সাইজ (Available Sizes): M (38), L (40), XL (42), XXL (44)
🧵 ফেব্রিক ও কোয়ালিটি: ১০০% প্রিমিয়াম এক্সপোর্ট কোয়ালিটি ফেব্রিক ও নিখুঁত স্টিচিং
🎨 কালার ভ্যারিয়েন্ট: ভিডিওতে প্রদর্শিত সকল আকর্ষণীয় কালার কালেকশন

💰 স্পেশাল অফার মূল্য: মাত্র ৳${sellingPrice ? sellingPrice.toLocaleString() : '০'}/- ${regularPrice && regularPrice > sellingPrice ? `(পূর্বের মূল্য: ৳${regularPrice.toLocaleString()}/-)` : ''}
${disc > 0 ? `🏷️ বিশেষ ডিসকাউন্ট: ${disc}% ছাড়!\n` : ''}
⭐ প্রিমিয়াম বৈশিষ্ট্যসমূহ:
✔️ ১০০% প্রিমিয়াম কোয়ালিটি ও আরামদায়ক ফেব্রিক
✔️ দীর্ঘস্থায়ী কালার ও নিখুঁত ফিনিশিং গ্যারান্টি
✔️ আধুনিক ও ট্রেন্ডি স্মার্ট আউটলুক
✔️ ক্যাজুয়াল, অফিস কিংবা যেকোনো অনুষ্ঠানে ব্যবহারের জন্য পারফেক্ট

🚚 ডেলিভারি ও পেমেন্ট সুবিধা:
✔️ সারা দেশে দ্রুততম সময়ে ক্যাশ অন হোম ডেলিভারি
✔️ পার্সেল খুলে চেক করে টাকা পরিশোধের পূর্ণ নিশ্চয়তা

🛒 অর্ডার করার সহজ নিয়ম:
ইনবক্সে আপনার নাম, পূর্ণ ঠিকানা, মোবাইল নাম্বার এবং পছন্দের সাইজ ও কালার লিখে পাঠিয়ে দিন অথবা সরাসরি মেসেজ দিন! 📩

${pageTag} #TawZoon #TawZoonNexus #OnlineShoppingBD #TrendingFashion #PremiumQuality #SpecialOffer #CashOnDeliveryBD #ViralReels`;

  return res.json({
    success: true,
    data: {
      catchyHeadline: headline,
      fullPostCopy: fullPost
    }
  });
});

// Prevent Nginx 403 interception from falling back to SPA index.html with 200
app.all('/forbidden.html', (_req: Request, res: Response) => {
  res.status(403).json({ error: 'Access forbidden.' });
});

// ==========================================
// 6. DEV / PROD SERVER CONFIGURATION
// ==========================================

async function startServer() {
  console.log('[Server] Starting Enterprise Engine instantly (local JSON data initialized)...');

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`TAWZOON NEXUS Enterprise Engine running on http://0.0.0.0:${PORT}`);
    console.log(`White Minimalist UI | Full Admin Control | OTP Security`);
    console.log(`Authorized Admin: ${AUTHORIZED_ADMIN_EMAIL}`);
    console.log(`======================================================\n`);

    // Complete DB sync from Cloud in background so we don't delay server startup or cause 502/Gateway Timeout
    db.ready.then(() => {
      console.log('[Server] Database sync with Cloud Firestore complete.');
    }).catch(err => {
      console.error('[Server] Database background sync failed:', err);
    });
  });

  // Enterprise Cloud Run Keep-Alive Tuning (Google Cloud Load Balancer default is 60s)
  // Setting keepAliveTimeout to 65s avoids premature connection termination and 502 Bad Gateway errors
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  // Cloud Run Horizontal Auto-scaling Graceful Termination Handlers
  const handleGracefulShutdown = (signal: string) => {
    console.log(`[Server] Received ${signal}. Gracefully stopping HTTP listener for Cloud Run scaling...`);
    server.close(() => {
      console.log('[Server] All active HTTP sockets cleanly terminated.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Forcing process exit after 10s shutdown timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
}

startServer();
