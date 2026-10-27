import {
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
  Subsection,
} from '../types/index.js';

const ADMIN_TOKEN_KEY = 'tawzoon_admin_token';
const EMPLOYEE_TOKEN_KEY = 'tawzoon_emp_token';

export const authStorage = {
  getAdminToken: () => localStorage.getItem(ADMIN_TOKEN_KEY),
  setAdminToken: (token: string) => localStorage.setItem(ADMIN_TOKEN_KEY, token),
  clearAdminToken: () => localStorage.removeItem(ADMIN_TOKEN_KEY),

  getEmployeeToken: () => localStorage.getItem(EMPLOYEE_TOKEN_KEY),
  setEmployeeToken: (token: string) => localStorage.setItem(EMPLOYEE_TOKEN_KEY, token),
  clearEmployeeToken: () => localStorage.removeItem(EMPLOYEE_TOKEN_KEY),
};

async function request<T>(endpoint: string, options: RequestInit = {}, retries = 3, delay = 600): Promise<T> {
  try {
    const empToken = authStorage.getEmployeeToken();
    const adminToken = authStorage.getAdminToken();
    const defaultAuth = empToken ? `Bearer ${empToken}` : (adminToken ? `Bearer ${adminToken}` : undefined);

    let activeRef: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const search = new URLSearchParams(window.location.search);
        activeRef = search.get('ref') || search.get('referral') || sessionStorage.getItem('tawzoon_invite_ref');
      } catch {}
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(defaultAuth ? { Authorization: defaultAuth } : {}),
      ...(activeRef ? { 'x-referral-code': activeRef } : {}),
      ...(options.headers as Record<string, string>),
    };

    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (parseErr) {
      const isHtml = Boolean(text && (text.trim().startsWith('<') || text.toLowerCase().includes('html')));
      if (res.status === 401 || res.status === 403) {
        if (endpoint.includes('/employee') || endpoint.includes('/auth/employee')) {
          authStorage.clearEmployeeToken();
        } else if (endpoint.includes('/admin') || endpoint.includes('/auth/admin')) {
          authStorage.clearAdminToken();
        }
        throw new Error(res.status === 401 ? 'ভুল ইমেইল বা পাসওয়ার্ড! সঠিক তথ্য দিয়ে আবার চেষ্টা করুন।' : 'অনুমোদিত নয়: সেশন শেষ হয়ে গেছে বা সঠিক权限 নেই।');
      }
      if (res.status === 429 || res.status >= 500 || (text && (text.includes('Rate exceeded') || text.includes('Too Many Requests') || isHtml))) {
        if (retries > 0) {
          await new Promise(r => setTimeout(r, delay));
          return request<T>(endpoint, options, retries - 1, delay * 2);
        }
      }
      if (isHtml && endpoint.includes('/auth/')) {
        throw new Error('সার্ভারের সাথে সংযোগে সাময়িক বিলম্ব হচ্ছে। অনুগ্রহ করে ৫-১০ সেকেন্ড পর সঠিক পাসওয়ার্ড দিয়ে আবার চেষ্টা করুন।');
      }
      throw new Error(isHtml ? `Request failed with status ${res.status}` : (text || `Request failed with status ${res.status}`));
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        if (endpoint.includes('/employee') || endpoint.includes('/auth/employee')) {
          authStorage.clearEmployeeToken();
        } else if (endpoint.includes('/admin') || endpoint.includes('/auth/admin')) {
          authStorage.clearAdminToken();
        }
      }
      if ((res.status === 429 || res.status >= 500) && retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return request<T>(endpoint, options, retries - 1, delay * 2);
      }
      const rawErr = data?.error || data?.message || `Request failed with status ${res.status}`;
      const isHtml = typeof rawErr === 'string' && (rawErr.trim().startsWith('<') || rawErr.toLowerCase().includes('html'));
      throw new Error(isHtml ? `Request failed with status ${res.status}` : rawErr);
    }
    return data as T;
  } catch (err: any) {
    if (retries > 0 && (err.message?.includes('Rate exceeded') || err.message?.includes('429') || err.message?.includes('network') || err.message?.includes('Failed to fetch') || err.message?.includes('aborted'))) {
      await new Promise(r => setTimeout(r, delay));
      return request<T>(endpoint, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

export const api = {
  // Public
  publicGetNotifications: () =>
    request<NotificationItem[]>('/api/public/notifications'),

  getBootstrap: () =>
    request<{
      brandSettings: BrandSettings;
      categories: Category[];
      subsections?: any[];
      paymentSettings: PaymentSetting[];
      featuredProducts: Product[];
      trendingProducts: Product[];
      newArrivalProducts: Product[];
    }>('/api/public/bootstrap'),

  getProducts: (params?: { category?: string; search?: string; sort?: string; filter?: string }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.search) query.set('search', params.search);
    if (params?.sort) query.set('sort', params.sort);
    if (params?.filter) query.set('filter', params.filter);
    return request<{ products: Product[]; total: number }>(`/api/public/products?${query.toString()}`);
  },

  getProductDetails: (id: string) => request<Product>(`/api/public/products/${id}`),

  visualSearch: (imageBase64: string, mimeType?: string) =>
    request<{
      success: boolean;
      detectedItem?: {
        detectedCategory?: string;
        itemTypeBn?: string;
        itemTypeEn?: string;
        colors?: string[];
        keywords?: string[];
        descriptionBn?: string;
      };
      matchedProducts: Array<{
        product: Product;
        matchScore: number;
        reason?: string;
      }>;
    }>('/api/public/visual-search', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    }),

  testTelegram: (payload: { token?: string; chatId?: string }) =>
    request<{ success: boolean; message?: string; error?: string }>('/api/telegram/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitPublicOrder: (payload: {
    items: Array<{
      productId: string;
      productName: string;
      productCode: string;
      quantity: number;
      size?: string;
      sellingPrice: number;
      imageUrl?: string;
    }>;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    district: string;
    thana: string;
    notes?: string;
    deliveryCharge: number;
    paymentMethod: 'bKash' | 'Nagad' | 'COD';
    transactionId?: string;
    senderPhone?: string;
    isAdvancePaid: boolean;
    referralCode?: string;
  }) =>
    request<{
      success: boolean;
      orderCode: string;
      itemsCount: number;
      productsTotal: number;
      deliveryCharge: number;
      grandTotal: number;
      advancePaid: number;
      dueAmount: number;
      isAdvancePaid: boolean;
      paymentMethod: string;
      transactionId?: string;
      customerName: string;
      customerPhone: string;
      customerAddress: string;
      orderDate: string;
      message: string;
    }>('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Admin Auth
  adminLogin: (email: string, password: string) =>
    request<{ success: boolean; token: string; admin: { email: string; role: string } }>('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  adminRequestOtp: (email: string, password: string) =>
    request<{ success: boolean; message: string }>('/api/auth/admin/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  adminVerifyOtp: (email: string, otp: string) =>
    request<{ success: boolean; token: string; admin: { email: string; role: string } }>('/api/auth/admin/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp }),
    }),

  adminGetMe: (token: string) =>
    request<{ email: string; role: string }>('/api/auth/admin/me', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminLogout: (token: string) =>
    request<{ success: boolean }>('/api/auth/admin/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  // Employee Auth
  employeeRegister: (payload: {
    name: string;
    email?: string;
    phone: string;
    district: string;
    thana: string;
    password: string;
    reference?: string;
  }) =>
    request<{ success: boolean; messageBn: string; messageEn: string }>('/api/auth/employee/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  employeeLogin: (payload: { identifier: string; password: string }) =>
    request<{ success: boolean; token: string; employee: Employee }>('/api/auth/employee/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  employeeGetMe: (token: string) =>
    request<Employee>('/api/auth/employee/me', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeUpdateProfile: (token: string, payload: { name: string; avatarUrl?: string }) =>
    request<{ success: boolean; employee: Employee }>('/api/employee/profile', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  employeeUpdateStore: (token: string, payload: any) =>
    request<{ success: boolean; employee: Employee }>('/api/employee/store', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  getPublicStore: (slug: string) =>
    request<{ success: boolean; reseller: Employee; isExpired: boolean; products: Product[] }>(`/api/store/${slug}`),

  employeeUploadAvatar: (token: string, imageBase64: string) =>
    request<{ success: boolean; url: string }>('/api/employee/upload-avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: imageBase64 }),
    }),

  employeeGetNotifications: (token: string) =>
    request<NotificationItem[]>('/api/employee/notifications', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeGetProducts: (token?: string) =>
    request<{ products: Product[]; total: number }>('/api/employee/products', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),

  employeeGetReferrals: (token: string) =>
    request<{
      referenceCode: string;
      totalCount: number;
      approvedCount: number;
      pendingCount: number;
      bonusEarned: number;
      thisMonthEarned?: number;
      balanceAdded?: number;
      referrals: Array<{
        id: string;
        name: string;
        phone: string;
        district?: string;
        thana?: string;
        status: string;
        registeredAt: string;
        avatarUrl?: string;
        orderCount?: number;
        deliveredOrders?: number;
        cancelledOrders?: number;
        totalSales?: number;
        referralCommission?: number;
        paidCommission?: number;
        pendingCommission?: number;
      }>;
    }>('/api/employee/referrals', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeGetReferralClientDetails: (token: string, clientId: string) =>
    request<{
      client: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        district?: string;
        thana?: string;
        registeredAt: string;
        status: string;
      };
      stats: {
        totalOrders: number;
        deliveredOrders: number;
        cancelledOrders: number;
        totalSales: number;
        generatedCommission: number;
        paidCommission: number;
        pendingCommission: number;
      };
      orders: any[];
    }>(`/api/employee/referrals/${clientId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeGetTrainingVideos: (token: string) =>
    request<any[]>('/api/employee/training-videos', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeChangePassword: (token: string, payload: { oldPassword: string; newPassword: string }) =>
    request<{ success: boolean; message: string }>('/api/employee/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  employeeMarkNotificationRead: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/employee/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeMarkAllNotificationsRead: (token: string) =>
    request<{ success: boolean }>('/api/employee/notifications/mark-all-read', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeLogout: (token: string) =>
    request<{ success: boolean }>('/api/auth/employee/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  // Employee Operations
  employeeGetDashboard: (token: string) =>
    request<{
      wallet: Employee['wallet'];
      metrics: {
        todaySales: number;
        todayEarnings: number;
        totalSales: number;
        totalEarnings: number;
        availableBalance: number;
        pendingWithdrawal: number;
        totalWithdrawn: number;
        salesCount: number;
      };
      recentSales: Sale[];
      recentTransactions: Transaction[];
      recentWithdrawals: Withdrawal[];
    }>('/api/employee/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeRecordSale: (token: string, payload: {
    productId: string;
    actualSalePrice?: number;
    quantity: number;
    customerName: string;
    customerPhone: string;
    customerAddress: string;
    notes?: string;
    orderCode?: string;
    size?: string;
  }) =>
    request<{ success: boolean; sale: Sale; message: string }>('/api/employee/sales', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  employeeGetSales: (token: string) =>
    request<Sale[]>('/api/employee/sales', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeGetTransactions: (token: string) =>
    request<Transaction[]>('/api/employee/transactions', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeeRequestWithdrawal: (token: string, payload: {
    amount: number;
    paymentMethod: 'bKash' | 'Nagad';
    accountType?: 'Personal' | 'Agent' | 'Merchant' | string;
    accountNumber: string;
    note?: string;
  }) =>
    request<{ success: boolean; withdrawal: Withdrawal; wallet: Employee['wallet']; message: string }>(
      '/api/employee/withdrawals',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }
    ),

  employeeGetWithdrawals: (token: string) =>
    request<Withdrawal[]>('/api/employee/withdrawals', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  employeePaySubscription: (token: string, payload: {
    paymentMethod: string;
    trxId?: string;
    amount: number;
    senderPhone?: string;
  }) =>
    request<{ success: boolean; employee: Employee; messageBn: string; messageEn: string; trxId: string }>(
      '/api/employee/pay-subscription',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }
    ),

  // Admin Operations
  adminGetDashboard: (token: string) =>
    request<{
      stats: {
        totalProducts: number;
        activeProducts: number;
        totalEmployees: number;
        pendingEmployees: number;
        todaySales: number;
        todayCommission: number;
        totalSalesRevenue: number;
        totalCommissionPaid: number;
        pendingWithdrawalsTotal: number;
        pendingWithdrawalsCount: number;
        paidWithdrawalsTotal: number;
        netAdminRevenue: number;
      };
      recentSales: Sale[];
      pendingWithdrawals: Withdrawal[];
      recentEmployees: Employee[];
      recentAuditLogs: AuditLogItem[];
    }>('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetProducts: (token: string) =>
    request<Product[]>('/api/admin/products', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUploadImages: (token: string, images: { name: string; data: string }[]) =>
    request<{ success: boolean; urls: string[] }>('/api/admin/upload-images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ images }),
    }),

  adminUploadVideo: (token: string, data: string) =>
    request<{ success: boolean; url: string }>('/api/admin/upload-video', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
    }),

  adminCreateProduct: (token: string, product: Partial<Product>) =>
    request<{ success: boolean; product: Product }>('/api/admin/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(product),
    }),

  adminUpdateProduct: (token: string, id: string, product: Partial<Product>) =>
    request<{ success: boolean; product: Product }>(`/api/admin/products/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(product),
    }),

  adminArchiveProduct: (token: string, id: string) =>
    request<{ success: boolean; product: Product }>(`/api/admin/products/${id}/archive`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminDeleteProduct: (token: string, id: string) =>
    request<{ success: boolean; deleted: boolean; archived: boolean; undoWindow?: boolean }>(`/api/admin/products/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminToggleProductStatus: (token: string, id: string) =>
    request<{ success: boolean; isActive: boolean }>(`/api/admin/products/${id}/toggle-status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetCategories: (token: string) =>
    request<Category[]>('/api/admin/categories', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminCreateCategory: (token: string, category: Partial<Category>) =>
    request<{ success: boolean; category: Category }>('/api/admin/categories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(category),
    }),

  adminUpdateCategory: (token: string, id: string, category: Partial<Category>) =>
    request<{ success: boolean; category: Category }>(`/api/admin/categories/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(category),
    }),

  adminDeleteCategory: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/admin/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminReorderCategories: (token: string, orders: { id: string; order: number }[]) =>
    request<{ success: boolean }>('/api/admin/categories/reorder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orders }),
    }),

  adminGetSubsections: (token: string) =>
    request<Subsection[]>('/api/admin/subsections', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminSaveSubsections: (token: string, subsections: Subsection[]) =>
    request<{ success: boolean; subsections: Subsection[] }>('/api/admin/subsections', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subsections }),
    }),

  adminDeleteSubsection: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/admin/subsections/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUndoDelete: (token: string) =>
    request<{ success: boolean; message: string }>('/api/admin/undo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminReorderSubsections: (token: string, orders: { id: string; order: number }[]) =>
    request<{ success: boolean }>('/api/admin/subsections/reorder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orders }),
    }),

  adminPublishToWebsite: (token: string) =>
    request<{ success: boolean; message: string }>('/api/admin/publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetEmployees: (token: string) =>
    request<Employee[]>('/api/admin/employees', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUpdateEmployeeProfile: (token: string, id: string, data: Partial<Employee>) =>
    request<{ success: boolean; employee: Employee }>(`/api/admin/employees/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    }),

  adminDeleteEmployee: (token: string, id: string) =>
    request<{ success: boolean; message: string }>(`/api/admin/employees/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUpdateEmployeeStatus: (token: string, id: string, status: string) =>
    request<{ success: boolean; employee: Employee }>(`/api/admin/employees/${id}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    }),

  adminUpdateEmployeeCommission: (token: string, id: string, customCommissionRate: number | null) =>
    request<{ success: boolean; customCommissionRate?: number }>(`/api/admin/employees/${id}/commission`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ customCommissionRate }),
    }),

  adminUpdateResellerMargin: (token: string, id: string, margin: number) =>
    request<{ success: boolean; employee: Employee; message: string }>(`/api/admin/employees/${id}/margin`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ margin }),
    }),

  adminGetResellerStores: (token: string) =>
    request<{ success: boolean; stores: Employee[] }>('/api/admin/reseller-stores', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUpdateResellerStoreStatus: (token: string, employeeId: string, storeStatus: string) =>
    request<{ success: boolean; storeStatus: string }>(`/api/admin/reseller-stores/${employeeId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storeStatus }),
    }),

  adminGetSales: (token: string) =>
    request<Sale[]>('/api/admin/sales', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetWithdrawals: (token: string) =>
    request<Withdrawal[]>('/api/admin/withdrawals', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminConfirmSale: (token: string, saleId: string) =>
    request<{ success: boolean; message: string; updatedCount: number }>(
      `/api/admin/sales/${saleId}/confirm`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  adminApproveSale: (token: string, saleId: string) =>
    request<{ success: boolean; message: string; updatedCount: number }>(
      `/api/admin/sales/${saleId}/approve`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  adminRejectSale: (token: string, saleId: string, payload?: { deductDeliveryCharge?: boolean; penaltyAmount?: number }) =>
    request<{ success: boolean; message: string }>(
      `/api/admin/sales/${saleId}/reject`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload || {}),
      }
    ),

  adminUpdateSaleCourier: (token: string, saleId: string, payload: {
    courierPartner?: string;
    trackingCode?: string;
    trackingUrl?: string;
    deliveryStatus?: string;
  }) =>
    request<{ success: boolean; message: string; courierPartner?: string; trackingCode?: string; courierTrackingUrl?: string }>(
      `/api/admin/sales/${saleId}/courier`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }
    ),

  adminProcessWithdrawal: (token: string, id: string, payload: { action: 'APPROVE' | 'REJECT'; adminNote?: string }) =>
    request<{ success: boolean; withdrawal: Withdrawal; employeeWallet: Employee['wallet'] }>(
      `/api/admin/withdrawals/${id}/process`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }
    ),

  adminForceSync: (token: string) =>
    request<{ success: boolean; message: string; quotaReached?: boolean; syncedAt?: string; stats?: any }>('/api/admin/force-sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminPurgeResellers: (token: string) =>
    request<{ success: boolean; message?: string }>('/api/admin/purge-resellers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetTrainingVideos: (token: string) =>
    request<any[]>('/api/admin/training-videos', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminCreateTrainingVideo: (token: string, video: any) =>
    request<{ success: boolean; video: any }>('/api/admin/training-videos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(video),
    }),

  adminUpdateTrainingVideo: (token: string, id: string, video: any) =>
    request<{ success: boolean; video: any }>(`/api/admin/training-videos/${id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(video),
    }),

  adminDeleteTrainingVideo: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/admin/training-videos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminReorderTrainingVideos: (token: string, orders: { id: string; order: number }[]) =>
    request<{ success: boolean }>('/api/admin/training-videos/reorder', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orders }),
    }),

  adminGetBranding: (token: string) =>
    request<BrandSettings>('/api/admin/branding', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUpdateBranding: (token: string, settings: Partial<BrandSettings>) =>
    request<{ success: boolean; brandSettings: BrandSettings }>('/api/admin/branding', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(settings),
    }),

  adminGetPayments: (token: string) =>
    request<PaymentSetting[]>('/api/admin/payments', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminUpdatePayments: (token: string, paymentSettings: PaymentSetting[]) =>
    request<{ success: boolean; paymentSettings: PaymentSetting[] }>('/api/admin/payments', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ paymentSettings }),
    }),

  adminGetAuditLogs: (token: string) =>
    request<AuditLogItem[]>('/api/admin/audit-logs', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetNotifications: (token: string) =>
    request<NotificationItem[]>('/api/admin/notifications', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminGetAllNotifications: (token: string) =>
    request<NotificationItem[]>('/api/admin/notifications/all', {
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminSendNotification: (
    token: string,
    payload: {
      recipientRole: 'PUBLIC' | 'EMPLOYEE' | 'ALL';
      titleBn: string;
      titleEn?: string;
      messageBn: string;
      messageEn?: string;
      type?: string;
    }
  ) =>
    request<{ success: boolean; notifications: NotificationItem[] }>('/api/admin/notifications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),

  adminMarkAllNotificationsRead: (token: string) =>
    request<{ success: boolean; count: number }>('/api/admin/notifications/mark-all-read', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminDeleteNotification: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/admin/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminMarkNotificationRead: (token: string, id: string) =>
    request<{ success: boolean }>(`/api/admin/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }),

  adminResetEmployeePassword: (token: string, employeeId: string, newPassword: string) =>
    request<{ success: boolean; message: string }>(`/api/admin/employees/${employeeId}/reset-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newPassword }),
    }),

  // Customer History & Delivery Analytics
  getCustomerHistory: (phone: string) =>
    request<{
      phone: string;
      totalOrders: number;
      deliveredOrders: number;
      rejectedOrders: number;
      pendingOrders: number;
      totalAmountSpent: number;
      successRate: number;
      courierNetwork: {
        totalParcels: number;
        deliveredParcels: number;
        returnedParcels: number;
        successRate: number;
        riskStatus: 'GREEN' | 'YELLOW' | 'RED';
        riskTextBn: string;
        riskTextEn: string;
        dataSources: string;
      };
      salesHistory: Array<{
        id: string;
        productName: string;
        productCode?: string;
        quantity: number;
        totalAmount: number;
        status: string;
        createdAt: string;
        customerName?: string;
        customerAddress?: string;
      }>;
    }>(`/api/common/customer-history?phone=${encodeURIComponent(phone)}`),
};
