/**
 * HUNTIQ Configuration Module
 * 
 * Manages server-side configuration and credentials for HUNTIQ CRM.
 * NEVER exposes API keys or secrets to the frontend.
 */

export interface HuntIQConfig {
  apiUrl: string;
  apiKey?: string;
  workspaceId?: string;
  timeoutMs: number;
  maxRetries: number;
}

export class HuntIQConfigManager {
  /**
   * Retrieves server configuration from environment variables
   */
  static getConfig(): HuntIQConfig {
    return {
      apiUrl: (process.env.HUNTIQ_API_URL || '').trim(),
      apiKey: (process.env.HUNTIQ_API_KEY || '').trim() || undefined,
      workspaceId: (process.env.HUNTIQ_WORKSPACE_ID || '').trim() || undefined,
      timeoutMs: parseInt(process.env.HUNTIQ_TIMEOUT_MS || '10000', 10),
      maxRetries: parseInt(process.env.HUNTIQ_MAX_RETRIES || '3', 10)
    };
  }

  /**
   * Validates whether the HUNTIQ integration has required configuration
   */
  static validateConfig(): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!process.env.HUNTIQ_API_URL) {
      missing.push('HUNTIQ_API_URL');
    }
    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Checks if basic HUNTIQ endpoint configuration is present
   */
  static isConfigured(): boolean {
    return Boolean(process.env.HUNTIQ_API_URL && process.env.HUNTIQ_API_URL.trim().length > 0);
  }

  /**
   * Returns a sanitized view of configuration suitable for diagnostics
   * (Masks the API key completely)
   */
  static getSanitizedDiagnostics() {
    const config = this.getConfig();
    return {
      isConfigured: this.isConfigured(),
      apiUrl: config.apiUrl || '(not set)',
      hasApiKey: Boolean(config.apiKey),
      workspaceId: config.workspaceId || '(not set)',
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries
    };
  }
}
