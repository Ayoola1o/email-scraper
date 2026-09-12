/**
 * HUNTIQ Configuration Module
 * 
 * Manages server-side configuration and credentials for HUNTIQ CRM.
 * NEVER exposes API keys or secrets to the frontend.
 * Strictly avoids client-supplied workspace IDs or default fallbacks.
 */

export interface HuntIQConfig {
  apiUrl: string;
  apiKey?: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface HuntIQUnconfiguredError {
  success: false;
  code: 'HUNTIQ_INTEGRATION_NOT_CONFIGURED';
  message: string;
}

export interface HuntIQConfigValidationResult {
  valid: boolean;
  error?: string;
  cleanUpdates?: {
    apiUrl?: string;
    apiKey?: string;
    enabled?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
  };
}

export class HuntIQConfigManager {
  /**
   * Retrieves server configuration exclusively from environment variables
   */
  static getConfig(): HuntIQConfig {
    const enabledEnv = process.env.HUNTIQ_INTEGRATION_ENABLED;
    const isEnabled = enabledEnv !== undefined ? enabledEnv.toLowerCase() === 'true' : false;

    return {
      apiUrl: (process.env.HUNTIQ_API_URL || '').trim(),
      apiKey: (process.env.HUNTIQ_API_KEY || '').trim() || undefined,
      enabled: isEnabled,
      timeoutMs: parseInt(process.env.HUNTIQ_TIMEOUT_MS || '30000', 10),
      maxRetries: parseInt(process.env.HUNTIQ_MAX_RETRIES || '3', 10)
    };
  }

  /**
   * Checks whether the HUNTIQ integration is enabled and fully configured on the server.
   * Configured ONLY when:
   * 1. HUNTIQ_INTEGRATION_ENABLED=true
   * 2. HUNTIQ_API_URL exists (non-empty)
   * 3. HUNTIQ_API_KEY exists (non-empty)
   */
  static isConfigured(): boolean {
    const config = this.getConfig();
    return Boolean(
      config.enabled === true &&
      config.apiUrl &&
      config.apiUrl.length > 0 &&
      config.apiKey &&
      config.apiKey.length > 0
    );
  }

  /**
   * Validates configuration update parameters
   */
  static validateConfigUpdates(updates: any): HuntIQConfigValidationResult {
    if (!updates || typeof updates !== 'object') {
      return { valid: false, error: 'Configuration update payload must be an object' };
    }

    const cleanUpdates: HuntIQConfigValidationResult['cleanUpdates'] = {};

    // Validate apiUrl if provided
    if (updates.apiUrl !== undefined) {
      if (typeof updates.apiUrl !== 'string') {
        return { valid: false, error: 'apiUrl must be a valid string URL' };
      }
      const trimmedUrl = updates.apiUrl.trim();
      if (trimmedUrl !== '') {
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(trimmedUrl);
        } catch {
          return { valid: false, error: `apiUrl "${trimmedUrl}" is not a valid URL` };
        }

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return { valid: false, error: `Invalid apiUrl protocol "${parsedUrl.protocol}". Only http: and https: are allowed.` };
        }

        // In production, enforce HTTPS unless loopback/local
        const isProduction = process.env.NODE_ENV === 'production';
        const isLoopback = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === '::1';
        if (isProduction && parsedUrl.protocol !== 'https:' && !isLoopback) {
          return { valid: false, error: 'HUNTIQ_API_URL must use HTTPS in production environments' };
        }

        cleanUpdates.apiUrl = trimmedUrl;
      }
    }

    // Validate apiKey if provided
    if (updates.apiKey !== undefined) {
      if (typeof updates.apiKey !== 'string') {
        return { valid: false, error: 'apiKey must be a string' };
      }
      const trimmedKey = updates.apiKey.trim();
      // If non-empty and does not contain mask characters, accept it
      if (trimmedKey !== '' && !trimmedKey.includes('••••') && !trimmedKey.includes('●●●●')) {
        cleanUpdates.apiKey = trimmedKey;
      }
      // Note: empty string or masked key means "keep existing key" and is intentionally not overwritten
    }

    // Validate enabled if provided
    if (updates.enabled !== undefined) {
      if (typeof updates.enabled === 'boolean') {
        cleanUpdates.enabled = updates.enabled;
      } else if (typeof updates.enabled === 'string') {
        const lower = updates.enabled.trim().toLowerCase();
        if (lower === 'true') cleanUpdates.enabled = true;
        else if (lower === 'false') cleanUpdates.enabled = false;
        else return { valid: false, error: 'enabled must be a boolean (true/false)' };
      } else {
        return { valid: false, error: 'enabled must be a boolean' };
      }
    }

    // Validate timeoutMs if provided
    if (updates.timeoutMs !== undefined) {
      const parsedTimeout = parseInt(String(updates.timeoutMs), 10);
      if (isNaN(parsedTimeout) || parsedTimeout < 1000 || parsedTimeout > 120000) {
        return { valid: false, error: 'timeoutMs must be an integer between 1,000 ms and 120,000 ms' };
      }
      cleanUpdates.timeoutMs = parsedTimeout;
    }

    // Validate maxRetries if provided
    if (updates.maxRetries !== undefined) {
      const parsedRetries = parseInt(String(updates.maxRetries), 10);
      if (isNaN(parsedRetries) || parsedRetries < 0 || parsedRetries > 10) {
        return { valid: false, error: 'maxRetries must be an integer between 0 and 10' };
      }
      cleanUpdates.maxRetries = parsedRetries;
    }

    return { valid: true, cleanUpdates };
  }

  /**
   * Returns a standard unconfigured error payload matching the specification
   */
  static getUnconfiguredError(): HuntIQUnconfiguredError {
    return {
      success: false,
      code: 'HUNTIQ_INTEGRATION_NOT_CONFIGURED',
      message: 'HUNTIQ integration is not configured on this server.'
    };
  }

  /**
   * Returns a sanitized diagnostic summary without leaking secrets
   */
  static getSanitizedDiagnostics() {
    const config = this.getConfig();
    return {
      isConfigured: this.isConfigured(),
      enabled: config.enabled,
      hasApiUrl: Boolean(config.apiUrl),
      hasApiKey: Boolean(config.apiKey),
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries
    };
  }

  /**
   * Updates in-memory configuration environment variables safely
   */
  static updateConfig(updates: {
    apiUrl?: string;
    apiKey?: string;
    enabled?: boolean;
    timeoutMs?: number;
    maxRetries?: number;
  }): HuntIQConfig {
    if (updates.apiUrl !== undefined) {
      process.env.HUNTIQ_API_URL = updates.apiUrl.trim();
    }
    if (updates.apiKey !== undefined && updates.apiKey.trim() !== '') {
      // Do not overwrite with masked values
      if (!updates.apiKey.includes('••••') && !updates.apiKey.includes('●●●●')) {
        process.env.HUNTIQ_API_KEY = updates.apiKey.trim();
      }
    }
    if (updates.enabled !== undefined) {
      process.env.HUNTIQ_INTEGRATION_ENABLED = String(updates.enabled);
    }
    if (updates.timeoutMs !== undefined) {
      process.env.HUNTIQ_TIMEOUT_MS = String(updates.timeoutMs);
    }
    if (updates.maxRetries !== undefined) {
      process.env.HUNTIQ_MAX_RETRIES = String(updates.maxRetries);
    }
    return this.getConfig();
  }
}
