import React from 'react';
import { SecurityAlert } from '../../hooks/useSecurityFeedback';

interface SecurityAlertBannerProps {
  alert: SecurityAlert | null;
  countdown: number | null;
  onDismiss: () => void;
  onOpenAuthModal?: () => void;
}

export const SecurityAlertBanner: React.FC<SecurityAlertBannerProps> = ({
  alert,
  countdown,
  onDismiss,
  onOpenAuthModal
}) => {
  if (!alert) return null;

  // Determine styling based on alert type
  let borderColor = 'rgba(239, 68, 68, 0.4)';
  let bgColor = 'rgba(239, 68, 68, 0.12)';
  let icon = '🔒';
  let badgeText = 'SECURITY ALERT';
  let badgeColor = '#EF4444';

  if (alert.type === 'rate_limit') {
    borderColor = 'rgba(245, 158, 11, 0.4)';
    bgColor = 'rgba(245, 158, 11, 0.12)';
    icon = '⏳';
    badgeText = 'RATE LIMIT EXCEEDED';
    badgeColor = '#F59E0B';
  } else if (alert.type === 'blocked_url') {
    borderColor = 'rgba(225, 29, 72, 0.4)';
    bgColor = 'rgba(225, 29, 72, 0.12)';
    icon = '⛔';
    badgeText = 'BLOCKED DESTINATION (SSRF)';
    badgeColor = '#E11D48';
  } else if (alert.type === 'crawl_cancelled') {
    borderColor = 'rgba(59, 130, 246, 0.4)';
    bgColor = 'rgba(59, 130, 246, 0.12)';
    icon = '⏹️';
    badgeText = 'JOB CANCELLED';
    badgeColor = '#3B82F6';
  } else if (alert.type === 'huntiq_error') {
    borderColor = 'rgba(249, 115, 22, 0.4)';
    bgColor = 'rgba(249, 115, 22, 0.12)';
    icon = '🔄';
    badgeText = 'HUNTIQ SYNC ISSUE';
    badgeColor = '#F97316';
  } else if (alert.type === 'service_unavailable') {
    borderColor = 'rgba(168, 85, 247, 0.4)';
    bgColor = 'rgba(168, 85, 247, 0.12)';
    icon = '📡';
    badgeText = 'SERVICE UNAVAILABLE';
    badgeColor = '#A855F7';
  }

  return (
    <div
      style={{
        margin: '0 0 20px 0',
        padding: '14px 18px',
        borderRadius: '10px',
        border: `1px solid ${borderColor}`,
        backgroundColor: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '14px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        animation: 'fadeIn 0.25s ease-out'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <div
          style={{
            fontSize: '22px',
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            flexShrink: 0
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                color: badgeColor,
                border: `1px solid ${badgeColor}40`
              }}
            >
              {badgeText}
            </span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>{alert.title}</span>
          </div>
          <div style={{ fontSize: '12px', color: '#CBD5E1', lineHeight: '1.4' }}>
            {alert.message}
            {countdown !== null && countdown > 0 && (
              <span style={{ fontWeight: 700, color: '#FCD34D', marginLeft: '6px' }}>
                Retry enabled in {countdown}s
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {(alert.type === 'auth_failure' || alert.type === 'session_expired') && onOpenAuthModal && (
          <button
            onClick={onOpenAuthModal}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: '#6366F1',
              color: '#FFFFFF',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>🔑</span> Authenticate
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#94A3B8',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '6px',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Dismiss alert"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
