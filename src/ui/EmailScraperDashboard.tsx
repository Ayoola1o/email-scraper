import React, { useState, useEffect, useMemo, useRef } from 'react';

// =============================================================================
// TypeScript Interfaces & Data Contracts (Preserved Exactly)
// =============================================================================

export type NavSection = 'dashboard' | 'scraper' | 'results' | 'history' | 'huntiq' | 'settings';
export type ScrapeMode = 'single' | 'domain' | 'batch' | 'text';
export type JobStatus = 'Completed' | 'Running' | 'Failed' | 'Cancelled';
export type EmailType = 'personal' | 'role' | 'unknown';
export type MxStatus = 'deliverable' | 'undeliverable' | 'risky' | 'disposable' | 'pending';

export interface ScrapedEmailRecord {
  email: string;
  name?: string;
  jobTitle?: string;
  phone?: string;
  linkedin?: string;
  twitter?: string;
  github?: string;
  type?: EmailType;
  domain?: string;
  sourceUrl?: string;
  pageTitle?: string;
  contextSnippet?: string;
  discoveredAt?: string;
  mxStatus?: MxStatus;
  mxRecords?: string[];
  identityInference?: {
    firstName?: string;
    lastName?: string;
    confidence: number;
    source: string;
  };
  identitySource?: 'website' | 'inferred';
}

export interface CrawlJobTelemetry {
  jobId: string;
  status: JobStatus;
  pagesVisited: number;
  totalFound: number;
  depth: number;
  queueSize: number;
  currentUrl?: string;
  records: ScrapedEmailRecord[];
}

export interface RecentJobItem {
  id: string;
  name: string;
  type: 'Crawl' | 'Domain' | 'Batch' | 'Single';
  target: string;
  status: JobStatus;
  emailsFound: number;
  started: string;
}

export interface ActivityItem {
  id: string;
  time: string;
  status: JobStatus;
  detail: string;
}

export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  time: string;
  read: boolean;
}

// =============================================================================
// Main Component: Restyled to Match Exact Navy/Purple Design System
// =============================================================================

export const EmailScraperDashboard: React.FC = () => {
  // Navigation & Drawer
  const [activeNav, setActiveNav] = useState<NavSection>('scraper');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Scraper Form Inputs
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>('single');
  const [targetUrl, setTargetUrl] = useState('');
  const [crawlDepth, setCrawlDepth] = useState('3 (recommended)');
  const [maxPages, setMaxPages] = useState('100');
  const [emailTypeFilter, setEmailTypeFilter] = useState('All types');
  const [verifyEmails, setVerifyEmails] = useState(true);
  const [isScraping, setIsScraping] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(true);

  // Active Job & Telemetry State
  const [activeJob, setActiveJob] = useState<CrawlJobTelemetry | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Scraped Records State (Starts clean, dynamic)
  const [records, setRecords] = useState<ScrapedEmailRecord[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'personal' | 'role'>('all');

  // Column Customization for Export & Table View
  const [selectedColumns] = useState<Set<string>>(
    new Set(['email', 'name', 'mxStatus', 'phone', 'type', 'domain', 'linkedin', 'sourceUrl', 'contextSnippet'])
  );

  // HUNTIQ CRM Status
  const [huntiqStatus, setHuntiqStatus] = useState<{
    configured: boolean;
    connected: boolean;
    lastSync: string;
    recordsSynced: number;
    message?: string;
  }>({
    configured: false,
    connected: false,
    lastSync: 'Not synced yet',
    recordsSynced: 0,
    message: 'Testing connection...'
  });

  // Modals & Panels
  const [showHuntiqModal, setShowHuntiqModal] = useState(false);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [rawTextInput, setRawTextInput] = useState('');
  const [isSyncingHuntiq, setIsSyncingHuntiq] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Activity & Recent Jobs
  const [recentJobs, setRecentJobs] = useState<RecentJobItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Notifications
  const [notifications, setNotifications] = useState<AppNotification[]>([
    {
      id: 'n1',
      title: 'Scraper Engine Initialized',
      detail: 'SSRF protection active, 10MB limit enforced, MX verifier online.',
      time: 'Just now',
      read: false
    }
  ]);

  // Toast Helper
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const getFormattedTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // Test Server-Managed HUNTIQ Connection on Load
  useEffect(() => {
    testHuntiqConnection(true);
  }, []);

  const testHuntiqConnection = async (silent = false) => {
    try {
      const res = await fetch('/api/integrations/huntiq/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data: any = await res.json();
      if (res.status === 503 || data.code === 'HUNTIQ_INTEGRATION_NOT_CONFIGURED') {
        setHuntiqStatus(prev => ({ ...prev, configured: false, connected: false, message: data.message || 'Not configured' }));
        if (!silent) showToast('HUNTIQ integration is not configured on the server.', 'error');
      } else if (data.reachable && data.authenticated) {
        setHuntiqStatus(prev => ({ ...prev, configured: true, connected: true, message: data.message || 'Authenticated' }));
        if (!silent) showToast('HUNTIQ connection verified & authenticated!', 'success');
      } else {
        setHuntiqStatus(prev => ({ ...prev, configured: true, connected: false, message: data.message || 'Rejected' }));
        if (!silent) showToast(`HUNTIQ connection test: ${data.message || 'Rejected'}`, 'error');
      }
    } catch (err: any) {
      setHuntiqStatus(prev => ({ ...prev, connected: false, message: err.message }));
      if (!silent) showToast(`HUNTIQ test failed: ${err.message}`, 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // Core Scraping & Crawling Execution
  // ---------------------------------------------------------------------------

  const handleStartScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTarget = targetUrl.trim();
    if (!cleanTarget) {
      showToast('Please enter a target URL or URLs.', 'error');
      return;
    }

    setIsScraping(true);
    const hostname = getHostnameSafely(cleanTarget);
    const timeNow = getFormattedTime();

    setActivities(prev => [
      {
        id: Date.now().toString(),
        time: timeNow,
        status: 'Running',
        detail: `Started crawling ${cleanTarget}`
      },
      ...prev.slice(0, 9)
    ]);

    try {
      // MODE 1: SINGLE URL SCRAPE
      if (scrapeMode === 'single') {
        showToast('Initiating secure single-page extraction...', 'info');
        const res = await fetch('/api/scrape/page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanTarget, timeout: 12000 })
        });
        const data: any = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Scrape failed');
        }

        const newFound: ScrapedEmailRecord[] = data.records || [];
        mergeRecords(newFound);
        showToast(`Discovered ${newFound.length} contact(s) from ${cleanTarget}!`, 'success');

        setRecentJobs(prev => [
          {
            id: Date.now().toString(),
            name: data.pageTitle || `Page: ${hostname}`,
            type: 'Single',
            target: hostname,
            status: 'Completed',
            emailsFound: newFound.length,
            started: 'Just now'
          },
          ...prev
        ]);

        setActivities(prev => [
          {
            id: (Date.now() + 1).toString(),
            time: getFormattedTime(),
            status: 'Completed',
            detail: `Found ${newFound.length} emails on ${hostname}`
          },
          ...prev.slice(0, 9)
        ]);

        if (verifyEmails && newFound.length > 0) {
          handleVerifyDeliverability(newFound);
        }
      }

      // MODE 2: DOMAIN CRAWL (WITH REAL-TIME SSE PROGRESS)
      else if (scrapeMode === 'domain') {
        const pagesNum = Math.min(200, Math.max(1, parseInt(maxPages.replace(/\D/g, ''), 10) || 50));
        const depthNum = Math.min(10, Math.max(1, parseInt(crawlDepth.replace(/\D/g, ''), 10) || 2));

        showToast('Launching asynchronous crawler...', 'info');
        const res = await fetch('/api/scrape/crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: cleanTarget,
            maxPages: pagesNum,
            maxDepth: depthNum,
            sameDomainOnly: true,
            timeout: 15000
          })
        });
        const data: any = await res.json();
        if (!res.ok || !data.jobId) {
          throw new Error(data.error || 'Failed to start crawler');
        }

        const jobId = data.jobId;
        setActiveJob({
          jobId,
          status: 'Running',
          pagesVisited: 0,
          totalFound: 0,
          depth: depthNum,
          queueSize: 1,
          currentUrl: cleanTarget,
          records: []
        });

        const jobEntryId = Date.now().toString();
        setRecentJobs(prev => [
          {
            id: jobEntryId,
            name: `${hostname} Deep Crawl`,
            type: 'Crawl',
            target: hostname,
            status: 'Running',
            emailsFound: 0,
            started: 'Just now'
          },
          ...prev
        ]);

        if (sseRef.current) sseRef.current.close();
        const eventSource = new EventSource(`/api/scrape/crawl/stream/${jobId}`);
        sseRef.current = eventSource;

        eventSource.addEventListener('progress', (ev: any) => {
          const prog = JSON.parse(ev.data);
          setActiveJob(prev => prev ? {
            ...prev,
            pagesVisited: prog.pagesVisited || prev.pagesVisited,
            totalFound: prog.emailsFound || prev.totalFound,
            queueSize: prog.queueSize || 0,
            currentUrl: prog.currentUrl || prev.currentUrl
          } : null);
        });

        eventSource.addEventListener('record', (ev: any) => {
          const rec: ScrapedEmailRecord = JSON.parse(ev.data);
          mergeRecords([rec]);
          setActiveJob(prev => prev ? {
            ...prev,
            records: [...prev.records, rec],
            totalFound: prev.totalFound + 1
          } : null);
        });

        eventSource.addEventListener('done', (ev: any) => {
          const doneData = JSON.parse(ev.data);
          eventSource.close();
          setActiveJob(null);
          setIsScraping(false);
          showToast(`Crawl finished: ${doneData.totalRecords} contacts found across ${doneData.pagesVisited} pages.`, 'success');

          setRecentJobs(prev => prev.map(j => j.id === jobEntryId ? { ...j, status: 'Completed', emailsFound: doneData.totalRecords } : j));
          setActivities(prev => [
            {
              id: Date.now().toString(),
              time: getFormattedTime(),
              status: 'Completed',
              detail: `Finished • ${doneData.totalRecords} emails found across ${doneData.pagesVisited} pages`
            },
            ...prev.slice(0, 9)
          ]);

          if (verifyEmails && doneData.records && doneData.records.length > 0) {
            handleVerifyDeliverability(doneData.records);
          }
        });

        eventSource.addEventListener('error', () => {
          eventSource.close();
          setIsScraping(false);
          setActiveJob(null);
          setRecentJobs(prev => prev.map(j => j.id === jobEntryId ? { ...j, status: 'Failed' } : j));
        });
      }

      // MODE 3: BATCH URL EXTRACTION
      else if (scrapeMode === 'batch') {
        const urlArray = cleanTarget.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
        if (urlArray.length === 0) {
          throw new Error('Please enter at least one URL');
        }

        showToast(`Processing batch of ${urlArray.length} URLs...`, 'info');
        const res = await fetch('/api/scrape/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlArray })
        });
        const data: any = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Batch scrape failed');
        }

        const newFound: ScrapedEmailRecord[] = data.records || [];
        mergeRecords(newFound);
        showToast(`Batch completed: Found ${data.uniqueEmailsFound} unique email(s) across ${data.totalUrlsProcessed} targets`, 'success');

        setRecentJobs(prev => [
          {
            id: Date.now().toString(),
            name: 'Batch Extraction',
            type: 'Batch',
            target: `${urlArray.length} URLs`,
            status: 'Completed',
            emailsFound: data.uniqueEmailsFound,
            started: 'Just now'
          },
          ...prev
        ]);

        setActivities(prev => [
          {
            id: Date.now().toString(),
            time: getFormattedTime(),
            status: 'Completed',
            detail: `Found ${data.uniqueEmailsFound} emails across ${data.totalUrlsProcessed} batch URLs`
          },
          ...prev.slice(0, 9)
        ]);

        if (verifyEmails && newFound.length > 0) {
          handleVerifyDeliverability(newFound);
        }
      }
    } catch (err: any) {
      showToast(`Scrape error: ${err.message}`, 'error');
      setIsScraping(false);
      setRecentJobs(prev => [
        {
          id: Date.now().toString(),
          name: 'Extraction Job',
          type: scrapeMode === 'domain' ? 'Crawl' : scrapeMode === 'batch' ? 'Batch' : 'Single',
          target: cleanTarget.slice(0, 30),
          status: 'Failed',
          emailsFound: 0,
          started: 'Just now'
        },
        ...prev
      ]);
      setActivities(prev => [
        {
          id: Date.now().toString(),
          time: getFormattedTime(),
          status: 'Failed',
          detail: `Failed • ${err.message || 'Error occurred'}`
        },
        ...prev.slice(0, 9)
      ]);
    } finally {
      if (scrapeMode !== 'domain') {
        setIsScraping(false);
      }
    }
  };

  const handleCancelCrawl = async () => {
    if (!activeJob) return;
    try {
      await fetch(`/api/scrape/crawl/cancel/${activeJob.jobId}`, { method: 'POST' });
      if (sseRef.current) sseRef.current.close();
      setActiveJob(null);
      setIsScraping(false);
      showToast('Crawl job cancelled.', 'info');
      setActivities(prev => [
        {
          id: Date.now().toString(),
          time: getFormattedTime(),
          status: 'Cancelled',
          detail: `Cancelled crawl on ${activeJob.currentUrl}`
        },
        ...prev.slice(0, 9)
      ]);
    } catch (err: any) {
      showToast(`Failed to cancel: ${err.message}`, 'error');
    }
  };

  const getHostnameSafely = (rawUrl: string) => {
    try {
      return new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname;
    } catch {
      return rawUrl.slice(0, 25);
    }
  };

  // ---------------------------------------------------------------------------
  // Record Management & Deliverability Verification
  // ---------------------------------------------------------------------------

  const mergeRecords = (newRecords: ScrapedEmailRecord[]) => {
    setRecords(prev => {
      const emailMap = new Map<string, ScrapedEmailRecord>();
      prev.forEach(r => emailMap.set(r.email.toLowerCase(), r));
      newRecords.forEach(r => {
        const key = r.email.toLowerCase();
        if (emailMap.has(key)) {
          emailMap.set(key, { ...emailMap.get(key)!, ...r });
        } else {
          emailMap.set(key, r);
        }
      });
      return Array.from(emailMap.values());
    });
  };

  const handleVerifyDeliverability = async (targets: ScrapedEmailRecord[]) => {
    const unverified = targets.filter(t => !t.mxStatus || t.mxStatus === 'pending');
    if (unverified.length === 0) return;

    try {
      const emails = unverified.map(u => u.email);
      const res = await fetch('/api/verify/mx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails })
      });
      const data: any = await res.json();
      if (data.success && data.results) {
        const statusMap = new Map<string, any>();
        data.results.forEach((r: any) => statusMap.set(r.email.toLowerCase(), r));

        setRecords(prev => prev.map(rec => {
          const verified = statusMap.get(rec.email.toLowerCase());
          if (verified) {
            return {
              ...rec,
              mxStatus: verified.mxStatus,
              mxRecords: verified.mxRecords
            };
          }
          return rec;
        }));
        showToast(`Verified deliverability for ${data.results.length} email(s).`, 'info');
      }
    } catch {
      // Non-fatal
    }
  };

  const handleQuarantineInvalid = () => {
    const invalidEmails = new Set(
      records.filter(r => r.mxStatus === 'undeliverable' || r.mxStatus === 'disposable').map(r => r.email)
    );
    if (invalidEmails.size === 0) {
      showToast('No invalid or disposable contacts to quarantine.', 'info');
      return;
    }
    setRecords(prev => prev.filter(r => !invalidEmails.has(r.email)));
    setSelectedEmails(prev => {
      const next = new Set(prev);
      invalidEmails.forEach(e => next.delete(e));
      return next;
    });
    showToast(`Archived ${invalidEmails.size} invalid/disposable lead(s) to quarantine.`, 'success');
  };

  // ---------------------------------------------------------------------------
  // Raw Text Extraction Modal Handler
  // ---------------------------------------------------------------------------

  const handleExtractFromText = async () => {
    const text = rawTextInput.trim();
    if (!text) {
      showToast('Please paste or type text to extract.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/scrape/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data: any = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Text extraction failed');
      }

      const found: ScrapedEmailRecord[] = data.records || [];
      mergeRecords(found);
      showToast(`Extracted ${found.length} contact(s) from text snippet!`, 'success');
      setShowTextModal(false);
      setRawTextInput('');
      setShowResultsModal(true);

      setActivities(prev => [
        {
          id: Date.now().toString(),
          time: getFormattedTime(),
          status: 'Completed',
          detail: `Extracted ${found.length} email(s) from raw snippet`
        },
        ...prev.slice(0, 9)
      ]);
    } catch (err: any) {
      showToast(`Text extraction failed: ${err.message}`, 'error');
    }
  };

  // ---------------------------------------------------------------------------
  // HUNTIQ CRM Sync Execution
  // ---------------------------------------------------------------------------

  const handleSyncToHuntiq = async () => {
    if (records.length === 0) {
      showToast('No contacts discovered yet to sync.', 'error');
      return;
    }

    setIsSyncingHuntiq(true);
    try {
      const payloadContacts = records.map(r => ({
        email: r.email,
        name: r.name || null,
        company: r.domain ? { name: null, website: null } : null,
        leadScore: undefined,
        verified: r.mxStatus === 'deliverable',
        customFields: {
          jobTitle: r.jobTitle || null,
          phone: r.phone || null,
          linkedin: r.linkedin || null,
          sourceUrl: r.sourceUrl || null,
          scrapedAt: r.discoveredAt || new Date().toISOString()
        }
      }));

      const res = await fetch('/api/integrations/huntiq/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: payloadContacts })
      });
      const data: any = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Sync failed');
      }

      const synced = data.syncedCount || payloadContacts.length;
      setHuntiqStatus(prev => ({
        ...prev,
        connected: true,
        lastSync: 'Just now',
        recordsSynced: prev.recordsSynced + synced
      }));
      showToast(`Successfully pushed ${synced} verified leads to HUNTIQ CRM!`, 'success');
      setShowHuntiqModal(false);

      setActivities(prev => [
        {
          id: Date.now().toString(),
          time: getFormattedTime(),
          status: 'Completed',
          detail: `Synced ${synced} contacts to HUNTIQ CRM`
        },
        ...prev.slice(0, 9)
      ]);
    } catch (err: any) {
      showToast(`HUNTIQ Sync Failed: ${err.message}`, 'error');
    } finally {
      setIsSyncingHuntiq(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Multi-Format Export Handler
  // ---------------------------------------------------------------------------

  const handleExport = (format: 'csv' | 'json' | 'txt' | 'vcf') => {
    const targets = selectedEmails.size > 0
      ? records.filter(r => selectedEmails.has(r.email))
      : records;

    if (targets.length === 0) {
      showToast('No records available to export.', 'error');
      return;
    }

    const activeCols = Array.from(selectedColumns);

    if (format === 'json') {
      const filtered = targets.map(r => {
        const obj: any = {};
        activeCols.forEach(c => { obj[c] = (r as any)[c]; });
        return obj;
      });
      downloadFile(JSON.stringify(filtered, null, 2), 'email_leads.json', 'application/json');
    } else if (format === 'txt') {
      const text = targets.map(r => r.email).join('\n');
      downloadFile(text, 'email_leads.txt', 'text/plain');
    } else if (format === 'csv') {
      const headers = activeCols.map(c => `"${c.toUpperCase()}"`).join(',');
      const rows = targets.map(r =>
        activeCols.map(c => `"${String((r as any)[c] || '').replace(/"/g, '""')}"`).join(',')
      );
      const csv = '\uFEFF' + [headers, ...rows].join('\r\n');
      downloadFile(csv, 'email_leads.csv', 'text/csv;charset=utf-8;');
    } else if (format === 'vcf') {
      const vcf = targets.map(r =>
        `BEGIN:VCARD\nVERSION:3.0\nFN:${r.name || 'Lead'}\nEMAIL:${r.email}\nORG:${r.domain || ''}\nTITLE:${r.jobTitle || ''}\nTEL:${r.phone || ''}\nEND:VCARD`
      ).join('\n');
      downloadFile(vcf, 'contacts.vcf', 'text/vcard');
    }

    showToast(`Exported ${targets.length} leads in ${format.toUpperCase()} format.`, 'success');
    setShowExportModal(false);
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Filtered Records & Statistics
  // ---------------------------------------------------------------------------

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchesSearch = searchQuery === '' ||
        r.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.name && r.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.domain && r.domain.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesType = typeFilter === 'all' || r.type === typeFilter;
      const matchesDomain = domainFilter === 'all' || r.domain === domainFilter;

      return matchesSearch && matchesType && matchesDomain;
    });
  }, [records, searchQuery, typeFilter, domainFilter]);

  const uniqueDomains = useMemo(() => {
    return Array.from(new Set(records.map(r => r.domain).filter(Boolean))) as string[];
  }, [records]);

  const handleLoadDemoTarget = () => {
    const demoUrl = `${window.location.origin}/api/demo`;
    setTargetUrl(demoUrl);
    setScrapeMode('single');
    showToast('Loaded built-in demo target! Click "Start Scrape" to test extraction.', 'info');
  };

  const handleDeleteJob = (jobId: string) => {
    setRecentJobs(prev => prev.filter(j => j.id !== jobId));
    showToast('Job removed from list.', 'info');
  };

  // ===========================================================================
  // Modular View & Card Renderers
  // ===========================================================================

  const renderRecentJobsCard = () => (
    <div id="recent-jobs-section" style={styles.cardContainer}>
      <div style={styles.rowBetween}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#5B5FEF' }}>🧭</span>
          <h3 style={styles.cardTitle}>Recent Jobs</h3>
        </div>
        <button onClick={() => setShowResultsModal(true)} style={styles.linkButton}>View all →</button>
      </div>

      <div style={{ overflowX: 'auto', marginTop: '14px' }}>
        <table style={styles.jobTable}>
          <thead>
            <tr style={styles.jobTableHead}>
              <th style={styles.jobTh}>Job Name</th>
              <th style={styles.jobTh}>Type</th>
              <th style={styles.jobTh}>Target</th>
              <th style={styles.jobTh}>Status</th>
              <th style={styles.jobTh}>Emails Found</th>
              <th style={styles.jobTh}>Started</th>
              <th style={{ ...styles.jobTh, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recentJobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: '#8B92B0' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>📑</div>
                  <div style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 500 }}>No extraction jobs yet</div>
                  <div style={{ fontSize: '11px', marginTop: '4px', color: '#8B92B0' }}>
                    Start a single scrape, crawler, or batch run to track jobs here.
                  </div>
                </td>
              </tr>
            ) : (
              recentJobs.map(j => (
                <tr key={j.id} style={styles.jobTr}>
                  <td style={{ ...styles.jobTd, fontWeight: 600, color: '#FFFFFF' }}>
                    <span style={{ marginRight: '8px', opacity: 0.8 }}>👤</span>{j.name}
                  </td>
                  <td style={{ ...styles.jobTd, color: '#8B92B0' }}>{j.type}</td>
                  <td style={{ ...styles.jobTd, color: '#8B92B0' }}>{j.target}</td>
                  <td style={styles.jobTd}>
                    <span style={{
                      ...styles.statusTag,
                      ...(j.status === 'Completed' ? styles.statusCompleted :
                         j.status === 'Running' ? styles.statusRunning :
                         j.status === 'Cancelled' ? styles.statusCancelled : styles.statusFailed)
                    }}>
                      • {j.status}
                    </span>
                  </td>
                  <td style={{ ...styles.jobTd, fontWeight: 600, color: '#FFFFFF' }}>{j.emailsFound.toLocaleString()}</td>
                  <td style={{ ...styles.jobTd, color: '#8B92B0' }}>{j.started}</td>
                  <td style={{ ...styles.jobTd, textAlign: 'right' }}>
                    <button onClick={() => setShowResultsModal(true)} style={styles.viewLink}>View</button>
                    <button
                      onClick={() => handleDeleteJob(j.id)}
                      style={styles.kebabActionBtn}
                      title="Job actions"
                    >
                      •••
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderQuickActionsCard = () => (
    <div style={styles.cardContainer}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <span style={{ color: '#5B5FEF' }}>⚡</span>
        <h3 style={styles.cardTitle}>Quick Actions</h3>
      </div>

      <div style={styles.quickActionsTileGrid}>
        <button onClick={() => setShowResultsModal(true)} style={styles.actionTile}>
          <div style={{ ...styles.actionIconPill, background: '#7C3AED' }}>✉</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.actionTileH4}>View Results</div>
            <div style={styles.actionTileP}>Access scraped emails</div>
          </div>
        </button>

        <button
          onClick={() => {
            document.getElementById('recent-jobs-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
          style={styles.actionTile}
        >
          <div style={{ ...styles.actionIconPill, background: '#3B82F6' }}>🕒</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.actionTileH4}>Job History</div>
            <div style={styles.actionTileP}>Check past jobs</div>
          </div>
        </button>

        <button onClick={() => setShowExportModal(true)} style={styles.actionTile}>
          <div style={{ ...styles.actionIconPill, background: '#10B981' }}>📥</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.actionTileH4}>Export Data</div>
            <div style={styles.actionTileP}>Download your leads</div>
          </div>
        </button>

        <button onClick={() => setShowSettingsModal(true)} style={styles.actionTile}>
          <div style={{ ...styles.actionIconPill, background: '#475569' }}>⚙️</div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.actionTileH4}>Settings</div>
            <div style={styles.actionTileP}>Configure preferences</div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderSecureCompliantCard = (asPills = false) => (
    <div style={styles.cardSecureCompliant}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#5B5FEF' }}>🛡️</span>
            <h3 style={{ ...styles.cardTitle, fontSize: '15px' }}>Secure & Compliant</h3>
          </div>
          <p style={{ fontSize: '13px', color: '#8B92B0', margin: '6px 0 14px 0', lineHeight: 1.4 }}>
            Your data is protected with enterprise-grade security and privacy controls.
          </p>
        </div>
        <div style={styles.shieldGraphic}>
          <svg width="45" height="52" viewBox="0 0 24 24" fill="none" stroke="#5B5FEF" strokeWidth="1.3">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(91, 95, 239, 0.2)" />
            <rect x="9" y="10" width="6" height="5" rx="1" fill="#818CF8" />
            <path d="M10 10V8a2 2 0 0 1 4 0v2" stroke="#818CF8" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {asPills ? (
        <div style={styles.securityPillsGrid}>
          <div style={styles.secPill}>
            <span style={styles.secCheck}>✓</span>
            <span>SSRF Protected</span>
          </div>
          <div style={styles.secPill}>
            <span style={styles.secCheck}>✓</span>
            <span>URL Validation</span>
          </div>
          <div style={styles.secPill}>
            <span style={styles.secCheck}>✓</span>
            <span>10MB Response Limit</span>
          </div>
          <div style={styles.secPill}>
            <span style={styles.secCheck}>✓</span>
            <span>No Client Workspace</span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            'SSRF protection enabled',
            'URL validation active',
            '10MB response limit',
            'Secure HUNTIQ integration',
            'No client-side credentials'
          ].map((text, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#8B92B0' }}>
              <span style={{ color: '#10B981', fontWeight: 'bold' }}>✓</span>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // DASHBOARD VIEW (from email scrapper Dashboard.png)
  const renderDashboardView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Greeting Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#FFFFFF', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            Good morning, Alex 👋
          </h1>
          <p style={{ fontSize: '14px', color: '#8B92B0', margin: '6px 0 0 0' }}>
            Here's what's happening with your email scraping activity.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#8B92B0', background: 'rgba(20, 24, 51, 0.65)', padding: '6px 14px', borderRadius: '20px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <span>Thu, Sep 11, 2026</span>
          <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>•</span>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }} />
          <span style={{ color: '#10B981', fontWeight: 500 }}>System Online</span>
        </div>
      </div>

      {/* 5 Top KPI Cards */}
      <div style={styles.kpiRow5}>
        {/* Card 1: Total Emails Found */}
        <div style={styles.cardStat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(91, 95, 239, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5B5FEF' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '12px' }}>
              ↑ 12% <span style={{ color: '#8B92B0', fontWeight: 400 }}>vs. last 7 days</span>
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '4px' }}>Total Emails Found</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFFFFF' }}>
            {records.length > 0 ? records.length.toLocaleString() : '0'}
          </div>
        </div>

        {/* Card 2: Websites Processed */}
        <div style={styles.cardStat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10B981' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '12px' }}>
              ↑ 8% <span style={{ color: '#8B92B0', fontWeight: 400 }}>vs. last 7 days</span>
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '4px' }}>Websites Processed</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFFFFF' }}>
            {uniqueDomains.length > 0 ? uniqueDomains.length.toLocaleString() : recentJobs.length.toLocaleString()}
          </div>
        </div>

        {/* Card 3: Successful Jobs */}
        <div style={styles.cardStat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366F1' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '12px' }}>
              ↑ 20% <span style={{ color: '#8B92B0', fontWeight: 400 }}>vs. last 7 days</span>
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '4px' }}>Successful Jobs</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFFFFF' }}>
            {recentJobs.filter(j => j.status === 'Completed').length}
          </div>
        </div>

        {/* Card 4: Failed Jobs */}
        <div style={styles.cardStat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#EF4444', background: 'rgba(239, 68, 68, 0.12)', padding: '2px 8px', borderRadius: '12px' }}>
              ↓ 75% <span style={{ color: '#8B92B0', fontWeight: 400 }}>vs. last 7 days</span>
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '4px' }}>Failed Jobs</div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#FFFFFF' }}>
            {recentJobs.filter(j => j.status === 'Failed').length}
          </div>
        </div>

        {/* Card 5: HuntIQ Sync Status */}
        <div style={styles.cardStat}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10B981' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#10B981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              ● {huntiqStatus.connected ? 'Connected' : 'Standby'}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '4px' }}>HuntIQ Sync Status</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginTop: '4px' }}>
            {huntiqStatus.recordsSynced.toLocaleString()} records synced
          </div>
          <div style={{ fontSize: '11px', color: '#8B92B0', marginTop: '2px' }}>
            Last sync: {huntiqStatus.lastSync}
          </div>
        </div>
      </div>

      {/* Dashboard 2-Column Grid */}
      <div style={styles.layoutTwoCol}>
        {/* Left Column */}
        <div style={styles.leftCol}>
          {/* Quick Scrape Card */}
          <div style={styles.cardContainer}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(91, 95, 239, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5B5FEF', fontSize: '16px' }}>
                ⚡
              </div>
              <div>
                <h3 style={styles.cardTitle}>Quick Scrape</h3>
                <p style={{ fontSize: '13px', color: '#8B92B0', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                  Start scraping emails from a website or domain. Configure your crawl settings and let us find valuable contacts.
                </p>
              </div>
            </div>

            {/* Segmented Mode Switcher Tabs */}
            <div style={styles.scrapeTabsTrack}>
              <button
                type="button"
                onClick={() => setScrapeMode('single')}
                style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'single' ? styles.scrapeTabBtnActive : {}) }}
              >
                Single URL
              </button>
              <button
                type="button"
                onClick={() => setScrapeMode('domain')}
                style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'domain' ? styles.scrapeTabBtnActive : {}) }}
              >
                Domain
              </button>
              <button
                type="button"
                onClick={() => setScrapeMode('batch')}
                style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'batch' ? styles.scrapeTabBtnActive : {}) }}
              >
                Batch
              </button>
            </div>

            {/* URL Input Form */}
            <form onSubmit={handleStartScrape} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={styles.fieldLabel}>Website URL</label>
                  <button
                    type="button"
                    onClick={handleLoadDemoTarget}
                    style={styles.demoPillBtn}
                    title="Load built-in mock site for quick safe testing"
                  >
                    🧪 Load Demo Target
                  </button>
                </div>
                <div style={styles.urlInputBox}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B92B0" strokeWidth="2" style={{ marginLeft: '14px', flexShrink: 0 }}>
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <input
                    type="text"
                    placeholder={
                      scrapeMode === 'single' ? 'https://example.com' :
                      scrapeMode === 'domain' ? 'https://company.com/team' :
                      'https://site1.com, https://site2.com'
                    }
                    value={targetUrl}
                    onChange={e => setTargetUrl(e.target.value)}
                    style={styles.urlInputText}
                    required
                  />
                  <button
                    type="submit"
                    disabled={isScraping}
                    style={styles.primaryActionButton}
                  >
                    <span>▶</span>
                    <span>{isScraping ? 'Scraping...' : 'Start Scrape →'}</span>
                  </button>
                </div>
              </div>

              {/* 4 Parameter Option Cards */}
              <div style={styles.paramGrid4}>
                <div style={styles.paramBox}>
                  <div style={styles.paramIconSquare}>⏱️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.paramLabel}>Crawl Depth</div>
                    <select
                      value={crawlDepth}
                      onChange={e => setCrawlDepth(e.target.value)}
                      style={styles.paramSelect}
                    >
                      <option value="1">1 (fast)</option>
                      <option value="2">2 (standard)</option>
                      <option value="3 (recommended)">3 (recommended)</option>
                      <option value="5">5 (thorough)</option>
                    </select>
                  </div>
                </div>

                <div style={styles.paramBox}>
                  <div style={styles.paramIconSquare}>📄</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.paramLabel}>Max Pages</div>
                    <select
                      value={maxPages}
                      onChange={e => setMaxPages(e.target.value)}
                      style={styles.paramSelect}
                    >
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="200">200 (max)</option>
                    </select>
                  </div>
                </div>

                <div style={styles.paramBox}>
                  <div style={styles.paramIconSquare}>✉️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.paramLabel}>Email Types</div>
                    <select
                      value={emailTypeFilter}
                      onChange={e => setEmailTypeFilter(e.target.value)}
                      style={styles.paramSelect}
                    >
                      <option value="All types">All types</option>
                      <option value="Personal only">Personal only</option>
                      <option value="Role only">Role only</option>
                    </select>
                  </div>
                </div>

                <div style={styles.paramBox}>
                  <div style={styles.paramIconSquare}>🛡️</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.paramLabel}>Verify Emails</div>
                    <div style={{ fontSize: '11px', color: '#8B92B0' }}>Live MX check</div>
                  </div>
                  <label style={styles.switchBox}>
                    <input
                      type="checkbox"
                      checked={verifyEmails}
                      onChange={e => setVerifyEmails(e.target.checked)}
                      style={{ display: 'none' }}
                    />
                    <span style={{ ...styles.switchTrack, ...(verifyEmails ? styles.switchTrackOn : {}) }}>
                      <span style={{ ...styles.switchKnob, ...(verifyEmails ? styles.switchKnobOn : {}) }} />
                    </span>
                  </label>
                </div>
              </div>
            </form>
          </div>

          {/* Scraping Activity SVG Line & Area Chart Card */}
          <div style={styles.cardContainer}>
            <div style={styles.rowBetween}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#5B5FEF' }}>📈</span>
                  <h3 style={styles.cardTitle}>Scraping Activity</h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#5B5FEF' }} />
                    <span style={{ color: '#8B92B0' }}>Emails Found</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                    <span style={{ color: '#8B92B0' }}>Websites Processed</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#8B92B0', background: 'rgba(255, 255, 255, 0.05)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                <span>Last 7 days</span>
                <span>⌄</span>
              </div>
            </div>

            {/* Responsive SVG Chart */}
            <div style={{ marginTop: '16px', width: '100%', overflow: 'hidden' }}>
              <svg viewBox="0 0 540 210" style={{ width: '100%', height: 'auto', display: 'block' }}>
                <defs>
                  <linearGradient id="dashPurpleGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5B5FEF" stopOpacity="0.4"/>
                    <stop offset="100%" stopColor="#5B5FEF" stopOpacity="0.0"/>
                  </linearGradient>
                  <linearGradient id="dashTealGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.3"/>
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0"/>
                  </linearGradient>
                </defs>

                {/* Dotted Gridlines & Y-Axis Labels */}
                {[
                  { label: '2K', y: 30 },
                  { label: '1.5K', y: 65 },
                  { label: '1K', y: 100 },
                  { label: '500', y: 135 },
                  { label: '0', y: 170 }
                ].map(g => (
                  <g key={g.label}>
                    <text x="5" y={g.y + 4} fill="#8B92B0" fontSize="10" fontFamily="Inter, sans-serif">
                      {g.label}
                    </text>
                    <line x1="38" y1={g.y} x2="530" y2={g.y} stroke="rgba(255, 255, 255, 0.07)" strokeDasharray="3 3" />
                  </g>
                ))}

                {/* X-Axis Date Labels */}
                {[
                  { label: 'Sep 5', x: 60 },
                  { label: 'Sep 6', x: 135 },
                  { label: 'Sep 7', x: 210 },
                  { label: 'Sep 8', x: 285 },
                  { label: 'Sep 9', x: 360 },
                  { label: 'Sep 10', x: 435 },
                  { label: 'Sep 11', x: 500 }
                ].map(d => (
                  <text key={d.label} x={d.x} y="195" fill="#8B92B0" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif">
                    {d.label}
                  </text>
                ))}

                {/* Purple Series Area & Spline */}
                <path
                  d="M 60,135 C 95,125 105,120 135,120 C 165,120 180,125 210,122 C 240,119 255,115 285,108 C 315,101 330,55 360,55 C 390,55 405,75 435,75 C 465,75 480,85 500,85 L 500,170 L 60,170 Z"
                  fill="url(#dashPurpleGrad)"
                />
                <path
                  d="M 60,135 C 95,125 105,120 135,120 C 165,120 180,125 210,122 C 240,119 255,115 285,108 C 315,101 330,55 360,55 C 390,55 405,75 435,75 C 465,75 480,85 500,85"
                  fill="none"
                  stroke="#5B5FEF"
                  strokeWidth="2.5"
                />
                {/* Purple Data Points */}
                {[
                  [60, 135], [135, 120], [210, 122], [285, 108], [360, 55], [435, 75], [500, 85]
                ].map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r="4.5" fill="#5B5FEF" stroke="#0B0E1A" strokeWidth="2" />
                ))}

                {/* Teal Series Area & Spline */}
                <path
                  d="M 60,165 C 95,160 105,155 135,155 C 165,155 180,158 210,158 C 240,158 255,152 285,150 C 315,148 330,118 360,118 C 390,118 405,130 435,130 C 465,130 480,140 500,140 L 500,170 L 60,170 Z"
                  fill="url(#dashTealGrad)"
                />
                <path
                  d="M 60,165 C 95,160 105,155 135,155 C 165,155 180,158 210,158 C 240,158 255,152 285,150 C 315,148 330,118 360,118 C 390,118 405,130 435,130 C 465,130 480,140 500,140"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                />
                {/* Teal Data Points */}
                {[
                  [60, 165], [135, 155], [210, 158], [285, 150], [360, 118], [435, 130], [500, 140]
                ].map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r="4" fill="#10B981" stroke="#0B0E1A" strokeWidth="2" />
                ))}
              </svg>
            </div>
          </div>

          {/* Recent Jobs Table Card */}
          {renderRecentJobsCard()}
        </div>

        {/* Right Column */}
        <div style={styles.rightCol}>
          {/* HuntIQ CRM Outreach Promo Card */}
          <div style={styles.cardContainer}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <div style={styles.huntiqSquareBadge}>H</div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>HuntIQ Integration</span>
            </div>

            <div style={{ position: 'relative', overflow: 'hidden', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', margin: '0 0 8px 0', lineHeight: 1.3 }}>
                Automate your outreach with HuntIQ CRM
              </h3>
              <p style={{ fontSize: '13px', color: '#8B92B0', margin: '0 0 16px 0', lineHeight: 1.4, maxWidth: '240px' }}>
                Sync your discovered leads directly to HuntIQ for streamlined outreach and better results.
              </p>

              {/* Floating Graphic */}
              <div style={{ position: 'absolute', right: '-10px', top: '20px', width: '100px', height: '100px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(91, 95, 239, 0.35) 0%, transparent 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontWeight: 700, fontSize: '18px', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)' }}>
                  H
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowHuntiqModal(true)}
                style={{ ...styles.primaryActionButton, padding: '10px 18px', width: 'auto', marginBottom: '16px' }}
              >
                Manage Integration →
              </button>
            </div>

            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#8B92B0' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: huntiqStatus.connected ? '#10B981' : '#F59E0B' }} />
              <span style={{ color: huntiqStatus.connected ? '#10B981' : '#F59E0B', fontWeight: 500 }}>
                {huntiqStatus.connected ? 'Connected' : 'Standby'}
              </span>
              <span>•</span>
              <span>{huntiqStatus.recordsSynced.toLocaleString()} records synced</span>
            </div>
          </div>

          {/* Recent Activity Card */}
          <div style={styles.cardContainer}>
            <div style={styles.rowBetween}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#5B5FEF' }}>🕒</span>
                <h3 style={styles.cardTitle}>Recent Activity</h3>
              </div>
              <button onClick={() => setShowResultsModal(true)} style={styles.linkButton}>View all →</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
              {activities.length > 0 ? (
                activities.slice(0, 5).map(act => (
                  <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: act.status === 'Completed' ? '#10B981' : act.status === 'Running' ? '#3B82F6' : '#EF4444',
                      flexShrink: 0
                    }} />
                    <span style={{ fontSize: '12px', color: '#8B92B0', width: '45px', flexShrink: 0 }}>{act.time}</span>
                    <span style={{ fontSize: '13px', color: '#FFFFFF', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.detail}
                    </span>
                  </div>
                ))
              ) : (
                [
                  { name: 'TechCorp Solutions', status: 'Completed', sub: '1,248 emails found', time: '2h ago', color: '#10B981', initial: 'T' },
                  { name: 'Global Marketing Co.', status: 'Completed', sub: '892 emails found', time: '4h ago', color: '#10B981', initial: 'G' },
                  { name: 'StartupXYZ', status: 'Running', sub: '67% complete', time: '6h ago', color: '#3B82F6', initial: 'S' },
                  { name: 'Ecommerce Site', status: 'Failed', sub: 'Connection timeout', time: '8h ago', color: '#EF4444', initial: 'E' },
                  { name: 'Agency Partners', status: 'Completed', sub: '436 emails found', time: '12h ago', color: '#10B981', initial: 'A' }
                ].map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#FFFFFF', flexShrink: 0 }}>
                      {item.initial}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>{item.name}</div>
                      <div style={{ fontSize: '11px', color: '#8B92B0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: item.color }} />
                        <span style={{ color: item.color }}>{item.status}</span>
                        <span>•</span>
                        <span>{item.sub}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', color: '#8B92B0', flexShrink: 0 }}>{item.time}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Actions Card */}
          {renderQuickActionsCard()}

          {/* Secure & Compliant Card */}
          {renderSecureCompliantCard(false)}
        </div>
      </div>
    </div>
  );

  // SCRAPER VIEW (from Email Scraper Scraper page.png)
  const renderScraperView = () => (
    <div style={styles.layoutTwoCol}>
      {/* LEFT MAIN COLUMN (~68% width) */}
      <div style={styles.leftCol}>
        {/* HERO BANNER: Start a New Scrape */}
        <div style={styles.heroScrapeCard}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', zIndex: 2, position: 'relative' }}>
            <div style={styles.heroLightningIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#FFFFFF">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={styles.heroH1}>Start a New Scrape</h1>
              <p style={styles.heroSub}>
                Enter a website or domain to find and extract emails, or configure advanced crawling options.
              </p>
            </div>
          </div>

          {/* Cosmic Glow Illustration + Right Promo Copy */}
          <div style={styles.heroRightPromo}>
            <div style={styles.cosmicGlowSphere} />
            <div style={{ zIndex: 2, position: 'relative', textAlign: 'right', maxWidth: '280px' }}>
              <div style={styles.heroPromoH3}>Turn websites into valuable contacts</div>
              <div style={styles.heroPromoP}>
                Find verified emails, build your contact list, and grow your business.
              </div>
            </div>
          </div>
        </div>

        {/* LIVE TELEMETRY (When crawl active) */}
        {activeJob && (
          <section style={styles.telemetryCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={styles.pulseDot} />
                <strong style={{ fontSize: '13px', color: '#5B5FEF' }}>Live Crawling in Progress</strong>
                <span style={{ fontSize: '12px', color: '#8B92B0' }}>({activeJob.currentUrl})</span>
              </div>
              <button onClick={handleCancelCrawl} style={styles.cancelCrawlBtn}>
                Stop Crawl
              </button>
            </div>
            <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: '#FFFFFF' }}>
              <span>Pages Visited: <strong>{activeJob.pagesVisited}</strong></span>
              <span>Emails Found: <strong>{activeJob.totalFound}</strong></span>
              <span>Queue: <strong>{activeJob.queueSize}</strong></span>
              <span>Depth: <strong>{activeJob.depth}</strong></span>
            </div>
          </section>
        )}

        {/* MAIN SCRAPER CONFIGURATION CARD */}
        <div style={styles.cardContainer}>
          {/* Segmented Mode Switcher Tabs */}
          <div style={styles.scrapeTabsTrack}>
            <button
              type="button"
              onClick={() => setScrapeMode('single')}
              style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'single' ? styles.scrapeTabBtnActive : {}) }}
            >
              Single URL
            </button>
            <button
              type="button"
              onClick={() => setScrapeMode('domain')}
              style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'domain' ? styles.scrapeTabBtnActive : {}) }}
            >
              Domain
            </button>
            <button
              type="button"
              onClick={() => setScrapeMode('batch')}
              style={{ ...styles.scrapeTabBtn, ...(scrapeMode === 'batch' ? styles.scrapeTabBtnActive : {}) }}
            >
              Batch
            </button>
          </div>

          {/* Website URL Input Form */}
          <form onSubmit={handleStartScrape} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={styles.fieldLabel}>Website URL</label>
                <button
                  type="button"
                  onClick={handleLoadDemoTarget}
                  style={styles.demoPillBtn}
                  title="Load built-in mock site for quick safe testing"
                >
                  🧪 Load Demo Target
                </button>
              </div>
              <div style={styles.urlInputBox}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B92B0" strokeWidth="2" style={{ marginLeft: '14px', flexShrink: 0 }}>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <input
                  type="text"
                  placeholder={
                    scrapeMode === 'single' ? 'https://example.com' :
                    scrapeMode === 'domain' ? 'https://company.com/team' :
                    'https://site1.com, https://site2.com'
                  }
                  value={targetUrl}
                  onChange={e => setTargetUrl(e.target.value)}
                  style={styles.urlInputText}
                  required
                />
                <button
                  type="submit"
                  disabled={isScraping}
                  style={styles.primaryActionButton}
                >
                  <span>▶</span>
                  <span>{isScraping ? 'Scraping...' : 'Start Scrape →'}</span>
                </button>
              </div>
            </div>

            {/* 4 Parameter Option Cards */}
            <div style={styles.paramGrid4}>
              <div style={styles.paramBox}>
                <div style={styles.paramIconSquare}>⏱️</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.paramLabel}>Crawl Depth</div>
                  <select
                    value={crawlDepth}
                    onChange={e => setCrawlDepth(e.target.value)}
                    style={styles.paramSelect}
                  >
                    <option value="1">1 (fast)</option>
                    <option value="2">2 (standard)</option>
                    <option value="3 (recommended)">3 (recommended)</option>
                    <option value="5">5 (thorough)</option>
                  </select>
                </div>
              </div>

              <div style={styles.paramBox}>
                <div style={styles.paramIconSquare}>📄</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.paramLabel}>Max Pages</div>
                  <select
                    value={maxPages}
                    onChange={e => setMaxPages(e.target.value)}
                    style={styles.paramSelect}
                  >
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200 (max)</option>
                  </select>
                </div>
              </div>

              <div style={styles.paramBox}>
                <div style={styles.paramIconSquare}>✉️</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.paramLabel}>Email Types</div>
                  <select
                    value={emailTypeFilter}
                    onChange={e => setEmailTypeFilter(e.target.value)}
                    style={styles.paramSelect}
                  >
                    <option value="All types">All types</option>
                    <option value="Personal only">Personal only</option>
                    <option value="Role only">Role only</option>
                  </select>
                </div>
              </div>

              <div style={styles.paramBox}>
                <div style={styles.paramIconSquare}>🛡️</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.paramLabel}>Verify Emails</div>
                  <div style={{ fontSize: '11px', color: '#8B92B0' }}>Live MX check</div>
                </div>
                <label style={styles.switchBox}>
                  <input
                    type="checkbox"
                    checked={verifyEmails}
                    onChange={e => setVerifyEmails(e.target.checked)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ ...styles.switchTrack, ...(verifyEmails ? styles.switchTrackOn : {}) }}>
                    <span style={{ ...styles.switchKnob, ...(verifyEmails ? styles.switchKnobOn : {}) }} />
                  </span>
                </label>
              </div>
            </div>

            {/* Collapsible Advanced Options Accordion */}
            <div style={styles.advancedOptionsContainer}>
              <button
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                style={styles.advancedOptionsToggleBtn}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#5B5FEF' }}>⬡</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>Advanced Options</span>
                </div>
                <span style={{ color: '#8B92B0', fontSize: '12px' }}>{advancedOpen ? '▲' : '▼'}</span>
              </button>

              {advancedOpen && (
                <div style={styles.advancedCardsRow}>
                  <div style={styles.advMiniCard}>
                    <div style={styles.advIconBox}>⏱️</div>
                    <div>
                      <div style={styles.advLabel}>Estimated time</div>
                      <div style={styles.advValue}>
                        {scrapeMode === 'single' ? '< 30 seconds' : scrapeMode === 'domain' ? '2–10 minutes' : '1–3 minutes'}
                      </div>
                    </div>
                  </div>

                  <div style={styles.advMiniCard}>
                    <div style={styles.advIconBox}>🎯</div>
                    <div>
                      <div style={styles.advLabel}>Expected emails</div>
                      <div style={styles.advValue}>~ 5–50</div>
                    </div>
                  </div>

                  <div style={styles.advMiniCard}>
                    <div style={styles.advIconBox}>⚡</div>
                    <div>
                      <div style={styles.advLabel}>Max concurrency</div>
                      <div style={styles.advValue}>5 requests</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* View Results Banner */}
            {records.length > 0 && (
              <button
                type="button"
                onClick={() => setShowResultsModal(true)}
                style={styles.viewDiscoveredBtn}
              >
                🔍 View Discovered Contacts ({records.length}) →
              </button>
            )}
          </form>
        </div>

        {/* RECENT JOBS TABLE CARD */}
        {renderRecentJobsCard()}

        {/* SCRAPER ACTIVITY CARD WITH LIVE BADGE */}
        <div style={styles.cardContainer}>
          <div style={styles.rowBetween}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#5B5FEF' }}>📊</span>
              <h3 style={styles.cardTitle}>Scraper Activity</h3>
            </div>
            <div style={styles.liveBadge}>
              <span style={styles.liveDot} />
              <span>Live</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px', minHeight: '110px' }}>
            {activities.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: '#8B92B0' }}>
                <div style={{ fontSize: '20px', marginBottom: '6px' }}>⏱️</div>
                <div style={{ fontSize: '13px', color: '#FFFFFF', fontWeight: 500 }}>No scraping activity yet</div>
                <div style={{ fontSize: '11px', marginTop: '2px', color: '#8B92B0' }}>
                  Live extraction telemetry and verification events will appear here.
                </div>
              </div>
            ) : (
              activities.slice(0, 6).map(act => (
                <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    backgroundColor: act.status === 'Completed' ? '#10B981' : act.status === 'Running' ? '#3B82F6' : '#EF4444',
                    flexShrink: 0
                  }} />
                  <span style={{ fontSize: '12px', color: '#8B92B0', width: '45px', flexShrink: 0 }}>{act.time}</span>
                  <span style={{ fontSize: '13px', color: '#FFFFFF', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {act.detail}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* RIGHT SIDEBAR COLUMN (~32% width) */}
      <div style={styles.rightCol}>
        {/* 1: HUNTIQ INTEGRATION CARD */}
        <div style={styles.cardHuntiqWidget}>
          <div style={styles.rowBetween}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={styles.huntiqSquareBadge}>H</div>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#FFFFFF' }}>HuntIQ Integration</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: huntiqStatus.connected ? '#10B981' : '#F59E0B'
                  }} />
                  <span style={{ fontSize: '12px', color: huntiqStatus.connected ? '#10B981' : '#F59E0B', fontWeight: 500 }}>
                    {huntiqStatus.connected ? 'Connected' : (huntiqStatus.configured ? 'Standby' : 'Not Configured')}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHuntiqModal(true)}
              style={styles.manageLink}
            >
              Manage
            </button>
          </div>

          <p style={styles.huntiqWidgetP}>
            Your discovered leads are automatically synced to HuntIQ for streamlined outreach and better results.
          </p>

          <button
            type="button"
            onClick={() => testHuntiqConnection(false)}
            style={styles.testConnectionBtn}
          >
            <span>Test Connection</span>
            <span>🔗</span>
          </button>

          <div style={styles.huntiqWidgetMetricsRow}>
            <div>
              <div style={styles.huntiqMetricLabel}>Last sync</div>
              <div style={styles.huntiqMetricValue}>{huntiqStatus.lastSync}</div>
            </div>
            <div>
              <div style={styles.huntiqMetricLabel}>Records synced</div>
              <div style={styles.huntiqMetricValueBig}>{huntiqStatus.recordsSynced.toLocaleString()}</div>
            </div>
            <div>
              <div style={styles.huntiqMetricLabel}>Status</div>
              <div style={{ ...styles.huntiqMetricValue, color: huntiqStatus.connected ? '#10B981' : '#F59E0B' }}>
                ● {huntiqStatus.connected ? 'Healthy' : 'Standby'}
              </div>
            </div>
          </div>
        </div>

        {/* 2: QUICK ACTIONS (2x2 Grid) */}
        {renderQuickActionsCard()}

        {/* 3: SCRAPING TIPS */}
        <div style={styles.cardContainer}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <span style={{ color: '#5B5FEF' }}>💡</span>
            <h3 style={styles.cardTitle}>Scraping Tips</h3>
          </div>

          <ul style={styles.tipsList}>
            <li style={styles.tipItem}>
              <span style={styles.tipCheck}>✓</span> Use specific domains for better results
            </li>
            <li style={styles.tipItem}>
              <span style={styles.tipCheck}>✓</span> Enable email verification for higher quality
            </li>
            <li style={styles.tipItem}>
              <span style={styles.tipCheck}>✓</span> Respect robots.txt and website terms
            </li>
            <li style={styles.tipItem}>
              <span style={styles.tipCheck}>✓</span> Avoid scraping sensitive or private data
            </li>
          </ul>
        </div>

        {/* 4: SECURE & COMPLIANT CARD */}
        {renderSecureCompliantCard(true)}
      </div>
    </div>
  );

  // ===========================================================================
  // JSX Render
  // ===========================================================================

  return (
    <div style={styles.appContainer}>
      {/* ------------------------------------------------------------------- */}
      {/* 1. LEFT SIDEBAR NAVIGATION                                          */}
      {/* ------------------------------------------------------------------- */}
      <aside style={{ ...styles.sidebar, ...(sidebarOpen ? styles.sidebarMobileOpen : {}) }}>
        <div>
          {/* Logo Block */}
          <div style={styles.brandRow}>
            <div style={styles.brandLogoBox}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <div>
              <div style={styles.brandTitle}>Email Scraper</div>
              <div style={styles.brandTagline}>Find • Verify • Grow</div>
            </div>
          </div>

          {/* Navigation items as rounded pills */}
          <nav style={styles.navStack}>
            <button
              type="button"
              onClick={() => { setActiveNav('dashboard'); setSidebarOpen(false); }}
              style={{ ...styles.navButton, ...(activeNav === 'dashboard' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span>Dashboard</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveNav('scraper'); setSidebarOpen(false); }}
              style={{ ...styles.navButton, ...(activeNav === 'scraper' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span style={{ flex: 1 }}>Scraper</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveNav('results'); setShowResultsModal(true); setSidebarOpen(false); }}
              style={{ ...styles.navButton, ...(activeNav === 'results' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <span>Results</span>
              {records.length > 0 && <span style={styles.badgeSmall}>{records.length}</span>}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveNav('history');
                setSidebarOpen(false);
                document.getElementById('recent-jobs-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{ ...styles.navButton, ...(activeNav === 'history' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Job History</span>
              {recentJobs.length > 0 && <span style={styles.badgeSmall}>{recentJobs.length}</span>}
            </button>

            <button
              type="button"
              onClick={() => { setActiveNav('huntiq'); setShowHuntiqModal(true); setSidebarOpen(false); }}
              style={{ ...styles.navButton, ...(activeNav === 'huntiq' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                <line x1="6" y1="9" x2="6" y2="21" />
              </svg>
              <span>HuntIQ Integration</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveNav('settings'); setShowSettingsModal(true); setSidebarOpen(false); }}
              style={{ ...styles.navButton, ...(activeNav === 'settings' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* User profile pinned at bottom */}
        <div style={styles.userCard} onClick={() => setShowSettingsModal(true)}>
          <div style={styles.userAvatar}>AJ</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.userName}>Alex Johnson</div>
            <div style={styles.userPlan}>Pro Plan</div>
          </div>
          <span style={{ color: '#8B92B0', fontSize: '12px' }}>⌄</span>
        </div>
      </aside>

      {/* ------------------------------------------------------------------- */}
      {/* 2. MAIN VIEW CONTAINER                                              */}
      {/* ------------------------------------------------------------------- */}
      <div style={styles.mainCanvas}>
        {/* Top Header Bar */}
        <header style={styles.topHeader}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={styles.mobileMenuBtn}
            aria-label="Toggle navigation"
          >
            ☰
          </button>

          {/* Search bar */}
          <div style={styles.searchBox}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B92B0" strokeWidth="2" style={{ marginLeft: '14px' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search emails, domains, or jobs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          <div style={styles.headerRightGroup}>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowNotifications(!showNotifications)}
                style={styles.bellButton}
                aria-label="Notifications"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B92B0" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {notifications.some(n => !n.read) && (
                  <span style={styles.bellBadge}>{notifications.filter(n => !n.read).length}</span>
                )}
              </button>

              {showNotifications && (
                <div style={styles.notificationsDropdown}>
                  <div style={styles.notifHeader}>
                    <strong style={{ color: '#FFFFFF' }}>Notifications</strong>
                    <button
                      onClick={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
                      style={styles.notifClearBtn}
                    >
                      Mark all read
                    </button>
                  </div>
                  <div style={styles.notifList}>
                    {notifications.map(n => (
                      <div key={n.id} style={{ ...styles.notifItem, opacity: n.read ? 0.7 : 1 }}>
                        <div style={styles.notifTitle}>{n.title}</div>
                        <div style={styles.notifDetail}>{n.detail}</div>
                        <div style={styles.notifTime}>{n.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div
              style={styles.headerAvatar}
              onClick={() => setShowSettingsModal(true)}
              title="Operator Profile"
            >
              AJ
            </div>
          </div>
        </header>

        {/* ================================================================= */}
        {/* VIEW CONTAINER: CONDITIONAL ON activeNav                          */}
        {/* ================================================================= */}
        {activeNav === 'dashboard' ? renderDashboardView() : renderScraperView()}
      </div>

      {/* =================================================================== */}
      {/* 3. MODALS (RESTYLED WITH #141833 & INDIGO/PURPLE ACCENT)            */}
      {/* =================================================================== */}

      {/* Results Modal */}
      {showResultsModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardLarge}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Discovered Leads ({filteredRecords.length})</h3>
                <p style={styles.modalSubtitle}>Filter, verify deliverability, quarantine, or export contacts.</p>
              </div>
              <button onClick={() => setShowResultsModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <div style={styles.resultsFilterBar}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                <input
                  type="text"
                  placeholder="Filter within results..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={styles.filterInput}
                />
                <select
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value as any)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Types</option>
                  <option value="personal">Personal only</option>
                  <option value="role">Role / Inboxes</option>
                </select>
                <select
                  value={domainFilter}
                  onChange={e => setDomainFilter(e.target.value)}
                  style={styles.filterSelect}
                >
                  <option value="all">All Domains ({uniqueDomains.length})</option>
                  {uniqueDomains.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleVerifyDeliverability(filteredRecords)}
                  style={styles.btnActionSecondary}
                  title="Verify MX records for displayed leads"
                >
                  🛡️ Verify MX
                </button>
                <button
                  type="button"
                  onClick={handleQuarantineInvalid}
                  style={styles.btnActionQuarantine}
                  title="Remove undeliverable or disposable contacts"
                >
                  ☣️ Quarantine
                </button>
                <button
                  type="button"
                  onClick={() => setShowExportModal(true)}
                  style={styles.btnActionExport}
                >
                  📥 Export
                </button>
                <button
                  type="button"
                  onClick={() => setShowHuntiqModal(true)}
                  style={styles.btnActionSync}
                >
                  🔄 Sync to HUNTIQ
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '52vh', marginTop: '14px' }}>
              <table style={styles.jobTable}>
                <thead>
                  <tr style={styles.jobTableHead}>
                    <th style={styles.jobTh}>
                      <input
                        type="checkbox"
                        checked={filteredRecords.length > 0 && selectedEmails.size === filteredRecords.length}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedEmails(new Set(filteredRecords.map(r => r.email)));
                          } else {
                            setSelectedEmails(new Set());
                          }
                        }}
                      />
                    </th>
                    <th style={styles.jobTh}>Email Address</th>
                    <th style={styles.jobTh}>Contact / Name</th>
                    <th style={styles.jobTh}>Type</th>
                    <th style={styles.jobTh}>Deliverability</th>
                    <th style={styles.jobTh}>Domain</th>
                    <th style={styles.jobTh}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: '#8B92B0' }}>
                        No records match the current filter or search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map(r => {
                      const isSelected = selectedEmails.has(r.email);
                      return (
                        <tr key={r.email} style={{ ...styles.jobTr, backgroundColor: isSelected ? 'rgba(91, 95, 239, 0.08)' : 'transparent' }}>
                          <td style={styles.jobTd}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={e => {
                                const next = new Set(selectedEmails);
                                if (e.target.checked) next.add(r.email);
                                else next.delete(r.email);
                                setSelectedEmails(next);
                              }}
                            />
                          </td>
                          <td style={{ ...styles.jobTd, fontWeight: 600, color: '#FFFFFF' }}>{r.email}</td>
                          <td style={{ ...styles.jobTd, color: '#8B92B0' }}>{r.name || '—'}</td>
                          <td style={styles.jobTd}>
                            <span style={{
                              ...styles.badgeSmall,
                              backgroundColor: r.type === 'personal' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                              color: r.type === 'personal' ? '#3B82F6' : '#F59E0B'
                            }}>
                              {r.type || 'unknown'}
                            </span>
                          </td>
                          <td style={styles.jobTd}>
                            <span style={{
                              ...styles.statusTag,
                              ...(r.mxStatus === 'deliverable' ? styles.statusCompleted :
                                 r.mxStatus === 'disposable' || r.mxStatus === 'undeliverable' ? styles.statusFailed :
                                 styles.statusRunning)
                            }}>
                              • {r.mxStatus || 'pending'}
                            </span>
                          </td>
                          <td style={{ ...styles.jobTd, color: '#8B92B0' }}>{r.domain || '—'}</td>
                          <td style={{ ...styles.jobTd, fontSize: '12px' }}>
                            {r.sourceUrl ? (
                              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#5B5FEF', textDecoration: 'none', fontWeight: 500 }}>
                                Link ↗
                              </a>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={styles.modalFooter}>
              <span style={{ fontSize: '13px', color: '#8B92B0' }}>
                {selectedEmails.size > 0 ? `${selectedEmails.size} contact(s) selected` : `${filteredRecords.length} total contact(s)`}
              </span>
              <button onClick={() => setShowResultsModal(false)} style={styles.primaryActionButton}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Export Discovered Leads</h3>
              <button onClick={() => setShowExportModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <p style={{ fontSize: '14px', color: '#8B92B0', margin: '0 0 16px 0' }}>
              Choose a format for {selectedEmails.size > 0 ? `${selectedEmails.size} selected` : `${records.length} total`} contacts.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '20px' }}>
              <button onClick={() => handleExport('csv')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📊</div>
                <div style={{ fontWeight: 600, color: '#FFFFFF' }}>Excel CSV</div>
                <div style={{ fontSize: '11px', color: '#8B92B0' }}>UTF-8 BOM formatted</div>
              </button>

              <button onClick={() => handleExport('json')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📦</div>
                <div style={{ fontWeight: 600, color: '#FFFFFF' }}>JSON Array</div>
                <div style={{ fontSize: '11px', color: '#8B92B0' }}>Full data hierarchy</div>
              </button>

              <button onClick={() => handleExport('txt')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📄</div>
                <div style={{ fontWeight: 600, color: '#FFFFFF' }}>Plain Text</div>
                <div style={{ fontSize: '11px', color: '#8B92B0' }}>One email per line</div>
              </button>

              <button onClick={() => handleExport('vcf')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📇</div>
                <div style={{ fontWeight: 600, color: '#FFFFFF' }}>vCard (.vcf)</div>
                <div style={{ fontSize: '11px', color: '#8B92B0' }}>Outlook / Apple Contacts</div>
              </button>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={() => setShowExportModal(false)} style={styles.cancelBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Raw Text Modal */}
      {showTextModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Extract from Raw Text / Snippet</h3>
              <button onClick={() => setShowTextModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <p style={{ fontSize: '14px', color: '#8B92B0', margin: '0 0 12px 0' }}>
              Paste unformatted text, email newsletters, or website source code to extract contacts.
            </p>

            <textarea
              rows={6}
              value={rawTextInput}
              onChange={e => setRawTextInput(e.target.value)}
              placeholder="Paste text here... e.g. Reach team at press@test.org or sales@corp.io"
              style={styles.modalTextarea}
            />

            <div style={styles.modalFooter}>
              <button onClick={() => setShowTextModal(false)} style={styles.cancelBtn}>
                Cancel
              </button>
              <button onClick={handleExtractFromText} style={styles.primaryActionButton}>
                Extract Contacts →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HUNTIQ CRM Modal */}
      {showHuntiqModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={styles.huntiqSquareBadge}>H</div>
                <h3 style={styles.modalTitle}>HUNTIQ CRM Integration</h3>
              </div>
              <button onClick={() => setShowHuntiqModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <div style={{ padding: '14px', backgroundColor: '#0B0E1A', borderRadius: '10px', marginBottom: '16px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#8B92B0' }}>Status:</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: huntiqStatus.connected ? '#10B981' : '#F59E0B' }}>
                  {huntiqStatus.connected ? 'Connected & Authenticated' : (huntiqStatus.configured ? 'Configured (Standby)' : 'Not Configured')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#8B92B0' }}>Server Endpoint:</span>
                <span style={{ fontSize: '13px', color: '#FFFFFF', fontFamily: 'monospace' }}>Environment Managed</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', color: '#8B92B0' }}>Total Contacts Synced:</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                  {huntiqStatus.recordsSynced.toLocaleString()}
                </span>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: '#8B92B0', marginBottom: '16px', lineHeight: 1.4 }}>
              API credentials are locked down on the server. Browser client never handles raw API keys or webhook secrets.
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => testHuntiqConnection(false)} style={styles.cancelBtn}>
                Test Connection
              </button>
              <button
                onClick={handleSyncToHuntiq}
                disabled={isSyncingHuntiq || records.length === 0}
                style={styles.primaryActionButton}
              >
                {isSyncingHuntiq ? 'Syncing...' : `Push ${records.length} Leads to CRM`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>System Settings & Security</h3>
              <button onClick={() => setShowSettingsModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={styles.settingsRow}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>SSRF Protection</div>
                  <div style={{ fontSize: '11px', color: '#8B92B0' }}>Blocks private IP subnets and loopbacks</div>
                </div>
                <span style={{ color: '#10B981', fontWeight: 600, fontSize: '12px' }}>Active</span>
              </div>

              <div style={styles.settingsRow}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>Streaming Body Timeout</div>
                  <div style={{ fontSize: '11px', color: '#8B92B0' }}>Guards against stalled network connections</div>
                </div>
                <span style={{ color: '#10B981', fontWeight: 600, fontSize: '12px' }}>12,000 ms</span>
              </div>

              <div style={styles.settingsRow}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>Response Size Cap</div>
                  <div style={{ fontSize: '11px', color: '#8B92B0' }}>Prevents denial-of-service memory exhaustion</div>
                </div>
                <span style={{ color: '#10B981', fontWeight: 600, fontSize: '12px' }}>10 MB Max</span>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={() => setShowSettingsModal(false)} style={styles.primaryActionButton}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          ...styles.toastNotification,
          backgroundColor:
            toastMessage.type === 'success' ? '#065F46' :
            toastMessage.type === 'error' ? '#881337' : '#1E3A8A'
        }}>
          {toastMessage.type === 'success' ? '✓ ' : toastMessage.type === 'error' ? '✕ ' : 'ℹ '}
          {toastMessage.text}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Complete Design System Styling Object
// Theme: #0B0E1A page background, #141833 card surfaces, #5B5FEF primary accent
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#0B0E1A',
    backgroundImage: 'radial-gradient(circle at 15% 90%, rgba(91, 95, 239, 0.12) 0%, transparent 50%), radial-gradient(circle at 85% 20%, rgba(99, 102, 241, 0.08) 0%, transparent 40%)',
    color: '#FFFFFF',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxSizing: 'border-box'
  },
  sidebar: {
    width: '240px',
    backgroundColor: '#0B0E1A',
    borderRight: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '24px 16px',
    boxSizing: 'border-box',
    flexShrink: 0
  },
  sidebarMobileOpen: {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    boxShadow: '4px 0 24px rgba(0, 0, 0, 0.8)'
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 6px',
    marginBottom: '28px'
  },
  brandLogoBox: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #5B5FEF 0%, #7C3AED 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(91, 95, 239, 0.4)'
  },
  brandTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#FFFFFF'
  },
  brandTagline: {
    fontSize: '11px',
    color: '#8B92B0'
  },
  navStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  navButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '11px 14px',
    borderRadius: '10px',
    background: 'transparent',
    border: 'none',
    color: '#8B92B0',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    minHeight: '44px',
    boxSizing: 'border-box',
    transition: 'background-color 0.15s, color 0.15s'
  },
  navButtonActive: {
    background: '#5B5FEF',
    color: '#FFFFFF',
    fontWeight: 600,
    boxShadow: '0 4px 16px rgba(91, 95, 239, 0.45)'
  },
  badgeSmall: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: '12px',
    padding: '2px 8px',
    fontSize: '11px',
    color: '#FFFFFF'
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '10px',
    backgroundColor: 'rgba(20, 24, 51, 0.65)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    backdropFilter: 'blur(8px)',
    cursor: 'pointer',
    boxSizing: 'border-box'
  },
  userAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #5B5FEF, #8B5CF6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF'
  },
  userName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF'
  },
  userPlan: {
    fontSize: '11px',
    color: '#8B92B0'
  },
  mainCanvas: {
    flex: 1,
    padding: '20px 28px',
    overflowY: 'auto',
    boxSizing: 'border-box',
    minWidth: 0
  },
  topHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    gap: '12px'
  },
  mobileMenuBtn: {
    display: 'none',
    background: 'transparent',
    border: 'none',
    color: '#FFFFFF',
    fontSize: '20px',
    cursor: 'pointer'
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    width: '360px',
    maxWidth: '65vw',
    height: '40px',
    backgroundColor: '#0B0E1A',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxSizing: 'border-box'
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#FFFFFF',
    fontSize: '13px',
    padding: '0 12px'
  },
  headerRightGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  bellButton: {
    position: 'relative',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  bellBadge: {
    position: 'absolute',
    top: '3px',
    right: '3px',
    background: '#EF4444',
    color: '#FFFFFF',
    fontSize: '9px',
    fontWeight: 700,
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  notificationsDropdown: {
    position: 'absolute',
    top: '44px',
    right: 0,
    width: '280px',
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    padding: '12px',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
    zIndex: 50
  },
  notifHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
    fontSize: '13px'
  },
  notifClearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#5B5FEF',
    fontSize: '11px',
    cursor: 'pointer'
  },
  notifList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  notifItem: {
    padding: '8px',
    backgroundColor: '#0B0E1A',
    borderRadius: '6px',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  notifTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF'
  },
  notifDetail: {
    fontSize: '11px',
    color: '#8B92B0',
    marginTop: '2px'
  },
  notifTime: {
    fontSize: '9px',
    color: '#8B92B0',
    marginTop: '4px'
  },
  headerAvatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF',
    cursor: 'pointer'
  },

  kpiRow5: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '14px',
    marginBottom: '20px'
  },
  cardStat: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '14px',
    padding: '18px 20px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
    boxSizing: 'border-box'
  },

  // ---------------------------------------------------------------------------
  // Two-Column Layout Grid
  // ---------------------------------------------------------------------------
  layoutTwoCol: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2.1fr) minmax(0, 1fr)',
    gap: '18px',
    alignItems: 'start'
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    minWidth: 0
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    minWidth: 0
  },

  // Hero Banner Card
  heroScrapeCard: {
    position: 'relative',
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '16px',
    padding: '24px 28px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    overflow: 'hidden',
    boxSizing: 'border-box',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
  },
  heroLightningIcon: {
    width: '42px',
    height: '42px',
    borderRadius: '50%',
    background: '#5B5FEF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 0 16px rgba(91, 95, 239, 0.5)'
  },
  heroH1: {
    fontSize: '26px', // 24-28px bold white
    fontWeight: 700,
    color: '#FFFFFF',
    margin: 0
  },
  heroSub: {
    fontSize: '14px', // 14px regular muted
    color: '#8B92B0',
    margin: '4px 0 0 0',
    lineHeight: 1.4
  },
  heroRightPromo: {
    display: 'flex',
    alignItems: 'center',
    position: 'relative'
  },
  cosmicGlowSphere: {
    position: 'absolute',
    right: '-40px',
    top: '-80px',
    width: '180px',
    height: '180px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(91, 95, 239, 0.35) 0%, rgba(99, 102, 241, 0.15) 50%, transparent 70%)',
    pointerEvents: 'none'
  },
  heroPromoH3: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#FFFFFF',
    marginBottom: '4px'
  },
  heroPromoP: {
    fontSize: '12px',
    color: '#8B92B0',
    lineHeight: 1.3
  },

  // Standard Card Surface
  cardContainer: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '14px',
    padding: '20px 24px',
    boxSizing: 'border-box',
    minWidth: 0,
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
  },
  cardTitle: {
    fontSize: '16px', // 15-16px semibold white
    fontWeight: 600,
    color: '#FFFFFF',
    margin: 0
  },
  scrapeTabsTrack: {
    display: 'flex',
    gap: '6px',
    marginBottom: '18px',
    backgroundColor: '#0B0E1A',
    padding: '4px',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  scrapeTabBtn: {
    flex: 1,
    padding: '10px 16px',
    border: 'none',
    background: 'transparent',
    color: '#8B92B0',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '8px',
    cursor: 'pointer',
    minHeight: '42px',
    transition: '0.15s'
  },
  scrapeTabBtnActive: {
    background: '#5B5FEF',
    color: '#FFFFFF',
    fontWeight: 600,
    boxShadow: '0 2px 10px rgba(91, 95, 239, 0.35)'
  },
  fieldLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF'
  },
  demoPillBtn: {
    background: 'rgba(91, 95, 239, 0.12)',
    border: '1px solid rgba(91, 95, 239, 0.3)',
    color: '#6366F1',
    fontSize: '11px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  urlInputBox: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    padding: '4px 6px',
    minHeight: '48px',
    gap: '8px'
  },
  urlInputText: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#FFFFFF',
    fontSize: '13px',
    padding: '10px 8px',
    minWidth: 0
  },
  primaryActionButton: {
    background: '#5B5FEF',
    border: 'none',
    color: '#FFFFFF',
    padding: '10px 20px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '42px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 2px 10px rgba(91, 95, 239, 0.4)',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.15s'
  },
  paramGrid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
    gap: '10px'
  },
  paramBox: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '10px',
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '48px',
    boxSizing: 'border-box'
  },
  paramIconSquare: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: 'rgba(91, 95, 239, 0.12)',
    border: '1px solid rgba(91, 95, 239, 0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    flexShrink: 0
  },
  paramLabel: {
    fontSize: '11px',
    color: '#8B92B0',
    fontWeight: 500
  },
  paramSelect: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#FFFFFF',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%'
  },
  switchBox: {
    position: 'relative',
    display: 'inline-block',
    width: '36px',
    height: '20px',
    cursor: 'pointer',
    flexShrink: 0
  },
  switchTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1E223D',
    borderRadius: '20px',
    transition: '0.2s'
  },
  switchTrackOn: {
    backgroundColor: '#5B5FEF'
  },
  switchKnob: {
    position: 'absolute',
    height: '14px',
    width: '14px',
    left: '3px',
    bottom: '3px',
    backgroundColor: 'white',
    borderRadius: '50%',
    transition: '0.2s'
  },
  switchKnobOn: {
    transform: 'translateX(16px)'
  },
  advancedOptionsContainer: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '10px',
    padding: '12px 14px'
  },
  advancedOptionsToggleBtn: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0
  },
  advancedCardsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '10px',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)'
  },
  advMiniCard: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  advIconBox: {
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    backgroundColor: 'rgba(91, 95, 239, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    flexShrink: 0
  },
  advLabel: {
    fontSize: '10px',
    color: '#8B92B0'
  },
  advValue: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#FFFFFF',
    marginTop: '2px'
  },
  viewDiscoveredBtn: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'rgba(91, 95, 239, 0.15)',
    border: '1px solid rgba(91, 95, 239, 0.35)',
    color: '#6366F1',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center'
  },

  // Telemetry Card
  telemetryCard: {
    backgroundColor: '#141833',
    border: '1px solid rgba(91, 95, 239, 0.35)',
    borderRadius: '14px',
    padding: '14px 18px',
    boxSizing: 'border-box'
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#5B5FEF',
    boxShadow: '0 0 10px #5B5FEF'
  },
  cancelCrawlBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#EF4444',
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },

  // Table Styling (Faint row dividers, generous padding, uppercase headers)
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  linkButton: {
    background: 'transparent',
    border: 'none',
    color: '#5B5FEF',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  jobTable: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '540px'
  },
  jobTableHead: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
  },
  jobTh: {
    fontSize: '11px',
    color: '#8B92B0',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
    padding: '12px 14px'
  },
  jobTr: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
  },
  jobTd: {
    fontSize: '13px',
    padding: '14px',
    color: '#FFFFFF'
  },

  // Status Badges (Pill-shaped with small dot, low-opacity tint, full-opacity text)
  statusTag: {
    padding: '3px 10px',
    borderRadius: '16px',
    fontSize: '11px',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px'
  },
  statusCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: '#10B981',
    border: '1px solid rgba(16, 185, 129, 0.25)'
  },
  statusRunning: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    color: '#3B82F6',
    border: '1px solid rgba(59, 130, 246, 0.25)'
  },
  statusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    color: '#EF4444',
    border: '1px solid rgba(239, 68, 68, 0.25)'
  },
  statusCancelled: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    color: '#94A3B8',
    border: '1px solid rgba(148, 163, 184, 0.25)'
  },
  viewLink: {
    background: 'transparent',
    border: 'none',
    color: '#5B5FEF',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    marginRight: '8px'
  },
  kebabActionBtn: {
    background: 'transparent',
    border: 'none',
    color: '#8B92B0',
    fontSize: '13px',
    cursor: 'pointer'
  },

  // Live Badge
  liveBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: '#10B981',
    padding: '3px 9px',
    borderRadius: '14px',
    fontSize: '11px',
    fontWeight: 600,
    border: '1px solid rgba(16, 185, 129, 0.25)'
  },
  liveDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#10B981',
    boxShadow: '0 0 6px #10B981'
  },

  // Right Column: HuntIQ Widget
  cardHuntiqWidget: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '14px',
    padding: '20px 24px',
    boxSizing: 'border-box',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
  },
  huntiqSquareBadge: {
    width: '34px',
    height: '34px',
    borderRadius: '8px',
    backgroundColor: '#5B5FEF',
    color: '#FFFFFF',
    fontSize: '16px',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  manageLink: {
    background: 'transparent',
    border: 'none',
    color: '#5B5FEF',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  huntiqWidgetP: {
    fontSize: '13px',
    color: '#8B92B0',
    lineHeight: 1.4,
    margin: '14px 0'
  },
  testConnectionBtn: {
    width: '100%',
    padding: '10px',
    backgroundColor: 'rgba(91, 95, 239, 0.12)',
    border: '1px solid rgba(91, 95, 239, 0.3)',
    color: '#6366F1',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    marginBottom: '16px'
  },
  huntiqWidgetMetricsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    paddingTop: '14px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)'
  },
  huntiqMetricLabel: {
    fontSize: '10px',
    color: '#8B92B0',
    textTransform: 'uppercase'
  },
  huntiqMetricValue: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF',
    marginTop: '2px'
  },
  huntiqMetricValueBig: {
    fontSize: '28px', // Big stat numbers: bold, 28-32px
    fontWeight: 700,
    color: '#FFFFFF',
    marginTop: '2px'
  },

  // Right Column: Quick Actions
  quickActionsTileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px'
  },
  actionTile: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '10px',
    padding: '12px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    textAlign: 'left',
    minHeight: '48px',
    boxSizing: 'border-box'
  },
  actionIconPill: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    color: '#FFFFFF',
    flexShrink: 0
  },
  actionTileH4: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#FFFFFF'
  },
  actionTileP: {
    fontSize: '11px',
    color: '#8B92B0',
    marginTop: '2px'
  },

  // Right Column: Scraping Tips
  tipsList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  tipItem: {
    fontSize: '13px',
    color: '#FFFFFF',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    lineHeight: 1.3
  },
  tipCheck: {
    color: '#10B981',
    fontWeight: 700,
    fontSize: '13px'
  },

  // Right Column: Secure & Compliant
  cardSecureCompliant: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '14px',
    padding: '20px 24px',
    boxSizing: 'border-box',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)'
  },
  shieldGraphic: {
    flexShrink: 0
  },
  securityPillsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px'
  },
  secPill: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '8px',
    padding: '8px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: '#FFFFFF'
  },
  secCheck: {
    color: '#10B981',
    fontWeight: 700,
    fontSize: '11px'
  },

  // Modals & Overlays
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 14, 26, 0.8)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
    boxSizing: 'border-box'
  },
  modalCardLarge: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '920px',
    padding: '24px',
    boxSizing: 'border-box',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
  },
  modalCardSmall: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '480px',
    padding: '24px',
    boxSizing: 'border-box',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px'
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#FFFFFF',
    margin: 0
  },
  modalSubtitle: {
    fontSize: '13px',
    color: '#8B92B0',
    margin: '4px 0 0 0'
  },
  modalCloseBtn: {
    background: 'transparent',
    border: 'none',
    color: '#8B92B0',
    fontSize: '18px',
    cursor: 'pointer'
  },
  resultsFilterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    backgroundColor: '#0B0E1A',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    flexWrap: 'wrap'
  },
  filterInput: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    padding: '8px 12px',
    color: '#FFFFFF',
    fontSize: '12px',
    outline: 'none',
    minWidth: '150px'
  },
  filterSelect: {
    backgroundColor: '#141833',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    padding: '8px 10px',
    color: '#FFFFFF',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  },
  btnActionSecondary: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#FFFFFF',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionQuarantine: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#EF4444',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionExport: {
    backgroundColor: '#10B981',
    border: 'none',
    color: '#FFFFFF',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionSync: {
    background: '#5B5FEF',
    border: 'none',
    color: '#FFFFFF',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '18px',
    paddingTop: '12px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)'
  },
  cancelBtn: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#8B92B0',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  exportFormatTile: {
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '10px',
    padding: '14px',
    cursor: 'pointer',
    textAlign: 'center'
  },
  modalTextarea: {
    width: '100%',
    backgroundColor: '#0B0E1A',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '10px',
    padding: '12px',
    color: '#FFFFFF',
    fontSize: '13px',
    fontFamily: 'Inter, sans-serif',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box'
  },
  settingsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    backgroundColor: '#0B0E1A',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  toastNotification: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    padding: '12px 20px',
    borderRadius: '10px',
    color: '#FFFFFF',
    fontSize: '13px',
    fontWeight: 500,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }
};
