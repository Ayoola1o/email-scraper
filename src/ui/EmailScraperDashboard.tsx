import React, { useState, useEffect, useMemo, useRef } from 'react';

// =============================================================================
// TypeScript Interfaces & Data Contracts
// =============================================================================

export type NavSection = 'dashboard' | 'scraper' | 'results' | 'history' | 'huntiq' | 'settings';
export type ScrapeMode = 'single' | 'domain' | 'batch' | 'text';
export type JobStatus = 'Completed' | 'Running' | 'Failed' | 'cancelled';
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
  name: string;
  status: JobStatus;
  detail: string;
  timeAgo: string;
}

export interface AppNotification {
  id: string;
  title: string;
  detail: string;
  time: string;
  read: boolean;
}

// =============================================================================
// Main Email Scraper Dashboard Component
// =============================================================================

export const EmailScraperDashboard: React.FC = () => {
  // Navigation & Drawer
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Scraper Form Inputs
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>('single');
  const [targetUrl, setTargetUrl] = useState('');
  const [crawlDepth, setCrawlDepth] = useState('3 (recommended)');
  const [maxPages, setMaxPages] = useState('100');
  const [emailTypeFilter, setEmailTypeFilter] = useState('All types');
  const [verifyEmails, setVerifyEmails] = useState(true);
  const [isScraping, setIsScraping] = useState(false);

  // Active Job & Telemetry State
  const [activeJob, setActiveJob] = useState<CrawlJobTelemetry | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Scraped Records State (Starts completely empty with zero mock data)
  const [records, setRecords] = useState<ScrapedEmailRecord[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'personal' | 'role'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Column Customization for Export & Table View
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(['email', 'name', 'mxStatus', 'phone', 'type', 'domain', 'linkedin', 'sourceUrl', 'contextSnippet'])
  );

  // HUNTIQ CRM Status (Starts clean, then populated by live server test)
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

  // Activity & Recent Jobs (Starts completely empty with zero mock data)
  const [recentJobs, setRecentJobs] = useState<RecentJobItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Notifications List
  const [notifications, setNotifications] = useState<AppNotification[]>([
    {
      id: 'n1',
      title: 'Scraper Engine Initialized',
      detail: 'Core extraction engine, SSRF guards, and MX verifier online.',
      time: 'Just now',
      read: false
    }
  ]);

  // Toast Helper
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
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
        setNotifications(prev => [
          {
            id: Date.now().toString(),
            title: 'HUNTIQ CRM Connected',
            detail: 'Server verified authentication credentials with HUNTIQ endpoint.',
            time: 'Just now',
            read: false
          },
          ...prev
        ]);
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

        const hostname = getHostnameSafely(cleanTarget);
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
            id: Date.now().toString(),
            name: hostname,
            status: 'Completed',
            detail: `Completed • ${newFound.length} email(s) extracted`,
            timeAgo: 'Just now'
          },
          ...prev.slice(0, 8)
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

        const hostname = getHostnameSafely(cleanTarget);
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

        setActivities(prev => [
          {
            id: Date.now().toString(),
            name: `${hostname} Crawl`,
            status: 'Running',
            detail: 'Crawler started • streaming pages...',
            timeAgo: 'Just now'
          },
          ...prev.slice(0, 8)
        ]);

        // Connect SSE stream
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
              name: `${hostname} Crawl`,
              status: 'Completed',
              detail: `Finished • ${doneData.totalRecords} emails found across ${doneData.pagesVisited} pages`,
              timeAgo: 'Just now'
            },
            ...prev.slice(0, 8)
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
            name: `Batch (${urlArray.length} URLs)`,
            status: 'Completed',
            detail: `Completed • ${data.uniqueEmailsFound} unique emails found`,
            timeAgo: 'Just now'
          },
          ...prev.slice(0, 8)
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
          name: cleanTarget.slice(0, 30),
          status: 'Failed',
          detail: `Failed • ${err.message || 'Error occurred'}`,
          timeAgo: 'Just now'
        },
        ...prev.slice(0, 8)
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
      // Deliverability check is non-fatal
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
          name: 'Text Extraction',
          status: 'Completed',
          detail: `Extracted ${found.length} email(s) from raw snippet`,
          timeAgo: 'Just now'
        },
        ...prev.slice(0, 8)
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
          name: 'HUNTIQ CRM Sync',
          status: 'Completed',
          detail: `Pushed ${synced} contacts to HUNTIQ CRM`,
          timeAgo: 'Just now'
        },
        ...prev.slice(0, 8)
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
      // Excel-ready CSV with UTF-8 BOM
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
  // Filtered & Paginated Records
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

  const totalPersonal = useMemo(() => records.filter(r => r.type === 'personal').length, [records]);
  const totalRole = useMemo(() => records.filter(r => r.type === 'role').length, [records]);
  const successfulJobsCount = useMemo(() => recentJobs.filter(j => j.status === 'Completed').length, [recentJobs]);
  const failedJobsCount = useMemo(() => recentJobs.filter(j => j.status === 'Failed').length, [recentJobs]);

  // Demo target quick-filler
  const handleLoadDemoTarget = () => {
    const demoUrl = `${window.location.origin}/api/demo`;
    setTargetUrl(demoUrl);
    setScrapeMode('single');
    showToast('Loaded built-in test target! Click "Start Scrape" to test extraction.', 'info');
  };

  // Clear or remove a job from history
  const handleDeleteJob = (jobId: string) => {
    setRecentJobs(prev => prev.filter(j => j.id !== jobId));
    showToast('Job removed from history.', 'info');
  };

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
          {/* Brand Logo & Name */}
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

          {/* Nav Items */}
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
              onClick={() => {
                setActiveNav('scraper');
                setSidebarOpen(false);
                document.getElementById('quick-scrape-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{ ...styles.navButton, ...(activeNav === 'scraper' ? styles.navButtonActive : {}) }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span style={{ flex: 1 }}>Scraper</span>
              <span style={{ color: '#64748b' }}>›</span>
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

        {/* User Card */}
        <div style={styles.userCard} onClick={() => setShowSettingsModal(true)}>
          <div style={styles.userAvatar}>ES</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.userName}>Operator Workspace</div>
            <div style={styles.userPlan}>Production Mode</div>
          </div>
          <span style={{ color: '#64748b', fontSize: '12px' }}>⚙️</span>
        </div>
      </aside>

      {/* ------------------------------------------------------------------- */}
      {/* 2. MAIN VIEW CONTAINER                                              */}
      {/* ------------------------------------------------------------------- */}
      <div style={styles.mainCanvas}>
        {/* Top Header Bar */}
        <header style={styles.topHeader}>
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={styles.mobileMenuBtn}
            aria-label="Toggle navigation"
          >
            ☰
          </button>

          {/* Search bar */}
          <div style={styles.searchBox}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" style={{ marginLeft: '12px' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search extracted emails, domains..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          {/* Right Header Badges */}
          <div style={styles.headerRightGroup}>
            {/* Notifications Bell */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowNotifications(!showNotifications)}
                style={styles.bellButton}
                aria-label="Notifications"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {notifications.some(n => !n.read) && (
                  <span style={styles.bellBadge}>{notifications.filter(n => !n.read).length}</span>
                )}
              </button>

              {/* Notifications Popover */}
              {showNotifications && (
                <div style={styles.notificationsDropdown}>
                  <div style={styles.notifHeader}>
                    <strong>Notifications</strong>
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
              title="Operator Profile & Preferences"
            >
              ES
            </div>
          </div>
        </header>

        {/* Greeting Banner */}
        <section style={styles.greetingBar}>
          <div>
            <h1 style={styles.greetingH1}>Email Extraction Console 👋</h1>
            <p style={styles.greetingSub}>Real-time email discovery, MX deliverability validation, and HUNTIQ synchronization.</p>
          </div>
          <div style={styles.systemStatusWrap}>
            <span style={styles.dateLabel}>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <div style={styles.statusOnlinePill}>
              <span style={styles.glowDotGreen} />
              <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 500 }}>Engine Online</span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* KPI METRICS ROW (5 CARDS) - DYNAMIC & ZERO MOCK NUMBERS           */}
        {/* ----------------------------------------------------------------- */}
        <section style={styles.kpiRow}>
          {/* 1: Total Emails Found */}
          <div style={styles.cardKpi}>
            <div style={styles.kpiTop}>
              <div style={{ ...styles.kpiIconSquare, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)' }}>
                ✉️
              </div>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={styles.kpiTitleText}>Total Emails Found</div>
                <div style={styles.kpiNumberText}>{records.length.toLocaleString()}</div>
              </div>
            </div>
            <div style={styles.kpiBottom}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {records.length > 0 ? `${totalPersonal} personal • ${totalRole} role` : 'No emails discovered yet'}
              </span>
            </div>
          </div>

          {/* 2: Websites Processed */}
          <div style={styles.cardKpi}>
            <div style={styles.kpiTop}>
              <div style={{ ...styles.kpiIconSquare, background: 'linear-gradient(135deg, #059669, #047857)' }}>
                🌐
              </div>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={styles.kpiTitleText}>Websites Processed</div>
                <div style={styles.kpiNumberText}>{uniqueDomains.length.toLocaleString()}</div>
              </div>
            </div>
            <div style={styles.kpiBottom}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {uniqueDomains.length > 0 ? `${uniqueDomains.length} unique domain(s)` : 'No domains scraped yet'}
              </span>
            </div>
          </div>

          {/* 3: Successful Jobs */}
          <div style={styles.cardKpi}>
            <div style={{ ...styles.kpiTop }}>
              <div style={{ ...styles.kpiIconSquare, background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                ✓
              </div>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={styles.kpiTitleText}>Successful Jobs</div>
                <div style={styles.kpiNumberText}>{successfulJobsCount.toLocaleString()}</div>
              </div>
            </div>
            <div style={styles.kpiBottom}>
              <span style={{ fontSize: '11px', color: successfulJobsCount > 0 ? '#10b981' : '#64748b' }}>
                {successfulJobsCount > 0 ? 'Completed extractions' : 'No completed jobs yet'}
              </span>
            </div>
          </div>

          {/* 4: Failed Jobs */}
          <div style={styles.cardKpi}>
            <div style={styles.kpiTop}>
              <div style={{ ...styles.kpiIconSquare, background: 'linear-gradient(135deg, #e11d48, #be123c)' }}>
                !
              </div>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={styles.kpiTitleText}>Failed Jobs</div>
                <div style={styles.kpiNumberText}>{failedJobsCount.toLocaleString()}</div>
              </div>
            </div>
            <div style={styles.kpiBottom}>
              <span style={{ fontSize: '11px', color: failedJobsCount === 0 ? '#10b981' : '#f43f5e' }}>
                {failedJobsCount === 0 ? 'Zero errors' : `${failedJobsCount} error(s) logged`}
              </span>
            </div>
          </div>

          {/* 5: HuntIQ Sync Status */}
          <div style={styles.cardKpi}>
            <div style={styles.kpiTop}>
              <div style={{ ...styles.kpiIconSquare, background: 'linear-gradient(135deg, #0d9488, #0f766e)' }}>
                🔄
              </div>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={styles.kpiTitleText}>HuntIQ Sync Status</div>
                <div style={{ ...styles.kpiNumberText, color: huntiqStatus.connected ? '#10b981' : (huntiqStatus.configured ? '#f59e0b' : '#94a3b8'), fontSize: '16px' }}>
                  {huntiqStatus.connected ? '● Connected' : (huntiqStatus.configured ? '○ Standby' : '○ Not Configured')}
                </div>
              </div>
            </div>
            <div style={styles.kpiBottom}>
              <span style={styles.trendSub}>
                {huntiqStatus.recordsSynced > 0 ? `${huntiqStatus.recordsSynced.toLocaleString()} leads synced` : '0 synced leads'}
              </span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* LIVE TELEMETRY STREAM BAR (VISIBLE WHEN CRAWLER ACTIVE)           */}
        {/* ----------------------------------------------------------------- */}
        {activeJob && (
          <section style={styles.telemetryCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={styles.pulseDot} />
                <strong style={{ fontSize: '14px', color: '#60a5fa' }}>Live Crawling in Progress</strong>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>({activeJob.currentUrl})</span>
              </div>
              <button onClick={handleCancelCrawl} style={styles.cancelCrawlBtn}>
                Stop Crawl
              </button>
            </div>
            <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: '#cbd5e1' }}>
              <span>Pages Visited: <strong>{activeJob.pagesVisited}</strong></span>
              <span>Discovered Emails: <strong>{activeJob.totalFound}</strong></span>
              <span>Queue: <strong>{activeJob.queueSize}</strong></span>
              <span>Depth Cap: <strong>{activeJob.depth}</strong></span>
            </div>
          </section>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* QUICK SCRAPE & HUNTIQ HERO PROMO                                  */}
        {/* ----------------------------------------------------------------- */}
        <section id="quick-scrape-section" style={styles.middleSectionGrid}>
          {/* Quick Scrape Control Card */}
          <div style={styles.cardContainer}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', color: '#f59e0b' }}>⚡</span>
                <h2 style={styles.sectionHeading}>Quick Scrape</h2>
              </div>
              <button
                type="button"
                onClick={handleLoadDemoTarget}
                style={styles.demoLoadBtn}
                title="Fill input with local built-in demo target for quick testing"
              >
                🧪 Try Demo Target
              </button>
            </div>
            <p style={styles.sectionSub}>
              Start scraping emails from a website or domain. Configure crawl settings and discover verified contacts.
            </p>

            {/* Mode Switcher Tabs */}
            <div style={styles.tabTrack}>
              <button
                type="button"
                onClick={() => setScrapeMode('single')}
                style={{ ...styles.tabBtn, ...(scrapeMode === 'single' ? styles.tabBtnActive : {}) }}
              >
                Single URL
              </button>
              <button
                type="button"
                onClick={() => setScrapeMode('domain')}
                style={{ ...styles.tabBtn, ...(scrapeMode === 'domain' ? styles.tabBtnActive : {}) }}
              >
                Domain Crawler
              </button>
              <button
                type="button"
                onClick={() => setScrapeMode('batch')}
                style={{ ...styles.tabBtn, ...(scrapeMode === 'batch' ? styles.tabBtnActive : {}) }}
              >
                Batch URLs
              </button>
            </div>

            {/* Input Form */}
            <form onSubmit={handleStartScrape} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={styles.inputContainer}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" style={{ marginLeft: '12px' }}>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <input
                  type="text"
                  placeholder={
                    scrapeMode === 'single' ? 'https://example.com/team' :
                    scrapeMode === 'domain' ? 'https://company.com' :
                    'https://site1.com, https://site2.com'
                  }
                  value={targetUrl}
                  onChange={e => setTargetUrl(e.target.value)}
                  style={styles.urlInputField}
                  required
                />
                <button
                  type="submit"
                  disabled={isScraping}
                  style={styles.primaryActionButton}
                >
                  {isScraping ? 'Scraping...' : 'Start Scrape →'}
                </button>
              </div>

              {/* Options Row */}
              <div style={styles.optionsRow}>
                {/* Crawl Depth */}
                <div style={styles.optionPill}>
                  <span>⏱️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.optionSmallLabel}>Crawl Depth</div>
                    <select
                      value={crawlDepth}
                      onChange={e => setCrawlDepth(e.target.value)}
                      style={styles.optionSelectField}
                    >
                      <option value="1">1 (fast)</option>
                      <option value="2">2 (standard)</option>
                      <option value="3 (recommended)">3 (recommended)</option>
                      <option value="5">5 (thorough)</option>
                    </select>
                  </div>
                </div>

                {/* Max Pages */}
                <div style={styles.optionPill}>
                  <span>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.optionSmallLabel}>Max Pages</div>
                    <select
                      value={maxPages}
                      onChange={e => setMaxPages(e.target.value)}
                      style={styles.optionSelectField}
                    >
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="200">200 (max)</option>
                    </select>
                  </div>
                </div>

                {/* Email Types */}
                <div style={styles.optionPill}>
                  <span>✉️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.optionSmallLabel}>Email Types</div>
                    <select
                      value={emailTypeFilter}
                      onChange={e => setEmailTypeFilter(e.target.value)}
                      style={styles.optionSelectField}
                    >
                      <option value="All types">All types</option>
                      <option value="Personal only">Personal only</option>
                      <option value="Role only">Role only</option>
                    </select>
                  </div>
                </div>

                {/* Verify Emails Toggle */}
                <div style={styles.optionPill}>
                  <span>🛡️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.optionSmallLabel}>Verify Emails</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Live MX check</div>
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

              {/* View Results Button if records exist */}
              {records.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setShowResultsModal(true)}
                    style={styles.viewLeadsBannerBtn}
                  >
                    🔍 View Discovered Contacts ({records.length}) →
                  </button>
                </div>
              )}
            </form>
          </div>

          {/* HuntIQ Integration Hero Card */}
          <div style={styles.cardHuntiqHero}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={styles.huntiqPillBadge}>HQ</div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>HuntIQ Integration</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '65%' }}>
                <h3 style={styles.huntiqHeroH3}>Automate your outreach with HuntIQ CRM</h3>
                <p style={styles.huntiqHeroP}>
                  Sync your discovered leads directly to HuntIQ for streamlined outreach and verified deliverability.
                </p>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setShowHuntiqModal(true)}
                    style={styles.huntiqOutlinedBtn}
                  >
                    Manage Integration →
                  </button>
                  <button
                    type="button"
                    onClick={() => testHuntiqConnection(false)}
                    style={styles.huntiqTestBtn}
                  >
                    Test Connection
                  </button>
                </div>
              </div>

              {/* 3D Visual Accents */}
              <div style={styles.illustrationWrapper}>
                <div style={styles.badgeH}>H</div>
                <div style={styles.badgeEnvelope}>✉</div>
              </div>
            </div>

            <div style={styles.huntiqHeroFooter}>
              <span style={huntiqStatus.connected ? styles.glowDotGreen : styles.glowDotAmber} />
              <span style={{ color: huntiqStatus.connected ? '#10b981' : '#f59e0b', fontSize: '12px', fontWeight: 600, marginLeft: '6px' }}>
                {huntiqStatus.connected ? 'Connected' : (huntiqStatus.configured ? 'Configured (Standby)' : 'Not Configured')}
              </span>
              <span style={{ color: '#64748b', margin: '0 6px' }}>•</span>
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                {huntiqStatus.recordsSynced.toLocaleString()} records synced
              </span>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* THIRD ROW: CHART + ACTIVITY + QUICK ACTIONS                       */}
        {/* ----------------------------------------------------------------- */}
        <section style={styles.thirdRowGrid}>
          {/* 1: Scraping Activity Chart */}
          <div style={styles.cardContainer}>
            <div style={styles.rowBetween}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#818cf8' }}>📊</span>
                <h3 style={styles.sectionHeading}>Scraping Activity</h3>
              </div>
              <select style={styles.dropdownMini}>
                <option>Last 7 days</option>
                <option>Last 30 days</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#818cf8' }} />
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Emails Found: {records.length}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2dd4bf' }} />
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Websites: {uniqueDomains.length}</span>
              </div>
            </div>

            {/* Bezier Vector Line Graph - Dynamic representation */}
            <div style={{ height: '160px', marginTop: '14px', position: 'relative' }}>
              <svg width="100%" height="100%" viewBox="0 0 500 150" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="purpleGradientGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="30" x2="500" y2="30" stroke="#1e293b" strokeDasharray="3 3" />
                <line x1="0" y1="70" x2="500" y2="70" stroke="#1e293b" strokeDasharray="3 3" />
                <line x1="0" y1="110" x2="500" y2="110" stroke="#1e293b" strokeDasharray="3 3" />

                {records.length > 0 ? (
                  <>
                    {/* Dynamic curve when records exist */}
                    <path
                      d={`M 0 135 Q 100 120, 200 90 T 350 50 T 500 ${Math.max(20, 135 - Math.min(110, records.length * 5))} L 500 150 L 0 150 Z`}
                      fill="url(#purpleGradientGlow)"
                    />
                    <path
                      d={`M 0 135 Q 100 120, 200 90 T 350 50 T 500 ${Math.max(20, 135 - Math.min(110, records.length * 5))}`}
                      fill="none"
                      stroke="#818cf8"
                      strokeWidth="3"
                    />
                    <circle cx="350" cy="50" r="4" fill="#818cf8" stroke="#0d1322" strokeWidth="2" />
                    <circle cx="500" cy={Math.max(20, 135 - Math.min(110, records.length * 5))} r="4" fill="#818cf8" stroke="#0d1322" strokeWidth="2" />

                    {/* Teal curve for domains */}
                    <path
                      d={`M 0 140 Q 120 135, 250 110 T 500 ${Math.max(40, 140 - Math.min(90, uniqueDomains.length * 15))}`}
                      fill="none"
                      stroke="#2dd4bf"
                      strokeWidth="2.5"
                    />
                    <circle cx="500" cy={Math.max(40, 140 - Math.min(90, uniqueDomains.length * 15))} r="4" fill="#2dd4bf" stroke="#0d1322" strokeWidth="2" />
                  </>
                ) : (
                  <>
                    {/* Baseline idle state when zero records */}
                    <line x1="0" y1="135" x2="500" y2="135" stroke="#334155" strokeWidth="1.5" />
                    <text x="250" y="80" textAnchor="middle" fill="#64748b" fontSize="13" fontWeight="500">
                      No scraping activity recorded yet. Run an extraction to plot live data.
                    </text>
                  </>
                )}
              </svg>

              <div style={styles.chartAxisDates}>
                <span>Day 1</span>
                <span>Day 2</span>
                <span>Day 3</span>
                <span>Day 4</span>
                <span>Day 5</span>
                <span>Day 6</span>
                <span>Today</span>
              </div>
            </div>
          </div>

          {/* 2: Recent Activity Feed */}
          <div style={styles.cardContainer}>
            <div style={styles.rowBetween}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⏱️</span>
                <h3 style={styles.sectionHeading}>Recent Activity</h3>
              </div>
              <button onClick={() => setShowResultsModal(true)} style={styles.linkButton}>View all →</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', minHeight: '160px' }}>
              {activities.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏱️</div>
                  <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>No recent activity yet</div>
                  <div style={{ fontSize: '11px', marginTop: '4px' }}>Extracted leads and sync operations will appear here.</div>
                </div>
              ) : (
                activities.slice(0, 5).map(act => (
                  <div key={act.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      ...styles.activityIconCircle,
                      background:
                        act.status === 'Completed' ? '#059669' :
                        act.status === 'Running' ? '#2563eb' : '#e11d48'
                    }}>
                      {act.status === 'Completed' ? '🌐' : act.status === 'Running' ? '⚙️' : '⚠️'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.activityName}>{act.name}</div>
                      <div style={styles.activitySub}>{act.detail}</div>
                    </div>
                    <div style={styles.activityTimeLabel}>{act.timeAgo}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 3: Quick Actions (2x2 Grid) */}
          <div style={styles.cardContainer}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span>⚡</span>
              <h3 style={styles.sectionHeading}>Quick Actions</h3>
            </div>

            <div style={styles.quickActionsTileGrid}>
              <button onClick={() => setShowResultsModal(true)} style={styles.actionTile}>
                <div style={{ ...styles.actionIconPill, background: '#7c3aed' }}>📋</div>
                <div>
                  <div style={styles.actionTileH4}>View Results</div>
                  <div style={styles.actionTileP}>{records.length > 0 ? `${records.length} leads ready` : 'Inspect contacts'}</div>
                </div>
              </button>

              <button
                onClick={() => {
                  document.getElementById('recent-jobs-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={styles.actionTile}
              >
                <div style={{ ...styles.actionIconPill, background: '#2563eb' }}>🕒</div>
                <div>
                  <div style={styles.actionTileH4}>Job History</div>
                  <div style={styles.actionTileP}>{recentJobs.length} extraction runs</div>
                </div>
              </button>

              <button onClick={() => setShowExportModal(true)} style={styles.actionTile}>
                <div style={{ ...styles.actionIconPill, background: '#059669' }}>📥</div>
                <div>
                  <div style={styles.actionTileH4}>Export Data</div>
                  <div style={styles.actionTileP}>CSV, JSON, TXT, vCard</div>
                </div>
              </button>

              <button onClick={() => setShowTextModal(true)} style={styles.actionTile}>
                <div style={{ ...styles.actionIconPill, background: '#475569' }}>📝</div>
                <div>
                  <div style={styles.actionTileH4}>Text / Snippet</div>
                  <div style={styles.actionTileP}>Paste raw copy/HTML</div>
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------------- */}
        {/* BOTTOM ROW: RECENT JOBS TABLE + COMPLIANCE CARD                   */}
        {/* ----------------------------------------------------------------- */}
        <section id="recent-jobs-section" style={styles.bottomSectionGrid}>
          {/* Recent Jobs Table */}
          <div style={styles.cardContainer}>
            <div style={styles.rowBetween}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📑</span>
                <h3 style={styles.sectionHeading}>Recent Jobs</h3>
              </div>
              <button onClick={() => setShowResultsModal(true)} style={styles.linkButton}>View all →</button>
            </div>

            <div style={{ overflowX: 'auto', marginTop: '10px' }}>
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
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>📑</div>
                        <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>No extraction jobs yet</div>
                        <div style={{ fontSize: '11px', marginTop: '4px' }}>
                          Start a single scrape, crawler, or batch run above to track jobs here.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    recentJobs.map(j => (
                      <tr key={j.id} style={styles.jobTr}>
                        <td style={{ ...styles.jobTd, fontWeight: 600, color: '#f8fafc' }}>{j.name}</td>
                        <td style={styles.jobTd}>{j.type}</td>
                        <td style={{ ...styles.jobTd, color: '#94a3b8' }}>{j.target}</td>
                        <td style={styles.jobTd}>
                          <span style={{
                            ...styles.statusTag,
                            ...(j.status === 'Completed' ? styles.statusCompleted :
                               j.status === 'Running' ? styles.statusRunning : styles.statusFailed)
                          }}>
                            • {j.status}
                          </span>
                        </td>
                        <td style={{ ...styles.jobTd, fontWeight: 600, color: '#f8fafc' }}>{j.emailsFound.toLocaleString()}</td>
                        <td style={{ ...styles.jobTd, color: '#64748b' }}>{j.started}</td>
                        <td style={{ ...styles.jobTd, textAlign: 'right' }}>
                          <button onClick={() => setShowResultsModal(true)} style={styles.viewLink}>View</button>
                          <button
                            onClick={() => handleDeleteJob(j.id)}
                            style={styles.deleteJobBtn}
                            title="Remove job"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Secure & Compliant Status */}
          <div style={styles.cardContainer}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '18px', color: '#818cf8' }}>🛡️</span>
              <h3 style={styles.sectionHeading}>Secure & Compliant</h3>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <ul style={styles.securityChecklist}>
                <li style={styles.securityItem}><span style={styles.greenCheck}>✓</span> SSRF protection enabled</li>
                <li style={styles.securityItem}><span style={styles.greenCheck}>✓</span> Strict URL validation active</li>
                <li style={styles.securityItem}><span style={styles.greenCheck}>✓</span> 10MB streaming size limit</li>
                <li style={styles.securityItem}><span style={styles.greenCheck}>✓</span> Lifecycle request/body timeout</li>
                <li style={styles.securityItem}><span style={styles.greenCheck}>✓</span> Secure server-only HUNTIQ keys</li>
              </ul>

              <div style={styles.shieldVectorBox}>
                <svg width="65" height="80" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(99, 102, 241, 0.15)" />
                  <rect x="9" y="10" width="6" height="5" rx="1" fill="#818cf8" />
                  <path d="M10 10V8a2 2 0 0 1 4 0v2" stroke="#818cf8" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* =================================================================== */}
      {/* 3. MODALS (RESULTS, EXPORT, HUNTIQ, RAW TEXT, SETTINGS)            */}
      {/* =================================================================== */}

      {/* MODAL 1: RESULTS INSPECTION TABLE */}
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

            {/* Results Filter Bar */}
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
                  title="Verify MX records for all displayed leads"
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

            {/* Results Table */}
            <div style={{ overflowX: 'auto', maxHeight: '52vh', marginTop: '12px' }}>
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
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: '#64748b' }}>
                        No records match the current filter or search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map(r => {
                      const isSelected = selectedEmails.has(r.email);
                      return (
                        <tr key={r.email} style={{ ...styles.jobTr, backgroundColor: isSelected ? 'rgba(79, 70, 229, 0.08)' : 'transparent' }}>
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
                          <td style={{ ...styles.jobTd, fontWeight: 600, color: '#f8fafc' }}>{r.email}</td>
                          <td style={styles.jobTd}>{r.name || '—'}</td>
                          <td style={styles.jobTd}>
                            <span style={{
                              ...styles.badgeSmall,
                              backgroundColor: r.type === 'personal' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                              color: r.type === 'personal' ? '#60a5fa' : '#facc15'
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
                          <td style={{ ...styles.jobTd, color: '#94a3b8' }}>{r.domain || '—'}</td>
                          <td style={{ ...styles.jobTd, fontSize: '11px', color: '#64748b' }}>
                            {r.sourceUrl ? (
                              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'none' }}>
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
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {selectedEmails.size > 0 ? `${selectedEmails.size} contact(s) selected` : `${filteredRecords.length} total contact(s)`}
              </span>
              <button onClick={() => setShowResultsModal(false)} style={styles.primaryActionButton}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: EXPORT DIALOG */}
      {showExportModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Export Discovered Leads</h3>
              <button onClick={() => setShowExportModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 16px 0' }}>
              Choose a format and customize columns for {selectedEmails.size > 0 ? `${selectedEmails.size} selected` : `${records.length} total`} contacts.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '20px' }}>
              <button onClick={() => handleExport('csv')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📊</div>
                <div style={{ fontWeight: 600, color: '#f8fafc' }}>Excel CSV</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>UTF-8 BOM formatted</div>
              </button>

              <button onClick={() => handleExport('json')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📦</div>
                <div style={{ fontWeight: 600, color: '#f8fafc' }}>JSON Array</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Full data hierarchy</div>
              </button>

              <button onClick={() => handleExport('txt')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📄</div>
                <div style={{ fontWeight: 600, color: '#f8fafc' }}>Plain Text</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>One email per line</div>
              </button>

              <button onClick={() => handleExport('vcf')} style={styles.exportFormatTile}>
                <div style={{ fontSize: '20px' }}>📇</div>
                <div style={{ fontWeight: 600, color: '#f8fafc' }}>vCard (.vcf)</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Outlook / Apple Contacts</div>
              </button>
            </div>

            <div style={styles.modalFooter}>
              <button onClick={() => setShowExportModal(false)} style={styles.huntiqOutlinedBtn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: RAW TEXT EXTRACTION */}
      {showTextModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Extract from Raw Text / Snippet</h3>
              <button onClick={() => setShowTextModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 12px 0' }}>
              Paste an email newsletter, customer support transcript, or unformatted text to parse all valid emails.
            </p>

            <textarea
              rows={6}
              value={rawTextInput}
              onChange={e => setRawTextInput(e.target.value)}
              placeholder="Paste text here... e.g. Contact alex@example.com or support@team.org"
              style={styles.modalTextarea}
            />

            <div style={styles.modalFooter}>
              <button onClick={() => setShowTextModal(false)} style={styles.huntiqOutlinedBtn}>
                Cancel
              </button>
              <button onClick={handleExtractFromText} style={styles.primaryActionButton}>
                Extract Contacts →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: HUNTIQ CRM INTEGRATION */}
      {showHuntiqModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCardSmall}>
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={styles.huntiqPillBadge}>HQ</div>
                <h3 style={styles.modalTitle}>HUNTIQ CRM Integration</h3>
              </div>
              <button onClick={() => setShowHuntiqModal(false)} style={styles.modalCloseBtn}>✕</button>
            </div>

            <div style={{ padding: '14px', backgroundColor: '#090e1a', borderRadius: '10px', marginBottom: '16px', border: '1px solid #172238' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Status:</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: huntiqStatus.connected ? '#10b981' : '#f59e0b' }}>
                  {huntiqStatus.connected ? 'Connected & Authenticated' : (huntiqStatus.configured ? 'Configured (Standby)' : 'Not Configured')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Server Endpoint:</span>
                <span style={{ fontSize: '12px', color: '#f8fafc', fontFamily: 'monospace' }}>Environment Managed</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Total Contacts Synced:</span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
                  {huntiqStatus.recordsSynced.toLocaleString()}
                </span>
              </div>
            </div>

            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
              API credentials are locked down on the server. Client browsers never handle raw API keys or webhook secrets.
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => testHuntiqConnection(false)} style={styles.huntiqOutlinedBtn}>
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

      {/* MODAL 5: SETTINGS / PREFERENCES */}
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
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>SSRF Protection</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Blocks private IP subnets and loopbacks</div>
                </div>
                <span style={{ color: '#10b981', fontWeight: 600, fontSize: '12px' }}>Active</span>
              </div>

              <div style={styles.settingsRow}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Streaming Body Timeout</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Guards against stalled network connections</div>
                </div>
                <span style={{ color: '#10b981', fontWeight: 600, fontSize: '12px' }}>12,000 ms</span>
              </div>

              <div style={styles.settingsRow}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Response Size Cap</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Prevents denial-of-service memory exhaustion</div>
                </div>
                <span style={{ color: '#10b981', fontWeight: 600, fontSize: '12px' }}>10 MB Max</span>
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
            toastMessage.type === 'success' ? '#065f46' :
            toastMessage.type === 'error' ? '#881337' : '#1e3a8a'
        }}>
          {toastMessage.type === 'success' ? '✓ ' : toastMessage.type === 'error' ? '✕ ' : 'ℹ '}
          {toastMessage.text}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Comprehensive Responsive Styling
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#080b13',
    color: '#f8fafc',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxSizing: 'border-box'
  },
  sidebar: {
    width: '240px',
    backgroundColor: '#0a0d18',
    borderRight: '1px solid #141c2e',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '24px 16px',
    boxSizing: 'border-box',
    backgroundImage: 'radial-gradient(circle at 10% 95%, rgba(99, 102, 241, 0.28) 0%, rgba(147, 51, 234, 0.18) 35%, transparent 65%)'
  },
  sidebarMobileOpen: {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    boxShadow: '4px 0 24px rgba(0,0,0,0.8)'
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 8px',
    marginBottom: '28px'
  },
  brandLogoBox: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.35)'
  },
  brandTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#f8fafc'
  },
  brandTagline: {
    fontSize: '11px',
    color: '#64748b'
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
    borderRadius: '9px',
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    minHeight: '44px',
    boxSizing: 'border-box'
  },
  navButtonActive: {
    background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
    color: '#ffffff',
    fontWeight: 600,
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.3)'
  },
  badgeSmall: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: '12px',
    padding: '2px 8px',
    fontSize: '11px',
    color: '#fff'
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    borderRadius: '10px',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(30, 41, 59, 0.7)',
    backdropFilter: 'blur(8px)',
    cursor: 'pointer',
    boxSizing: 'border-box'
  },
  userAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
    color: '#f8fafc'
  },
  userName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#f8fafc'
  },
  userPlan: {
    fontSize: '11px',
    color: '#94a3b8'
  },
  mainCanvas: {
    flex: 1,
    padding: '24px 32px',
    overflowY: 'auto',
    boxSizing: 'border-box',
    minWidth: 0
  },
  topHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    gap: '12px'
  },
  mobileMenuBtn: {
    display: 'none',
    background: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: '20px',
    cursor: 'pointer'
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    width: '340px',
    maxWidth: '65vw',
    height: '40px',
    backgroundColor: '#0c111e',
    borderRadius: '9px',
    border: '1px solid #192338',
    boxSizing: 'border-box'
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f8fafc',
    fontSize: '13px',
    padding: '0 12px'
  },
  headerRightGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  bellButton: {
    position: 'relative',
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#0c111e',
    border: '1px solid #192338',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  bellBadge: {
    position: 'absolute',
    top: '3px',
    right: '3px',
    background: '#ef4444',
    color: '#fff',
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
    backgroundColor: '#0d1322',
    border: '1px solid #1f2a40',
    borderRadius: '10px',
    padding: '12px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
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
    color: '#818cf8',
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
    backgroundColor: '#070b14',
    borderRadius: '6px',
    border: '1px solid #141c2e'
  },
  notifTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#f8fafc'
  },
  notifDetail: {
    fontSize: '11px',
    color: '#94a3b8',
    marginTop: '2px'
  },
  notifTime: {
    fontSize: '9px',
    color: '#64748b',
    marginTop: '4px'
  },
  headerAvatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 600,
    color: '#f8fafc',
    cursor: 'pointer'
  },
  greetingBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '12px'
  },
  greetingH1: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#f8fafc',
    margin: 0
  },
  greetingSub: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: '4px 0 0 0'
  },
  systemStatusWrap: {
    display: 'flex',
    alignItems: 'center'
  },
  dateLabel: {
    color: '#94a3b8',
    fontSize: '13px',
    marginRight: '14px'
  },
  statusOnlinePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  glowDotGreen: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
    boxShadow: '0 0 8px #10b981'
  },
  glowDotAmber: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#f59e0b',
    boxShadow: '0 0 8px #f59e0b'
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: '14px',
    marginBottom: '24px'
  },
  cardKpi: {
    backgroundColor: '#0d1322',
    border: '1px solid #162036',
    borderRadius: '12px',
    padding: '16px',
    boxSizing: 'border-box',
    minWidth: 0,
    overflow: 'hidden'
  },
  kpiTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    gap: '8px'
  },
  kpiIconSquare: {
    width: '38px',
    height: '38px',
    borderRadius: '9px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    flexShrink: 0
  },
  kpiTitleText: {
    fontSize: '12px',
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  kpiNumberText: {
    fontSize: 'clamp(18px, 1.8vw, 22px)',
    fontWeight: 700,
    color: '#f8fafc',
    marginTop: '2px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  kpiBottom: {
    paddingTop: '8px',
    borderTop: '1px solid #141c2e',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis'
  },
  trendSub: {
    color: '#64748b',
    fontSize: '11px'
  },
  telemetryCard: {
    backgroundColor: '#0b1329',
    border: '1px solid #1e3a8a',
    borderRadius: '12px',
    padding: '16px 20px',
    marginBottom: '24px',
    boxSizing: 'border-box'
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    boxShadow: '0 0 10px #3b82f6'
  },
  cancelCrawlBtn: {
    backgroundColor: '#7f1d1d',
    border: 'none',
    color: '#f87171',
    padding: '6px 14px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  middleSectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  cardContainer: {
    backgroundColor: '#0d1322',
    border: '1px solid #162036',
    borderRadius: '14px',
    padding: '20px 24px',
    boxSizing: 'border-box',
    minWidth: 0
  },
  sectionHeading: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f8fafc',
    margin: 0
  },
  sectionSub: {
    fontSize: '13px',
    color: '#94a3b8',
    margin: '0 0 16px 0',
    lineHeight: 1.4
  },
  demoLoadBtn: {
    backgroundColor: '#172238',
    border: '1px solid #283756',
    color: '#818cf8',
    padding: '5px 10px',
    borderRadius: '7px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  tabTrack: {
    display: 'inline-flex',
    backgroundColor: '#080b13',
    borderRadius: '9px',
    padding: '3px',
    border: '1px solid #162036',
    marginBottom: '14px',
    width: '100%',
    boxSizing: 'border-box'
  },
  tabBtn: {
    flex: 1,
    padding: '8px 14px',
    border: 'none',
    background: 'transparent',
    color: '#94a3b8',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '7px',
    cursor: 'pointer',
    minHeight: '44px',
    boxSizing: 'border-box'
  },
  tabBtnActive: {
    background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
    color: '#ffffff',
    fontWeight: 600,
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)'
  },
  inputContainer: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#080b13',
    border: '1px solid #1a243a',
    borderRadius: '10px',
    padding: '4px',
    minHeight: '48px',
    boxSizing: 'border-box',
    gap: '6px'
  },
  urlInputField: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f8fafc',
    fontSize: '13px',
    padding: '10px 12px',
    minWidth: 0
  },
  primaryActionButton: {
    background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
    border: 'none',
    color: '#ffffff',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)',
    whiteSpace: 'nowrap'
  },
  viewLeadsBannerBtn: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#172238',
    border: '1px solid #283756',
    color: '#818cf8',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center'
  },
  optionsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: '10px'
  },
  optionPill: {
    backgroundColor: '#090e1a',
    border: '1px solid #162036',
    borderRadius: '9px',
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '46px',
    boxSizing: 'border-box'
  },
  optionSmallLabel: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: 500
  },
  optionSelectField: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f1f5f9',
    fontSize: '12px',
    fontWeight: 500,
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
    backgroundColor: '#1e293b',
    borderRadius: '20px',
    transition: '0.2s'
  },
  switchTrackOn: {
    backgroundColor: '#4f46e5'
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
  cardHuntiqHero: {
    background: 'linear-gradient(145deg, #0d1527 0%, #131c38 50%, #1c1744 100%)',
    border: '1px solid #1e294b',
    borderRadius: '14px',
    padding: '20px 24px',
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
    minWidth: 0
  },
  huntiqPillBadge: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    backgroundColor: '#2563eb',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  huntiqHeroH3: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.3,
    margin: '0 0 8px 0'
  },
  huntiqHeroP: {
    fontSize: '12px',
    color: '#94a3b8',
    lineHeight: 1.4,
    margin: '0 0 16px 0'
  },
  huntiqOutlinedBtn: {
    backgroundColor: '#0c1326',
    border: '1px solid #2e3b5e',
    color: '#f8fafc',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px'
  },
  huntiqTestBtn: {
    backgroundColor: 'transparent',
    border: '1px solid #3b82f6',
    color: '#60a5fa',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: '44px'
  },
  illustrationWrapper: {
    position: 'relative',
    width: '100px',
    height: '90px',
    flexShrink: 0
  },
  badgeH: {
    position: 'absolute',
    top: '5px',
    right: 0,
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #1d4ed8, #0284c7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: 800,
    color: '#fff',
    boxShadow: '0 8px 24px rgba(2, 132, 199, 0.4)'
  },
  badgeEnvelope: {
    position: 'absolute',
    bottom: '4px',
    left: '4px',
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #4f46e5, #818cf8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    color: '#fff',
    boxShadow: '0 6px 18px rgba(79, 70, 229, 0.4)'
  },
  huntiqHeroFooter: {
    display: 'flex',
    alignItems: 'center',
    marginTop: '16px'
  },
  thirdRowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  dropdownMini: {
    backgroundColor: '#080b13',
    border: '1px solid #1e293b',
    color: '#94a3b8',
    fontSize: '12px',
    borderRadius: '7px',
    padding: '4px 8px',
    outline: 'none',
    cursor: 'pointer'
  },
  chartAxisDates: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#64748b',
    marginTop: '6px'
  },
  linkButton: {
    background: 'transparent',
    border: 'none',
    color: '#818cf8',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  activityIconCircle: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    flexShrink: 0
  },
  activityName: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#f8fafc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  activitySub: {
    fontSize: '11px',
    color: '#64748b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  activityTimeLabel: {
    fontSize: '11px',
    color: '#64748b',
    flexShrink: 0
  },
  quickActionsTileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px'
  },
  actionTile: {
    backgroundColor: '#090e1a',
    border: '1px solid #172238',
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
    flexShrink: 0
  },
  actionTileH4: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#f1f5f9'
  },
  actionTileP: {
    fontSize: '10px',
    color: '#64748b'
  },
  bottomSectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px'
  },
  jobTable: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '550px'
  },
  jobTableHead: {
    borderBottom: '1px solid #172238'
  },
  jobTh: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: 500,
    textAlign: 'left',
    padding: '10px 12px'
  },
  jobTr: {
    borderBottom: '1px solid #111928'
  },
  jobTd: {
    fontSize: '12px',
    padding: '12px',
    color: '#cbd5e1'
  },
  statusTag: {
    padding: '3px 8px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 600,
    display: 'inline-block'
  },
  statusCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: '#10b981',
    border: '1px solid rgba(16, 185, 129, 0.25)'
  },
  statusRunning: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    color: '#60a5fa',
    border: '1px solid rgba(59, 130, 246, 0.25)'
  },
  statusFailed: {
    backgroundColor: 'rgba(244, 63, 94, 0.12)',
    color: '#f43f5e',
    border: '1px solid rgba(244, 63, 94, 0.25)'
  },
  viewLink: {
    background: 'transparent',
    border: 'none',
    color: '#818cf8',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    marginRight: '8px'
  },
  deleteJobBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    fontSize: '12px',
    cursor: 'pointer'
  },
  securityChecklist: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  securityItem: {
    fontSize: '12px',
    color: '#cbd5e1',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  greenCheck: {
    color: '#10b981',
    fontWeight: 700
  },
  shieldVectorBox: {
    padding: '8px',
    flexShrink: 0
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
    boxSizing: 'border-box'
  },
  modalCardLarge: {
    backgroundColor: '#0c111e',
    border: '1px solid #1f2a40',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '920px',
    padding: '24px',
    boxSizing: 'border-box',
    boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
  },
  modalCardSmall: {
    backgroundColor: '#0c111e',
    border: '1px solid #1f2a40',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '480px',
    padding: '24px',
    boxSizing: 'border-box',
    boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
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
    color: '#ffffff',
    margin: 0
  },
  modalSubtitle: {
    fontSize: '12px',
    color: '#94a3b8',
    margin: '4px 0 0 0'
  },
  modalCloseBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: '18px',
    cursor: 'pointer'
  },
  resultsFilterBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#070b14',
    borderRadius: '10px',
    border: '1px solid #162036',
    flexWrap: 'wrap'
  },
  filterInput: {
    backgroundColor: '#0d1322',
    border: '1px solid #1f2a40',
    borderRadius: '8px',
    padding: '8px 12px',
    color: '#f8fafc',
    fontSize: '12px',
    outline: 'none',
    minWidth: '160px'
  },
  filterSelect: {
    backgroundColor: '#0d1322',
    border: '1px solid #1f2a40',
    borderRadius: '8px',
    padding: '8px 10px',
    color: '#f8fafc',
    fontSize: '12px',
    outline: 'none',
    cursor: 'pointer'
  },
  btnActionSecondary: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#f8fafc',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionQuarantine: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#f87171',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionExport: {
    backgroundColor: '#065f46',
    border: 'none',
    color: '#ffffff',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnActionSync: {
    background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
    border: 'none',
    color: '#ffffff',
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
    marginTop: '20px',
    paddingTop: '14px',
    borderTop: '1px solid #162036'
  },
  exportFormatTile: {
    backgroundColor: '#080b13',
    border: '1px solid #162036',
    borderRadius: '10px',
    padding: '14px',
    cursor: 'pointer',
    textAlign: 'center'
  },
  modalTextarea: {
    width: '100%',
    backgroundColor: '#080b13',
    border: '1px solid #1e293b',
    borderRadius: '10px',
    padding: '12px',
    color: '#f8fafc',
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
    padding: '10px 12px',
    backgroundColor: '#080b13',
    borderRadius: '8px',
    border: '1px solid #162036'
  },
  toastNotification: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    padding: '12px 20px',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 500,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  }
};
