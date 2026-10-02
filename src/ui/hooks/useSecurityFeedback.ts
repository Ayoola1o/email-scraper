import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/apiClient';

export type SecurityAlertType =
  | 'auth_failure'
  | 'rate_limit'
  | 'blocked_url'
  | 'crawl_cancelled'
  | 'job_failed'
  | 'service_unavailable'
  | 'huntiq_error'
  | 'session_expired';

export interface SecurityAlert {
  id: string;
  type: SecurityAlertType;
  title: string;
  message: string;
  retryAfterSeconds?: number;
  timestamp: number;
}

export function useSecurityFeedback() {
  const [activeAlert, setActiveAlert] = useState<SecurityAlert | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  // Clear alert
  const dismissAlert = useCallback(() => {
    setActiveAlert(null);
    setRetryCountdown(null);
  }, []);

  // Set an alert
  const triggerAlert = useCallback((type: SecurityAlertType, title: string, message: string, retryAfterSeconds?: number) => {
    const alert: SecurityAlert = {
      id: `alert_${Date.now()}`,
      type,
      title,
      message,
      retryAfterSeconds,
      timestamp: Date.now()
    };
    setActiveAlert(alert);
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      setRetryCountdown(retryAfterSeconds);
    } else {
      setRetryCountdown(null);
    }
  }, []);

  // Handle countdown timer for rate limits
  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return;
    const timer = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryCountdown]);

  // Wire API client callbacks to feedback state
  useEffect(() => {
    apiClient.setCallbacks({
      onAuthFailure: (message) => {
        triggerAlert('auth_failure', 'Authentication Failed', message);
      },
      onForbidden: (message) => {
        triggerAlert('auth_failure', 'Access Forbidden (403)', message);
      },
      onRateLimit: (retryAfterSec, message) => {
        triggerAlert('rate_limit', 'Rate Limit Exceeded (429)', message, retryAfterSec);
      },
      onBlockedUrl: (message) => {
        triggerAlert('blocked_url', 'Blocked Unsafe Destination (SSRF Defense)', message);
      },
      onServiceUnavailable: (message) => {
        triggerAlert('service_unavailable', 'Backend Service Unavailable', message);
      },
      onCrawlCancelled: (jobId) => {
        triggerAlert('crawl_cancelled', 'Crawl Job Cancelled', `Job ${jobId} was successfully cancelled and worker terminated.`);
      },
      onJobFailed: (jobId, error) => {
        triggerAlert('job_failed', 'Extraction Job Failed', `Job ${jobId} failed: ${error}`);
      },
      onHuntiqError: (message) => {
        triggerAlert('huntiq_error', 'HUNTIQ Synchronization Error', message);
      }
    });
  }, [triggerAlert]);

  return {
    activeAlert,
    retryCountdown,
    dismissAlert,
    triggerAlert
  };
}
