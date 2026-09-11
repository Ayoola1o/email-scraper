/**
 * EmailScraper Pro - Interactive Frontend Application Logic
 * Supports real-time crawling, folder organization, pagination (10, 25, 50, 100), and multi-format exports.
 */

// Application State
const state = {
  activeTab: 'page',
  currentJobId: null,
  eventSource: null,
  records: [], // Currently displayed records (session or active folder)
  sessionRecords: [], // Live session records
  folders: [], // List of saved folders
  activeFolder: 'session', // 'session' or folderId
  selectedEmails: new Set(),
  searchQuery: '',
  typeFilter: 'all',
  domainFilter: 'all',
  isScraping: false,
  currentPage: 1,
  pageSize: 50, // 10, 25, 50, 100, or 'all'
  selectedColumns: new Set(['email', 'name', 'mxStatus', 'phone', 'type', 'domain', 'linkedin', 'sourceUrl', 'contextSnippet'])
};

// DOM Elements
const elements = {
  // Tabs
  tabButtons: document.querySelectorAll('.tab-button'),
  tabContents: document.querySelectorAll('.tab-content'),

  // KPIs
  kpiTotal: document.getElementById('kpi-total'),
  kpiPersonal: document.getElementById('kpi-personal'),
  kpiRole: document.getElementById('kpi-role'),
  kpiDomains: document.getElementById('kpi-domains'),

  // Telemetry Card
  telemetryCard: document.getElementById('telemetry-card'),
  telemetryStatus: document.getElementById('telemetry-status'),
  telemetryProgressBar: document.getElementById('telemetry-progress-bar'),
  telemetryPages: document.getElementById('telemetry-pages'),
  telemetryFound: document.getElementById('telemetry-found'),
  telemetryDepth: document.getElementById('telemetry-depth'),
  telemetryQueue: document.getElementById('telemetry-queue'),
  telemetryUrlTicker: document.getElementById('telemetry-url-ticker'),
  btnCancelCrawl: document.getElementById('btn-cancel-crawl'),

  // Forms
  formSinglePage: document.getElementById('form-single-page'),
  inputSingleUrl: document.getElementById('input-single-url'),
  inputSingleTimeout: document.getElementById('input-single-timeout'),
  btnScrapeSingle: document.getElementById('btn-scrape-single'),

  formCrawl: document.getElementById('form-crawl'),
  inputCrawlUrl: document.getElementById('input-crawl-url'),
  inputCrawlDepth: document.getElementById('input-crawl-depth'),
  inputCrawlPages: document.getElementById('input-crawl-pages'),
  inputCrawlDelay: document.getElementById('input-crawl-delay'),
  chkSameDomain: document.getElementById('chk-same-domain'),
  btnStartCrawl: document.getElementById('btn-start-crawl'),

  formBatch: document.getElementById('form-batch'),
  inputBatchUrls: document.getElementById('input-batch-urls'),
  btnStartBatch: document.getElementById('btn-start-batch'),

  formText: document.getElementById('form-text'),
  inputTextContent: document.getElementById('input-text-content'),
  btnExtractText: document.getElementById('btn-extract-text'),

  // Table & Controls
  searchInput: document.getElementById('search-input'),
  domainFilterSelect: document.getElementById('domain-filter-select'),
  filterPills: document.querySelectorAll('.filter-pill'),
  tableContainer: document.getElementById('table-container'),
  tableBody: document.getElementById('results-table-body'),
  emptyState: document.getElementById('empty-state'),
  chkSelectAll: document.getElementById('chk-select-all'),
  selectedCountText: document.getElementById('selected-count-text'),

  // Table Headers
  tableHeaders: {
    email: document.getElementById('th-email'),
    name: document.getElementById('th-name'),
    mxStatus: document.getElementById('th-mxStatus'),
    phone: document.getElementById('th-phone'),
    type: document.getElementById('th-type'),
    domain: document.getElementById('th-domain'),
    linkedin: document.getElementById('th-linkedin'),
    sourceUrl: document.getElementById('th-sourceUrl'),
    pageTitle: document.getElementById('th-pageTitle'),
    contextSnippet: document.getElementById('th-contextSnippet'),
    discoveredAt: document.getElementById('th-discoveredAt')
  },

  // Column Toggle Modal
  btnToggleColumnsModal: document.getElementById('btn-toggle-columns-modal'),
  columnsModal: document.getElementById('columns-modal'),
  btnCloseColumnsModal: document.getElementById('btn-close-columns-modal'),
  btnApplyColumns: document.getElementById('btn-apply-columns'),
  btnPresetAll: document.getElementById('btn-preset-all'),
  btnPresetMinimal: document.getElementById('btn-preset-minimal'),
  btnPresetEnrichment: document.getElementById('btn-preset-enrichment'),
  btnPresetOutreach: document.getElementById('btn-preset-outreach'),
  colCheckboxes: {
    email: document.getElementById('col-email'),
    name: document.getElementById('col-name'),
    mxStatus: document.getElementById('col-mxStatus'),
    phone: document.getElementById('col-phone'),
    type: document.getElementById('col-type'),
    domain: document.getElementById('col-domain'),
    linkedin: document.getElementById('col-linkedin'),
    sourceUrl: document.getElementById('col-sourceUrl'),
    pageTitle: document.getElementById('col-pageTitle'),
    contextSnippet: document.getElementById('col-contextSnippet'),
    discoveredAt: document.getElementById('col-discoveredAt')
  },

  // Folder Controls & Modal
  folderFilterSelect: document.getElementById('folder-filter-select'),
  btnSaveToFolder: document.getElementById('btn-save-to-folder'),
  folderModal: document.getElementById('folder-modal'),
  modalFolderSelect: document.getElementById('modal-folder-select'),
  modalNewFolderInput: document.getElementById('modal-new-folder-input'),
  modalSaveSummary: document.getElementById('modal-save-summary'),
  btnConfirmSaveFolder: document.getElementById('btn-confirm-save-folder'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  btnCloseFolderModal: document.getElementById('btn-close-folder-modal'),

  // Pagination Controls
  paginationBar: document.getElementById('pagination-bar'),
  perPageSelect: document.getElementById('per-page-select'),
  paginationStatus: document.getElementById('pagination-status'),
  currentPageLabel: document.getElementById('current-page-label'),
  btnPageFirst: document.getElementById('btn-page-first'),
  btnPagePrev: document.getElementById('btn-page-prev'),
  btnPageNext: document.getElementById('btn-page-next'),
  btnPageLast: document.getElementById('btn-page-last'),

  // Actions
  btnVerifyMx: document.getElementById('btn-verify-mx'),
  btnPurgeDead: document.getElementById('btn-purge-dead'),
  btnCopySelected: document.getElementById('btn-copy-selected'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnExportJson: document.getElementById('btn-export-json'),
  btnExportTxt: document.getElementById('btn-export-txt'),
  btnExportVcf: document.getElementById('btn-export-vcf'),
  btnClearResults: document.getElementById('btn-clear-results'),
  btnTryDemo: document.getElementById('btn-try-demo'),

  // HUNTIQ CRM Sync Controls
  btnSyncHuntiqModal: document.getElementById('btn-sync-huntiq-modal'),
  huntiqModal: document.getElementById('huntiq-modal'),
  btnCloseHuntiqModal: document.getElementById('btn-close-huntiq-modal'),
  btnCancelHuntiqModal: document.getElementById('btn-cancel-huntiq-modal'),
  huntiqUrlInput: document.getElementById('huntiq-url-input'),
  huntiqWorkspaceInput: document.getElementById('huntiq-workspace-input'),
  huntiqApiKeyInput: document.getElementById('huntiq-apikey-input'),
  huntiqDraftToggle: document.getElementById('huntiq-draft-toggle'),
  huntiqAutosyncToggle: document.getElementById('huntiq-autosync-toggle'),
  huntiqSyncSummary: document.getElementById('huntiq-sync-summary'),
  btnTestHuntiqConn: document.getElementById('btn-test-huntiq-conn'),
  btnConfirmHuntiqSync: document.getElementById('btn-confirm-huntiq-sync'),

  toastContainer: document.getElementById('toast-container')
};

/* ==========================================================================
   Initialization
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupEventListeners();
  loadFolders();
  updateTableHeaderVisibility();
  updateKPIs();
  renderResults();
});

function setupTabs() {
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      state.activeTab = target;

      elements.tabButtons.forEach(b => b.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add('active');
    });
  });
}

function setupEventListeners() {
  // Preset Chips
  document.querySelectorAll('.chip[data-url]').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.getAttribute('data-url');
      if (state.activeTab === 'page') elements.inputSingleUrl.value = url;
      if (state.activeTab === 'crawl') elements.inputCrawlUrl.value = url;
    });
  });

  // Demo Button
  if (elements.btnTryDemo) {
    elements.btnTryDemo.addEventListener('click', () => {
      const demoUrl = `${window.location.origin}/api/demo`;
      elements.inputSingleUrl.value = demoUrl;
      elements.inputCrawlUrl.value = demoUrl;
      showToast('Loaded interactive Demo URL! Click "Scrape Emails" to test.', 'info');
    });
  }

  // Forms
  elements.formSinglePage.addEventListener('submit', handleSinglePageScrape);
  elements.formCrawl.addEventListener('submit', handleCrawlSubmit);
  elements.btnCancelCrawl.addEventListener('click', handleCancelCrawl);
  elements.formBatch.addEventListener('submit', handleBatchScrape);
  elements.formText.addEventListener('submit', handleTextExtraction);

  // Search & Filtering
  elements.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    state.currentPage = 1;
    renderResults();
  });

  elements.domainFilterSelect.addEventListener('change', (e) => {
    state.domainFilter = e.target.value;
    state.currentPage = 1;
    renderResults();
  });

  elements.filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      elements.filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.typeFilter = pill.getAttribute('data-type');
      state.currentPage = 1;
      renderResults();
    });
  });

  // Selection
  elements.chkSelectAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const filtered = getFilteredRecords();
    if (isChecked) {
      filtered.forEach(r => state.selectedEmails.add(r.email));
    } else {
      state.selectedEmails.clear();
    }
    renderResults();
  });

  // Pagination Controls
  elements.perPageSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    state.pageSize = val === 'all' ? 'all' : parseInt(val, 10);
    state.currentPage = 1;
    renderResults();
  });

  elements.btnPageFirst.addEventListener('click', () => {
    state.currentPage = 1;
    renderResults();
  });

  elements.btnPagePrev.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderResults();
    }
  });

  elements.btnPageNext.addEventListener('click', () => {
    const totalPages = getTotalPages();
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderResults();
    }
  });

  elements.btnPageLast.addEventListener('click', () => {
    state.currentPage = getTotalPages();
    renderResults();
  });

  // Folder Actions
  elements.folderFilterSelect.addEventListener('change', handleFolderSwitch);
  elements.btnSaveToFolder.addEventListener('click', openFolderModal);
  elements.btnCancelModal.addEventListener('click', closeFolderModal);
  elements.btnCloseFolderModal.addEventListener('click', closeFolderModal);
  elements.btnConfirmSaveFolder.addEventListener('click', handleConfirmSaveFolder);

  // Column Configuration Modal
  elements.btnToggleColumnsModal.addEventListener('click', openColumnsModal);
  elements.btnCloseColumnsModal.addEventListener('click', closeColumnsModal);
  elements.btnApplyColumns.addEventListener('click', applyColumns);

  elements.btnPresetAll.addEventListener('click', () => {
    Object.values(elements.colCheckboxes).forEach(cb => { if (cb) cb.checked = true; });
  });

  elements.btnPresetMinimal.addEventListener('click', () => {
    Object.entries(elements.colCheckboxes).forEach(([k, cb]) => {
      if (cb) cb.checked = (k === 'email' || k === 'domain');
    });
  });

  if (elements.btnPresetEnrichment) {
    elements.btnPresetEnrichment.addEventListener('click', () => {
      Object.entries(elements.colCheckboxes).forEach(([k, cb]) => {
        if (cb) cb.checked = (k === 'email' || k === 'name' || k === 'mxStatus' || k === 'phone' || k === 'linkedin');
      });
    });
  }

  if (elements.btnPresetOutreach) {
    elements.btnPresetOutreach.addEventListener('click', () => {
      Object.entries(elements.colCheckboxes).forEach(([k, cb]) => {
        if (cb) cb.checked = (k === 'email' || k === 'name' || k === 'mxStatus' || k === 'contextSnippet');
      });
    });
  }

  // Live MX Verification Action
  if (elements.btnVerifyMx) {
    elements.btnVerifyMx.addEventListener('click', handleVerifyMxDeliverability);
  }
  if (elements.btnPurgeDead) {
    elements.btnPurgeDead.addEventListener('click', handlePurgeDeadEmails);
  }

  // HUNTIQ CRM Actions
  if (elements.btnSyncHuntiqModal) {
    elements.btnSyncHuntiqModal.addEventListener('click', openHuntiqModal);
  }
  if (elements.btnCloseHuntiqModal) {
    elements.btnCloseHuntiqModal.addEventListener('click', closeHuntiqModal);
  }
  if (elements.btnCancelHuntiqModal) {
    elements.btnCancelHuntiqModal.addEventListener('click', closeHuntiqModal);
  }
  if (elements.btnTestHuntiqConn) {
    elements.btnTestHuntiqConn.addEventListener('click', testHuntiqConnection);
  }
  if (elements.btnConfirmHuntiqSync) {
    elements.btnConfirmHuntiqSync.addEventListener('click', confirmHuntiqSync);
  }

  // Export Buttons
  elements.btnCopySelected.addEventListener('click', copySelectedToClipboard);
  elements.btnExportCsv.addEventListener('click', () => triggerExport('csv'));
  elements.btnExportJson.addEventListener('click', () => triggerExport('json'));
  elements.btnExportTxt.addEventListener('click', () => triggerExport('txt'));
  elements.btnExportVcf.addEventListener('click', () => triggerExport('vcf'));

  elements.btnClearResults.addEventListener('click', () => {
    if (confirm('Clear current displayed leads?')) {
      if (state.activeFolder === 'session') {
        state.sessionRecords = [];
        state.records = [];
      } else {
        state.records = [];
      }
      state.selectedEmails.clear();
      updateKPIs();
      populateDomainFilter();
      renderResults();
      showToast('Results cleared');
    }
  });
}

/* ==========================================================================
   Folder & Collection Management
   ========================================================================== */

async function loadFolders() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    if (data.success && Array.isArray(data.folders)) {
      state.folders = data.folders;
      populateFolderDropdowns();
    }
  } catch (err) {
    console.error('Failed to load folders:', err);
  }
}

function populateFolderDropdowns() {
  // Folder filter dropdown
  elements.folderFilterSelect.innerHTML = `
    <option value="session" ${state.activeFolder === 'session' ? 'selected' : ''}>⚡ Active Session</option>
  `;
  state.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `📁 ${f.name} (${f.count})`;
    if (state.activeFolder === f.id) opt.selected = true;
    elements.folderFilterSelect.appendChild(opt);
  });

  // Modal folder dropdown
  elements.modalFolderSelect.innerHTML = '';
  state.folders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.name} (${f.count} leads)`;
    elements.modalFolderSelect.appendChild(opt);
  });
}

async function handleFolderSwitch(e) {
  const folderId = e.target.value;
  state.activeFolder = folderId;
  state.currentPage = 1;
  state.selectedEmails.clear();

  if (folderId === 'session') {
    state.records = [...state.sessionRecords];
    updateKPIs();
    populateDomainFilter();
    renderResults();
    showToast('Viewing Active Session leads');
    return;
  }

  try {
    const res = await fetch(`/api/folders/${folderId}`);
    const data = await res.json();
    if (data.success && data.folder) {
      state.records = data.folder.records || [];
      updateKPIs();
      populateDomainFilter();
      renderResults();
      showToast(`Viewing Folder: "${data.folder.name}" (${state.records.length} leads)`);
    }
  } catch (err) {
    showToast(`Failed to load folder: ${err.message}`, 'error');
  }
}

function openFolderModal() {
  const targets = getExportDataset();
  if (targets.length === 0) {
    showToast('No leads found to save. Please run a scrape first.', 'error');
    return;
  }

  elements.modalSaveSummary.textContent = `Will save ${targets.length} lead(s) into folder.`;
  elements.modalNewFolderInput.value = '';
  elements.folderModal.style.display = 'flex';
}

function closeFolderModal() {
  elements.folderModal.style.display = 'none';
}

async function handleConfirmSaveFolder() {
  const targets = getExportDataset();
  if (targets.length === 0) {
    showToast('No leads to save', 'error');
    closeFolderModal();
    return;
  }

  let folderId = elements.modalFolderSelect.value;
  const newName = elements.modalNewFolderInput.value.trim();

  try {
    // If creating new folder
    if (newName) {
      const createRes = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(createData.error || 'Failed to create folder');
      }
      folderId = createData.folder.id;
    }

    if (!folderId) {
      showToast('Please select or name a folder', 'error');
      return;
    }

    // Save records to folder
    const saveRes = await fetch(`/api/folders/${folderId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: targets })
    });
    const saveData = await saveRes.json();
    if (!saveRes.ok || !saveData.success) {
      throw new Error(saveData.error || 'Failed to save leads to folder');
    }

    closeFolderModal();
    await loadFolders();
    showToast(`Saved ${targets.length} leads to folder "${saveData.folder.name}"!`, 'success');
  } catch (err) {
    showToast(`Error saving: ${err.message}`, 'error');
  }
}

/* ==========================================================================
   HUNTIQ CRM Ingestion Integration
   ========================================================================== */

function openHuntiqModal() {
  const targets = getExportDataset();
  if (targets.length === 0) {
    showToast('No leads available to push. Please run a scrape first.', 'error');
    return;
  }

  // Load saved configuration from localStorage
  const savedUrl = localStorage.getItem('huntiq_url') || 'http://localhost:3001/api/v1/integrations/lead-ingest';
  const savedWorkspace = localStorage.getItem('huntiq_workspace') || 'ws-default-001';
  const savedApiKey = localStorage.getItem('huntiq_apikey') || '';
  const savedDraft = localStorage.getItem('huntiq_draft') !== 'false';
  const savedAutoSync = localStorage.getItem('huntiq_autosync') === 'true';

  if (elements.huntiqUrlInput) elements.huntiqUrlInput.value = savedUrl;
  if (elements.huntiqWorkspaceInput) elements.huntiqWorkspaceInput.value = savedWorkspace;
  if (elements.huntiqApiKeyInput) elements.huntiqApiKeyInput.value = savedApiKey;
  if (elements.huntiqDraftToggle) elements.huntiqDraftToggle.checked = savedDraft;
  if (elements.huntiqAutosyncToggle) elements.huntiqAutosyncToggle.checked = savedAutoSync;

  const isFiltered = state.selectedEmails.size > 0;
  if (elements.huntiqSyncSummary) {
    elements.huntiqSyncSummary.textContent = isFiltered
      ? `Ready to push ${targets.length} selected lead(s) to HUNTIQ CRM.`
      : `Ready to push all ${targets.length} visible lead(s) to HUNTIQ CRM.`;
  }

  elements.huntiqModal.style.display = 'flex';
}

function closeHuntiqModal() {
  elements.huntiqModal.style.display = 'none';
}

async function testHuntiqConnection() {
  const url = elements.huntiqUrlInput ? elements.huntiqUrlInput.value.trim() : '';

  setLoadingState(true, elements.btnTestHuntiqConn, 'Testing...');

  try {
    // Prefer server-configured integration endpoint
    const endpoint = url ? '/api/sync/huntiq/test' : '/api/integrations/huntiq/test';
    const body = url ? JSON.stringify({ huntiqApiUrl: url }) : undefined;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const data = await res.json();

    if (data.reachable) {
      if (data.authenticated === false) {
        showToast(`⚠️ HUNTIQ reachable but authentication rejected. Check HUNTIQ_API_KEY.`, 'warning');
      } else {
        showToast(`✓ HUNTIQ reachable & verified! (${data.message || 'Ready'})`, 'success');
      }
    } else {
      showToast(`✕ Could not reach HUNTIQ: ${data.message || data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Test failed: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnTestHuntiqConn, '🔌 Test Connection');
  }
}

async function confirmHuntiqSync() {
  const targets = getExportDataset();
  if (targets.length === 0) {
    showToast('No leads available to push', 'error');
    closeHuntiqModal();
    return;
  }

  const autoSync = elements.huntiqAutosyncToggle ? elements.huntiqAutosyncToggle.checked : false;
  localStorage.setItem('huntiq_autosync', String(autoSync));

  setLoadingState(true, elements.btnConfirmHuntiqSync, `Pushing ${targets.length} leads...`);

  try {
    const res = await fetch('/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: targets,
        sourceType: 'website_email_scraper'
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to push leads to HUNTIQ');
    }

    closeHuntiqModal();
    const dupNotice = data.duplicates > 0 ? ` (${data.duplicates} duplicates)` : '';
    showToast(`🚀 Successfully synced ${data.accepted ?? targets.length} lead(s) to HUNTIQ CRM${dupNotice}!`, 'success');
  } catch (err) {
    showToast(`HUNTIQ Sync: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnConfirmHuntiqSync, '🚀 Push Leads to HUNTIQ');
  }
}

async function triggerAutoHuntiqSync(newRecords) {
  if (!newRecords || newRecords.length === 0) return;

  try {
    const res = await fetch('/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: newRecords,
        sourceType: 'website_email_scraper'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`⚡ Auto-synced ${data.accepted ?? newRecords.length} new lead(s) to HUNTIQ CRM!`, 'info');
    }
  } catch (err) {
    console.warn('Auto-sync to HUNTIQ failed:', err);
  }
}

/* ==========================================================================
   Column Customization & Visibility
   ========================================================================== */

function openColumnsModal() {
  Object.entries(elements.colCheckboxes).forEach(([k, cb]) => {
    if (cb) cb.checked = state.selectedColumns.has(k);
  });
  elements.columnsModal.style.display = 'flex';
}

function closeColumnsModal() {
  elements.columnsModal.style.display = 'none';
}

function applyColumns() {
  const newCols = new Set(['email']); // email address is always required
  Object.entries(elements.colCheckboxes).forEach(([k, cb]) => {
    if (cb && cb.checked) newCols.add(k);
  });

  state.selectedColumns = newCols;
  closeColumnsModal();
  updateTableHeaderVisibility();
  renderResults();
  showToast(`Active export & view columns: ${state.selectedColumns.size} fields`, 'info');
}

function updateTableHeaderVisibility() {
  Object.entries(elements.tableHeaders).forEach(([key, th]) => {
    if (th) {
      th.style.display = state.selectedColumns.has(key) ? '' : 'none';
    }
  });
}

/**
 * Verifies live MX records and mail deliverability for displayed or selected leads.
 * Automatically moves dead/undeliverable emails out of the active scraped list into a dedicated quarantine folder.
 */
async function handleVerifyMxDeliverability() {
  const targetRecords = getExportDataset();
  if (targetRecords.length === 0) {
    showToast('No leads available to verify', 'error');
    return;
  }

  setLoadingState(true, elements.btnVerifyMx, `Verifying ${targetRecords.length} MX...`);

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: targetRecords })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Verification failed');
    }

    // Merge verified results back into active records and session
    const verifiedMap = new Map(data.records.map(r => [r.email.toLowerCase(), r]));

    const validRecords = [];
    const deadRecords = [];

    state.records.forEach(r => {
      const updated = verifiedMap.get(r.email.toLowerCase());
      const merged = updated ? { ...r, ...updated } : r;
      if (merged.mxStatus === 'undeliverable') {
        deadRecords.push(merged);
      } else {
        validRecords.push(merged);
      }
    });

    if (deadRecords.length > 0) {
      // Move dead records out of the active scraped list
      state.records = validRecords;
      if (state.activeFolder === 'session') {
        state.sessionRecords = validRecords;
      }
      deadRecords.forEach(r => state.selectedEmails.delete(r.email));

      // Automatically store in "Dead / Bounced Emails" folder
      saveDeadRecordsToQuarantineFolder(deadRecords);

      updateKPIs();
      populateDomainFilter();
      renderResults();

      showToast(
        `🛡️ MX Verification: Kept ${validRecords.length} deliverable leads. Moved ${deadRecords.length} dead email(s) out of the list into "Dead / Bounced Emails" folder!`,
        'success'
      );
    } else {
      state.records = validRecords;
      if (state.activeFolder === 'session') {
        state.sessionRecords = validRecords;
      }
      updateKPIs();
      populateDomainFilter();
      renderResults();

      showToast(
        `🛡️ Verification complete: All ${validRecords.length} emails are deliverable! No dead emails found.`,
        'success'
      );
    }
  } catch (err) {
    showToast(`Verification error: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnVerifyMx, '🛡️ Verify MX');
  }
}

/**
 * Moves any dead/undeliverable emails out of the active scraped list
 */
function handlePurgeDeadEmails() {
  const deadRecords = state.records.filter(r => r.mxStatus === 'undeliverable');
  if (deadRecords.length === 0) {
    showToast('No dead emails detected in the current list. Click "🛡️ Verify MX" to test deliverability first.', 'info');
    return;
  }

  const validRecords = state.records.filter(r => r.mxStatus !== 'undeliverable');
  state.records = validRecords;
  if (state.activeFolder === 'session') {
    state.sessionRecords = validRecords;
  }
  deadRecords.forEach(r => state.selectedEmails.delete(r.email));

  saveDeadRecordsToQuarantineFolder(deadRecords);
  updateKPIs();
  populateDomainFilter();
  renderResults();

  showToast(`🧹 Moved ${deadRecords.length} dead email(s) out of the list into "Dead / Bounced Emails" folder!`, 'success');
}

/**
 * Automatically archives dead/undeliverable leads into a dedicated folder
 */
async function saveDeadRecordsToQuarantineFolder(deadRecords) {
  if (!Array.isArray(deadRecords) || deadRecords.length === 0) return;
  try {
    let deadFolder = state.folders.find(f => f.name === 'Dead / Bounced Emails');
    let folderId = deadFolder ? deadFolder.id : null;

    if (!folderId) {
      const createRes = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Dead / Bounced Emails' })
      });
      const createData = await createRes.json();
      if (createData.success && createData.folder) {
        folderId = createData.folder.id;
      }
    }

    if (folderId) {
      await fetch(`/api/folders/${folderId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: deadRecords })
      });
      await loadFolders();
    }
  } catch (err) {
    console.warn('Failed to save dead emails to quarantine folder:', err);
  }
}

/* ==========================================================================
   Scraping Actions
   ========================================================================== */

/**
 * Single Page Scrape
 */
async function handleSinglePageScrape(e) {
  e.preventDefault();
  const url = elements.inputSingleUrl.value.trim();
  const timeout = parseInt(elements.inputSingleTimeout.value, 10) || 12000;

  if (!url) {
    showToast('Please enter a target URL', 'error');
    return;
  }

  setLoadingState(true, elements.btnScrapeSingle, 'Scraping...');

  try {
    const response = await fetch('/api/scrape/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, timeout })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Scrape failed');
    }

    mergeRecords(data.records);
    showToast(`Discovered ${data.count} email(s) on ${data.pageTitle || url}`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnScrapeSingle, 'Scrape Webpage');
  }
}

/**
 * Website Crawler with Live SSE Streaming
 */
async function handleCrawlSubmit(e) {
  e.preventDefault();
  const url = elements.inputCrawlUrl.value.trim();
  const maxDepth = parseInt(elements.inputCrawlDepth.value, 10) || 2;
  const maxPages = parseInt(elements.inputCrawlPages.value, 10) || 30;
  const delayMs = parseInt(elements.inputCrawlDelay.value, 10) || 250;
  const sameDomainOnly = elements.chkSameDomain.checked;

  if (!url) {
    showToast('Please enter a starting URL for the crawler', 'error');
    return;
  }

  setLoadingState(true, elements.btnStartCrawl, 'Crawling...');
  showTelemetry(true, url);

  try {
    const response = await fetch('/api/scrape/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxDepth, maxPages, delayMs, sameDomainOnly })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to start crawl');
    }

    state.currentJobId = data.jobId;
    connectCrawlStream(data.jobId, maxPages);
  } catch (err) {
    showToast(`Error starting crawl: ${err.message}`, 'error');
    setLoadingState(false, elements.btnStartCrawl, 'Start Deep Crawl');
    showTelemetry(false);
  }
}

/**
 * Connects to Server-Sent Events stream for live crawl telemetry
 */
function connectCrawlStream(jobId, maxPages) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const sse = new EventSource(`/api/scrape/crawl/stream/${jobId}`);
  state.eventSource = sse;

  sse.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    updateTelemetry(data, maxPages);
  });

  sse.addEventListener('record', (e) => {
    const record = JSON.parse(e.data);
    mergeRecords([record]);
  });

  sse.addEventListener('crawler_error', (e) => {
    const err = JSON.parse(e.data);
    console.warn('Crawl page warning:', err.url, err.message);
  });

  sse.addEventListener('done', (e) => {
    const summary = JSON.parse(e.data);
    sse.close();
    state.eventSource = null;
    state.currentJobId = null;

    mergeRecords(summary.records || []);
    setLoadingState(false, elements.btnStartCrawl, 'Start Deep Crawl');

    elements.telemetryProgressBar.style.width = '100%';
    elements.telemetryStatus.textContent = `Completed in ${(summary.durationMs / 1000).toFixed(1)}s`;
    showToast(`Crawl finished! Visited ${summary.pagesVisited} pages, collected ${summary.totalRecords} email(s)`, 'success');

    setTimeout(() => {
      showTelemetry(false);
    }, 4000);
  });

  sse.onerror = () => {
    console.error('SSE connection error');
  };
}

async function handleCancelCrawl() {
  if (!state.currentJobId) return;
  try {
    await fetch(`/api/scrape/crawl/cancel/${state.currentJobId}`, { method: 'POST' });
    showToast('Cancellation requested...', 'info');
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    setLoadingState(false, elements.btnStartCrawl, 'Start Deep Crawl');
    showTelemetry(false);
  } catch (err) {
    console.error(err);
  }
}

/**
 * Batch Scrape
 */
async function handleBatchScrape(e) {
  e.preventDefault();
  const rawText = elements.inputBatchUrls.value.trim();
  const urls = rawText.split('\n').map(u => u.trim()).filter(Boolean);

  if (urls.length === 0) {
    showToast('Please enter at least one URL', 'error');
    return;
  }

  setLoadingState(true, elements.btnStartBatch, `Processing ${urls.length} URLs...`);

  try {
    const response = await fetch('/api/scrape/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Batch scrape failed');
    }

    mergeRecords(data.records);
    showToast(`Batch completed: Found ${data.uniqueEmailsFound} unique email(s) across ${data.totalUrlsProcessed} targets`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnStartBatch, 'Start Batch Extraction');
  }
}

/**
 * Raw Text Extraction
 */
async function handleTextExtraction(e) {
  e.preventDefault();
  const text = elements.inputTextContent.value.trim();

  if (!text) {
    showToast('Please paste or enter some text or HTML', 'error');
    return;
  }

  setLoadingState(true, elements.btnExtractText, 'Extracting...');

  try {
    const response = await fetch('/api/scrape/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceName: 'Raw Text Input' })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Extraction failed');
    }

    mergeRecords(data.records);
    showToast(`Extracted ${data.count} email address(es)`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    setLoadingState(false, elements.btnExtractText, 'Extract Emails from Content');
  }
}

/* ==========================================================================
   State & Record Management
   ========================================================================== */

function mergeRecords(newRecords) {
  const existingMap = new Map(state.records.map(r => [r.email.toLowerCase(), r]));

  for (const rec of newRecords) {
    const key = rec.email.toLowerCase();
    if (!existingMap.has(key)) {
      existingMap.set(key, rec);
    }
  }

  state.records = Array.from(existingMap.values());
  if (state.activeFolder === 'session') {
    state.sessionRecords = [...state.records];
  }

  state.currentPage = 1;
  updateKPIs();
  populateDomainFilter();
  renderResults();

  // Auto-forward to HUNTIQ CRM if auto-sync is enabled
  if (localStorage.getItem('huntiq_autosync') === 'true' && newRecords.length > 0) {
    triggerAutoHuntiqSync(newRecords);
  }
}

function updateKPIs() {
  const total = state.records.length;
  const personal = state.records.filter(r => r.type === 'personal').length;
  const role = state.records.filter(r => r.type === 'role').length;
  const domains = new Set(state.records.map(r => r.domain)).size;

  elements.kpiTotal.textContent = total.toLocaleString();
  elements.kpiPersonal.textContent = personal.toLocaleString();
  elements.kpiRole.textContent = role.toLocaleString();
  elements.kpiDomains.textContent = domains.toLocaleString();
}

function populateDomainFilter() {
  const current = elements.domainFilterSelect.value;
  const domains = Array.from(new Set(state.records.map(r => r.domain))).sort();

  elements.domainFilterSelect.innerHTML = '<option value="all">All Domains</option>';
  domains.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    elements.domainFilterSelect.appendChild(opt);
  });

  if (domains.includes(current)) {
    elements.domainFilterSelect.value = current;
  }
}

function getFilteredRecords() {
  return state.records.filter(r => {
    // Deliverable / Type filter
    if (state.typeFilter === 'deliverable' && r.mxStatus !== 'deliverable') {
      return false;
    } else if (state.typeFilter !== 'all' && state.typeFilter !== 'deliverable' && r.type !== state.typeFilter) {
      return false;
    }

    // Domain filter
    if (state.domainFilter !== 'all' && r.domain !== state.domainFilter) {
      return false;
    }

    // Search query
    if (state.searchQuery) {
      const q = state.searchQuery;
      return (
        r.email.toLowerCase().includes(q) ||
        r.domain.toLowerCase().includes(q) ||
        (r.pageTitle && r.pageTitle.toLowerCase().includes(q)) ||
        (r.contextSnippet && r.contextSnippet.toLowerCase().includes(q))
      );
    }

    return true;
  });
}

function getTotalPages() {
  const filtered = getFilteredRecords();
  if (state.pageSize === 'all' || filtered.length === 0) return 1;
  return Math.ceil(filtered.length / state.pageSize);
}

function renderResults() {
  const filtered = getFilteredRecords();
  const totalRecords = filtered.length;

  if (totalRecords === 0) {
    elements.tableContainer.style.display = 'none';
    elements.paginationBar.style.display = 'none';
    elements.emptyState.style.display = 'flex';
  } else {
    elements.tableContainer.style.display = 'block';
    elements.paginationBar.style.display = 'flex';
    elements.emptyState.style.display = 'none';
  }

  // Calculate Pagination Slices
  const totalPages = getTotalPages();
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  let pageRecords = filtered;
  let startIdx = 1;
  let endIdx = totalRecords;

  if (state.pageSize !== 'all') {
    startIdx = (state.currentPage - 1) * state.pageSize + 1;
    endIdx = Math.min(totalRecords, state.currentPage * state.pageSize);
    pageRecords = filtered.slice(startIdx - 1, endIdx);
  }

  // Update Pagination Info
  elements.paginationStatus.textContent = totalRecords === 0
    ? '0 records'
    : `Showing ${startIdx} - ${endIdx} of ${totalRecords}`;
  elements.currentPageLabel.textContent = `Page ${state.currentPage} of ${totalPages}`;

  elements.btnPageFirst.disabled = state.currentPage <= 1;
  elements.btnPagePrev.disabled = state.currentPage <= 1;
  elements.btnPageNext.disabled = state.currentPage >= totalPages;
  elements.btnPageLast.disabled = state.currentPage >= totalPages;

  // Update selected count indicator
  elements.selectedCountText.textContent = `${state.selectedEmails.size} selected of ${state.records.length}`;

  // Update select all checkbox state
  if (pageRecords.length > 0 && pageRecords.every(r => state.selectedEmails.has(r.email))) {
    elements.chkSelectAll.checked = true;
    elements.chkSelectAll.indeterminate = false;
  } else if (pageRecords.some(r => state.selectedEmails.has(r.email))) {
    elements.chkSelectAll.checked = false;
    elements.chkSelectAll.indeterminate = true;
  } else {
    elements.chkSelectAll.checked = false;
    elements.chkSelectAll.indeterminate = false;
  }

  // Render Table Rows for Current Page
  elements.tableBody.innerHTML = '';
  pageRecords.forEach(record => {
    const tr = document.createElement('tr');
    const isSelected = state.selectedEmails.has(record.email);

    let rowHtml = `
      <td>
        <input type="checkbox" class="row-checkbox" ${isSelected ? 'checked' : ''} data-email="${escapeHtml(record.email)}" />
      </td>
    `;

    if (state.selectedColumns.has('email')) {
      rowHtml += `
        <td>
          <div class="email-cell">
            <span class="email-text">${escapeHtml(record.email)}</span>
            <button class="copy-icon-btn" title="Copy email" data-copy="${escapeHtml(record.email)}">
              📋
            </button>
          </div>
        </td>
      `;
    }

    if (state.selectedColumns.has('name')) {
      const nameText = record.name ? escapeHtml(record.name) : '<span style="color:var(--text-faint);">-</span>';
      const jobBadge = record.jobTitle ? `<span class="job-title-badge" title="${escapeHtml(record.jobTitle)}">${escapeHtml(record.jobTitle)}</span>` : '';
      rowHtml += `
        <td>
          <div class="name-cell">
            <span class="contact-name">${nameText}</span>
            ${jobBadge}
          </div>
        </td>
      `;
    }

    if (state.selectedColumns.has('mxStatus')) {
      const status = record.mxStatus || 'unverified';
      let badgeHtml = '';
      if (status === 'deliverable') {
        const mxHosts = (record.mxRecords || []).join(', ') || 'Valid Mail Exchange';
        badgeHtml = `<span class="mx-badge deliverable" title="Live MX Resolved: ${escapeHtml(mxHosts)}">✓ Deliverable</span>`;
      } else if (status === 'undeliverable') {
        badgeHtml = `<span class="mx-badge undeliverable" title="No MX record found or host invalid">✕ Undeliverable</span>`;
      } else if (status === 'disposable') {
        badgeHtml = `<span class="mx-badge disposable" title="Temporary / Disposable email domain">⚠ Disposable</span>`;
      } else {
        badgeHtml = `<span class="mx-badge unverified" title="Click 'Verify MX' to check live deliverability">○ Unverified</span>`;
      }
      rowHtml += `<td>${badgeHtml}</td>`;
    }

    if (state.selectedColumns.has('phone')) {
      const phoneHtml = record.phone
        ? `<span class="phone-pill" title="${escapeHtml(record.phone)}">📞 ${escapeHtml(record.phone)}</span>`
        : `<span style="color:var(--text-faint);">-</span>`;
      rowHtml += `<td>${phoneHtml}</td>`;
    }

    if (state.selectedColumns.has('type')) {
      rowHtml += `
        <td>
          <span class="type-badge ${record.type}">
            ${record.type === 'personal' ? '👤 Personal' : '🏢 Role / Team'}
          </span>
        </td>
      `;
    }

    if (state.selectedColumns.has('domain')) {
      rowHtml += `
        <td>
          <span class="domain-pill" title="${escapeHtml(record.domain)}">${escapeHtml(record.domain)}</span>
        </td>
      `;
    }

    if (state.selectedColumns.has('linkedin')) {
      const linkedinUrl = record.socials && record.socials.linkedin ? record.socials.linkedin : null;
      const linkedinHtml = linkedinUrl
        ? `<a href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener noreferrer" class="social-pill" title="${escapeHtml(linkedinUrl)}">in LinkedIn</a>`
        : `<span style="color:var(--text-faint);">-</span>`;
      rowHtml += `<td>${linkedinHtml}</td>`;
    }

    if (state.selectedColumns.has('sourceUrl')) {
      rowHtml += `
        <td>
          <a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="url-link" title="${escapeHtml(record.sourceUrl)}">
            🔗 ${escapeHtml(record.sourceUrl)}
          </a>
        </td>
      `;
    }

    if (state.selectedColumns.has('pageTitle')) {
      rowHtml += `
        <td>
          <span class="snippet-preview" title="${escapeHtml(record.pageTitle || '')}">
            ${escapeHtml(record.pageTitle || '-')}
          </span>
        </td>
      `;
    }

    if (state.selectedColumns.has('contextSnippet')) {
      rowHtml += `
        <td>
          <span class="snippet-preview" title="${escapeHtml(record.contextSnippet || '')}">
            ${escapeHtml(record.contextSnippet || 'Found on page')}
          </span>
        </td>
      `;
    }

    if (state.selectedColumns.has('discoveredAt')) {
      const dateStr = record.discoveredAt ? new Date(record.discoveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
      rowHtml += `
        <td>
          <span style="font-size:11px;color:var(--text-faint);">${dateStr}</span>
        </td>
      `;
    }

    tr.innerHTML = rowHtml;

    // Row checkbox listener
    const chk = tr.querySelector('.row-checkbox');
    chk.addEventListener('change', (e) => {
      if (e.target.checked) {
        state.selectedEmails.add(record.email);
      } else {
        state.selectedEmails.delete(record.email);
      }
      renderResults();
    });

    // Copy single email listener
    const copyBtn = tr.querySelector('.copy-icon-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(record.email).then(() => {
          showToast(`Copied ${record.email}`, 'success');
        });
      });
    }

    elements.tableBody.appendChild(tr);
  });
}

/* ==========================================================================
   Export & Clipboard Handlers
   ========================================================================== */

function getExportDataset() {
  const filtered = getFilteredRecords();
  if (state.selectedEmails.size > 0) {
    return filtered.filter(r => state.selectedEmails.has(r.email));
  }
  return filtered;
}

function copySelectedToClipboard() {
  const dataset = getExportDataset();
  if (dataset.length === 0) {
    showToast('No emails to copy', 'error');
    return;
  }

  const emailsText = Array.from(new Set(dataset.map(r => r.email))).join('\n');
  navigator.clipboard.writeText(emailsText).then(() => {
    showToast(`Copied ${dataset.length} email(s) to clipboard!`, 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

async function triggerExport(format) {
  const dataset = getExportDataset();
  if (dataset.length === 0) {
    showToast('No emails to export', 'error');
    return;
  }

  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: dataset,
        format,
        fields: Array.from(state.selectedColumns)
      })
    });

    if (!response.ok) {
      throw new Error('Export request failed');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `emails_export_${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);

    showToast(`Downloaded ${dataset.length} records as ${format.toUpperCase()}`, 'success');
  } catch (err) {
    showToast(`Export error: ${err.message}`, 'error');
  }
}

/* ==========================================================================
   UI Helpers
   ========================================================================== */

function showTelemetry(visible, url = '') {
  if (visible) {
    elements.telemetryCard.style.display = 'block';
    elements.telemetryStatus.textContent = 'Crawling in progress...';
    elements.telemetryProgressBar.style.width = '5%';
    elements.telemetryUrlTicker.textContent = `Target: ${url}`;
  } else {
    elements.telemetryCard.style.display = 'none';
  }
}

function updateTelemetry(progress, maxPages) {
  const percent = Math.min(100, Math.round((progress.pagesVisited / maxPages) * 100));
  elements.telemetryProgressBar.style.width = `${percent}%`;
  elements.telemetryPages.textContent = `${progress.pagesVisited} / ${maxPages}`;
  elements.telemetryFound.textContent = progress.totalUniqueEmails;
  elements.telemetryDepth.textContent = progress.depth;
  elements.telemetryQueue.textContent = progress.queueLength;
  elements.telemetryUrlTicker.textContent = `Analyzing: ${progress.url}`;
}

function setLoadingState(loading, button, text) {
  state.isScraping = loading;
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="radar-spinner" style="width:14px;height:14px;"></span> ${text}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.originalText || text;
  }
}

function showToast(message, type = 'normal') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon = '⚡';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '✕';
  if (type === 'info') icon = 'ℹ';

  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
