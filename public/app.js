/**
 * Speedotrack Bulk Provisioner - Client-side Logic & Execution Engine
 * Supports Dealer CPanel Mode & Super Administrator API Key Mode
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let parsedRows = [];
  let isExecuting = false;
  let isPaused = false;
  let shouldStop = false;
  let logHistory = [];
  let currentAuthMode = 'dealer'; // 'dealer' or 'server_key'

  // Helper to normalize URL to clean base URL (e.g. https://server.cartracker.com.ng/ or https://gps.example.com)
  function normalizeServerUrl(url) {
    let clean = (url || '').trim();
    if (!clean) return '';
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = (clean.match(/^\d+\.\d+\.\d+\.\d+/) ? 'http://' : 'https://') + clean;
    }
    try {
      const u = new URL(clean);
      u.hash = '';
      u.search = '';
      let p = u.pathname.replace(/\/(cpanel|index|api|login)(\.php)?$/i, '');
      p = p.replace(/\/api$/, '');
      p = p.replace(/\/+$/, '');
      u.pathname = p;
      return u.toString().replace(/\/+$/, '');
    } catch {
      return clean.replace(/\/+$/, '');
    }
  }

  // DOM Elements - Config
  const tabDealerModeBtn = document.getElementById('tabDealerModeBtn');
  const tabServerKeyBtn = document.getElementById('tabServerKeyBtn');
  const dealerAuthPanel = document.getElementById('dealerAuthPanel');
  const serverKeyAuthPanel = document.getElementById('serverKeyAuthPanel');
  const authModeNote = document.getElementById('authModeNote');

  const serverDomainInput = document.getElementById('serverDomainInput');
  const dealerUsernameInput = document.getElementById('dealerUsernameInput');
  const dealerPasswordInput = document.getElementById('dealerPasswordInput');
  const togglePasswordVisibilityBtn = document.getElementById('togglePasswordVisibilityBtn');

  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibilityBtn = document.getElementById('toggleKeyVisibilityBtn');
  const pacingSelect = document.getElementById('pacingSelect');
  const rememberCredsCheckbox = document.getElementById('rememberCredsCheckbox');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const testSpinner = document.getElementById('testSpinner');
  const testBtnText = document.getElementById('testBtnText');
  const testResultAlert = document.getElementById('testResultAlert');
  const connectionStatusBadge = document.getElementById('connectionStatusBadge');
  const connectionStatusText = document.getElementById('connectionStatusText');

  // DOM Elements - Ingestion
  const tabCsvBtn = document.getElementById('tabCsvBtn');
  const tabPasteBtn = document.getElementById('tabPasteBtn');
  const csvTab = document.getElementById('csvTab');
  const pasteTab = document.getElementById('pasteTab');
  const csvDropzone = document.getElementById('csvDropzone');
  const csvFileInput = document.getElementById('csvFileInput');
  const pasteTextarea = document.getElementById('pasteTextarea');
  const processPastedBtn = document.getElementById('processPastedBtn');
  const loadDemoBtn = document.getElementById('loadDemoBtn');
  const loadPdfDataBtn = document.getElementById('loadPdfDataBtn');

  // DOM Elements - Review & Validation
  const reviewSection = document.getElementById('reviewSection');
  const excelWarningBox = document.getElementById('excelWarningBox');
  const totalRowsCount = document.getElementById('totalRowsCount');
  const uniqueUsersCount = document.getElementById('uniqueUsersCount');
  const uniqueImeisCount = document.getElementById('uniqueImeisCount');
  const validationErrorsBox = document.getElementById('validationErrorsBox');
  const validationErrorsCount = document.getElementById('validationErrorsCount');
  const clearDataBtn = document.getElementById('clearDataBtn');
  const tableBody = document.getElementById('tableBody');

  // DOM Elements - Execution & Progress
  const startProvisioningBtn = document.getElementById('startProvisioningBtn');
  const pauseResumeBtn = document.getElementById('pauseResumeBtn');
  const stopBtn = document.getElementById('stopBtn');
  const retryFailedBtn = document.getElementById('retryFailedBtn');
  const failedRetryCount = document.getElementById('failedRetryCount');
  const progressWrapper = document.getElementById('progressWrapper');
  const progressStatusText = document.getElementById('progressStatusText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const countSuccess = document.getElementById('countSuccess');
  const countFailed = document.getElementById('countFailed');
  const countRemaining = document.getElementById('countRemaining');

  // DOM Elements - Terminal Log
  const logSection = document.getElementById('logSection');
  const terminalStream = document.getElementById('terminalStream');
  const autoscrollCheckbox = document.getElementById('autoscrollCheckbox');
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  // DOM Elements - Export
  const exportSection = document.getElementById('exportSection');
  const exportSummaryText = document.getElementById('exportSummaryText');
  const exportAllCsvBtn = document.getElementById('exportAllCsvBtn');
  const exportFailedCsvBtn = document.getElementById('exportFailedCsvBtn');

  // 1. Initial State & Stored Credentials
  initStoredSettings();

  function initStoredSettings() {
    const savedMode = localStorage.getItem('speedotrack_auth_mode');
    let savedDomain = localStorage.getItem('speedotrack_domain') || 'https://server.cartracker.com.ng/';
    const savedUser = localStorage.getItem('speedotrack_username') || 'cartrack';
    const savedPass = localStorage.getItem('speedotrack_password');
    const savedKey = localStorage.getItem('speedotrack_key');
    const savedPacing = localStorage.getItem('speedotrack_pacing');

    // Auto-clean domain
    savedDomain = normalizeServerUrl(savedDomain);
    serverDomainInput.value = savedDomain;
    dealerUsernameInput.value = savedUser;

    if (savedPass) dealerPasswordInput.value = savedPass;
    if (savedKey) apiKeyInput.value = savedKey;
    if (savedPacing) pacingSelect.value = savedPacing;

    if (savedMode === 'server_key') {
      switchAuthMode('server_key');
    } else {
      switchAuthMode('dealer');
    }

    log('info', `Loaded configuration for domain: ${savedDomain} (Auth: ${currentAuthMode === 'dealer' ? `Dealer (${savedUser})` : 'Server API Key'})`);
  }

  function saveSettings() {
    if (rememberCredsCheckbox.checked) {
      const cleanDomain = normalizeServerUrl(serverDomainInput.value);
      localStorage.setItem('speedotrack_auth_mode', currentAuthMode);
      localStorage.setItem('speedotrack_domain', cleanDomain);
      localStorage.setItem('speedotrack_username', dealerUsernameInput.value.trim());
      localStorage.setItem('speedotrack_password', dealerPasswordInput.value);
      localStorage.setItem('speedotrack_key', apiKeyInput.value.trim());
      localStorage.setItem('speedotrack_pacing', pacingSelect.value);
    } else {
      localStorage.removeItem('speedotrack_auth_mode');
      localStorage.removeItem('speedotrack_domain');
      localStorage.removeItem('speedotrack_username');
      localStorage.removeItem('speedotrack_password');
      localStorage.removeItem('speedotrack_key');
      localStorage.removeItem('speedotrack_pacing');
    }
  }

  // Auth Mode Switching
  tabDealerModeBtn.addEventListener('click', () => switchAuthMode('dealer'));
  tabServerKeyBtn.addEventListener('click', () => switchAuthMode('server_key'));

  function switchAuthMode(mode) {
    currentAuthMode = mode;
    if (mode === 'dealer') {
      tabDealerModeBtn.classList.add('active');
      tabServerKeyBtn.classList.remove('active');
      dealerAuthPanel.classList.remove('hidden');
      serverKeyAuthPanel.classList.add('hidden');
      testBtnText.textContent = '⚡ Test Dealer Connection';
      authModeNote.innerHTML = 'Recommended for <strong>Dealer-SM</strong> accounts like <code>cartrack</code>';
    } else {
      tabServerKeyBtn.classList.add('active');
      tabDealerModeBtn.classList.remove('active');
      serverKeyAuthPanel.classList.remove('hidden');
      dealerAuthPanel.classList.add('hidden');
      testBtnText.textContent = '⚡ Test Server Key';
      authModeNote.innerHTML = 'Requires <strong>Super Administrator</strong> Server API Key from Manage Server';
    }
    testResultAlert.classList.add('hidden');
  }

  // Auto-sanitize Server Domain on blur
  serverDomainInput.addEventListener('blur', () => {
    const raw = serverDomainInput.value.trim();
    if (!raw) return;
    const clean = normalizeServerUrl(raw);
    if (clean && clean !== raw) {
      serverDomainInput.value = clean;
      log('info', `Auto-sanitized Server Domain to clean base URL: ${clean}`);
    }
  });

  // Toggle Password visibility
  togglePasswordVisibilityBtn.addEventListener('click', () => {
    if (dealerPasswordInput.type === 'password') {
      dealerPasswordInput.type = 'text';
      togglePasswordVisibilityBtn.textContent = '🔒';
    } else {
      dealerPasswordInput.type = 'password';
      togglePasswordVisibilityBtn.textContent = '👁️';
    }
  });

  // Toggle API Key visibility
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = '👁️';
    }
  });

  function parseServerResponse(text, fallbackMessage = 'Unexpected response from server.') {
    if (!text || typeof text !== 'string') {
      throw new Error(fallbackMessage);
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype') || trimmed.toLowerCase().includes('<html')) {
      throw new Error('Speedotrack server returned an HTML webpage instead of an API response. Ensure Server Domain is set to the base URL (e.g. https://server.cartracker.com.ng/) and do not append /cpanel.php or page paths.');
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(fallbackMessage + ' (' + trimmed.slice(0, 80) + ')');
    }
  }

  // 2. Test Connection
  testConnectionBtn.addEventListener('click', async () => {
    let domain = serverDomainInput.value.trim();
    const cleanDomain = normalizeServerUrl(domain);
    if (cleanDomain !== domain) {
      serverDomainInput.value = cleanDomain;
      domain = cleanDomain;
    }

    if (!cleanDomain) {
      showAlert(testResultAlert, 'error', 'Please provide your Speedotrack Server Domain.');
      return;
    }

    saveSettings();
    setTestingState(true);

    if (currentAuthMode === 'dealer') {
      const username = dealerUsernameInput.value.trim();
      const password = dealerPasswordInput.value;

      if (!username || !password) {
        setTestingState(false);
        showAlert(testResultAlert, 'error', 'Please enter both your CPanel Dealer Username and Password.');
        return;
      }

      log('info', `Testing Dealer CPanel connection to ${cleanDomain} for user "${username}"...`);

      try {
        const res = await fetch('/api/dealer/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverDomain: cleanDomain, username, password })
        });

        const text = await res.text();
        const data = parseServerResponse(text, 'Could not parse response from server.');

        if (data.ok) {
          setConnectionStatus('connected', `Dealer: ${data.username}`);
          showAlert(testResultAlert, 'success', `✔ ${data.message}`);
          log('success', `✔ Dealer authenticated successfully! Role: ${data.privileges || 'Dealer-SM'}. Ready to bulk provision.`);
        } else {
          setConnectionStatus('error', 'Login Failed');
          showAlert(testResultAlert, 'error', `✖ Connection failed: ${data.error || 'Invalid credentials or server error'}`);
          log('error', `✖ Dealer connection failed: ${data.error || 'Login error'}`);
        }
      } catch (err) {
        setConnectionStatus('error', 'Network Error');
        showAlert(testResultAlert, 'error', `✖ Connection error: ${err.message}`);
        log('error', `✖ Connection error: ${err.message}`);
      } finally {
        setTestingState(false);
      }

    } else {
      // Server API Key mode
      const key = apiKeyInput.value.trim();
      if (!key) {
        setTestingState(false);
        showAlert(testResultAlert, 'error', 'Please provide your Super Administrator Server API Key.');
        return;
      }

      log('info', `Testing Server API Key connection to ${cleanDomain}...`);

      try {
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverDomain: cleanDomain, apiKey: key })
        });

        const text = await res.text();
        const data = parseServerResponse(text, 'Could not parse response from server.');

        if (data.ok) {
          setConnectionStatus('connected', 'Server Key Verified');
          showAlert(testResultAlert, 'success', `✔ ${data.message}`);
          log('success', `✔ Server authentication verified successfully.`);
        } else {
          setConnectionStatus('error', 'Key Rejected');
          showAlert(testResultAlert, 'error', `✖ Connection failed: ${data.error || 'Invalid API Key'}`);
          log('error', `✖ Server connection test failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        setConnectionStatus('error', 'Network Error');
        showAlert(testResultAlert, 'error', `✖ Connection error: ${err.message}`);
        log('error', `✖ Connection error: ${err.message}`);
      } finally {
        setTestingState(false);
      }
    }
  });

  function setTestingState(isTesting) {
    testConnectionBtn.disabled = isTesting;
    testSpinner.classList.toggle('hidden', !isTesting);
    testBtnText.textContent = isTesting ? 'Connecting...' : (currentAuthMode === 'dealer' ? '⚡ Test Dealer Connection' : '⚡ Test Server Key');
  }

  function setConnectionStatus(status, text) {
    connectionStatusBadge.className = `status-pill status-${status}`;
    connectionStatusText.textContent = text;
  }

  function showAlert(elem, type, message) {
    elem.className = `alert alert-${type}`;
    elem.textContent = message;
    elem.classList.remove('hidden');
  }

  // 3. Tab Switching for Ingestion
  tabCsvBtn.addEventListener('click', () => switchIngestionTab('csv'));
  tabPasteBtn.addEventListener('click', () => switchIngestionTab('paste'));

  function switchIngestionTab(mode) {
    if (mode === 'csv') {
      tabCsvBtn.classList.add('active');
      tabPasteBtn.classList.remove('active');
      csvTab.classList.add('active');
      pasteTab.classList.remove('active');
    } else {
      tabPasteBtn.classList.add('active');
      tabCsvBtn.classList.remove('active');
      pasteTab.classList.add('active');
      csvTab.classList.remove('active');
    }
  }

  // 4. File Dropzone
  csvDropzone.addEventListener('click', () => csvFileInput.click());
  csvDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvDropzone.classList.add('dragover');
  });
  csvDropzone.addEventListener('dragleave', () => csvDropzone.classList.remove('dragover'));
  csvDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    log('info', `Loading file: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    const reader = new FileReader();
    reader.onload = (e) => {
      parseAndLoadData(e.target.result, 'csv');
    };
    reader.readAsText(file);
  }

  // Process Pasted Data
  processPastedBtn.addEventListener('click', () => {
    const text = pasteTextarea.value.trim();
    if (!text) {
      alert('Please paste rows into the text area first.');
      return;
    }
    parseAndLoadData(text, 'paste');
  });

  // Load Demo Data
  loadDemoBtn.addEventListener('click', () => {
    const demoData = `email,send_credentials,imei,object_name,expire,expire_date
fleet.manager@transportco.com,true,868204051000001,Delivery Van 01,false,2027-12-31
fleet.manager@transportco.com,false,868204051000002,Delivery Van 02,false,2027-12-31
fleet.manager@transportco.com,false,868204051000003,Heavy Truck 01,false,2027-12-31
driver.john@example.com,true,868204052000001,Toyota Hilux - Lagos,false,2027-12-31
driver.mary@example.com,true,868204053000001,Ford Transit - Abuja,false,2027-12-31
logistics@globalhaulage.com,true,868204054000001,Volvo FH16 Semi-Truck,true,2026-12-31`;
    
    log('info', 'Loaded sample demo records.');
    parseAndLoadData(demoData, 'csv');
  });

  // Load Data from PDF (table-object-objects_20260910.pdf)
  if (loadPdfDataBtn) {
    loadPdfDataBtn.addEventListener('click', () => {
      fetch('pdf-test-data.csv')
        .then(r => r.text())
        .then(csvText => {
          log('info', 'Loaded 3 uncorrupted test objects from table-object-objects_20260910.pdf');
          parseAndLoadData(csvText, 'csv');
        })
        .catch(err => {
          log('error', `Failed to load PDF test data: ${err.message}`);
        });
    });
  }

  // 5. Data Parsing & Pre-Flight Validation Engine
  function normalizeDate(rawStr) {
    if (!rawStr) return '';
    let str = String(rawStr).trim();
    if (['never', 'none', 'lifetime', '0000-00-00', '-'].includes(str.toLowerCase())) return '';
    str = str.split(/[T\s]/)[0];

    // Check YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
    const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (ymdMatch) {
      return `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
    }

    // Check DD-MM-YYYY or MM-DD-YYYY or DD/MM/YYYY
    const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmyMatch) {
      const p1 = parseInt(dmyMatch[1], 10);
      const p2 = parseInt(dmyMatch[2], 10);
      const y = dmyMatch[3];
      let d, m;
      if (p1 > 12 && p2 <= 12) {
        d = String(p1).padStart(2, '0');
        m = String(p2).padStart(2, '0');
      } else if (p2 > 12 && p1 <= 12) {
        m = String(p1).padStart(2, '0');
        d = String(p2).padStart(2, '0');
      } else {
        // Standard international format (DD-MM-YYYY)
        d = String(p1).padStart(2, '0');
        m = String(p2).padStart(2, '0');
      }
      return `${y}-${m}-${d}`;
    }
    return str;
  }

  function parseAndLoadData(rawContent, format) {
    const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      alert('The provided content is empty.');
      return;
    }

    const isTabDelimited = lines[0].includes('\t');
    const delimiter = isTabDelimited ? '\t' : ',';

    let headers = parseLine(lines[0], delimiter).map(h => h.toLowerCase().trim().replace(/[\s_-]+/g, '_'));
    let startIdx = 1;

    const knownKeys = ['email', 'imei', 'object_name', 'send_credentials'];
    const hasHeader = headers.some(h => knownKeys.includes(h));

    if (!hasHeader) {
      headers = ['email', 'send_credentials', 'imei', 'object_name', 'expire', 'expire_date'];
      startIdx = 0;
    }

    const newRows = [];
    let detectedScientificCount = 0;

    for (let i = startIdx; i < lines.length; i++) {
      const tokens = parseLine(lines[i], delimiter);
      if (tokens.length < 2) continue;

      const record = {
        id: `row_${Date.now()}_${i}`,
        email: '',
        send_credentials: true,
        imei: '',
        rawImei: '',
        isScientific: false,
        object_name: '',
        plate_number: '',
        sim_number: '',
        hasExplicitExpire: false,
        rawExpire: '',
        expire: false,
        expire_date: '',
        status: 'pending',
        validationErrors: [],
        validationWarnings: [],
        responseMsg: '',
        steps: null
      };

      headers.forEach((h, colIdx) => {
        const val = tokens[colIdx] !== undefined ? tokens[colIdx].trim() : '';
        if (h.includes('email') || h === 'user') {
          record.email = val;
        } else if (h.includes('imei') || h === 'device') {
          record.rawImei = val;
          const isSci = /^[0-9.]+[eE][+]?[0-9]+$/.test(val) || /^\d+[eE]\d+$/i.test(val);
          if (isSci) {
            record.isScientific = true;
            record.imei = val;
            detectedScientificCount++;
          } else {
            record.imei = val.replace(/[^0-9]/g, '');
          }
        } else if (h.includes('plate') || h.includes('reg') || h.includes('license')) {
          record.plate_number = val;
        } else if (h.includes('sim') || h.includes('phone') || h.includes('mobile') || h.includes('msisdn')) {
          record.sim_number = val;
        } else if (h.includes('object') || h === 'name' || h === 'vehicle') {
          record.object_name = val;
        } else if (h.includes('send') || h.includes('cred') || h.includes('pass')) {
          record.send_credentials = val.toLowerCase() === 'true' || val === '1' || val === 'yes';
        } else if (h === 'expire' || h === 'expired') {
          record.hasExplicitExpire = true;
          record.rawExpire = val;
        } else if (h.includes('date') || h.includes('expiry') || h.includes('expire')) {
          record.expire_date = normalizeDate(val);
        }
      });

      // Auto-determine expiration if not explicitly specified:
      // If a date is provided (e.g. 2026-02-27), expiration is automatically active (true).
      // If date is blank, 'never', 'none', 'lifetime', or omitted, expiration is false (lifetime access).
      if (record.hasExplicitExpire) {
        record.expire = record.rawExpire.toLowerCase() === 'true' || record.rawExpire === '1' || record.rawExpire === 'yes';
      } else {
        const cleanDate = (record.expire_date || '').trim().toLowerCase();
        record.expire = Boolean(cleanDate && !['never', 'none', 'lifetime', '0000-00-00', '-'].includes(cleanDate));
      }
      if (!record.expire && !record.expire_date) {
        record.expire_date = '';
      }

      validateRow(record);
      newRows.push(record);
    }

    if (newRows.length === 0) {
      alert('Could not parse any valid rows from the input.');
      return;
    }

    parsedRows = newRows;
    renderTable();
    log('info', `Imported ${parsedRows.length} records. Review the validation grid before execution.`);

    if (detectedScientificCount > 0) {
      log('error', `⚠️ Excel scientific notation detected on ${detectedScientificCount} IMEI(s) (e.g. 359E14). These cannot be provisioned until fixed.`);
    }
  }

  function parseLine(line, delimiter) {
    if (delimiter === '\t') {
      return line.split('\t').map(v => v.trim());
    }
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  function validateRow(row) {
    row.validationErrors = [];
    row.validationWarnings = [];

    // Email check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!row.email) {
      row.validationErrors.push('Missing email address');
    } else if (!emailRegex.test(row.email)) {
      row.validationErrors.push('Invalid email structure');
    }

    // IMEI check
    if (!row.rawImei && !row.imei) {
      row.validationErrors.push('Missing device IMEI');
    } else if (row.isScientific || /^[0-9.]+[eE][+]?[0-9]+$/.test(row.rawImei) || /^\d+[eE]\d+$/i.test(row.rawImei)) {
      row.validationErrors.push(`Excel corrupted IMEI to "${row.rawImei}" (original 15 digits truncated)`);
    } else if (row.imei.length < 14 || row.imei.length > 16 || !/^\d+$/.test(row.imei)) {
      row.validationErrors.push(`IMEI is ${row.imei.length} digits (expected 15 digits)`);
    }

    // Object Name check (Compulsory)
    if (!row.object_name || !row.object_name.trim()) {
      row.validationErrors.push('Missing object / vehicle name (compulsory)');
    }

    // Date check (YYYY-MM-DD)
    if (row.expire_date && !['never', 'none', 'lifetime'].includes(row.expire_date.toLowerCase())) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.expire_date)) {
        row.validationWarnings.push('Invalid date format (YYYY-MM-DD expected, e.g. 2027-12-31)');
      }
    }
  }

  // 6. Table Renderer
  function renderTable() {
    if (parsedRows.length === 0) {
      reviewSection.classList.add('hidden');
      logSection.classList.add('hidden');
      exportSection.classList.add('hidden');
      if (excelWarningBox) excelWarningBox.classList.add('hidden');
      return;
    }

    reviewSection.classList.remove('hidden');
    logSection.classList.remove('hidden');

    const hasScientific = parsedRows.some(r => r.isScientific);
    if (excelWarningBox) {
      excelWarningBox.classList.toggle('hidden', !hasScientific);
    }

    const uniqueUsers = new Set(parsedRows.map(r => r.email)).size;
    const uniqueImeis = new Set(parsedRows.map(r => r.imei)).size;
    const totalErrors = parsedRows.reduce((acc, r) => acc + (r.validationErrors ? r.validationErrors.length : 0), 0);
    const totalWarnings = parsedRows.reduce((acc, r) => acc + (r.validationWarnings ? r.validationWarnings.length : 0), 0);

    totalRowsCount.textContent = parsedRows.length;
    uniqueUsersCount.textContent = uniqueUsers;
    uniqueImeisCount.textContent = uniqueImeis;

    const totalIssues = totalErrors + totalWarnings;
    if (totalIssues > 0) {
      validationErrorsCount.textContent = `${totalErrors} error(s), ${totalWarnings} warning(s)`;
      validationErrorsBox.classList.remove('hidden');
    } else {
      validationErrorsBox.classList.add('hidden');
    }

    tableBody.innerHTML = '';
    parsedRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.id = `tr_${row.id}`;

      const statusBadge = getStatusBadgeHtml(row.status);

      const imeiErrors = (row.validationErrors || []).filter(e => e.toLowerCase().includes('imei') || e.toLowerCase().includes('corrupt') || e.toLowerCase().includes('digit')).map(e => `<span class="val-error-text">✖ ${escapeHtml(e)}</span>`).join('');
      const imeiWarnings = (row.validationWarnings || []).filter(w => w.toLowerCase().includes('imei')).map(w => `<span class="val-warning-text">⚠️ ${escapeHtml(w)}</span>`).join('');

      const emailErrors = (row.validationErrors || []).filter(e => e.toLowerCase().includes('email')).map(e => `<span class="val-error-text">✖ ${escapeHtml(e)}</span>`).join('');
      const objectErrors = (row.validationErrors || []).filter(e => e.toLowerCase().includes('object')).map(e => `<span class="val-error-text">✖ ${escapeHtml(e)}</span>`).join('');
      const dateWarnings = (row.validationWarnings || []).filter(w => w.toLowerCase().includes('date')).map(w => `<span class="val-warning-text">⚠️ ${escapeHtml(w)}</span>`).join('');

      let expireDisplay = '<span style="color: var(--text-dim); font-style: italic;">No Expiry (Lifetime)</span>';
      if (row.expire_date && !['never', 'none', 'lifetime'].includes(row.expire_date.toLowerCase())) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const isPast = row.expire_date < todayStr;
        if (isPast) {
          expireDisplay = `<span style="color: #f87171; font-weight: 500;" title="Date has elapsed: Server automatically treats tracker as expired">${escapeHtml(row.expire_date)} <span style="font-size: 0.68rem; background: rgba(239, 68, 68, 0.25); border: 1px solid rgba(239,68,68,0.5); padding: 1px 4px; border-radius: 3px; margin-left: 4px; color: #fca5a5;">Elapsed</span></span>`;
        } else {
          expireDisplay = `<span style="color: #4ade80;" title="Active until ${escapeHtml(row.expire_date)}">${escapeHtml(row.expire_date)}</span>`;
        }
      }

      tr.innerHTML = `
        <td style="color: var(--text-dim);">${idx + 1}</td>
        <td>${statusBadge}</td>
        <td>
          <strong>${escapeHtml(row.email)}</strong>
          ${emailErrors}
        </td>
        <td>
          <span style="font-size: 0.78rem; color: ${row.send_credentials ? 'var(--success)' : 'var(--text-dim)'};">
            ${row.send_credentials ? '✔ Yes' : '✖ No'}
          </span>
        </td>
        <td class="mono-cell">
          ${escapeHtml(row.rawImei || row.imei)}
          ${imeiErrors}
          ${imeiWarnings}
        </td>
        <td>
          <strong>${escapeHtml(row.object_name || '—')}</strong>
          ${objectErrors}
        </td>
        <td class="mono-cell" style="font-size: 0.8rem; color: #a5f3fc;">${escapeHtml(row.plate_number || '—')}</td>
        <td class="mono-cell" style="font-size: 0.8rem; color: #cbd5e1;">${escapeHtml(row.sim_number || '—')}</td>
        <td class="mono-cell" style="font-size: 0.78rem;">
          ${expireDisplay}
          ${dateWarnings}
        </td>
        <td id="msg_${row.id}" style="font-size: 0.82rem; color: var(--text-muted);">
          ${escapeHtml(row.responseMsg || (row.validationErrors?.length ? 'Fix errors to proceed' : 'Ready'))}
        </td>
        <td>
          <button class="btn-remove-row" data-id="${row.id}" title="Remove record">✕</button>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    document.querySelectorAll('.btn-remove-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (isExecuting) return;
        const id = e.currentTarget.getAttribute('data-id');
        parsedRows = parsedRows.filter(r => r.id !== id);
        renderTable();
      });
    });

    updateProgressUI();
  }

  function getStatusBadgeHtml(status) {
    switch (status) {
      case 'processing':
        return '<span class="badge-row-status badge-processing">Running</span>';
      case 'success':
        return '<span class="badge-row-status badge-success">✔ Done</span>';
      case 'error':
        return '<span class="badge-row-status badge-error">✖ Failed</span>';
      default:
        return '<span class="badge-row-status badge-pending">Pending</span>';
    }
  }

  clearDataBtn.addEventListener('click', () => {
    if (isExecuting) {
      alert('Cannot clear while provisioning is in progress.');
      return;
    }
    if (confirm('Clear all loaded data?')) {
      parsedRows = [];
      renderTable();
      log('info', 'Cleared all table data.');
    }
  });

  // 7. Bulk Provisioning Engine
  startProvisioningBtn.addEventListener('click', () => {
    const errorRows = parsedRows.filter(r => r.validationErrors && r.validationErrors.length > 0);
    if (errorRows.length > 0) {
      alert(`Cannot start provisioning: ${errorRows.length} record(s) have critical validation errors (such as corrupted scientific notation IMEIs from Excel or invalid emails).\n\nPlease correct these records before proceeding.`);
      return;
    }
    executeBatch(parsedRows.filter(r => r.status !== 'success'));
  });

  retryFailedBtn.addEventListener('click', () => {
    executeBatch(parsedRows.filter(r => r.status === 'error'));
  });

  pauseResumeBtn.addEventListener('click', () => {
    if (isPaused) {
      isPaused = false;
      pauseResumeBtn.textContent = '⏸️ Pause';
      log('info', '▶️ Resumed provisioning execution.');
    } else {
      isPaused = true;
      pauseResumeBtn.textContent = '▶️ Resume';
      log('warn', '⏸️ Provisioning paused by user.');
    }
  });

  stopBtn.addEventListener('click', () => {
    if (confirm('Cancel the current provisioning batch?')) {
      shouldStop = true;
      log('warn', '⏹️ Cancellation requested. Stopping after current request...');
    }
  });

  async function executeBatch(targetRows) {
    const rawDomain = serverDomainInput.value.trim();
    const cleanDomain = normalizeServerUrl(rawDomain);

    if (!cleanDomain) {
      alert('Please fill in your Server Domain in Step 1 first.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (cleanDomain !== rawDomain) {
      serverDomainInput.value = cleanDomain;
    }

    // Validate mode credentials
    if (currentAuthMode === 'dealer') {
      const username = dealerUsernameInput.value.trim();
      const password = dealerPasswordInput.value;
      if (!username || !password) {
        alert('Please fill in your CPanel Dealer Username and Password in Step 1 first.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    } else {
      const key = apiKeyInput.value.trim();
      if (!key) {
        alert('Please fill in your Server API Key in Step 1 first.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    if (targetRows.length === 0) {
      alert('No rows to provision.');
      return;
    }

    saveSettings();

    isExecuting = true;
    isPaused = false;
    shouldStop = false;

    setControlsForExecution(true);
    log('info', `🚀 Starting bulk provisioning of ${targetRows.length} records via [${currentAuthMode === 'dealer' ? `Dealer CPanel: ${dealerUsernameInput.value.trim()}` : 'Super Admin Server API'}]...`);

    const pacingDelay = parseInt(pacingSelect.value, 10) || 250;

    for (let i = 0; i < targetRows.length; i++) {
      if (shouldStop) break;

      while (isPaused && !shouldStop) {
        await sleep(300);
      }

      if (shouldStop) break;

      const row = targetRows[i];

      if (row.validationErrors && row.validationErrors.length > 0) {
        row.status = 'error';
        row.responseMsg = `Validation failed: ${row.validationErrors.join('; ')}`;
        updateRowInTable(row, row.responseMsg);
        log('error', `  ✖ [Skipped] Row ${i + 1}: ${row.responseMsg}`);
        continue;
      }

      row.status = 'processing';
      updateRowInTable(row, 'Executing provisioning steps...');

      const details = [row.object_name, row.plate_number ? `Plate: ${row.plate_number}` : null, row.sim_number ? `SIM: ${row.sim_number}` : null].filter(Boolean).join(' | ');
      log('info', `[${i + 1}/${targetRows.length}] Processing: ${row.email} -> ${row.imei} (${details})`);

      try {
        const response = await fetch('/api/provision-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authMode: currentAuthMode,
            serverDomain: cleanDomain,
            username: dealerUsernameInput.value.trim(),
            password: dealerPasswordInput.value,
            apiKey: apiKeyInput.value.trim(),
            row: {
              email: row.email,
              send_credentials: row.send_credentials,
              imei: row.imei,
              object_name: row.object_name,
              plate_number: row.plate_number,
              sim_number: row.sim_number,
              expire: row.expire,
              expire_date: row.expire_date
            }
          })
        });
        const text = await response.text();
        const data = parseServerResponse(text, 'Server returned an unreadable response.');
        row.steps = data.steps;

        if (data.ok) {
          row.status = 'success';
          row.responseMsg = data.summary || 'Completed successfully.';
          updateRowInTable(row, row.responseMsg);
          log('success', `  ✔ ${row.email} | ${row.imei} : ${row.responseMsg}`);
        } else {
          row.status = 'error';
          row.responseMsg = data.summary || data.error || 'Provisioning failed';
          updateRowInTable(row, row.responseMsg);
          log('error', `  ✖ ${row.email} | ${row.imei} : ${row.responseMsg}`);
        }
      } catch (err) {
        row.status = 'error';
        row.responseMsg = `Network / server error: ${err.message}`;
        updateRowInTable(row, row.responseMsg);
        log('error', `  ✖ Failed request: ${err.message}`);
      }

      updateProgressUI();

      if (i < targetRows.length - 1 && pacingDelay > 0) {
        await sleep(pacingDelay);
      }
    }

    isExecuting = false;
    setControlsForExecution(false);
    updateProgressUI();

    const failedCount = parsedRows.filter(r => r.status === 'error').length;
    const successCount = parsedRows.filter(r => r.status === 'success').length;

    log('info', `🏁 Batch completed. Success: ${successCount}, Failed: ${failedCount}.`);
    
    exportSection.classList.remove('hidden');
    exportSummaryText.textContent = `Completed batch. ${successCount} successful, ${failedCount} failed out of ${parsedRows.length} total records.`;
    
    if (failedCount > 0) {
      exportFailedCsvBtn.classList.remove('hidden');
      retryFailedBtn.classList.remove('hidden');
      failedRetryCount.textContent = failedCount;
    } else {
      exportFailedCsvBtn.classList.add('hidden');
      retryFailedBtn.classList.add('hidden');
    }
  }

  function updateRowInTable(row, message) {
    const tr = document.getElementById(`tr_${row.id}`);
    const msgCell = document.getElementById(`msg_${row.id}`);
    if (tr) {
      const statusTd = tr.querySelector('td:nth-child(2)');
      if (statusTd) statusTd.innerHTML = getStatusBadgeHtml(row.status);
    }
    if (msgCell) {
      msgCell.textContent = message;
      if (row.status === 'success') {
        msgCell.style.color = 'var(--success)';
      } else if (row.status === 'error') {
        msgCell.style.color = 'var(--danger)';
      } else {
        msgCell.style.color = 'var(--text-muted)';
      }
    }
  }

  function updateProgressUI() {
    const total = parsedRows.length;
    if (total === 0) return;

    const completed = parsedRows.filter(r => r.status === 'success' || r.status === 'error').length;
    const successes = parsedRows.filter(r => r.status === 'success').length;
    const fails = parsedRows.filter(r => r.status === 'error').length;
    const remaining = total - completed;

    const percent = Math.round((completed / total) * 100);

    progressPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
    countSuccess.textContent = successes;
    countFailed.textContent = fails;
    countRemaining.textContent = remaining;

    if (isExecuting) {
      progressStatusText.textContent = `Provisioning record ${completed + 1} of ${total}...`;
    } else if (completed === total) {
      progressStatusText.textContent = 'All records processed!';
    }
  }

  function setControlsForExecution(running) {
    startProvisioningBtn.classList.toggle('hidden', running);
    pauseResumeBtn.classList.toggle('hidden', !running);
    stopBtn.classList.toggle('hidden', !running);
    progressWrapper.classList.remove('hidden');
    testConnectionBtn.disabled = running;
    clearDataBtn.disabled = running;
  }

  // 8. Terminal Logging
  function log(type, text) {
    const time = new Date().toLocaleTimeString();
    const entry = { time, type, text };
    logHistory.push(entry);

    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.textContent = `[${time}] ${text}`;
    terminalStream.appendChild(line);

    if (autoscrollCheckbox.checked) {
      terminalStream.scrollTop = terminalStream.scrollHeight;
    }
  }

  copyLogsBtn.addEventListener('click', () => {
    const rawText = logHistory.map(e => `[${e.time}] [${e.type.toUpperCase()}] ${e.text}`).join('\n');
    navigator.clipboard.writeText(rawText).then(() => {
      alert('Logs copied to clipboard!');
    });
  });

  clearLogsBtn.addEventListener('click', () => {
    terminalStream.innerHTML = '';
    logHistory = [];
  });

  // 9. Export to CSV
  exportAllCsvBtn.addEventListener('click', () => exportResultsToCSV(parsedRows, 'speedotrack_provisioning_report.csv'));
  exportFailedCsvBtn.addEventListener('click', () => exportResultsToCSV(parsedRows.filter(r => r.status === 'error'), 'speedotrack_failed_rows.csv'));

  function exportResultsToCSV(rows, filename) {
    const headers = ['Email', 'Send_Credentials', 'IMEI', 'Object_Name', 'Plate_Number', 'SIM_Number', 'Expire_Date', 'Status', 'User_Step', 'Object_Step', 'Assign_Step', 'Server_Message'];
    const csvLines = [headers.join(',')];

    rows.forEach(r => {
      const userStep = r.steps?.user ? `${r.steps.user.action} (${r.steps.user.status})` : 'N/A';
      const objStep = r.steps?.object ? `${r.steps.object.action} (${r.steps.object.status})` : 'N/A';
      const assignStep = r.steps?.assign ? `${r.steps.assign.action} (${r.steps.assign.status})` : 'N/A';

      const line = [
        csvEscape(r.email),
        r.send_credentials,
        csvEscape(r.imei),
        csvEscape(r.object_name),
        csvEscape(r.plate_number || ''),
        csvEscape(r.sim_number || ''),
        csvEscape(r.expire_date || 'Lifetime'),
        r.status,
        csvEscape(userStep),
        csvEscape(objStep),
        csvEscape(assignStep),
        csvEscape(r.responseMsg)
      ];
      csvLines.push(line.join(','));
    });

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function csvEscape(val) {
    const str = String(val || '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // ==========================================================================
  // CAR TRACKER NIGERIA (GPSWOX) -> SPEEDOTRACK LIVE MIGRATION CLIENT SUITE
  // ==========================================================================

  let ctUserApiHash = '';
  let migVehicles = [];
  let migFilter = 'all';
  let isMigrating = false;
  let isMigPaused = false;
  let shouldStopMig = false;
  let migLogHistory = [];

  // DOM Elements - Mode Navigation
  const modeProvisionBtn = document.getElementById('modeProvisionBtn');
  const modeMigrateBtn = document.getElementById('modeMigrateBtn');
  const modeRepointBtn = document.getElementById('modeRepointBtn');
  const provisionerView = document.getElementById('provisionerView');
  const migrationView = document.getElementById('migrationView');
  const repointView = document.getElementById('repointView');

  function switchTopTab(tabName) {
    if (modeProvisionBtn) modeProvisionBtn.classList.toggle('active', tabName === 'provision');
    if (modeMigrateBtn) modeMigrateBtn.classList.toggle('active', tabName === 'migrate');
    if (modeRepointBtn) modeRepointBtn.classList.toggle('active', tabName === 'repoint');

    if (provisionerView) provisionerView.classList.toggle('hidden', tabName !== 'provision');
    if (migrationView) migrationView.classList.toggle('hidden', tabName !== 'migrate');
    if (repointView) repointView.classList.toggle('hidden', tabName !== 'repoint');
  }

  if (modeProvisionBtn) modeProvisionBtn.addEventListener('click', () => switchTopTab('provision'));
  if (modeMigrateBtn) modeMigrateBtn.addEventListener('click', () => switchTopTab('migrate'));
  if (modeRepointBtn) modeRepointBtn.addEventListener('click', () => switchTopTab('repoint'));

  const goToRepointBtn = document.getElementById('goToRepointBtn');
  if (goToRepointBtn) {
    goToRepointBtn.addEventListener('click', () => {
      const clientEmail = (speedoClientEmailInput && speedoClientEmailInput.value.trim()) ||
                          (ctEmailInput && ctEmailInput.value.trim()) || '';
      if (clientEmail && repointClientEmailInput) {
        repointClientEmailInput.value = clientEmail;
      }
      switchTopTab('repoint');
      if (clientEmail && repointLoadFleetBtn) {
        repointLoadFleetBtn.click();
      }
    });
  }

  // DOM Elements - Migration Config
  const ctServerUrlInput = document.getElementById('ctServerUrlInput');
  const ctEmailInput = document.getElementById('ctEmailInput');
  const ctPasswordInput = document.getElementById('ctPasswordInput');
  const ctApiHashInput = document.getElementById('ctApiHashInput');
  const toggleCtPasswordBtn = document.getElementById('toggleCtPasswordBtn');
  const ctConnectBtn = document.getElementById('ctConnectBtn');
  const ctConnectSpinner = document.getElementById('ctConnectSpinner');
  const ctConnectBtnText = document.getElementById('ctConnectBtnText');
  const ctStatusBadge = document.getElementById('ctStatusBadge');
  const ctStatusText = document.getElementById('ctStatusText');
  const ctAlertBox = document.getElementById('ctAlertBox');

  const repointIpInput = document.getElementById('repointIpInput');
  const repointPortInput = document.getElementById('repointPortInput');
  const repointCommandInput = document.getElementById('repointCommandInput');
  const resetCommandBtn = document.getElementById('resetCommandBtn');
  const channelSelect = document.getElementById('channelSelect');

  // DOM Elements - Speedotrack Dealer Destination
  const speedoMigDomainInput = document.getElementById('speedoMigDomainInput');
  const speedoMigUsernameInput = document.getElementById('speedoMigUsernameInput');
  const speedoMigPasswordInput = document.getElementById('speedoMigPasswordInput');
  const toggleSpeedoMigPasswordBtn = document.getElementById('toggleSpeedoMigPasswordBtn');
  const speedoMigConnectBtn = document.getElementById('speedoMigConnectBtn');
  const speedoMigSpinner = document.getElementById('speedoMigSpinner');
  const speedoMigBtnText = document.getElementById('speedoMigBtnText');
  const speedoMigStatusBadge = document.getElementById('speedoMigStatusBadge');
  const speedoMigStatusText = document.getElementById('speedoMigStatusText');
  const speedoClientEmailInput = document.getElementById('speedoClientEmailInput');
  const speedoClientDefaultPassInput = document.getElementById('speedoClientDefaultPassInput');

  // Load saved Speedotrack credentials if available
  const savedSpeedoUser = localStorage.getItem('speedotrack_dealer_username');
  const savedSpeedoPass = localStorage.getItem('speedotrack_dealer_password');
  if (savedSpeedoUser && speedoMigUsernameInput) speedoMigUsernameInput.value = savedSpeedoUser;
  if (savedSpeedoPass && speedoMigPasswordInput) speedoMigPasswordInput.value = savedSpeedoPass;

  if (toggleSpeedoMigPasswordBtn && speedoMigPasswordInput) {
    toggleSpeedoMigPasswordBtn.addEventListener('click', () => {
      speedoMigPasswordInput.type = speedoMigPasswordInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Speedotrack Dealer Test Connection
  if (speedoMigConnectBtn) {
    speedoMigConnectBtn.addEventListener('click', async () => {
      const domain = (speedoMigDomainInput.value || 'https://server.cartracker.com.ng/').trim();
      const username = (speedoMigUsernameInput.value || '').trim();
      const password = speedoMigPasswordInput.value || '';

      if (!username || !password) {
        alert('Please enter your Speedotrack Dealer username and password.');
        return;
      }

      speedoMigConnectBtn.disabled = true;
      speedoMigSpinner.classList.remove('hidden');
      speedoMigBtnText.textContent = 'Verifying...';

      try {
        const res = await fetch('/api/verify-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverDomain: domain,
            authMode: 'dealer',
            username,
            password
          })
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Login failed.');

        speedoMigStatusBadge.className = 'status-pill status-ready';
        speedoMigStatusText.textContent = `Connected (${username})`;
        localStorage.setItem('speedotrack_dealer_username', username);
        localStorage.setItem('speedotrack_dealer_password', password);
        logMig('success', `Speedotrack Dealer connection verified: ${username} (Privileges: ${data.session?.privileges || 'Dealer'})`);
      } catch (err) {
        speedoMigStatusBadge.className = 'status-pill status-error';
        speedoMigStatusText.textContent = 'Login Failed';
        logMig('error', `Speedotrack Dealer login failed: ${err.message}`);
        alert(`Speedotrack Dealer login failed: ${err.message}`);
      } finally {
        speedoMigConnectBtn.disabled = false;
        speedoMigSpinner.classList.add('hidden');
        speedoMigBtnText.textContent = '⚡ Test Speedotrack Dealer Login';
      }
    });
  }

  // DOM Elements - Fleet Table & Toolbar
  const migrationFleetSection = document.getElementById('migrationFleetSection');
  const migFleetTotal = document.getElementById('migFleetTotal');
  const migFleetOnline = document.getElementById('migFleetOnline');
  const migFleetOffline = document.getElementById('migFleetOffline');
  const migSelectedCount = document.getElementById('migSelectedCount');
  const btnMigCount = document.getElementById('btnMigCount');
  const btnRepointCount = document.getElementById('btnRepointCount');

  const migSearchInput = document.getElementById('migSearchInput');
  const filterAllBtn = document.getElementById('filterAllBtn');
  const filterOnlineBtn = document.getElementById('filterOnlineBtn');
  const filterOfflineBtn = document.getElementById('filterOfflineBtn');

  const selectPilotBtn = document.getElementById('selectPilotBtn');
  const selectBatch5Btn = document.getElementById('selectBatch5Btn');
  const selectBatch10Btn = document.getElementById('selectBatch10Btn');
  const selectAllMigBtn = document.getElementById('selectAllMigBtn');
  const deselectAllMigBtn = document.getElementById('deselectAllMigBtn');

  const migMasterCheckbox = document.getElementById('migMasterCheckbox');
  const migTableBody = document.getElementById('migTableBody');

  // DOM Elements - Execution
  const btnMigrateAccountAndHistory = document.getElementById('btnMigrateAccountAndHistory');
  const btnRepointVehiclesOnly = document.getElementById('btnRepointVehiclesOnly');
  const startPilotMigrateBtn = document.getElementById('startPilotMigrateBtn');
  const pauseMigrateBtn = document.getElementById('pauseMigrateBtn');
  const stopMigrateBtn = document.getElementById('stopMigrateBtn');

  const migProgressWrapper = document.getElementById('migProgressWrapper');
  const migProgressTitle = document.getElementById('migProgressTitle');
  const migProgressPercent = document.getElementById('migProgressPercent');
  const migProgressBarFill = document.getElementById('migProgressBarFill');
  const migVehiclesDone = document.getElementById('migVehiclesDone');
  const migVehiclesTotal = document.getElementById('migVehiclesTotal');
  const migPointsReplayed = document.getElementById('migPointsReplayed');
  const migCommandsSent = document.getElementById('migCommandsSent');

  const migTerminalSection = document.getElementById('migTerminalSection');
  const migTerminalOutput = document.getElementById('migTerminalOutput');
  const clearMigTerminalBtn = document.getElementById('clearMigTerminalBtn');
  const downloadMigLogBtn = document.getElementById('downloadMigLogBtn');

  // Password visibility
  if (toggleCtPasswordBtn && ctPasswordInput) {
    toggleCtPasswordBtn.addEventListener('click', () => {
      ctPasswordInput.type = ctPasswordInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Dynamic Command Generation
  function updateRepointCommand() {
    const ip = (repointIpInput.value || '103.143.148.122').trim();
    const port = (repointPortInput.value || '10202').trim();
    const cmd = `SERVER,0,${ip},${port},0#`;
    repointCommandInput.value = cmd;
    if (cmdPreviewCode) cmdPreviewCode.textContent = cmd;
  }

  if (repointIpInput && repointPortInput) {
    repointIpInput.addEventListener('input', updateRepointCommand);
    repointPortInput.addEventListener('input', updateRepointCommand);
  }

  if (resetCommandBtn) {
    resetCommandBtn.addEventListener('click', () => {
      repointIpInput.value = '103.143.148.122';
      repointPortInput.value = '10202';
      updateRepointCommand();
      logMig('info', 'Reset activation command to tested Concox/GT06 default: SERVER,0,103.143.148.122,10202,0#');
    });
  }

  if (repointCommandInput && cmdPreviewCode) {
    repointCommandInput.addEventListener('input', () => {
      cmdPreviewCode.textContent = repointCommandInput.value;
    });
  }

  // 1. Connect to Car Tracker Nigeria
  if (ctConnectBtn) {
    ctConnectBtn.addEventListener('click', async () => {
      const cartrackerUrl = (ctServerUrlInput.value || 'https://cartracker.com.ng').trim();
      const email = (ctEmailInput.value || '').trim();
      const password = ctPasswordInput.value || '';
      const userApiHash = (ctApiHashInput.value || '').trim();

      if (!userApiHash && (!email || !password)) {
        showCtAlert('Please enter your Car Tracker Nigeria email & password, or your user_api_hash.', 'error');
        return;
      }

      setCtConnecting(true);
      showCtAlert('', 'hidden');
      logMig('info', `Connecting to Car Tracker Nigeria at ${cartrackerUrl}...`);

      try {
        const res = await fetch('/api/migration/cartracker/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cartrackerUrl, email, password, userApiHash })
        });

        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.error || 'Login failed.');
        }

        ctUserApiHash = data.userApiHash;
        ctApiHashInput.value = ctUserApiHash;

        ctStatusBadge.className = 'status-pill status-ready';
        ctStatusText.textContent = 'Connected (Active)';
        showCtAlert(`Successfully authenticated with Car Tracker Nigeria! Loading vehicle fleet...`, 'success');
        logMig('success', `Car Tracker Nigeria connected successfully. User API Hash: ${ctUserApiHash.substring(0, 15)}...`);

        // Automatically load fleet
        await loadCarTrackerFleet();

      } catch (err) {
        ctStatusBadge.className = 'status-pill status-error';
        ctStatusText.textContent = 'Connection Failed';
        showCtAlert(`Authentication failed: ${err.message}`, 'error');
        logMig('error', `Car Tracker Nigeria connection failed: ${err.message}`);
      } finally {
        setCtConnecting(false);
      }
    });
  }

  function setCtConnecting(connecting) {
    if (connecting) {
      ctConnectBtn.disabled = true;
      ctConnectSpinner.classList.remove('hidden');
      ctConnectBtnText.textContent = 'Connecting...';
    } else {
      ctConnectBtn.disabled = false;
      ctConnectSpinner.classList.add('hidden');
      ctConnectBtnText.textContent = '⚡ Connect & Fetch Live Fleet';
    }
  }

  function showCtAlert(msg, type) {
    if (type === 'hidden') {
      ctAlertBox.classList.add('hidden');
      ctAlertBox.textContent = '';
      return;
    }
    ctAlertBox.className = `alert alert-${type}`;
    ctAlertBox.textContent = msg;
    ctAlertBox.classList.remove('hidden');
  }

  // 2. Load Fleet from Car Tracker Nigeria
  async function loadCarTrackerFleet() {
    const cartrackerUrl = (ctServerUrlInput.value || 'https://cartracker.com.ng').trim();

    logMig('info', 'Fetching registered vehicle fleet from Car Tracker Nigeria...');
    try {
      const res = await fetch('/api/migration/cartracker/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cartrackerUrl, userApiHash: ctUserApiHash })
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Failed to fetch vehicles.');
      }

      migVehicles = (data.devices || []).map(d => ({
        ...d,
        selected: false,
        state: 'pending',
        stateMsg: 'Ready'
      }));

      if (data.accountExpiration) {
        const batchMigExpireDateInput = document.getElementById('batchMigExpireDateInput');
        if (batchMigExpireDateInput && !batchMigExpireDateInput.value) {
          batchMigExpireDateInput.value = data.accountExpiration;
        }
        const accountExpNotice = document.getElementById('accountExpNotice');
        if (accountExpNotice) {
          accountExpNotice.innerHTML = `📅 Car Tracker Subscription: <strong style="color: #10b981;">${escapeHtml(data.accountExpiration)}</strong> (applied to fleet)`;
        }
        logMig('info', `Car Tracker Nigeria subscription expiration: ${data.accountExpiration}`);
      }

      const withExp = migVehicles.filter(v => v.expire && v.expireDate).length;
      logMig('info', `Fleet Expiration: ${withExp} vehicles with active expiry dates, ${migVehicles.length - withExp} unlimited.`);

      const onlineCount = migVehicles.filter(v => v.online === 'online').length;
      const ackCount = migVehicles.filter(v => v.online === 'ack').length;
      const gprsReadyCount = onlineCount + ackCount;
      const offlineCount = migVehicles.length - gprsReadyCount;

      migFleetTotal.textContent = migVehicles.length;
      migFleetOnline.textContent = onlineCount;
      const migFleetAck = document.getElementById('migFleetAck');
      if (migFleetAck) migFleetAck.textContent = ackCount;
      migFleetOffline.textContent = offlineCount;

      const cAll = document.getElementById('countFilterAll');
      const cGprs = document.getElementById('countFilterGprsReady');
      const cOnline = document.getElementById('countFilterOnline');
      const cAck = document.getElementById('countFilterAck');
      const cOffline = document.getElementById('countFilterOffline');

      if (cAll) cAll.textContent = migVehicles.length;
      if (cGprs) cGprs.textContent = gprsReadyCount;
      if (cOnline) cOnline.textContent = onlineCount;
      if (cAck) cAck.textContent = ackCount;
      if (cOffline) cOffline.textContent = offlineCount;

      logMig('success', `Loaded ${migVehicles.length} total vehicles (${onlineCount} moving, ${ackCount} standby/ack, ${offlineCount} offline). ${gprsReadyCount} are GPRS ready!`);

      migrationFleetSection.classList.remove('hidden');
      migTerminalSection.classList.remove('hidden');

      renderMigTable();
      updateSelectedCounts();

    } catch (err) {
      logMig('error', `Failed to load fleet: ${err.message}`);
      showCtAlert(`Error loading vehicles: ${err.message}`, 'error');
    }
  }

  // 3. Render Fleet Table
  function renderMigTable() {
    const query = (migSearchInput.value || '').toLowerCase().trim();
    migTableBody.innerHTML = '';

    const filtered = migVehicles.filter(v => {
      if (migFilter === 'gprs_ready' && v.online !== 'online' && v.online !== 'ack') return false;
      if (migFilter === 'online' && v.online !== 'online') return false;
      if (migFilter === 'ack' && v.online !== 'ack') return false;
      if (migFilter === 'offline' && (v.online === 'online' || v.online === 'ack')) return false;
      if (!query) return true;

      return (
        v.name.toLowerCase().includes(query) ||
        v.imei.includes(query) ||
        v.plateNumber.toLowerCase().includes(query) ||
        v.simNumber.includes(query) ||
        v.protocol.toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="10" style="text-align: center; padding: 24px; color: var(--text-dim);">No vehicles found matching current filter.</td>`;
      migTableBody.appendChild(tr);
      return;
    }

    filtered.forEach((v, index) => {
      const tr = document.createElement('tr');
      tr.id = `migRow_${v.imei}`;

      let onlineBadge = '';
      if (v.online === 'online') {
        onlineBadge = `<span class="online-dot is-online"></span><span style="color: var(--success); font-weight: 500;">Moving</span>`;
      } else if (v.online === 'ack') {
        onlineBadge = `<span class="online-dot" style="background: #38bdf8; box-shadow: 0 0 6px #38bdf8;"></span><span style="color: #38bdf8; font-weight: 500;" title="Standby / Ignition off (Socket open - GPRS ready)">Standby (Ack)</span>`;
      } else {
        onlineBadge = `<span class="online-dot is-offline"></span><span style="color: var(--text-dim);">Offline</span>`;
      }

      let stateClass = 'state-pending';
      if (v.state === 'migrating') stateClass = 'state-migrating';
      if (v.state === 'success') stateClass = 'state-success';
      if (v.state === 'error') stateClass = 'state-error';

      const isExpActive = Boolean(v.expire && v.expireDate);
      const dateVal = v.expireDate || '';
      const expireCellHtml = `
        <div style="display: flex; align-items: center; gap: 4px;">
          <input type="date" class="mig-date-input" data-imei="${v.imei}" value="${escapeHtml(dateVal)}" style="padding: 3px 6px; font-size: 0.78rem; font-family: var(--font-mono); width: 118px; background: rgba(15, 23, 42, 0.6); border: 1px solid ${isExpActive ? '#10b981' : 'rgba(255, 255, 255, 0.15)'}; border-radius: 6px; color: ${isExpActive ? '#10b981' : 'var(--text-dim)'};" title="${isExpActive ? 'Expires on: ' + dateVal : 'Unlimited / Lifetime. Pick a date to set expiry.'}">
          ${isExpActive ? `<button type="button" class="btn-clear-date" data-imei="${v.imei}" title="Remove expiration date (set Unlimited)" style="background: none; border: none; cursor: pointer; color: var(--text-dim); padding: 1px 4px; font-size: 0.8rem;">✕</button>` : ''}
        </div>
      `;

      tr.innerHTML = `
        <td><input type="checkbox" class="mig-row-checkbox" data-imei="${v.imei}" ${v.selected ? 'checked' : ''}></td>
        <td>${onlineBadge}</td>
        <td><strong>${escapeHtml(v.name)}</strong></td>
        <td><code class="mono-text" style="color: #38bdf8;">${escapeHtml(v.imei)}</code></td>
        <td>${escapeHtml(v.plateNumber || 'N/A')}</td>
        <td><span class="protocol-badge">${escapeHtml(v.protocol || 'gt06')}</span></td>
        <td>${escapeHtml(v.simNumber || 'N/A')}</td>
        <td>${expireCellHtml}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(v.lastTime || 'N/A')}</td>
        <td><span class="state-badge ${stateClass}" id="migBadge_${v.imei}">${escapeHtml(v.stateMsg || 'Pending')}</span></td>
      `;

      migTableBody.appendChild(tr);
    });

    // Wire up checkboxes
    document.querySelectorAll('.mig-row-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const imei = e.target.getAttribute('data-imei');
        const veh = migVehicles.find(v => v.imei === imei);
        if (veh) {
          veh.selected = e.target.checked;
          updateSelectedCounts();
        }
      });
    });

    // Wire up inline date editors
    document.querySelectorAll('.mig-date-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const imei = e.target.getAttribute('data-imei');
        const veh = migVehicles.find(v => v.imei === imei);
        if (veh) {
          const val = (e.target.value || '').trim();
          if (val) {
            veh.expire = true;
            veh.expireDate = val;
          } else {
            veh.expire = false;
            veh.expireDate = '';
          }
          renderMigTable();
        }
      });
    });

    // Wire up inline clear date buttons
    document.querySelectorAll('.btn-clear-date').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const imei = e.target.getAttribute('data-imei');
        const veh = migVehicles.find(v => v.imei === imei);
        if (veh) {
          veh.expire = false;
          veh.expireDate = '';
          renderMigTable();
        }
      });
    });
  }

  function updateSelectedCounts() {
    const count = migVehicles.filter(v => v.selected).length;
    migSelectedCount.textContent = count;
    if (btnMigCount) btnMigCount.textContent = count;
    if (btnRepointCount) btnRepointCount.textContent = count;
    const batchExpireSelectedCount = document.getElementById('batchExpireSelectedCount');
    if (batchExpireSelectedCount) batchExpireSelectedCount.textContent = count;
    migMasterCheckbox.checked = count > 0 && count === migVehicles.length;
  }

  // Batch Selection Toolbar wiring
  if (migMasterCheckbox) {
    migMasterCheckbox.addEventListener('change', (e) => {
      const checked = e.target.checked;
      migVehicles.forEach(v => v.selected = checked);
      renderMigTable();
      updateSelectedCounts();
    });
  }

  if (selectAllMigBtn) {
    selectAllMigBtn.addEventListener('click', () => {
      migVehicles.forEach(v => v.selected = true);
      renderMigTable();
      updateSelectedCounts();
    });
  }

  if (deselectAllMigBtn) {
    deselectAllMigBtn.addEventListener('click', () => {
      migVehicles.forEach(v => v.selected = false);
      renderMigTable();
      updateSelectedCounts();
    });
  }

  if (selectBatch5Btn) {
    selectBatch5Btn.addEventListener('click', () => {
      migVehicles.forEach((v, idx) => v.selected = idx < 5);
      renderMigTable();
      updateSelectedCounts();
    });
  }

  if (selectBatch10Btn) {
    selectBatch10Btn.addEventListener('click', () => {
      migVehicles.forEach((v, idx) => v.selected = idx < 10);
      renderMigTable();
      updateSelectedCounts();
    });
  }

  if (selectPilotBtn) {
    selectPilotBtn.addEventListener('click', () => {
      const first = migVehicles[0];
      migVehicles.forEach(v => v.selected = false);
      if (first) first.selected = true;
      renderMigTable();
      updateSelectedCounts();
    });
  }

  // Batch Expiration toolbar wiring
  const applyBatchExpireBtn = document.getElementById('applyBatchExpireBtn');
  const setUnlimitedBatchBtn = document.getElementById('setUnlimitedBatchBtn');
  const batchMigExpireDateInput = document.getElementById('batchMigExpireDateInput');

  if (applyBatchExpireBtn) {
    applyBatchExpireBtn.addEventListener('click', () => {
      const dateVal = (batchMigExpireDateInput && batchMigExpireDateInput.value || '').trim();
      if (!dateVal) {
        alert('Please pick an expiration date first in the Batch Expiration box.');
        return;
      }
      const selected = migVehicles.filter(v => v.selected);
      if (selected.length === 0) {
        alert('Please select one or more vehicles using the table checkboxes first.');
        return;
      }
      selected.forEach(v => {
        v.expire = true;
        v.expireDate = dateVal;
      });
      renderMigTable();
      logMig('success', `Applied expiration date "${dateVal}" to ${selected.length} selected vehicle(s).`);
    });
  }

  if (setUnlimitedBatchBtn) {
    setUnlimitedBatchBtn.addEventListener('click', () => {
      const selected = migVehicles.filter(v => v.selected);
      if (selected.length === 0) {
        alert('Please select one or more vehicles using the table checkboxes first.');
        return;
      }
      selected.forEach(v => {
        v.expire = false;
        v.expireDate = '';
      });
      renderMigTable();
      logMig('info', `Set ${selected.length} selected vehicle(s) to Unlimited / Lifetime access.`);
    });
  }

  // Filter toolbar buttons wiring
  const filterGprsReadyBtn = document.getElementById('filterGprsReadyBtn');
  const filterAckBtn = document.getElementById('filterAckBtn');

  const allFilterButtons = [
    { btn: filterAllBtn, filter: 'all' },
    { btn: filterGprsReadyBtn, filter: 'gprs_ready' },
    { btn: filterOnlineBtn, filter: 'online' },
    { btn: filterAckBtn, filter: 'ack' },
    { btn: filterOfflineBtn, filter: 'offline' }
  ];

  allFilterButtons.forEach(({ btn, filter }) => {
    if (btn) {
      btn.addEventListener('click', () => {
        allFilterButtons.forEach(b => b.btn && b.btn.classList.remove('active'));
        btn.classList.add('active');
        migFilter = filter;
        renderMigTable();
      });
    }
  });

  if (migSearchInput) {
    migSearchInput.addEventListener('input', () => {
      renderMigTable();
    });
  }

  // Helper to get active Speedotrack dealer credentials
  function getSpeedoDealerAuth() {
    const domain = (speedoMigDomainInput.value || serverDomainInput.value || 'https://server.cartracker.com.ng/').trim();
    const username = (speedoMigUsernameInput.value || dealerUsernameInput.value || '').trim();
    const password = speedoMigPasswordInput.value || dealerPasswordInput.value || '';
    return { domain, username, password };
  }

  // 4a. BUTTON 1: STEP 1 - PROVISION & ASSIGN VEHICLES TO CLIENT (NO REPOINTING)
  if (btnMigrateAccountAndHistory) {
    btnMigrateAccountAndHistory.addEventListener('click', async () => {
      const selected = migVehicles.filter(v => v.selected);
      if (selected.length === 0) {
        alert('Please select at least one vehicle from the fleet table to provision.');
        return;
      }

      const speedoAuth = getSpeedoDealerAuth();
      if (!speedoAuth.username || !speedoAuth.password) {
        alert('Please enter your Speedotrack Dealer Username and Password in the Destination box first.');
        if (speedoMigUsernameInput) speedoMigUsernameInput.focus();
        return;
      }

      const clientEmail = (speedoClientEmailInput && speedoClientEmailInput.value.trim()) ||
                          (ctEmailInput.value || '').trim() || selected[0].clientEmail || 'client@speedotrack.com';
      const defaultPass = (speedoClientDefaultPassInput && speedoClientDefaultPassInput.value.trim()) || 'Tracker1';

      const confirmMsg = `📦 PROVISION & ASSIGN VEHICLES (${selected.length} VEHICLES)\n\n` +
        `Dealer Account: ${speedoAuth.username} (${speedoAuth.domain})\n` +
        `Client Account to Create/Link: ${clientEmail}\n\n` +
        `This will:\n` +
        `1. Register client account "${clientEmail}" under dealer "${speedoAuth.username}" on Speedotrack.\n` +
        `2. Create vehicle objects with IMEI, Plate Number, SIM Number, and Expiration Date.\n` +
        `3. Link and assign all ${selected.length} vehicles under "${clientEmail}".\n\n` +
        `⚠️ NOTE: Trackers will NOT be repointed yet. They will continue reporting safely to Car Tracker Nigeria.\n\n` +
        `Proceed with Provisioning?`;

      if (!confirm(confirmMsg)) return;

      await runStep1Migration(selected, clientEmail, speedoAuth, defaultPass);
    });
  }

  async function runStep1Migration(vehiclesToProcess, clientEmail, speedoAuth, defaultPass = 'Tracker1') {
    if (isMigrating) return;
    isMigrating = true;
    isMigPaused = false;
    shouldStopMig = false;

    setMigButtonsRunning(true);
    migProgressWrapper.classList.remove('hidden');

    const total = vehiclesToProcess.length;
    let doneCount = 0;

    migVehiclesDone.textContent = '0';
    migVehiclesTotal.textContent = total;

    logMig('info', `========================================================`);
    logMig('info', `STARTING PROVISIONING & OBJECT LINKING FOR ${total} VEHICLE(S)`);
    logMig('info', `Client: ${clientEmail} under Dealer: ${speedoAuth.username}`);
    logMig('info', `========================================================`);

    for (let i = 0; i < vehiclesToProcess.length; i++) {
      if (shouldStopMig) {
        logMig('warn', 'Provisioning process halted by user.');
        break;
      }

      while (isMigPaused && !shouldStopMig) {
        await sleep(500);
      }

      const v = vehiclesToProcess[i];
      updateRowState(v.imei, 'migrating', 'Provisioning...');

      // Determine object expiration per Car Tracker Nigeria OpenAPI spec
      const vehExpireDate = v.expireDate ? normalizeDate(v.expireDate) : '';
      const vehExpire = v.expire !== undefined
        ? Boolean(v.expire)
        : Boolean(vehExpireDate && !['never', 'none', 'lifetime', '0000-00-00', '-', 'unlimited'].includes(vehExpireDate.toLowerCase()));

      logMig('info', `[${i + 1}/${total}] Provisioning ${v.name} (IMEI: ${v.imei}, Plate: ${v.plateNumber || 'N/A'}, SIM: ${v.simNumber || 'N/A'}, Expiry: ${vehExpire ? vehExpireDate : 'Unlimited'})...`);

      let hasError = false;

      // Provision on Speedotrack under dealer
      try {
        const provRes = await fetch('/api/provision-row', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverDomain: speedoAuth.domain,
            authMode: 'dealer',
            username: speedoAuth.username,
            password: speedoAuth.password,
            row: {
              email: clientEmail,
              password: defaultPass,
              send_credentials: false,
              imei: v.imei,
              object_name: v.name,
              plate_number: v.plateNumber,
              sim_number: v.simNumber,
              expire: vehExpire,
              expire_date: vehExpire ? vehExpireDate : ''
            }
          })
        });

        const provData = await provRes.json();
        if (provData.ok || (provData.steps && provData.steps.object?.status === 'success')) {
          logMig('success', `[${v.imei}] Linked on Speedotrack under ${clientEmail} (Expiry: ${vehExpire ? vehExpireDate : 'Unlimited'})`);
        } else {
          logMig('warn', `[${v.imei}] Speedotrack provision: ${provData.summary || provData.error}`);
          if (provData.steps?.object?.status === 'error') hasError = true;
        }
      } catch (provErr) {
        hasError = true;
        logMig('error', `[${v.imei}] Provision error: ${provErr.message}`);
      }

      doneCount++;
      migVehiclesDone.textContent = doneCount;

      const pct = Math.round((doneCount / total) * 100);
      migProgressPercent.textContent = `${pct}%`;
      migProgressBarFill.style.width = `${pct}%`;

      if (hasError) {
        updateRowState(v.imei, 'error', 'Provision Failed');
      } else {
        updateRowState(v.imei, 'success', 'Provisioned & Linked');
      }

      await sleep(200);
    }

    logMig('info', `========================================================`);
    logMig('success', `Provisioning Finished: ${doneCount} of ${total} vehicles provisioned & linked under ${clientEmail}!`);
    logMig('info', `All vehicle records, plates, SIMs, and expiration dates are configured on Speedotrack.`);
    logMig('info', `👉 Next: Switch to the "Vehicle Repointing & OTA Cutover" tab to point physical devices to server.cartracker.com.ng.`);
    logMig('info', `========================================================`);

    setMigButtonsRunning(false);
    isMigrating = false;
  }

  // PILOT TEST BUTTON (1 VEHICLE: PROVISION ONLY)
  if (startPilotMigrateBtn) {
    startPilotMigrateBtn.addEventListener('click', async () => {
      let candidate = migVehicles.find(v => v.selected) ||
                      migVehicles.find(v => v.online === 'online') ||
                      migVehicles.find(v => v.online === 'ack') ||
                      migVehicles[0];

      if (!candidate) {
        alert('No vehicles loaded from Car Tracker Nigeria. Click "Connect & Fetch Fleet" first.');
        return;
      }

      migVehicles.forEach(v => v.selected = false);
      candidate.selected = true;
      renderMigTable();
      updateSelectedCounts();

      const speedoAuth = getSpeedoDealerAuth();
      if (!speedoAuth.username || !speedoAuth.password) {
        alert('Please enter your Speedotrack Dealer Username and Password in the Destination box first.');
        if (speedoMigUsernameInput) speedoMigUsernameInput.focus();
        return;
      }

      const clientEmail = (speedoClientEmailInput && speedoClientEmailInput.value.trim()) ||
                          (ctEmailInput.value || '').trim() || candidate.clientEmail || 'client@speedotrack.com';
      const defaultPass = (speedoClientDefaultPassInput && speedoClientDefaultPassInput.value.trim()) || 'Tracker1';

      const confirmMsg = `🧪 RUN PILOT PROVISION ON 1 VEHICLE\n\n` +
        `Vehicle: ${candidate.name}\n` +
        `IMEI: ${candidate.imei}\n` +
        `Speedotrack Dealer: ${speedoAuth.username}\n` +
        `Speedotrack Client: ${clientEmail}\n\n` +
        `This will register "${clientEmail}" under "${speedoAuth.username}" and provision this single vehicle on Speedotrack.\n\n` +
        `Proceed with Pilot Provisioning?`;

      if (!confirm(confirmMsg)) return;

      await runStep1Migration([candidate], clientEmail, speedoAuth, defaultPass);
    });
  }

  function setMigButtonsRunning(running) {
    if (btnMigrateAccountAndHistory) btnMigrateAccountAndHistory.disabled = running;
    if (btnRepointVehiclesOnly) btnRepointVehiclesOnly.disabled = running;
    if (startPilotMigrateBtn) startPilotMigrateBtn.disabled = running;
    if (pauseMigrateBtn) pauseMigrateBtn.classList.toggle('hidden', !running);
    if (stopMigrateBtn) stopMigrateBtn.classList.toggle('hidden', !running);
  }

  function updateRowState(imei, state, text) {
    const badge = document.getElementById(`migBadge_${imei}`);
    if (badge) {
      badge.className = `state-badge state-${state}`;
      badge.textContent = text;
    }
    const veh = migVehicles.find(v => v.imei === imei);
    if (veh) {
      veh.state = state;
      veh.stateMsg = text;
    }
  }

  // Pause / Stop controls
  if (pauseMigrateBtn) {
    pauseMigrateBtn.addEventListener('click', () => {
      isMigPaused = !isMigPaused;
      pauseMigrateBtn.textContent = isMigPaused ? '▶️ Resume' : '⏸️ Pause';
      logMig('warn', isMigPaused ? 'Migration paused.' : 'Migration resumed.');
    });
  }

  if (stopMigrateBtn) {
    stopMigrateBtn.addEventListener('click', () => {
      if (confirm('Cancel the remaining vehicles in this migration batch?')) {
        shouldStopMig = true;
        isMigPaused = false;
        logMig('warn', 'Cancel requested by user. Halting after current vehicle...');
      }
    });
  }

  // Terminal Logging
  function logMig(level, text) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const line = `[${timestamp}] ${text}`;
    migLogHistory.push(line);

    if (migTerminalOutput) {
      const el = document.createElement('div');
      el.className = `terminal-line log-${level}`;
      el.textContent = line;
      migTerminalOutput.appendChild(el);
      migTerminalOutput.scrollTop = migTerminalOutput.scrollHeight;
    }
  }

  if (clearMigTerminalBtn) {
    clearMigTerminalBtn.addEventListener('click', () => {
      migTerminalOutput.innerHTML = '<div class="terminal-line log-system">Audit logs cleared.</div>';
      migLogHistory = [];
    });
  }

  if (downloadMigLogBtn) {
    downloadMigLogBtn.addEventListener('click', () => {
      if (migLogHistory.length === 0) {
        alert('No audit logs recorded yet.');
        return;
      }
      const blob = new Blob([migLogHistory.join('\n')], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `speedotrack-migration-audit-${new Date().toISOString().split('T')[0]}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ==========================================================================
  // VIEW 3: SPEEDOTRACK VEHICLE REPOINTING & LIVE CUTOVER SWITCHBOARD
  // ==========================================================================

  let repointFleet = [];
  let repointFilter = 'pending'; // 'all' | 'pending' | 'pointed' | 'gprs'
  let isRepointing = false;
  let isRepointPaused = false;
  let shouldStopRepoint = false;
  let repointLogHistory = [];

  // DOM Elements - Tab 3 Auth
  const repointDomainInput = document.getElementById('repointDomainInput');
  const repointClientEmailInput = document.getElementById('repointClientEmailInput');
  const repointClientPasswordInput = document.getElementById('repointClientPasswordInput');
  const toggleRepointPasswordBtn = document.getElementById('toggleRepointPasswordBtn');
  const repointStatusBadge = document.getElementById('repointStatusBadge');
  const repointStatusText = document.getElementById('repointStatusText');
  const repointLoadFleetBtn = document.getElementById('repointLoadFleetBtn');
  const repointLoadSpinner = document.getElementById('repointLoadSpinner');
  const repointLoadBtnText = document.getElementById('repointLoadBtnText');
  const repointAlertBox = document.getElementById('repointAlertBox');

  // DOM Elements - Tab 3 Fleet Table & Toolbar
  const repointFleetSection = document.getElementById('repointFleetSection');
  const repointFleetTotal = document.getElementById('repointFleetTotal');
  const repointFleetPending = document.getElementById('repointFleetPending');
  const repointFleetPointed = document.getElementById('repointFleetPointed');
  const repointSelectedCount = document.getElementById('repointSelectedCount');
  const btnRepointActionCount = document.getElementById('btnRepointActionCount');

  const repointSearchInput = document.getElementById('repointSearchInput');
  const filterRepointAllBtn = document.getElementById('filterRepointAllBtn');
  const filterRepointPendingBtn = document.getElementById('filterRepointPendingBtn');
  const filterRepointPointedBtn = document.getElementById('filterRepointPointedBtn');
  const filterRepointGprsBtn = document.getElementById('filterRepointGprsBtn');

  const repointFilterAllCount = document.getElementById('repointFilterAllCount');
  const repointFilterPendingCount = document.getElementById('repointFilterPendingCount');
  const repointFilterPointedCount = document.getElementById('repointFilterPointedCount');
  const repointFilterGprsCount = document.getElementById('repointFilterGprsCount');

  const repointSelectPendingBtn = document.getElementById('repointSelectPendingBtn');
  const repointSelectPilotBtn = document.getElementById('repointSelectPilotBtn');
  const repointSelectAllBtn = document.getElementById('repointSelectAllBtn');
  const repointDeselectAllBtn = document.getElementById('repointDeselectAllBtn');

  const repointMasterCheckbox = document.getElementById('repointMasterCheckbox');
  const repointTableBody = document.getElementById('repointTableBody');

  // DOM Elements - Tab 3 OTA Commands & Action Bar
  const repointTargetIpInput = document.getElementById('repointTargetIpInput');
  const repointTargetPortInput = document.getElementById('repointTargetPortInput');
  const repointOtaCommandInput = document.getElementById('repointOtaCommandInput');
  const repointResetCmdBtn = document.getElementById('repointResetCmdBtn');
  const repointChannelSelect = document.getElementById('repointChannelSelect');

  const btnExecuteRepoint = document.getElementById('btnExecuteRepoint');
  const btnVerifyCutoverLive = document.getElementById('btnVerifyCutoverLive');
  const pauseRepointBtn = document.getElementById('pauseRepointBtn');
  const stopRepointBtn = document.getElementById('stopRepointBtn');

  const repointProgressWrapper = document.getElementById('repointProgressWrapper');
  const repointProgressTitle = document.getElementById('repointProgressTitle');
  const repointProgressPercent = document.getElementById('repointProgressPercent');
  const repointProgressBarFill = document.getElementById('repointProgressBarFill');
  const repointSentCount = document.getElementById('repointSentCount');
  const repointTotalToProcess = document.getElementById('repointTotalToProcess');
  const repointConfirmedCount = document.getElementById('repointConfirmedCount');

  const repointTerminalSection = document.getElementById('repointTerminalSection');
  const repointTerminalOutput = document.getElementById('repointTerminalOutput');
  const clearRepointTerminalBtn = document.getElementById('clearRepointTerminalBtn');
  const downloadRepointLogBtn = document.getElementById('downloadRepointLogBtn');

  // Password visibility
  if (toggleRepointPasswordBtn && repointClientPasswordInput) {
    toggleRepointPasswordBtn.addEventListener('click', () => {
      repointClientPasswordInput.type = repointClientPasswordInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Dynamic OTA Command Generation
  function updateTab3RepointCmd() {
    const ip = (repointTargetIpInput.value || '103.143.148.122').trim();
    const port = (repointTargetPortInput.value || '10202').trim();
    repointOtaCommandInput.value = `SERVER,0,${ip},${port},0#`;
  }

  if (repointTargetIpInput) repointTargetIpInput.addEventListener('input', updateTab3RepointCmd);
  if (repointTargetPortInput) repointTargetPortInput.addEventListener('input', updateTab3RepointCmd);

  if (repointResetCmdBtn) {
    repointResetCmdBtn.addEventListener('click', () => {
      repointTargetIpInput.value = '103.143.148.122';
      repointTargetPortInput.value = '10202';
      repointOtaCommandInput.value = 'SERVER,0,103.143.148.122,10202,0#';
      logRepoint('info', 'Command reset to tested Concox/GT06 default: SERVER,0,103.143.148.122,10202,0#');
    });
  }

  // 1. Fetch Fleet from Speedotrack for Client
  if (repointLoadFleetBtn) {
    repointLoadFleetBtn.addEventListener('click', async () => {
      const serverDomain = normalizeServerUrl(repointDomainInput.value || 'https://server.cartracker.com.ng/');
      const clientEmail = (repointClientEmailInput.value || '').trim();
      const password = (repointClientPasswordInput && repointClientPasswordInput.value) || '';

      if (!clientEmail) {
        showRepointAlert('Please enter the client account email or username.', 'error');
        if (repointClientEmailInput) repointClientEmailInput.focus();
        return;
      }

      if (!password) {
        showRepointAlert('Please enter the client account password.', 'error');
        if (repointClientPasswordInput) repointClientPasswordInput.focus();
        return;
      }

      setRepointLoading(true);
      showRepointAlert('', 'hidden');
      logRepoint('info', `Authenticating on Speedotrack (${serverDomain}) as ${clientEmail}...`);

      try {
        const res = await fetch('/api/speedotrack/client/vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverDomain,
            username: clientEmail,
            password
          })
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed to fetch vehicles from Speedotrack.');

        // Build fleet items
        repointFleet = (data.vehicles || []).map(v => {
          // Cross-reference with source Car Tracker Nigeria vehicles to check if GPRS socket is ready
          const sourceMatch = migVehicles.find(mv => mv.imei === v.imei);
          const isGprsReady = sourceMatch ? (sourceMatch.online === 'online' || sourceMatch.online === 'ack') : false;

          return {
            ...v,
            isGprsReady,
            sourceDevice: sourceMatch || null,
            // Select pending vehicles by default
            selected: !v.isPointed
          };
        });

        // Update status badge
        repointStatusBadge.className = 'status-pill status-ready';
        repointStatusText.textContent = `Active (${repointFleet.length} vehicles)`;

        repointFleetSection.classList.remove('hidden');
        repointTerminalSection.classList.remove('hidden');

        updateRepointCounters();
        renderRepointTable();

        showRepointAlert(`Loaded ${repointFleet.length} vehicles for ${clientEmail}! ${data.pendingCount} pending cutover, ${data.pointedCount} already pointed.`, 'success');
        logRepoint('success', `Speedotrack fleet loaded: ${repointFleet.length} total (${data.pendingCount} pending cutover, ${data.pointedCount} already pointed).`);

      } catch (err) {
        repointStatusBadge.className = 'status-pill status-error';
        repointStatusText.textContent = 'Load Failed';
        showRepointAlert(`Could not load Speedotrack fleet: ${err.message}`, 'error');
        logRepoint('error', `Fleet load failed: ${err.message}`);
      } finally {
        setRepointLoading(false);
      }
    });
  }

  function setRepointLoading(loading) {
    if (loading) {
      repointLoadFleetBtn.disabled = true;
      repointLoadSpinner.classList.remove('hidden');
      repointLoadBtnText.textContent = 'Loading Fleet...';
    } else {
      repointLoadFleetBtn.disabled = false;
      repointLoadSpinner.classList.add('hidden');
      repointLoadBtnText.textContent = '🚀 Pull Client Fleet from Speedotrack';
    }
  }

  function showRepointAlert(msg, type) {
    if (!repointAlertBox) return;
    if (type === 'hidden' || !msg) {
      repointAlertBox.className = 'alert hidden';
      repointAlertBox.textContent = '';
      return;
    }
    repointAlertBox.className = `alert alert-${type}`;
    repointAlertBox.textContent = msg;
  }

  function updateRepointCounters() {
    const total = repointFleet.length;
    const pending = repointFleet.filter(v => !v.isPointed).length;
    const pointed = repointFleet.filter(v => v.isPointed).length;
    const gprs = repointFleet.filter(v => v.isGprsReady).length;
    const selected = repointFleet.filter(v => v.selected).length;

    if (repointFleetTotal) repointFleetTotal.textContent = total;
    if (repointFleetPending) repointFleetPending.textContent = pending;
    if (repointFleetPointed) repointFleetPointed.textContent = pointed;
    if (repointSelectedCount) repointSelectedCount.textContent = selected;
    if (btnRepointActionCount) btnRepointActionCount.textContent = selected;

    if (repointFilterAllCount) repointFilterAllCount.textContent = total;
    if (repointFilterPendingCount) repointFilterPendingCount.textContent = pending;
    if (repointFilterPointedCount) repointFilterPointedCount.textContent = pointed;
    if (repointFilterGprsCount) repointFilterGprsCount.textContent = gprs;
  }

  // Filter Buttons
  [
    { btn: filterRepointAllBtn, filter: 'all' },
    { btn: filterRepointPendingBtn, filter: 'pending' },
    { btn: filterRepointPointedBtn, filter: 'pointed' },
    { btn: filterRepointGprsBtn, filter: 'gprs' }
  ].forEach(({ btn, filter }) => {
    if (btn) {
      btn.addEventListener('click', () => {
        repointFilter = filter;
        [filterRepointAllBtn, filterRepointPendingBtn, filterRepointPointedBtn, filterRepointGprsBtn].forEach(b => {
          if (b) b.classList.toggle('active', b === btn);
        });
        renderRepointTable();
      });
    }
  });

  // Search filter
  if (repointSearchInput) {
    repointSearchInput.addEventListener('input', () => {
      renderRepointTable();
    });
  }

  // Batch Selection Buttons
  if (repointSelectPendingBtn) {
    repointSelectPendingBtn.addEventListener('click', () => {
      repointFleet.forEach(v => {
        v.selected = !v.isPointed;
      });
      renderRepointTable();
      updateRepointCounters();
    });
  }

  if (repointSelectPilotBtn) {
    repointSelectPilotBtn.addEventListener('click', () => {
      repointFleet.forEach(v => v.selected = false);
      const pilot = repointFleet.find(v => !v.isPointed) || repointFleet[0];
      if (pilot) pilot.selected = true;
      renderRepointTable();
      updateRepointCounters();
    });
  }

  if (repointSelectAllBtn) {
    repointSelectAllBtn.addEventListener('click', () => {
      const visible = getFilteredRepointFleet();
      visible.forEach(v => v.selected = true);
      renderRepointTable();
      updateRepointCounters();
    });
  }

  if (repointDeselectAllBtn) {
    repointDeselectAllBtn.addEventListener('click', () => {
      repointFleet.forEach(v => v.selected = false);
      renderRepointTable();
      updateRepointCounters();
    });
  }

  // Master Checkbox
  if (repointMasterCheckbox) {
    repointMasterCheckbox.addEventListener('change', () => {
      const checked = repointMasterCheckbox.checked;
      const visible = getFilteredRepointFleet();
      visible.forEach(v => v.selected = checked);
      renderRepointTable();
      updateRepointCounters();
    });
  }

  function getFilteredRepointFleet() {
    const q = (repointSearchInput ? repointSearchInput.value : '').toLowerCase().trim();
    return repointFleet.filter(v => {
      // Filter tab check
      if (repointFilter === 'pending' && v.isPointed) return false;
      if (repointFilter === 'pointed' && !v.isPointed) return false;
      if (repointFilter === 'gprs' && !v.isGprsReady) return false;

      // Text search check
      if (q) {
        const str = `${v.name} ${v.imei} ${v.plateNumber} ${v.simNumber} ${v.dtServer}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }

  function renderRepointTable() {
    if (!repointTableBody) return;
    const filtered = getFilteredRepointFleet();
    repointTableBody.innerHTML = '';

    if (filtered.length === 0) {
      repointTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 32px;">No vehicles match the filter criteria.</td></tr>`;
      return;
    }

    const allSelected = filtered.length > 0 && filtered.every(v => v.selected);
    if (repointMasterCheckbox) repointMasterCheckbox.checked = allSelected;

    filtered.forEach(v => {
      const tr = document.createElement('tr');
      if (v.selected) tr.classList.add('selected-row');

      const pointedBadge = v.isPointed
        ? `<span class="badge-pointed" title="Transmitting to server.cartracker.com.ng"><span class="pulse-green"></span> Pointed</span>`
        : `<span class="badge-pending-repoint" title="Not yet transmitting to server.cartracker.com.ng"><span class="pulse-amber"></span> Pending</span>`;

      const lastPing = (v.dtServer && v.dtServer !== '0000-00-00 00:00:00' && v.dtServer !== '-')
        ? `<span style="color: var(--success); font-family: var(--font-mono); font-size: 0.78rem;">${escapeHtml(v.dtServer)}</span>`
        : `<span style="color: var(--text-dim); font-size: 0.8rem;">Never reported</span>`;

      const gprsHint = v.isGprsReady
        ? `<span title="Socket OPEN on Car Tracker Nigeria" style="color: #38bdf8; font-size: 0.75rem; margin-left: 4px;">⚡</span>`
        : '';

      const stateClass = v.stateClass || (v.isPointed ? 'state-success' : 'state-pending');
      const stateMsg = v.stateMsg || (v.isPointed ? 'Cutover Confirmed' : 'Ready to Repoint');
      const currentCmd = (repointOtaCommandInput && repointOtaCommandInput.value) || 'SERVER,0,103.143.148.122,10202,0#';

      tr.innerHTML = `
        <td><input type="checkbox" class="repoint-row-cb" data-imei="${v.imei}" ${v.selected ? 'checked' : ''}></td>
        <td>${pointedBadge}</td>
        <td><strong>${escapeHtml(v.name)}</strong> ${gprsHint}</td>
        <td><code style="font-family: var(--font-mono); font-size: 0.82rem;">${escapeHtml(v.imei)}</code></td>
        <td>${escapeHtml(v.plateNumber || '-')}</td>
        <td>${escapeHtml(v.simNumber || '-')}</td>
        <td>${lastPing}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span id="repointBadge_${v.imei}" class="state-badge ${stateClass}">${stateMsg}</span>
            <button type="button" class="btn btn-xs btn-outline repoint-single-btn" data-imei="${v.imei}" title="Queue Repoint Command for this device" style="font-size: 0.72rem; padding: 2px 8px;">📡 Point</button>
            ${v.simNumber ? `<a href="sms:${v.simNumber}?body=${encodeURIComponent(currentCmd)}" class="btn btn-xs btn-outline" style="font-size: 0.72rem; padding: 2px 8px; color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);" title="Direct SMS via phone">📱 SMS</a>` : ''}
          </div>
        </td>
      `;

      // Checkbox event
      const cb = tr.querySelector('.repoint-row-cb');
      cb.addEventListener('change', (e) => {
        v.selected = e.target.checked;
        tr.classList.toggle('selected-row', v.selected);
        updateRepointCounters();
      });

      // Single repoint button
      const singleBtn = tr.querySelector('.repoint-single-btn');
      if (singleBtn) {
        singleBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const serverDomain = (repointDomainInput && repointDomainInput.value.trim()) || 'https://server.cartracker.com.ng/';
          const username = (repointClientEmailInput && repointClientEmailInput.value.trim());
          const password = (repointClientPasswordInput && repointClientPasswordInput.value);

          if (!username || !password) {
            alert('Please enter the client account email/username and password in Section 1 above.');
            return;
          }

          const cmd = (repointOtaCommandInput.value || 'SERVER,0,103.143.148.122,10202,0#').trim();
          const channel = (repointChannelSelect && repointChannelSelect.value) || 'gprs';
          const gateway = (document.getElementById('repointGatewaySelect')?.value) || 'cartracker';

          updateRepointRowState(v.imei, 'migrating', 'Dispatching...');
          logRepoint('info', `[Manual] Dispatching ${channel.toUpperCase()} command to ${v.name} (IMEI: ${v.imei}) via ${gateway === 'cartracker' ? 'Car Tracker Nigeria active socket' : 'Speedotrack'}...`);

          try {
            const res = await fetch('/api/speedotrack/client/repoint-device', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                serverDomain,
                username,
                password,
                imei: v.imei,
                simNumber: v.simNumber || '',
                command: cmd,
                channel,
                gateway,
                cartrackerUrl: 'https://app.cartracker.com.ng'
              })
            });
            const data = await res.json();
            if (data.ok) {
              updateRepointRowState(v.imei, 'migrating', 'Command Delivered');
              logRepoint('success', `[${v.imei}] Delivered via ${data.gateway === 'cartracker' ? 'Car Tracker Nigeria active socket' : 'Speedotrack'}: "${cmd}"`);
              setTimeout(() => verifyCutoverLive([v.imei]), 4000);
            } else if (data.onlineStatus === 'offline') {
              updateRepointRowState(v.imei, 'pending', 'Offline on Old Server');
              logRepoint('warn', `[${v.imei}] Vehicle is currently offline on Car Tracker Nigeria. Will receive repoint when ignition starts, or send direct SMS.`);
            } else {
              updateRepointRowState(v.imei, 'error', 'Failed');
              logRepoint('warn', `[${v.imei}] Failed: ${data.message || data.error}`);
            }
          } catch (err) {
            updateRepointRowState(v.imei, 'error', 'Error');
            logRepoint('error', `[${v.imei}] Error: ${err.message}`);
          }
        });
      }

      repointTableBody.appendChild(tr);
    });
  }


  function updateRepointRowState(imei, state, text) {
    const badge = document.getElementById(`repointBadge_${imei}`);
    if (badge) {
      badge.className = `state-badge state-${state}`;
      badge.textContent = text;
    }
    const veh = repointFleet.find(v => v.imei === imei);
    if (veh) {
      veh.stateClass = `state-${state}`;
      veh.stateMsg = text;
    }
  }

  // 2. Dispatch Repoint Commands to Selected Vehicles
  if (btnExecuteRepoint) {
    btnExecuteRepoint.addEventListener('click', async () => {
      const selected = repointFleet.filter(v => v.selected);
      if (selected.length === 0) {
        alert('Please select at least one vehicle in the table to repoint.');
        return;
      }

      // Standalone Speedotrack Client Credentials from Section 1
      const serverDomain = (repointDomainInput && repointDomainInput.value.trim()) || 'https://server.cartracker.com.ng/';
      const username = (repointClientEmailInput && repointClientEmailInput.value.trim());
      const password = (repointClientPasswordInput && repointClientPasswordInput.value);

      if (!username || !password) {
        alert('Please enter the client account email/username and password in Section 1 above.');
        if (repointClientEmailInput && !username) repointClientEmailInput.focus();
        else if (repointClientPasswordInput) repointClientPasswordInput.focus();
        return;
      }

      const cmd = (repointOtaCommandInput.value || 'SERVER,0,103.143.148.122,10202,0#').trim();
      const channel = (repointChannelSelect && repointChannelSelect.value) || 'gprs';
      const gateway = (document.getElementById('repointGatewaySelect')?.value) || 'cartracker';

      const confirmMsg = `📡 DISPATCH REPOINT COMMAND TO ${selected.length} VEHICLE(S)\n\n` +
        `Gateway: ${gateway === 'cartracker' ? '⚡ Car Tracker Nigeria (Active Sockets)' : 'Speedotrack Queue'}\n` +
        `Client Account: ${username}\n` +
        `Target Command: ${cmd}\n` +
        `Delivery Channel: ${channel.toUpperCase()}\n` +
        `Target Server: ${repointTargetIpInput.value}:${repointTargetPortInput.value}\n\n` +
        `This will push the OTA repoint command through ${gateway === 'cartracker' ? 'Car Tracker Nigeria active sockets' : 'Speedotrack'} to cutover these physical trackers.\n\n` +
        `Do you want to proceed?`;

      if (!confirm(confirmMsg)) return;

      await executeRepointBatch(selected, cmd, channel, serverDomain, username, password, gateway);
    });
  }

  async function executeRepointBatch(vehiclesToProcess, command, channel, serverDomain, username, password, gateway = 'cartracker') {
    if (isRepointing) return;
    isRepointing = true;
    isRepointPaused = false;
    shouldStopRepoint = false;

    setRepointButtonsRunning(true);
    repointProgressWrapper.classList.remove('hidden');

    const total = vehiclesToProcess.length;
    let doneCount = 0;
    let successCount = 0;

    repointSentCount.textContent = '0';
    repointTotalToProcess.textContent = total;
    repointConfirmedCount.textContent = '0';

    logRepoint('info', `========================================================`);
    logRepoint('info', `STARTING BATCH REPOINT FOR ${total} VEHICLES`);
    logRepoint('info', `Gateway: ${gateway === 'cartracker' ? '⚡ Car Tracker Nigeria (Active Sockets)' : 'Speedotrack'}`);
    logRepoint('info', `Client: ${username} | Target Server: ${repointTargetIpInput.value}:${repointTargetPortInput.value}`);
    logRepoint('info', `Command: "${command}" | Channel: ${channel.toUpperCase()}`);
    logRepoint('info', `========================================================`);

    for (let i = 0; i < vehiclesToProcess.length; i++) {
      if (shouldStopRepoint) {
        logRepoint('warn', 'Batch repoint halted by user.');
        break;
      }

      while (isRepointPaused && !shouldStopRepoint) {
        await sleep(500);
      }

      const v = vehiclesToProcess[i];
      updateRepointRowState(v.imei, 'migrating', 'Dispatching...');
      logRepoint('info', `[${i + 1}/${total}] Queuing ${channel.toUpperCase()} command for ${v.name} (IMEI: ${v.imei})...`);

      let hasError = false;

      try {
        const res = await fetch('/api/speedotrack/client/repoint-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverDomain,
            username,
            password,
            imei: v.imei,
            simNumber: v.simNumber || '',
            command,
            channel,
            gateway,
            cartrackerUrl: 'https://app.cartracker.com.ng'
          })
        });

        const data = await res.json();
        if (data.ok) {
          successCount++;
          repointSentCount.textContent = successCount;
          updateRepointRowState(v.imei, 'migrating', 'Command Delivered');
          logRepoint('success', `[${v.imei}] Delivered via ${data.gateway === 'cartracker' ? 'Car Tracker Nigeria socket' : 'Speedotrack'}: "${command}"`);
        } else if (data.onlineStatus === 'offline') {
          updateRepointRowState(v.imei, 'pending', 'Offline on Old Server');
          logRepoint('warn', `[${v.imei}] Device is currently parked/offline on Car Tracker Nigeria. Will receive command when vehicle ignition starts.`);
        } else if (data.channel === 'sms' && data.smsUri) {
          updateRepointRowState(v.imei, 'pending', 'Direct SMS Ready');
          logRepoint('warn', `[${v.imei}] SIM: ${v.simNumber || 'N/A'}. SMS link ready.`);
        } else {
          hasError = true;
          updateRepointRowState(v.imei, 'error', 'Command Failed');
          logRepoint('warn', `[${v.imei}] Repoint failed: ${data.message || data.error}`);
        }
      } catch (err) {
        hasError = true;
        updateRepointRowState(v.imei, 'error', 'Network Error');
        logRepoint('error', `[${v.imei}] Dispatch error: ${err.message}`);
      }

      doneCount++;
      const pct = Math.round((doneCount / total) * 100);
      repointProgressPercent.textContent = `${pct}%`;
      repointProgressBarFill.style.width = `${pct}%`;

      await sleep(250);
    }

    logRepoint('info', `========================================================`);
    logRepoint('success', `Repoint batch finished: ${successCount} of ${total} commands delivered!`);
    logRepoint('info', `Verifying live handshakes on Speedotrack in 4 seconds...`);
    logRepoint('info', `========================================================`);

    setRepointButtonsRunning(false);
    isRepointing = false;

    // Run cutover check after 4 seconds
    setTimeout(async () => {
      await verifyCutoverLive(vehiclesToProcess.map(v => v.imei));
    }, 4000);
  }


  // 3. Verify Live Cutover on Speedotrack
  if (btnVerifyCutoverLive) {
    btnVerifyCutoverLive.addEventListener('click', async () => {
      await verifyCutoverLive();
    });
  }


  async function verifyCutoverLive(specificImeis = []) {
    const serverDomain = normalizeServerUrl(repointDomainInput.value || 'https://server.cartracker.com.ng/');
    const clientEmail = (repointClientEmailInput.value || '').trim();
    const password = (repointClientPasswordInput && repointClientPasswordInput.value) || '';

    if (!clientEmail || !password) {
      alert('Please enter your client account email and password.');
      return;
    }

    logRepoint('info', `Checking live handshakes on Speedotrack for ${repointFleet.length} vehicles...`);

    try {
      const res = await fetch('/api/speedotrack/verify-cutover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverDomain,
          username: clientEmail,
          password,
          imeis: specificImeis
        })
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Cutover verification failed.');

      const statusMap = data.statusMap || {};
      let newlyPointed = 0;
      let totalPointed = 0;

      repointFleet.forEach(v => {
        if (statusMap[v.imei]) {
          const info = statusMap[v.imei];
          const wasPointed = v.isPointed;
          v.isPointed = info.isPointed;
          v.dtServer = info.dtServer;
          v.dtTracker = info.dtTracker;

          if (v.isPointed) {
            totalPointed++;
            if (!wasPointed) {
              newlyPointed++;
              v.stateClass = 'state-success';
              v.stateMsg = '🎉 Cutover Confirmed!';
              logRepoint('success', `🎉 CUTOVER CONFIRMED: ${v.name} (${v.imei}) is transmitting live to ${serverDomain}! Last ping: ${v.dtServer}`);
            }
          }
        }
      });

      if (repointConfirmedCount) repointConfirmedCount.textContent = totalPointed;
      updateRepointCounters();
      renderRepointTable();

      if (newlyPointed > 0) {
        logRepoint('success', `Cutover Check Complete: ${newlyPointed} vehicle(s) successfully switched to Speedotrack!`);
      } else {
        logRepoint('info', `Cutover Check Complete: ${totalPointed} vehicle(s) currently confirmed pointed.`);
      }

    } catch (err) {
      logRepoint('error', `Cutover verification error: ${err.message}`);
    }
  }

  function setRepointButtonsRunning(running) {
    if (btnExecuteRepoint) btnExecuteRepoint.disabled = running;
    if (btnVerifyCutoverLive) btnVerifyCutoverLive.disabled = running;
    if (repointLoadFleetBtn) repointLoadFleetBtn.disabled = running;
    if (pauseRepointBtn) pauseRepointBtn.classList.toggle('hidden', !running);
    if (stopRepointBtn) stopRepointBtn.classList.toggle('hidden', !running);
  }

  // Pause / Resume / Stop for Repoint
  if (pauseRepointBtn) {
    pauseRepointBtn.addEventListener('click', () => {
      isRepointPaused = !isRepointPaused;
      pauseRepointBtn.textContent = isRepointPaused ? '▶️ Resume' : '⏸️ Pause';
      logRepoint('warn', isRepointPaused ? 'Repoint dispatch paused.' : 'Repoint dispatch resumed.');
    });
  }

  if (stopRepointBtn) {
    stopRepointBtn.addEventListener('click', () => {
      if (confirm('Cancel remaining repoint commands in this batch?')) {
        shouldStopRepoint = true;
        isRepointPaused = false;
        logRepoint('warn', 'Repoint cancel requested. Stopping batch...');
      }
    });
  }

  // Terminal logging for Repoint
  function logRepoint(level, text) {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const line = `[${timestamp}] ${text}`;
    repointLogHistory.push(line);

    if (repointTerminalOutput) {
      const el = document.createElement('div');
      el.className = `terminal-line log-${level}`;
      el.textContent = line;
      repointTerminalOutput.appendChild(el);
      repointTerminalOutput.scrollTop = repointTerminalOutput.scrollHeight;
    }
  }

  if (clearRepointTerminalBtn) {
    clearRepointTerminalBtn.addEventListener('click', () => {
      if (repointTerminalOutput) {
        repointTerminalOutput.innerHTML = '<div class="terminal-line log-system">Audit logs cleared.</div>';
      }
      repointLogHistory = [];
    });
  }

  if (downloadRepointLogBtn) {
    downloadRepointLogBtn.addEventListener('click', () => {
      if (repointLogHistory.length === 0) {
        alert('No audit logs recorded yet.');
        return;
      }
      const blob = new Blob([repointLogHistory.join('\n')], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `speedotrack-repoint-audit-${new Date().toISOString().split('T')[0]}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

});
