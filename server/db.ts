import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import type {
  Category,
  Product,
  Employee,
  Sale,
  Withdrawal,
  Transaction,
  BrandSettings,
  PaymentSetting,
  NotificationItem,
  AuditLogItem,
  AdminSession,
  EmployeeSession,
  Subsection,
  ReferralSettings,
} from '../src/types/index.ts';
import { firestore, testFirestoreConnection } from './firebase.ts';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const STORE_BACKUP_PATH = path.join(DATA_DIR, 'store.backup.json');
const SRC_STORE_PATH = path.join(__dirname, '..', 'src', 'data', 'store.json');

export function isFirestoreQuotaError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const code = (err.code || '').toLowerCase();
  return (
    code.includes('resource-exhausted') ||
    code.includes('quota-exceeded') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('free daily read units') ||
    msg.includes('free daily write units')
  );
}

export interface OutboxItem {
  id: string;
  colName: string;
  payload: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface IdempotencyRecord {
  key: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'QUEUED';
  responsePayload?: any;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseState {
  brandSettings: BrandSettings;
  categories: Category[];
  products: Product[];
  publishedCategories: Category[];
  publishedProducts: Product[];
  subsections?: Subsection[];
  publishedSubsections?: Subsection[];
  employees: (Employee & { passwordHash: string })[];
  sales: Sale[];
  withdrawals: Withdrawal[];
  transactions: Transaction[];
  paymentSettings: PaymentSetting[];
  notifications: NotificationItem[];
  auditLogs: AuditLogItem[];
  adminSessions: AdminSession[];
  employeeSessions: EmployeeSession[];
  trainingVideos?: any[];
  referralSettings?: ReferralSettings;
  deletedProductIds?: string[];
  deletedItemIds?: Record<string, string[]>;
  syncOutboxQueue?: OutboxItem[];
  idempotencyKeys?: Record<string, IdempotencyRecord>;
  adminOtpState: {
    email: string;
    otp: string;
    expiresAt: number;
    attempts: number;
    lastRequestedAt: number;
  } | null;
}

export const CORE_PRACTICE_EMPLOYEES: (Employee & { passwordHash: string })[] = [
  {
    id: 'emp-shaali',
    name: 'Shah Ali (A)',
    email: 'mdshaali9516@gmail.com',
    phone: '01722439516',
    district: 'Dhaka',
    thana: 'Mirpur',
    referenceCode: 'TN-REF-39516',
    reference: 'TAWZOON9516',
    isOfficialReferral: true,
    resellerMargin: 0,
    referralCommissionRate: 10,
    referralOwnerId: 'OFFICIAL_TAWZOON',
    referralOwnerName: 'তাওজুন অফিসিয়াল (Headquarters - TAWZOON9516)',
    role: 'EMPLOYEE',
    status: 'APPROVED',
    subscriptionStatus: 'exempt',
    isPaidSubscription: true,
    passwordHash: crypto.createHash('sha256').update('123456').digest('hex'),
    registeredAt: '2026-10-10T00:00:00.000Z',
    wallet: { availableBalance: 0, pendingWithdrawal: 0, totalEarnings: 0, totalWithdrawn: 0 }
  },
  {
    id: 'emp-ali',
    name: 'Ali (B)',
    email: 'ali@gmail.com',
    phone: '01711223344',
    district: 'Gazipur',
    thana: 'Tongi',
    referenceCode: 'TN-REF-23344',
    reference: 'TN-REF-39516',
    isOfficialReferral: false,
    resellerMargin: 10,
    referralCommissionRate: 10,
    referralOwnerId: 'emp-shaali',
    referralOwnerName: 'Shah Ali (A)',
    referralOwnerPhone: '01722439516',
    referredBy: 'TN-REF-39516',
    role: 'EMPLOYEE',
    status: 'APPROVED',
    subscriptionStatus: 'trial',
    isPaidSubscription: false,
    passwordHash: crypto.createHash('sha256').update('123456').digest('hex'),
    registeredAt: '2026-10-10T00:00:00.000Z',
    wallet: { availableBalance: 0, pendingWithdrawal: 0, totalEarnings: 0, totalWithdrawn: 0 }
  },
  {
    id: 'emp-c',
    name: 'Reseller C',
    email: 'c@gmail.com',
    phone: '01711223300',
    district: 'Chattogram',
    thana: 'Kotwali',
    referenceCode: 'TN-REF-23300',
    reference: 'TN-REF-23344',
    isOfficialReferral: false,
    resellerMargin: 10,
    referralCommissionRate: 10,
    referralOwnerId: 'emp-ali',
    referralOwnerName: 'Ali (B)',
    referralOwnerPhone: '01711223344',
    referredBy: 'TN-REF-23344',
    role: 'EMPLOYEE',
    status: 'APPROVED',
    subscriptionStatus: 'trial',
    isPaidSubscription: false,
    passwordHash: crypto.createHash('sha256').update('123456').digest('hex'),
    registeredAt: '2026-10-10T00:00:00.000Z',
    wallet: { availableBalance: 0, pendingWithdrawal: 0, totalEarnings: 0, totalWithdrawn: 0 }
  },
  {
    id: 'emp-d',
    name: 'Reseller D',
    email: 'd@gmail.com',
    phone: '01700122333',
    district: 'Sylhet',
    thana: 'Zindabazar',
    referenceCode: 'TN-REF-12333',
    reference: 'COMPANY',
    isOfficialReferral: false,
    resellerMargin: 10,
    referralCommissionRate: 10,
    referralOwnerId: 'COMPANY',
    referralOwnerName: 'তাওজুন কোম্পানি (Direct)',
    referredBy: 'COMPANY',
    role: 'EMPLOYEE',
    status: 'APPROVED',
    subscriptionStatus: 'trial',
    isPaidSubscription: false,
    passwordHash: crypto.createHash('sha256').update('123456').digest('hex'),
    registeredAt: '2026-10-10T00:00:00.000Z',
    wallet: { availableBalance: 0, pendingWithdrawal: 0, totalEarnings: 0, totalWithdrawn: 0 }
  }
];

const INITIAL_DATA: DatabaseState = {
  brandSettings: {
    appName: "TAWZOON NEXUS",
    logoUrl: "", 
    faviconUrl: "",
    brandDescriptionBn: "প্রিমিয়াম প্রোডাক্ট মার্কেটিং ও অনুমোদিত রিসেলার নেটওয়ার্ক প্ল্যাটফর্ম। সাশ্রয়ী ও মানসম্পন্ন পণ্য সবার দোড়গোড়ায়।",
    brandDescriptionEn: "Premium dynamic product marketing & authorized reseller distribution network. Quality products delivered with excellence.",
    heroHeadlineBn: "আধুনিক জীবনের প্রিমিয়াম পণ্য ও স্মার্ট মার্কেটিং",
    heroHeadlineEn: "Curated Premium Products & Empowered Commerce",
    heroSubheadBn: "ফ্যাশন, অত্যাধুনিক গ্যাজেট ও লাইফস্টাইল পণ্য সংগ্রহ করুন সহজে। রিসেলার ও মার্কেটারদের জন্য নির্ভরযোগ্য প্ল্যাটফর্ম।",
    heroSubheadEn: "Explore refined collections across fashion, cutting-edge gadgets, and lifestyle essentials with authentic guarantees.",
    heroBannerImage: "/images/hero_tawzoon_nexus_1790244695106.jpg",
    promoBannerActive: true,
    promoBannerTextBn: "বিশেষ অফার: নতুন সিজনের ট্রেন্ডিং গ্যাজেট ও ফ্যাশন কালেকশনে আকর্ষণীয় রিওয়ার্ড!",
    promoBannerTextEn: "Exclusive: Explore new trending gadgets and seasonal fashion with authorized affiliate rewards!",
    promoBannerLink: "#shop",
    mandatoryReserveBalance: 120,
    sendMoneyFee: 5
  },
  categories: [],
  publishedCategories: [],
  products: [],
  publishedProducts: [],
  deletedProductIds: [],
  subsections: [],
  publishedSubsections: [],
  employees: [...CORE_PRACTICE_EMPLOYEES],
  sales: [],
  withdrawals: [],
  transactions: [],
  paymentSettings: [
    {
      id: "pay-bkash",
      name: "bKash",
      isEnabled: true,
      accountType: "Merchant",
      accountNumber: "01700000000",
      instructionBn: "বিকাশ অ্যাপ থেকে 'Send Money' অথবা 'Merchant Pay' অপশন ব্যবহার করুন।",
      instructionEn: "Use bKash Send Money or Merchant Pay with reference."
    },
    {
      id: "pay-nagad",
      name: "Nagad",
      isEnabled: true,
      accountType: "Merchant",
      accountNumber: "01800000000",
      instructionBn: "নগদ অ্যাপ অথবা ইউএসএসডি কোডের মাধ্যমে পেমেন্ট সম্পন্ন করুন।",
      instructionEn: "Complete your transfer using Nagad App or USSD code."
    }
  ],
  notifications: [],
  auditLogs: [],
  adminSessions: [],
  employeeSessions: [],
  trainingVideos: [],
  referralSettings: {
    defaultRatePercent: 10,
    defaultMaxCap: 10,
    nonOfficialMarkup: 10,
    officialReferralCode: 'TAWZOON9516'
  },
  syncOutboxQueue: [],
  idempotencyKeys: {},
  adminOtpState: null
};

class Database {
  private state: DatabaseState;
  private isCloudSynced: boolean = false;
  private saveTimeout: NodeJS.Timeout | null = null;
  private lastSyncedHashes = new Map<string, string>();
  private isReadQuotaExhausted: boolean = false;
  private readQuotaExhaustedUntil: number = 0;
  private isWriteQuotaExhausted: boolean = false;
  private writeQuotaExhaustedUntil: number = 0;
  private employeeByIdIndex = new Map<string, Employee & { passwordHash: string }>();
  private employeeByCodeIndex = new Map<string, Employee & { passwordHash: string }>();
  private employeeByPhoneIndex = new Map<string, Employee & { passwordHash: string }>();
  private employeesByReferralIndex = new Map<string, (Employee & { passwordHash: string })[]>();
  public ready: Promise<void>;

  constructor() {
    this.state = this.load();
    if (!this.state.syncOutboxQueue) this.state.syncOutboxQueue = [];
    if (!this.state.idempotencyKeys) this.state.idempotencyKeys = {};
    this.ensureCoreData();
    this.rebuildIndices();
    this.ready = this.initCloudSync();

    // Schedule background durable outbox queue worker every 30 seconds
    setInterval(() => {
      this.processSyncOutbox().catch(() => {});
    }, 30000);
  }

  private createBackupSnapshot() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const json = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(STORE_BACKUP_PATH, json, 'utf-8');
      const presyncPath = path.join(DATA_DIR, 'store.presync.json');
      fs.writeFileSync(presyncPath, json, 'utf-8');
    } catch (err) {
      console.warn('[Database] Backup snapshot creation note:', err);
    }
  }

  public async forcePullFromCloud() {
    if (!firestore) {
      throw new Error('Firestore is not initialized');
    }
    console.log('[Firebase] Explicitly triggered live cloud synchronization pull...');
    await testFirestoreConnection();

    // 0. Take a safe pre-sync snapshot of local state so no data is ever lost
    this.createBackupSnapshot();

    let quotaHit = false;

    // 1. Pull Brand Settings safely
    try {
      const brandDoc = await getDoc(doc(firestore, 'brand_settings', 'default'));
      if (brandDoc.exists()) {
        const brandData = brandDoc.data() as BrandSettings;
        const localUpdated = Number(this.state.brandSettings.updatedAt || 0);
        const cloudUpdated = Number(brandData.updatedAt || 0);
        if (cloudUpdated >= localUpdated) {
          this.state.brandSettings = { ...this.state.brandSettings, ...brandData };
          this.lastSyncedHashes.set('brand_settings/default', JSON.stringify(this.state.brandSettings));
          console.log('[Firebase] Live brand settings synced from cloud');
        } else {
          // Local is newer, upload to cloud
          await this.syncBrandSettingsDirect(this.state.brandSettings);
        }
      } else {
        // Not yet in cloud, persist to cloud
        await this.syncBrandSettingsDirect(this.state.brandSettings);
      }
    } catch (err: any) {
      if (isFirestoreQuotaError(err)) {
        this.isReadQuotaExhausted = true;
        this.readQuotaExhaustedUntil = Date.now() + 15 * 60 * 1000;
        quotaHit = true;
        console.warn('[Firebase-Quota] Daily read quota reached during brand settings sync. Preserving local brand settings.');
      } else {
        console.warn('[Firebase] Warning reading brand settings during force sync:', err);
      }
    }

    // Pull tombstones / recorded deletions from Firestore first so we never resurrect deleted products/categories
    try {
      const delSnap = await getDocs(query(collection(firestore!, '_deletions')));
      for (const d of delSnap.docs) {
        const data = d.data();
        if (data && data.colName && data.colName !== 'employees' && data.id) {
          this.markDeleted(data.colName, data.id);
        }
      }
    } catch (e) {
      console.warn('[Firebase-Sync] Note checking _deletions:', e);
    }

    // 2. Safe Two-Way Bidirectional Pull for all authoritative collections
    const pullCollection = async (colName: string, stateKey: keyof DatabaseState) => {
      try {
        const snap = await getDocs(query(collection(firestore!, colName)));
        const cloudItems = snap.docs.map(doc => doc.data());
        const localItems = Array.isArray(this.state[stateKey]) ? (this.state[stateKey] as any[]) : [];
        
        const mergedMap = new Map<string, any>();
        const itemsToPushToCloud: any[] = [];
        
        // Step A: Load all existing local items first (excluding any marked as deleted)
        for (const item of localItems) {
          if (item && item.id && !this.isDeleted(colName, item.id)) {
            const existsInCloud = cloudItems.some(c => c && c.id === item.id);
            if (cloudItems.length > 0 && !existsInCloud) {
              console.log(`[Firebase-Sync] Item ${colName}/${item.id} does not exist in Cloud yet. Preserving local and queueing upload.`);
              itemsToPushToCloud.push(item);
            }
            mergedMap.set(item.id, item);
          }
        }
        
        // Step B: Merge with cloud items based on timestamps & completeness
        for (const cloudItem of cloudItems) {
          if (!cloudItem || !cloudItem.id) continue;

          // If item was permanently deleted, purge from cloud and do NOT bring it back!
          if (this.isDeleted(colName, cloudItem.id)) {
            console.log(`[Firebase-Sync] Pruning deleted item ${colName}/${cloudItem.id} from cloud Firestore`);
            this.deleteFromCloud(colName, cloudItem.id).catch(() => {});
            continue;
          }
          
          const localItem = mergedMap.get(cloudItem.id);
          if (localItem) {
            // Both exist: compare timestamps
            const localUpdated = localItem.updatedAt ? new Date(localItem.updatedAt).getTime() : 
                                (localItem.registeredAt ? new Date(localItem.registeredAt).getTime() : 
                                (localItem.saleDate ? new Date(localItem.saleDate).getTime() : 0));
            const cloudUpdated = cloudItem.updatedAt ? new Date(cloudItem.updatedAt).getTime() : 
                                (cloudItem.registeredAt ? new Date(cloudItem.registeredAt).getTime() : 
                                (cloudItem.saleDate ? new Date(cloudItem.saleDate).getTime() : 0));
            
            // For employee accounts, preserve passwordHash if cloud item does not have it
            const preservedPassword = (stateKey === 'employees' && localItem.passwordHash && !cloudItem.passwordHash)
              ? localItem.passwordHash
              : undefined;

            if (cloudUpdated >= localUpdated) {
              // Cloud version is equal or newer: update with cloud data
              mergedMap.set(cloudItem.id, {
                ...localItem,
                ...cloudItem,
                ...(preservedPassword ? { passwordHash: preservedPassword } : {})
              });
            } else {
              // Local version is newer: keep local and queue upload to cloud
              mergedMap.set(cloudItem.id, localItem);
              itemsToPushToCloud.push(localItem);
            }
          } else {
            // Brand new item from cloud (e.g. from live website or external registration): add to local
            mergedMap.set(cloudItem.id, cloudItem);
          }
        }
        
        // Step C: Ensure ALL local items (including practice and registered resellers) are fully preserved and pushed to cloud
        const cloudIds = new Set(cloudItems.map(item => item.id));
        for (const localItem of localItems) {
          if (
            localItem &&
            localItem.id &&
            !cloudIds.has(localItem.id) &&
            !this.isDeleted(colName, localItem.id)
          ) {
            itemsToPushToCloud.push(localItem);
            mergedMap.set(localItem.id, localItem);
          }
        }

        const finalMerged = Array.from(mergedMap.values());
        (this.state[stateKey] as any) = finalMerged;
        if (stateKey === 'employees') {
          this.rebuildIndices();
        }
        
        for (const item of finalMerged) {
          this.lastSyncedHashes.set(`${colName}/${item.id}`, JSON.stringify(item));
        }
        
        console.log(`[Firebase-Sync] Safe two-way sync for "${colName}": ${cloudItems.length} cloud, ${localItems.length} local -> ${finalMerged.length} preserved.`);
        
        // Upload any items that Cloud was missing to Firestore in the background
        if (itemsToPushToCloud.length > 0) {
          this.syncCollectionDirect(colName, itemsToPushToCloud).catch(e =>
            console.warn(`[Firebase-Sync] Background upload of missing items for "${colName}" error:`, e)
          );
        }
      } catch (err: any) {
        if (isFirestoreQuotaError(err)) {
          this.isReadQuotaExhausted = true;
          this.readQuotaExhaustedUntil = Date.now() + 15 * 60 * 1000;
          quotaHit = true;
          console.warn(`[Firebase-Quota] Daily read quota reached for collection "${colName}". Preserving local items safely.`);
        } else {
          console.error(`[Firebase-Sync] Error pulling collection "${colName}":`, err);
        }
      }
    };

    await Promise.all([
      pullCollection('categories', 'categories'),
      pullCollection('products', 'products'),
      pullCollection('employees', 'employees'),
      pullCollection('sales', 'sales'),
      pullCollection('withdrawals', 'withdrawals'),
      pullCollection('transactions', 'transactions'),
      pullCollection('payment_settings', 'paymentSettings'),
      pullCollection('notifications', 'notifications'),
      pullCollection('audit_logs', 'auditLogs'),
      pullCollection('subsections', 'subsections'),
      pullCollection('training_videos', 'trainingVideos'),
    ]);

    this.ensureCoreData();
    this.isCloudSynced = true;
    this.saveDirect(this.state);

    const stats = {
      products: this.state.products.length,
      categories: this.state.categories.length,
      employees: this.state.employees.length,
      sales: this.state.sales.length,
      withdrawals: this.state.withdrawals.length,
      transactions: this.state.transactions.length,
      subsections: (this.state.subsections || []).length,
      trainingVideos: (this.state.trainingVideos || []).length,
    };

    console.log('[Firebase] Force sync complete. Stats:', JSON.stringify(stats));

    return {
      success: true,
      quotaReached: quotaHit,
      syncedAt: new Date().toISOString(),
      stats
    };
  }

  private async initCloudSync() {
    if (!firestore) return;
    try {
      await testFirestoreConnection();
      console.log('[Firebase] Initializing granular cloud synchronization...');

      let isFirestoreInitialized = false;

      // 1. Load Brand Settings safely with timestamp check
      try {
        const brandDoc = await getDoc(doc(firestore, 'brand_settings', 'default'));
        isFirestoreInitialized = brandDoc.exists();
        if (isFirestoreInitialized) {
          const brandData = brandDoc.data() as BrandSettings;
          const localUpdated = Number(this.state.brandSettings.updatedAt || 0);
          const cloudUpdated = Number(brandData.updatedAt || 0);
          
          if (cloudUpdated >= localUpdated) {
            this.state.brandSettings = { ...this.state.brandSettings, ...brandData };
            this.lastSyncedHashes.set('brand_settings/default', JSON.stringify(brandData));
            console.log('[Firebase] Brand settings loaded from cloud (Cloud version newer or equal)');
          } else {
            console.log('[Firebase] Local brand settings are newer than cloud, preserving local settings and scheduling cloud update');
            this.syncToCloudDebounced();
          }
        }
      } catch (err: any) {
        if (isFirestoreQuotaError(err)) {
          this.isReadQuotaExhausted = true;
          this.readQuotaExhaustedUntil = Date.now() + 15 * 60 * 1000;
          console.warn('[Firebase-Quota] Quota exhausted during brand settings load. Falling back to local store.json settings.');
        } else {
          console.error('[Firebase] Failed to load brand settings:', err);
        }
      }

      // 2. Load Collections safely with robust bidirectional synchronization
      const loadCollection = async (colName: string, stateKey: keyof DatabaseState) => {
        try {
          const snap = await getDocs(query(collection(firestore!, colName)));
          const localItems = Array.isArray(this.state[stateKey]) ? (this.state[stateKey] as any[]) : [];
          
          // Map local items by ID for quick lookup and merge
          const localMap = new Map<string, any>();
          for (const item of localItems) {
            if (item && item.id && !this.isDeleted(colName, item.id)) {
              localMap.set(item.id, item);
            }
          }

          if (!snap.empty) {
            let cloudCount = 0;
            for (const docSnap of snap.docs) {
              const cloudItem = docSnap.data();
              if (cloudItem && cloudItem.id) {
                if (this.isDeleted(colName, cloudItem.id)) {
                  this.deleteFromCloud(colName, cloudItem.id).catch(() => {});
                  continue;
                }
                cloudCount++;
                const localItem = localMap.get(cloudItem.id);
                if (localItem) {
                  // Merge local and cloud. Since both exist, check which is newer, or prefer cloud.
                  const localUpdated = localItem.updatedAt ? new Date(localItem.updatedAt).getTime() : 0;
                  const cloudUpdated = cloudItem.updatedAt ? new Date(cloudItem.updatedAt).getTime() : 0;
                  
                  if (cloudUpdated > localUpdated) {
                    const preservedPassword = (stateKey === 'employees' && localItem.passwordHash && !cloudItem.passwordHash)
                      ? localItem.passwordHash
                      : undefined;
                    localMap.set(cloudItem.id, {
                      ...localItem,
                      ...cloudItem,
                      ...(preservedPassword ? { passwordHash: preservedPassword } : {})
                    });
                  } else {
                    // Local is newer or equal, keep local and force sync upload to cloud
                    this.lastSyncedHashes.delete(`${colName}/${cloudItem.id}`);
                  }
                } else {
                  // Not in local, add it
                  localMap.set(cloudItem.id, cloudItem);
                }
                // Update synced hash for this item
                this.lastSyncedHashes.set(`${colName}/${cloudItem.id}`, JSON.stringify(localMap.get(cloudItem.id)));
              }
            }

            const mergedItems = Array.from(localMap.values());
            (this.state[stateKey] as any) = mergedItems;
            console.log(`[Firebase] Merged Cloud and Local for "${colName}". Cloud count: ${cloudCount}, Total after merge: ${mergedItems.length}`);
            
            // Queue sync to make sure any local-only or newer items are uploaded to Firestore
            this.syncToCloudDebounced();
          } else {
            console.log(`[Firebase] Cloud collection "${colName}" is empty, preserving local items and queuing sync`);
            for (const item of localItems) {
              if (item && item.id) {
                this.lastSyncedHashes.set(`${colName}/${item.id}`, JSON.stringify(item));
              }
            }
            if (localItems.length > 0) {
              this.syncToCloudDebounced();
            }
          }
        } catch (err: any) {
          if (isFirestoreQuotaError(err)) {
            this.isReadQuotaExhausted = true;
            this.readQuotaExhaustedUntil = Date.now() + 15 * 60 * 1000;
            console.warn(`[Firebase-Quota] Quota exhausted while loading collection "${colName}". Preserving local file data safely.`);
          } else {
            console.error(`[Firebase] Error loading collection "${colName}":`, err);
          }
        }
      };

      await Promise.all([
        loadCollection('categories', 'categories'),
        loadCollection('products', 'products'),
        loadCollection('employees', 'employees'),
        loadCollection('sales', 'sales'),
        loadCollection('withdrawals', 'withdrawals'),
        loadCollection('transactions', 'transactions'),
        loadCollection('payment_settings', 'paymentSettings'),
        loadCollection('notifications', 'notifications'),
        loadCollection('audit_logs', 'auditLogs'),
        loadCollection('subsections', 'subsections'),
        loadCollection('training_videos', 'trainingVideos'),
      ]);

      // Always keep published versions in sync with current active products/categories
      this.state.publishedProducts = (this.state.products || []).filter(p => !p.isArchived && p.isActive !== false);
      this.state.publishedCategories = (this.state.categories || []).filter(c => c.isActive !== false);
      if (this.state.subsections) {
        this.state.publishedSubsections = (this.state.subsections || []).filter(s => s.isActive !== false);
      }

      // Ensure standard core categories and products are available and synced
      this.ensureCoreData();

      this.isCloudSynced = true;
      this.saveDirect(this.state);
      console.log('[Firebase] Granular cloud sync complete.');
    } catch (err) {
      console.error('[Firebase] Cloud sync error:', err);
    }
  }

  private ensureCoreData() {
    // Keep published versions in sync with current state
    this.state.publishedProducts = (this.state.products || []).filter(p => !p.isArchived && p.isActive !== false);
    this.state.publishedCategories = (this.state.categories || []).filter(c => c.isActive !== false);
    if (this.state.subsections) {
      this.state.publishedSubsections = (this.state.subsections || []).filter(s => s.isActive !== false);
    }
    if (!this.state.referralSettings) {
      this.state.referralSettings = {
        defaultRatePercent: 10,
        defaultMaxCap: 10,
        nonOfficialMarkup: 10,
        officialReferralCode: 'TAWZOON9516'
      };
    }
    if (!Array.isArray(this.state.employees)) {
      this.state.employees = [];
    }

    // Permanently remove any stale employee tombstones to protect all practice & registered accounts
    if (this.state.deletedItemIds && this.state.deletedItemIds.employees) {
      delete this.state.deletedItemIds.employees;
    }

    // Ensure all 4 core practice accounts (Shah Ali A, Ali B, Reseller C, Reseller D) always exist alongside custom accounts
    for (const coreEmp of CORE_PRACTICE_EMPLOYEES) {
      const existingIdx = this.state.employees.findIndex(
        e => e.id === coreEmp.id || (e.phone && coreEmp.phone && e.phone.replace(/[^0-9]/g, '') === coreEmp.phone.replace(/[^0-9]/g, ''))
      );
      if (existingIdx === -1) {
        this.state.employees.push({ ...coreEmp });
      } else {
        // Keep active approved status for practice accounts
        if (!this.state.employees[existingIdx].status || this.state.employees[existingIdx].status === 'PENDING') {
          this.state.employees[existingIdx].status = 'APPROVED';
        }
      }
    }

    // Direct background sync of all employees to Firestore so cloud and local always match
    if (firestore) {
      for (const emp of this.state.employees) {
        this.syncEntityDirect('employees', emp).catch(() => {});
      }
    }
    this.rebuildIndices();
  }

  private load(): DatabaseState {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      let raw: string | null = null;
      if (fs.existsSync(STORE_PATH)) {
        raw = fs.readFileSync(STORE_PATH, 'utf-8');
      } else if (fs.existsSync(STORE_BACKUP_PATH)) {
        console.log('[Database] Restoring from store.backup.json');
        raw = fs.readFileSync(STORE_BACKUP_PATH, 'utf-8');
      }

      if (raw) {
        let parsed = JSON.parse(raw);
        // Guard against accidental product or employee loss by checking backup sources
        if ((!parsed.products || parsed.products.length === 0) && fs.existsSync(STORE_BACKUP_PATH)) {
          try {
            const b = JSON.parse(fs.readFileSync(STORE_BACKUP_PATH, 'utf-8'));
            if (b.products && b.products.length > 0) {
              console.log(`[Database] Recovered ${b.products.length} products from store.backup.json`);
              parsed.products = b.products;
              if ((!parsed.categories || parsed.categories.length === 0) && b.categories) {
                parsed.categories = b.categories;
              }
            }
            if ((!parsed.employees || parsed.employees.length === 0) && b.employees) {
              parsed.employees = b.employees;
            }
          } catch (e) {}
        }
        if ((!parsed.products || parsed.products.length === 0) && fs.existsSync(SRC_STORE_PATH)) {
          try {
            const s = JSON.parse(fs.readFileSync(SRC_STORE_PATH, 'utf-8'));
            if (s.products && s.products.length > 0) {
              console.log(`[Database] Recovered ${s.products.length} products from src/data/store.json`);
              parsed.products = s.products;
              if ((!parsed.categories || parsed.categories.length === 0) && s.categories) {
                parsed.categories = s.categories;
              }
            }
            if ((!parsed.employees || parsed.employees.length === 0) && s.employees) {
              parsed.employees = s.employees;
            }
          } catch (e) {}
        }
        if ((!parsed.employees || parsed.employees.length === 0) && fs.existsSync(STORE_BACKUP_PATH)) {
          try {
            const b = JSON.parse(fs.readFileSync(STORE_BACKUP_PATH, 'utf-8'));
            if (b.employees && b.employees.length > 0) {
              console.log(`[Database] Recovered ${b.employees.length} employees from store.backup.json`);
              parsed.employees = b.employees;
            }
          } catch (e) {}
        }
        if ((!parsed.employees || parsed.employees.length === 0) && fs.existsSync(SRC_STORE_PATH)) {
          try {
            const s = JSON.parse(fs.readFileSync(SRC_STORE_PATH, 'utf-8'));
            if (s.employees && s.employees.length > 0) {
              console.log(`[Database] Recovered ${s.employees.length} employees from src/data/store.json`);
              parsed.employees = s.employees;
            }
          } catch (e) {}
        }

        // Ensure core practice accounts always exist alongside any saved reseller accounts
        const loadedEmployees = Array.isArray(parsed.employees) ? parsed.employees : [];
        const mergedEmployees = [...loadedEmployees];
        for (const coreEmp of CORE_PRACTICE_EMPLOYEES) {
          if (!mergedEmployees.some(e => e.id === coreEmp.id || (e.phone && coreEmp.phone && e.phone.replace(/[^0-9]/g, '') === coreEmp.phone.replace(/[^0-9]/g, '')))) {
            mergedEmployees.push({ ...coreEmp });
          }
        }

        return {
          ...INITIAL_DATA,
          ...parsed,
          categories: parsed.categories || [],
          products: parsed.products || [],
          employees: mergedEmployees,
          publishedCategories: parsed.publishedCategories || [],
          publishedProducts: parsed.publishedProducts || [],
          adminSessions: parsed.adminSessions || [],
          employeeSessions: parsed.employeeSessions || [],
        };
      }
    } catch (err) {
      console.error('Error loading database store, checking backup:', err);
      try {
        if (fs.existsSync(STORE_BACKUP_PATH)) {
          const rawBackup = fs.readFileSync(STORE_BACKUP_PATH, 'utf-8');
          const parsed = JSON.parse(rawBackup);
          return {
            ...INITIAL_DATA,
            ...parsed,
            categories: parsed.categories || [],
            products: parsed.products || [],
            publishedCategories: parsed.publishedCategories || [],
            publishedProducts: parsed.publishedProducts || [],
          };
        }
      } catch (backupErr) {
        console.error('Backup load failed too:', backupErr);
      }
    }
    this.saveDirect(INITIAL_DATA);
    return JSON.parse(JSON.stringify(INITIAL_DATA));
  }

  private saveDirect(data: DatabaseState) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const json = JSON.stringify(data, null, 2);
      fs.writeFileSync(STORE_PATH, json, 'utf-8');
      fs.writeFileSync(STORE_BACKUP_PATH, json, 'utf-8');

      // Also ensure src/data/store.json is kept up-to-date
      try {
        const srcDir = path.dirname(SRC_STORE_PATH);
        if (fs.existsSync(srcDir)) {
          fs.writeFileSync(SRC_STORE_PATH, json, 'utf-8');
        }
      } catch (srcErr) {}
      this.rebuildIndices();
    } catch (err) {
      console.error('Failed to write database store:', err);
    }
  }

  public save() {
    this.saveDirect(this.state);
    this.syncToCloudDebounced();
  }

  private syncToCloudDebounced() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.syncToCloudDirect();
    }, 1000); // 1 second debounce for granular sync
  }

  public async syncToCloudDirect() {
    if (!firestore) return;
    if (this.isWriteQuotaExhausted && Date.now() < this.writeQuotaExhaustedUntil) {
      return; // Skip cloud writes while write quota is in cooldown; local store is 100% up-to-date
    }

    try {
      // 1. Sync Brand Settings with hash check to save quota
      const brandSettingsJson = JSON.stringify(this.state.brandSettings);
      if (this.lastSyncedHashes.get('brand_settings/default') !== brandSettingsJson) {
        try {
          await setDoc(doc(firestore, 'brand_settings', 'default'), JSON.parse(brandSettingsJson), { merge: true });
          this.lastSyncedHashes.set('brand_settings/default', brandSettingsJson);
        } catch (e: any) {
          if (e.message?.includes('RESOURCE_EXHAUSTED') || e.code === 'resource-exhausted') {
            this.isWriteQuotaExhausted = true;
            this.writeQuotaExhaustedUntil = Date.now() + 30 * 60 * 1000;
            console.warn('[Firebase-Quota] Daily write quota exceeded. Changes safely saved in local store.json.');
            return;
          }
        }
      }

      // 2. Granular Delta Sync Helper (Batched in concurrent chunks of 10 to eliminate sequential write bottleneck)
      const syncCollection = async (items: any[], colName: string) => {
        if (this.isWriteQuotaExhausted && Date.now() < this.writeQuotaExhaustedUntil) return;

        const modifiedItems: Array<{ item: any; hashKey: string; json: string }> = [];
        for (const item of items) {
          if (!item.id || (this.isWriteQuotaExhausted && Date.now() < this.writeQuotaExhaustedUntil)) continue;
          const hashKey = `${colName}/${item.id}`;
          const currentJson = JSON.stringify(item);

          // Skip if already synced and unchanged
          if (this.lastSyncedHashes.get(hashKey) === currentJson) {
            continue;
          }
          modifiedItems.push({ item, hashKey, json: currentJson });
        }
        if (modifiedItems.length === 0) return;

        // Concurrently write modified documents in chunks of 10 to optimize Cloud Firestore write throughput
        const CHUNK_SIZE = 10;
        for (let i = 0; i < modifiedItems.length; i += CHUNK_SIZE) {
          if (this.isWriteQuotaExhausted && Date.now() < this.writeQuotaExhaustedUntil) return;
          const chunk = modifiedItems.slice(i, i + CHUNK_SIZE);
          await Promise.all(
            chunk.map(async ({ item, hashKey, json }) => {
              try {
                await setDoc(doc(firestore!, colName, item.id), JSON.parse(json), { merge: true });
                this.lastSyncedHashes.set(hashKey, json);
              } catch (e: any) {
                if (e.message?.includes('RESOURCE_EXHAUSTED') || e.code === 'resource-exhausted') {
                  this.isWriteQuotaExhausted = true;
                  this.writeQuotaExhaustedUntil = Date.now() + 30 * 60 * 1000;
                  console.warn(`[Firebase-Quota] Write quota reached for "${hashKey}". Preserved in local store.json cache.`);
                }
              }
            })
          );
        }
      };

      // Sync critical entities
      await Promise.all([
        syncCollection(this.state.categories, 'categories'),
        syncCollection(this.state.products, 'products'),
        syncCollection(this.state.employees, 'employees'),
        syncCollection(this.state.sales, 'sales'),
        syncCollection(this.state.withdrawals, 'withdrawals'),
        syncCollection(this.state.transactions || [], 'transactions'),
        syncCollection(this.state.paymentSettings, 'payment_settings'),
        syncCollection(this.state.subsections || [], 'subsections'),
        syncCollection(this.state.trainingVideos || [], 'training_videos'),
      ]);

      // Sync recent logs/notifications
      if (!this.isWriteQuotaExhausted) {
        await syncCollection(this.state.notifications.slice(0, 50), 'notifications');
        await syncCollection(this.state.auditLogs.slice(0, 50), 'audit_logs');
      }

      if (!this.isWriteQuotaExhausted) {
        console.log('[Firebase] Granular delta-sync completed successfully.');
      }
    } catch (err: any) {
      if (err.message?.includes('RESOURCE_EXHAUSTED') || err.code === 'resource-exhausted') {
        this.isWriteQuotaExhausted = true;
        this.writeQuotaExhaustedUntil = Date.now() + 30 * 60 * 1000;
      }
    }
  }

  public rebuildIndices() {
    this.employeeByIdIndex.clear();
    this.employeeByCodeIndex.clear();
    this.employeeByPhoneIndex.clear();
    this.employeesByReferralIndex.clear();

    const emps = this.state.employees || [];
    for (const emp of emps) {
      if (emp.id) this.employeeByIdIndex.set(emp.id, emp);
      if (emp.referenceCode) {
        this.employeeByCodeIndex.set(emp.referenceCode.trim().toUpperCase(), emp);
      }
      if (emp.phone) {
        const cleanPhone = emp.phone.replace(/[^0-9]/g, '');
        this.employeeByPhoneIndex.set(cleanPhone, emp);
      }
      const ref = (emp.referredBy || emp.reference || '').trim().toUpperCase();
      if (ref) {
        let list = this.employeesByReferralIndex.get(ref);
        if (!list) {
          list = [];
          this.employeesByReferralIndex.set(ref, list);
        }
        list.push(emp);
      }
    }
  }

  public getEmployeeById(id: string): (Employee & { passwordHash: string }) | undefined {
    return this.employeeByIdIndex.get(id);
  }

  public getEmployeeByCode(code: string): (Employee & { passwordHash: string }) | undefined {
    if (!code) return undefined;
    return this.employeeByCodeIndex.get(code.trim().toUpperCase());
  }

  public getEmployeeByPhone(phone: string): (Employee & { passwordHash: string }) | undefined {
    if (!phone) return undefined;
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    return this.employeeByPhoneIndex.get(cleanPhone);
  }

  public getDownlineEmployees(referralCode: string): (Employee & { passwordHash: string })[] {
    if (!referralCode) return [];
    return this.employeesByReferralIndex.get(referralCode.trim().toUpperCase()) || [];
  }

  public getState(): DatabaseState {
    return this.state;
  }

  /**
   * Immediately persist an entity to Cloud Firestore without waiting for debounce.
   * Crucial for Cloud Run environments where CPU throttles after request completion.
   */
  public async syncEntityDirect(colName: string, item: any, throwOnError: boolean = false): Promise<void> {
    if (!firestore || !item || !item.id) return;
    const hashKey = `${colName}/${item.id}`;
    let payload = item;
    let jsonStr = JSON.stringify(payload);

    // If payload exceeds 800KB, perform emergency image trimming to guarantee Firestore 1MB compliance
    if (jsonStr.length > 800 * 1024 && Array.isArray(payload.images)) {
      console.warn(`[Firebase] Document ${colName}/${item.id} is large (${Math.round(jsonStr.length/1024)}KB). Pruning images to fit Firestore 1MB limit...`);
      payload = {
        ...payload,
        images: payload.images.map((img: any, idx: number) => {
          // Keep primary image, limit secondary base64 if needed
          if (idx > 2 && typeof img.url === 'string' && img.url.startsWith('data:image') && img.url.length > 100000) {
            return { ...img, url: img.url.slice(0, 100) }; // trim oversized secondary images
          }
          return img;
        })
      };
      jsonStr = JSON.stringify(payload);
    }

    try {
      await setDoc(doc(firestore, colName, item.id), JSON.parse(jsonStr), { merge: true });
      this.lastSyncedHashes.set(hashKey, jsonStr);
      console.log(`[Firebase-Live] Immediately persisted ${colName}/${item.id} to Cloud Firestore`);
    } catch (err: any) {
      if (err.message?.includes('RESOURCE_EXHAUSTED') || err.code === 'resource-exhausted') {
        console.warn(`[Firebase-Quota] Write limit reached for ${colName}/${item.id}. Enqueuing in durable outbox queue.`);
      } else {
        console.error(`[Firebase] Immediate write for ${colName}/${item.id} failed:`, err);
      }

      // Auto-enqueue into durable outbox queue when Cloud write fails!
      this.enqueueOutbox(colName, payload, err?.message || String(err));

      if (throwOnError) {
        throw err;
      }
    }
  }

  public enqueueOutbox(colName: string, payload: any, errorMsg?: string) {
    if (!this.state.syncOutboxQueue) {
      this.state.syncOutboxQueue = [];
    }
    if (!payload || !payload.id) return;

    // Deduplicate existing pending outbox item for same entity
    const existingIdx = this.state.syncOutboxQueue.findIndex(q => q.colName === colName && q.payload?.id === payload.id);
    const item: OutboxItem = {
      id: 'outbox-' + crypto.randomUUID().slice(0, 8),
      colName,
      payload,
      createdAt: new Date().toISOString(),
      retryCount: existingIdx >= 0 ? (this.state.syncOutboxQueue[existingIdx].retryCount || 0) + 1 : 0,
      lastError: errorMsg
    };

    if (existingIdx >= 0) {
      this.state.syncOutboxQueue[existingIdx] = item;
    } else {
      this.state.syncOutboxQueue.push(item);
    }
    this.save();
  }

  public async processSyncOutbox(): Promise<{ processed: number; failed: number }> {
    if (!firestore || !this.state.syncOutboxQueue || this.state.syncOutboxQueue.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;
    const remainingQueue: OutboxItem[] = [];

    for (const item of [...this.state.syncOutboxQueue]) {
      try {
        const jsonStr = JSON.stringify(item.payload);
        await setDoc(doc(firestore, item.colName, item.payload.id), JSON.parse(jsonStr), { merge: true });
        this.lastSyncedHashes.set(`${item.colName}/${item.payload.id}`, jsonStr);
        processed++;
        console.log(`[Outbox-Worker] Successfully synced queued entity ${item.colName}/${item.payload.id} to Cloud Firestore`);
      } catch (err: any) {
        failed++;
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = err?.message || String(err);
        if (item.retryCount < 50) {
          remainingQueue.push(item);
        } else {
          console.error(`[Outbox-Worker] Dropped outbox item ${item.colName}/${item.payload.id} after 50 failed attempts:`, err);
        }
      }
    }

    this.state.syncOutboxQueue = remainingQueue;
    this.save();
    return { processed, failed };
  }

  public getIdempotencyRecord(key: string): IdempotencyRecord | null {
    if (!key) return null;
    const records = this.state.idempotencyKeys || {};
    return records[key] || null;
  }

  public async setIdempotencyRecord(key: string, record: { status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'QUEUED'; responsePayload?: any }): Promise<IdempotencyRecord> {
    if (!key) throw new Error('Idempotency key is required');
    if (!this.state.idempotencyKeys) {
      this.state.idempotencyKeys = {};
    }
    const existing = this.state.idempotencyKeys[key];
    const now = new Date().toISOString();
    const fullRecord: IdempotencyRecord = {
      key,
      status: record.status,
      responsePayload: record.responsePayload ?? existing?.responsePayload,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    this.state.idempotencyKeys[key] = fullRecord;
    this.save();

    if (firestore) {
      try {
        await setDoc(doc(firestore, '_idempotency_keys', key.replace(/[^a-zA-Z0-9_\-]/g, '_')), fullRecord, { merge: true });
      } catch (e) {
        console.warn(`[Firebase] Idempotency key cloud persist note for ${key}:`, e);
      }
    }

    return fullRecord;
  }

  /**
   * Immediately persist brand settings to Cloud Firestore.
   */
  public async syncBrandSettingsDirect(settings: BrandSettings): Promise<void> {
    if (!firestore || !settings) return;
    try {
      const jsonStr = JSON.stringify(settings);
      await setDoc(doc(firestore, 'brand_settings', 'default'), JSON.parse(jsonStr), { merge: true });
      this.lastSyncedHashes.set('brand_settings/default', jsonStr);
      console.log('[Firebase-Live] Immediately persisted brand_settings/default to Cloud Firestore');
    } catch (err: any) {
      console.error('[Firebase] Immediate write for brand settings failed:', err);
    }
  }

  /**
   * Immediately persist a list of items to Cloud Firestore.
   */
  public async syncCollectionDirect(colName: string, items: any[]): Promise<void> {
    if (!firestore || !Array.isArray(items)) return;
    for (const item of items) {
      if (item && item.id) {
        await this.syncEntityDirect(colName, item);
      }
    }
  }

  public markDeleted(colName: string, id: string) {
    if (colName === 'employees') {
      // For employees, do NOT add to deletedItemIds tombstone! Just filter out from array
      this.state.employees = (this.state.employees || []).filter(e => e.id !== id);
      this.lastSyncedHashes.delete(`${colName}/${id}`);
      this.saveDirect(this.state);
      this.createBackupSnapshot();
      return;
    }
    if (!this.state.deletedItemIds) this.state.deletedItemIds = {};
    if (!this.state.deletedItemIds[colName]) this.state.deletedItemIds[colName] = [];
    if (!this.state.deletedItemIds[colName].includes(id)) {
      this.state.deletedItemIds[colName].push(id);
    }
    if (colName === 'products') {
      if (!this.state.deletedProductIds) this.state.deletedProductIds = [];
      if (!this.state.deletedProductIds.includes(id)) {
        this.state.deletedProductIds.push(id);
      }
      this.state.products = (this.state.products || []).filter(p => p.id !== id);
      this.state.publishedProducts = (this.state.publishedProducts || []).filter(p => p.id !== id);
    } else if (colName === 'categories') {
      this.state.categories = (this.state.categories || []).filter(c => c.id !== id);
      this.state.publishedCategories = (this.state.publishedCategories || []).filter(c => c.id !== id);
    }
    this.lastSyncedHashes.delete(`${colName}/${id}`);
    this.saveDirect(this.state);
    this.createBackupSnapshot();
  }

  public isDeleted(colName: string, id: string): boolean {
    if (colName === 'employees') {
      return false; // Reseller accounts are protected and NEVER auto-discarded
    }
    if (this.state.deletedItemIds && this.state.deletedItemIds[colName]) {
      if (this.state.deletedItemIds[colName].includes(id)) return true;
    }
    if (colName === 'products' && this.state.deletedProductIds) {
      if (this.state.deletedProductIds.includes(id)) return true;
    }
    return false;
  }

  public async purgeAllResellers() {
    const coreIds = new Set(CORE_PRACTICE_EMPLOYEES.map(c => c.id));
    const empIds = (this.state.employees || []).filter(e => !coreIds.has(e.id)).map(e => e.id);
    const saleIds = (this.state.sales || []).map(s => s.id);
    const wIds = (this.state.withdrawals || []).map(w => w.id);
    const tIds = (this.state.transactions || []).map(t => t.id);

    // Also scan Firestore directly to ensure custom accounts created in other instances are wiped
    if (firestore) {
      try {
        const empSnap = await getDocs(collection(firestore, 'employees'));
        for (const d of empSnap.docs) {
          if (!coreIds.has(d.id) && !empIds.includes(d.id)) empIds.push(d.id);
        }
        const saleSnap = await getDocs(collection(firestore, 'sales'));
        for (const d of saleSnap.docs) {
          if (!saleIds.includes(d.id)) saleIds.push(d.id);
        }
      } catch (e) {
        console.warn('[Database] Purge scan notice:', e);
      }
    }

    for (const id of empIds) {
      if (id) {
        await this.deleteFromCloud('employees', id).catch(() => {});
      }
    }
    for (const id of saleIds) {
      if (id) {
        this.markDeleted('sales', id);
        await this.deleteFromCloud('sales', id).catch(() => {});
      }
    }
    for (const id of wIds) {
      if (id) {
        this.markDeleted('withdrawals', id);
        await this.deleteFromCloud('withdrawals', id).catch(() => {});
      }
    }
    for (const id of tIds) {
      if (id) {
        this.markDeleted('transactions', id);
        await this.deleteFromCloud('transactions', id).catch(() => {});
      }
    }

    // Always preserve core practice accounts!
    this.state.employees = [...CORE_PRACTICE_EMPLOYEES];
    this.state.employeeSessions = [];
    this.state.sales = [];
    this.state.withdrawals = [];
    this.state.transactions = [];
    this.saveDirect(this.state);
    if (firestore) {
      for (const emp of this.state.employees) {
        await this.syncEntityDirect('employees', emp).catch(() => {});
      }
    }
    console.log('[Database] Purged custom accounts, core practice reseller accounts successfully preserved.');
  }

  public async deleteFromCloud(colName: string, id: string) {
    if (!firestore) return;
    const hashKey = `${colName}/${id}`;
    this.lastSyncedHashes.delete(hashKey);
    try {
      await deleteDoc(doc(firestore, colName, id));
      console.log(`[Firebase] Deleted document ${id} from ${colName}`);
      // Record tombstone in Firestore for products/categories (NEVER for employees)
      if (colName !== 'employees') {
        try {
          await setDoc(doc(firestore, '_deletions', `${colName}_${id}`), {
            colName,
            id,
            deletedAt: Date.now()
          }, { merge: true });
        } catch (tombErr) {}
      }
    } catch (err: any) {
      if (err.message?.includes('RESOURCE_EXHAUSTED') || err.code === 'resource-exhausted') {
        console.warn(`[Firebase-Quota] Write limit reached. Document ${id} deleted from local store safely.`);
      } else {
        console.error(`[Firebase] Failed to delete document ${id} from ${colName}:`, err);
      }
    }
  }

  public logAudit(action: string, actor: string, target: string, previousValue?: string, newValue?: string, ip?: string) {
    const entry: AuditLogItem = {
      id: 'audit-' + crypto.randomUUID().slice(0, 8),
      action,
      actor,
      target,
      previousValue,
      newValue,
      ip,
      timestamp: new Date().toISOString()
    };
    this.state.auditLogs.unshift(entry);
    // Keep max 500 logs
    if (this.state.auditLogs.length > 500) {
      this.state.auditLogs.length = 500;
    }
    this.save();
    return entry;
  }

  public addNotification(item: Omit<NotificationItem, 'id' | 'createdAt' | 'isRead'>) {
    const notif: NotificationItem = {
      ...item,
      id: 'notif-' + crypto.randomUUID().slice(0, 8),
      isRead: false,
      createdAt: new Date().toISOString()
    };
    this.state.notifications.unshift(notif);
    this.save();
    return notif;
  }
}

export const db = new Database();
