/**
 * Secure Frontend API Client
 * Centralizes request execution, CSRF protection, header management,
 * token/session lifecycle, and security event callbacks.
 */

export interface SecurityCallbacks {
  onAuthFailure?: (message: string) => void;
  onForbidden?: (message: string) => void;
  onRateLimit?: (retryAfterSeconds: number, message: string) => void;
  onBlockedUrl?: (message: string) => void;
  onServiceUnavailable?: (message: string) => void;
  onCrawlCancelled?: (jobId: string) => void;
  onJobFailed?: (jobId: string, error: string) => void;
  onHuntiqError?: (message: string) => void;
}

export interface UserSessionInfo {
  id: string;
  username: string;
  role: 'admin' | 'user' | 'readonly' | 'service';
}

class SecureApiClient {
  private static instance: SecureApiClient;
  private authToken: string | null = null;
  private apiKey: string | null = null;
  private currentUser: UserSessionInfo | null = null;
  private callbacks: SecurityCallbacks = {};

  private constructor() {
    // Try to load any existing session token or user from sessionStorage (never localStorage for security)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const storedToken = sessionStorage.getItem('esp_auth_token');
        if (storedToken) this.authToken = storedToken;

        const storedKey = sessionStorage.getItem('esp_api_key');
        if (storedKey) this.apiKey = storedKey;

        const storedUser = sessionStorage.getItem('esp_user_info');
        if (storedUser) this.currentUser = JSON.parse(storedUser);
      } catch {}
    }
  }

  public static getInstance(): SecureApiClient {
    if (!SecureApiClient.instance) {
      SecureApiClient.instance = new SecureApiClient();
    }
    return SecureApiClient.instance;
  }

  public setCallbacks(callbacks: SecurityCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public setAuthToken(token: string | null, user?: UserSessionInfo | null) {
    this.authToken = token;
    this.currentUser = user || null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (token) {
        sessionStorage.setItem('esp_auth_token', token);
      } else {
        sessionStorage.removeItem('esp_auth_token');
      }
      if (user) {
        sessionStorage.setItem('esp_user_info', JSON.stringify(user));
      } else {
        sessionStorage.removeItem('esp_user_info');
      }
    }
  }

  public setApiKey(key: string | null) {
    this.apiKey = key;
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (key) {
        sessionStorage.setItem('esp_api_key', key);
      } else {
        sessionStorage.removeItem('esp_api_key');
      }
    }
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public getApiKey(): string | null {
    return this.apiKey;
  }

  public getCurrentUser(): UserSessionInfo | null {
    return this.currentUser;
  }

  /**
   * Centralized HTTP Request Dispatcher
   */
  public async request<T = any>(endpoint: string, options: RequestInit = {}, silentAuthFailure = false): Promise<T> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // CSRF defense
      ...(options.headers as Record<string, string> || {})
    };

    if (this.authToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (this.apiKey && !headers['X-API-Key']) {
      headers['X-API-Key'] = this.apiKey;
    }

    const config: RequestInit = {
      ...options,
      credentials: 'include', // Transmit session cookies across same-origin and dev server cross-origin
      headers
    };

    let response: Response;
    try {
      response = await fetch(endpoint, config);
    } catch (networkErr: any) {
      this.callbacks.onServiceUnavailable?.('Network connectivity error. Backend service is currently unreachable.');
      throw new Error(`Network error: ${networkErr.message}`);
    }

    // Inspect status codes for specific security conditions
    if (response.status === 401) {
      this.setAuthToken(null, null);
      let authMsg = 'Session expired or authentication required. Please sign in to continue.';
      try {
        const errJson = await response.clone().json();
        if (errJson.message) {
          authMsg = errJson.message;
        } else if (errJson.error && typeof errJson.error === 'string') {
          authMsg = errJson.error;
        } else if (errJson.error?.message) {
          authMsg = errJson.error.message;
        }
      } catch {}
      if (!silentAuthFailure) {
        this.callbacks.onAuthFailure?.(authMsg);
      }
      throw new Error(authMsg);
    }

    if (response.status === 403) {
      let forbiddenMsg = 'Access Denied: You lack permissions to perform this operation or access this resource.';
      try {
        const errJson = await response.clone().json();
        if (errJson.message) {
          forbiddenMsg = errJson.message;
        } else if (errJson.error?.message) {
          forbiddenMsg = errJson.error.message;
        } else if (errJson.error && typeof errJson.error === 'string') {
          forbiddenMsg = errJson.error;
        }
      } catch {}
      this.callbacks.onForbidden?.(forbiddenMsg);
      throw new Error(forbiddenMsg);
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
      let limitMsg = `Rate limit exceeded. Too many requests. Please wait ${retryAfterSec} seconds.`;
      try {
        const errJson = await response.clone().json();
        if (errJson.message || errJson.error) {
          limitMsg = errJson.message || errJson.error;
        }
      } catch {}
      this.callbacks.onRateLimit?.(retryAfterSec, limitMsg);
      throw new Error(limitMsg);
    }

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      const msg = 'Backend queue or worker service is temporarily unavailable. Please retry in a moment.';
      this.callbacks.onServiceUnavailable?.(msg);
      throw new Error(msg);
    }

    // Parse response body
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (!response.ok) {
        const errMsg = data.error?.message || data.error || data.message || `Request failed with status ${response.status}`;
        // Check for blocked SSRF / unsafe URL patterns
        if (
          errMsg.includes('prohibited') ||
          errMsg.includes('SSRF') ||
          errMsg.includes('private network') ||
          errMsg.includes('Restricted') ||
          errMsg.includes('unsafe URL') ||
          errMsg.includes('INVALID_INPUT')
        ) {
          this.callbacks.onBlockedUrl?.(errMsg);
        }
        throw new Error(errMsg);
      }
      return data as T;
    }

    // Non-JSON response (e.g. file export blob or text)
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    return response as any;
  }

  // ---------------------------------------------------------------------------
  // Authentication & Session Endpoints
  // ---------------------------------------------------------------------------

  public async login(username: string, role: 'admin' | 'user' | 'readonly' | 'service' = 'user'): Promise<UserSessionInfo> {
    const data = await this.request<{ success: boolean; token: string; user: UserSessionInfo }>('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, role })
    });
    this.setAuthToken(data.token, data.user);
    return data.user;
  }

  public async getMe(): Promise<UserSessionInfo | null> {
    try {
      const data = await this.request<{ success: boolean; user: UserSessionInfo }>('/api/auth/me', {}, true);
      if (data && data.user) {
        this.currentUser = data.user;
        return data.user;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch {}
    this.setAuthToken(null, null);
    this.setApiKey(null);
  }

  public async getProfile() {
    return this.request('/api/auth/profile');
  }

  public async updateProfile(preferences: any) {
    return this.request('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences })
    });
  }

  // ---------------------------------------------------------------------------
  // Scraping & Crawling Endpoints
  // ---------------------------------------------------------------------------

  public async scrapePage(url: string, timeout = 12000, userAgent?: string) {
    return this.request('/api/scrape/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timeout, userAgent })
    });
  }

  public async startCrawl(params: {
    url: string;
    maxDepth?: number;
    maxPages?: number;
    sameDomainOnly?: boolean;
    timeout?: number;
    delayMs?: number;
    useBrowser?: boolean;
    userAgent?: string;
    respectRobotsTxt?: boolean;
    contactEmail?: string;
  }) {
    return this.request('/api/scrape/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  }

  public async listJobs(limit = 50, all = false) {
    return this.request<{ success: boolean; count: number; jobs: any[] }>(
      `/api/scrape/crawl/jobs?limit=${limit}${all ? '&all=true' : ''}`
    );
  }

  public async getJob(jobId: string) {
    return this.request<{ success: boolean; job: any }>(
      `/api/scrape/crawl/jobs/${encodeURIComponent(jobId)}`
    );
  }

  public async deleteJob(jobId: string) {
    return this.request<{ success: boolean; message: string }>(
      `/api/scrape/crawl/jobs/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' }
    );
  }

  public async cancelCrawl(jobId: string) {
    try {
      const result = await this.request(`/api/scrape/crawl/cancel/${jobId}`, {
        method: 'POST'
      });
      this.callbacks.onCrawlCancelled?.(jobId);
      return result;
    } catch (err: any) {
      throw err;
    }
  }

  public async batchScrape(urls: string[], options: { maxDepth?: number; maxPages?: number } = {}) {
    return this.request('/api/scrape/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, ...options })
    });
  }

  public async scrapeText(text: string, sourceName = 'Manual Input') {
    return this.request('/api/scrape/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceName })
    });
  }

  // ---------------------------------------------------------------------------
  // Verification & Deliverability Endpoints
  // ---------------------------------------------------------------------------

  public async verifyMx(emailsOrRecords: { emails?: string[]; records?: any[] } | string[]) {
    const payload = Array.isArray(emailsOrRecords)
      ? { emails: emailsOrRecords }
      : emailsOrRecords;
    return this.request('/api/verify/mx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  public async bulkValidate(payload: { csv?: string; text?: string; emails?: string[]; records?: any[] }) {
    return this.request('/api/validator/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  // ---------------------------------------------------------------------------
  // Import & Export Endpoints
  // ---------------------------------------------------------------------------

  public async importList(payload: { text?: string; records?: any[]; verifyNow?: boolean; sourceName?: string; defaultCompany?: string }) {
    return this.request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  public async exportRecords(payload: {
    records: any[];
    format?: 'csv' | 'json' | 'txt' | 'vcf';
    segment?: string;
    fields?: string[];
    filename?: string;
    filterSuppressed?: boolean;
  }): Promise<Blob> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await fetch('/api/export', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errMsg = `Export failed with status ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) errMsg = j.error;
      } catch {}
      throw new Error(errMsg);
    }

    return await res.blob();
  }

  // ---------------------------------------------------------------------------
  // HUNTIQ CRM Integration Endpoints
  // ---------------------------------------------------------------------------

  public async getHuntiqConfig() {
    return this.request('/api/integrations/huntiq/config');
  }

  public async saveHuntiqConfig(config: {
    apiUrl: string;
    apiKey: string;
    enabled?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    return this.request('/api/integrations/huntiq/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  }

  public async testHuntiq(silent = false) {
    return this.request('/api/integrations/huntiq/test', {
      method: 'POST'
    }, silent);
  }

  public async syncHuntiq(records: any[], jobId?: string) {
    try {
      return await this.request('/api/integrations/huntiq/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records, jobId })
      });
    } catch (err: any) {
      this.callbacks.onHuntiqError?.(err.message);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Privacy & Suppression Endpoints
  // ---------------------------------------------------------------------------

  public async checkSuppression(email: string) {
    return this.request(`/api/privacy/suppression/check/${encodeURIComponent(email)}`);
  }

  public async listSuppression() {
    return this.request('/api/privacy/suppression');
  }

  public async addSuppression(entry: { type: string; value: string; reason?: string; note?: string }) {
    return this.request('/api/privacy/suppression', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  }

  public async removeSuppression(id: string) {
    return this.request(`/api/privacy/suppression/${id}`, {
      method: 'DELETE'
    });
  }
}

export const apiClient = SecureApiClient.getInstance();
