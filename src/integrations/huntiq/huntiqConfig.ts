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

export class HuntIQConfigManager {
  /**
   * Retrieves server configuration exclusively from environment variables
   */
  static getConfig(): HuntIQConfig {
    const enabledEnv = process.env.HUNTIQ_INTEGRATION_ENABLED;
    const isEnabled = enabledEnv !== undefined ? enabledEnv.toLowerCase() === 'true' : true;

    return {
      apiUrl: (process.env.HUNTIQ_API_URL || '').trim(),
      apiKey: (process.env.HUNTIQ_API_KEY || '').trim() || undefined,
      enabled: isEnabled,
      timeoutMs: parseInt(process.env.HUNTIQ_TIMEOUT_MS || '10000', 10),
      maxRetries: parseInt(process.env.HUNTIQ_MAX_RETRIES || '3', 10)
    };
  }

  /**
   * Checks whether the HUNTIQ integration is enabled and fully configured on the server
   */
  static isConfigured(): boolean {
    const config = this.getConfig();
    return Boolean(config.enabled && config.apiUrl && config.apiUrl.length > 0);
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
}
