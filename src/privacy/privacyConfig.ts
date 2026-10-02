import { PrivacyConfig } from './types';

let currentConfig: PrivacyConfig = {
  retentionDays: 90,
  maskEmailsInLogs: true,
  sanitizeContextSnippets: true,
  contextSnippetMaxChars: 150,
  stripContextSnippets: false,
  honorRobotsTxt: true
};

export function getPrivacyConfig(): PrivacyConfig {
  return { ...currentConfig };
}

export function updatePrivacyConfig(updates: Partial<PrivacyConfig>): PrivacyConfig {
  currentConfig = {
    ...currentConfig,
    ...updates
  };
  return { ...currentConfig };
}
