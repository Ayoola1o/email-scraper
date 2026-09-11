import { HuntIQConfig, HuntIQConfigManager } from './huntiqConfig';
import {
  HuntIQConnectionTestResult,
  HuntIQSyncPayload,
  HuntIQSyncResponse
} from './huntiqTypes';

export class HuntIQClient {
  private config: HuntIQConfig;

  constructor(customConfig?: Partial<HuntIQConfig>) {
    const baseConfig = HuntIQConfigManager.getConfig();
    this.config = {
      ...baseConfig,
      ...customConfig
    };
  }

  /**
   * Builds request headers with server-side authentication and idempotency.
   * Strictly avoids arbitrary client workspace headers.
   */
  private buildHeaders(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'EmailScraper-HuntIQ-Discovery/1.0'
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      headers['x-huntiq-api-key'] = this.config.apiKey;
    }

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return headers;
  }

  /**
   * Determines if an HTTP or network failure is transient and eligible for backoff retry
   */
  private isTransientError(statusCode?: number, err?: any): boolean {
    if (statusCode) {
      // Fast-fail: Never retry client or authentication errors
      if (
        statusCode === 400 ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 404 ||
        statusCode === 422
      ) {
        return false;
      }
      // Retry transient server or rate limit codes: 408, 429, 500, 502, 503, 504
      return statusCode === 408 || statusCode === 429 || statusCode >= 500;
    }

    // Network errors, timeouts, connection resets
    if (err) {
      const code = err.code || (err.cause && err.cause.code);
      return (
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNREFUSED' ||
        code === 'EAI_AGAIN' ||
        err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        err.message?.includes('timeout') ||
        err.message?.includes('aborted')
      );
    }
    return false;
  }

  /**
   * Performs an authenticated health and connection verification test against HUNTIQ
   */
  async checkConnection(): Promise<HuntIQConnectionTestResult> {
    if (!HuntIQConfigManager.isConfigured()) {
      return {
        success: false,
        integration: 'huntiq',
        reachable: false,
        authenticated: false,
        code: 'HUNTIQ_INTEGRATION_NOT_CONFIGURED',
        message: 'HUNTIQ integration is not configured on this server.'
      };
    }

    try {
      const pingPayload = {
        integration: 'email-scraper',
        action: 'ping',
        source: 'HEALTH_CHECK'
      };

      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(pingPayload),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          integration: 'huntiq',
          reachable: true,
          authenticated: false,
          statusCode: response.status,
          code: 'AUTHENTICATION_FAILED',
          message: `Authentication rejected (HTTP ${response.status}). Verify HUNTIQ_API_KEY.`
        };
      }

      const reachable = response.ok || response.status < 500;
      return {
        success: response.ok,
        integration: 'huntiq',
        reachable,
        authenticated: response.ok || response.status !== 401,
        statusCode: response.status,
        message: response.ok
          ? `HUNTIQ connection verified (HTTP ${response.status})`
          : `HUNTIQ server reachable (HTTP ${response.status})`
      };
    } catch (err: any) {
      return {
        success: false,
        integration: 'huntiq',
        reachable: false,
        authenticated: false,
        message: `Unable to reach HUNTIQ: ${err.message}`
      };
    }
  }

  /**
   * Synchronizes discovered contact records into HUNTIQ with idempotency and controlled retries
   */
  async syncContacts(payload: HuntIQSyncPayload): Promise<HuntIQSyncResponse> {
    if (!HuntIQConfigManager.isConfigured()) {
      const err = new Error('HUNTIQ integration is not configured on this server.');
      (err as any).code = 'HUNTIQ_INTEGRATION_NOT_CONFIGURED';
      throw err;
    }

    if (!payload.contacts || payload.contacts.length === 0) {
      return {
        success: true,
        requestId: payload.requestId,
        accepted: 0,
        rejected: 0,
        duplicates: 0,
        errors: []
      };
    }

    let lastError: any = null;
    const maxAttempts = Math.max(1, this.config.maxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.config.apiUrl, {
          method: 'POST',
          headers: this.buildHeaders(payload.requestId),
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.timeoutMs)
        });

        // Fast-fail: Do NOT retry on authentication or client validation errors
        if (response.status === 401 || response.status === 403) {
          const authErr = new Error(`HUNTIQ authentication failed (HTTP ${response.status}). Unauthorized.`);
          (authErr as any).statusCode = response.status;
          throw authErr;
        }
        if (response.status === 400 || response.status === 422) {
          const errText = await response.text();
          const valErr = new Error(`HUNTIQ rejected payload as invalid (HTTP ${response.status}): ${errText}`);
          (valErr as any).statusCode = response.status;
          throw valErr;
        }

        // Retry transient server or rate limit codes
        if (this.isTransientError(response.status) && attempt < maxAttempts) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(res => setTimeout(res, backoffMs));
          continue;
        }

        const responseText = await response.text();
        let data: any;
        try {
          data = JSON.parse(responseText);
        } catch {
          data = { message: responseText };
        }

        if (!response.ok) {
          throw new Error(`HUNTIQ server error (HTTP ${response.status}): ${data.message || responseText}`);
        }

        const accepted = typeof data.accepted === 'number'
          ? data.accepted
          : typeof data.importedCount === 'number'
            ? data.importedCount
            : payload.contacts.length;

        const duplicates = typeof data.duplicates === 'number' ? data.duplicates : 0;
        const rejected = typeof data.rejected === 'number' ? data.rejected : 0;
        const errors = Array.isArray(data.errors) ? data.errors : [];

        return {
          success: true,
          requestId: payload.requestId,
          accepted,
          rejected,
          duplicates,
          errors,
          huntiqResponse: data
        };
      } catch (err: any) {
        lastError = err;

        // Fast-fail: Do NOT retry client/auth errors
        if (
          err.statusCode === 401 ||
          err.statusCode === 403 ||
          err.statusCode === 400 ||
          err.statusCode === 422 ||
          err.message?.includes('HTTP 401') ||
          err.message?.includes('HTTP 403') ||
          err.message?.includes('HTTP 400') ||
          err.code === 'HUNTIQ_INTEGRATION_NOT_CONFIGURED'
        ) {
          throw err;
        }

        // If not transient or last attempt reached, exit loop
        if (!this.isTransientError(undefined, err) || attempt >= maxAttempts) {
          break;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(res => setTimeout(res, backoffMs));
      }
    }

    throw lastError || new Error('HUNTIQ synchronization failed');
  }
}
