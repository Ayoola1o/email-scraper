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
   * Builds headers with authentication and idempotency
   */
  private buildHeaders(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'EmailScraper-HuntIQ-Connector/1.0'
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      headers['x-huntiq-api-key'] = this.config.apiKey;
    }

    if (this.config.workspaceId) {
      headers['x-workspace-id'] = this.config.workspaceId;
    }

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return headers;
  }

  /**
   * Checks if an error is transient and eligible for retry
   */
  private isTransientError(statusCode?: number, err?: any): boolean {
    if (statusCode) {
      // 5xx server errors and 429 Too Many Requests are eligible for retry
      return statusCode >= 500 || statusCode === 429;
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
        err.name === 'AbortError'
      );
    }
    return false;
  }

  /**
   * Tests connection, reachability, and authentication with HUNTIQ
   */
  async checkConnection(): Promise<HuntIQConnectionTestResult> {
    if (!this.config.apiUrl) {
      return {
        success: false,
        integration: 'huntiq',
        reachable: false,
        authenticated: false,
        message: 'HUNTIQ_API_URL is not configured on server'
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
   * Synchronizes discovered contacts to HUNTIQ with idempotency and controlled retries
   */
  async syncContacts(payload: HuntIQSyncPayload): Promise<HuntIQSyncResponse> {
    if (!this.config.apiUrl) {
      throw new Error('HUNTIQ_API_URL is not configured on server');
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
          throw new Error(`HUNTIQ authentication failed (HTTP ${response.status}). Unauthorized.`);
        }
        if (response.status === 400 || response.status === 422) {
          const errText = await response.text();
          throw new Error(`HUNTIQ rejected payload as invalid (HTTP ${response.status}): ${errText}`);
        }

        // Retry transient server errors
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

        // Parse ingestion results safely from HUNTIQ response
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

        // If it's a client error (e.g. 401/400), don't retry
        if (err.message && (err.message.includes('HTTP 401') || err.message.includes('HTTP 403') || err.message.includes('HTTP 400'))) {
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
