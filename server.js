const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Prevent browser from caching local HTML/JS/CSS during development
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Cache for dealer CPanel web sessions
// Key: `${domain}_${username}` -> { cookies, managerId, privileges, username, email, expiresAt }
const cpanelSessions = new Map();

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

// Extract and merge cookies into standard "Cookie: name=val; name2=val2" format
function extractCookies(response, existingCookieStr = '') {
  let cookieMap = new Map();

  if (existingCookieStr) {
    existingCookieStr.split(';').forEach(c => {
      const parts = c.trim().split('=');
      if (parts[0]) cookieMap.set(parts[0], parts.slice(1).join('='));
    });
  }

  let setCookieHeaders = [];
  if (typeof response.headers.getSetCookie === 'function') {
    setCookieHeaders = response.headers.getSetCookie();
  } else if (response.headers.get('set-cookie')) {
    setCookieHeaders = [response.headers.get('set-cookie')];
  }

  for (const raw of setCookieHeaders) {
    const firstPart = raw.split(';')[0];
    const parts = firstPart.trim().split('=');
    if (parts[0]) {
      cookieMap.set(parts[0], parts.slice(1).join('='));
    }
  }

  const merged = [];
  for (const [k, v] of cookieMap.entries()) {
    merged.push(`${k}=${v}`);
  }
  return merged.join('; ');
}

function normalizeDate(rawStr) {
  if (!rawStr) return '';
  let str = String(rawStr).trim();
  if (['never', 'none', 'lifetime', '0000-00-00', '-'].includes(str.toLowerCase())) return '';
  str = str.split(/[T\s]/)[0];

  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, '0')}-${String(ymdMatch[3]).padStart(2, '0')}`;
  }

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
      d = String(p1).padStart(2, '0');
      m = String(p2).padStart(2, '0');
    }
    return `${y}-${m}-${d}`;
  }
  return str;
}

// -------------------------------------------------------------
// DEALER CPANEL WEB SESSION HANDLERS
// -------------------------------------------------------------

async function loginDealerCPanel(serverDomain, username, password) {
  const cleanDomain = normalizeServerUrl(serverDomain);
  const sessionKey = `${cleanDomain}_${username.trim().toLowerCase()}`;

  // Check existing session (valid for 20 minutes)
  const existing = cpanelSessions.get(sessionKey);
  if (existing && existing.expiresAt > Date.now()) {
    return existing;
  }

  const loginBody = new URLSearchParams({
    cmd: 'login',
    username: username.trim(),
    password: password,
    remember_me: 'false',
    mobile: 'false'
  });

  const loginRes = await fetch(`${cleanDomain}/func/fn_connect.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: loginBody.toString()
  });

  const loginText = (await loginRes.text()).trim();

  if (loginText === 'ERROR_USERNAME_PASSWORD_INCORRECT') {
    throw new Error('Incorrect CPanel username or password.');
  }

  if (loginText !== 'LOGIN_CPANEL' && loginText !== 'LOGIN_TRACKING') {
    throw new Error(`CPanel login failed (${loginText || `HTTP ${loginRes.status}`}).`);
  }

  let cookies = extractCookies(loginRes);

  // Retrieve dealer manager_id and privileges from fn_cpanel.server.php
  let managerId = '';
  let privileges = 'Dealer-SM';
  let email = '';

  try {
    const loadBody = new URLSearchParams({ cmd: 'load_cpanel_data' });
    const loadRes = await fetch(`${cleanDomain}/func/fn_cpanel.server.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
      },
      body: loadBody.toString()
    });

    cookies = extractCookies(loadRes, cookies);
    const loadText = await loadRes.text();
    let loadJson = null;
    try {
      loadJson = JSON.parse(loadText);
    } catch {}
    if (loadJson && typeof loadJson === 'object') {
      managerId = loadJson.manager_id || '';
      privileges = loadJson.privileges || privileges;
      email = loadJson.email || '';
    }
  } catch (err) {
    // Non-fatal, default to dealer
  }

  const session = {
    domain: cleanDomain,
    username: username.trim(),
    email,
    cookies,
    managerId,
    privileges,
    expiresAt: Date.now() + 20 * 60 * 1000 // 20 mins
  };

  cpanelSessions.set(sessionKey, session);
  return session;
}

// Helper to find a user from the user list by email or username
function findUser(users, targetEmail) {
  if (!Array.isArray(users) || !targetEmail) return null;
  const norm = targetEmail.trim().toLowerCase();
  // 1. Exact email match
  let found = users.find(u => u.email === norm);
  if (found) return found;
  // 2. Exact username match
  found = users.find(u => (u.username || '').toLowerCase() === norm);
  if (found) return found;
  // 3. Email found anywhere in record text
  found = users.find(u => u.allText && u.allText.includes(norm));
  if (found) return found;
  // 4. Prefix match (e.g. "testing" matches "testing@gmail.com")
  const prefix = norm.split('@')[0];
  if (prefix && prefix.length >= 3) {
    found = users.find(u => (u.username || '').toLowerCase() === prefix);
    if (found) return found;
  }
  return null;
}

// Fetch list of users belonging to this dealer (combining search list and jqGrid list)
async function dealerLoadUsers(cleanDomain, cookies, managerId) {
  const usersMap = new Map();

  // Source 1: load_user_search_list (Directly used by CPanel Tokenize select list)
  try {
    const sUrl = `${cleanDomain}/func/fn_cpanel.users.php?cmd=load_user_search_list&manager_id=${managerId || ''}`;
    const sRes = await fetch(sUrl, {
      method: 'GET',
      headers: {
        'Cookie': cookies,
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
      }
    });
    const sText = await sRes.text();
    let sData = null;
    try { sData = JSON.parse(sText); } catch {}
    if (Array.isArray(sData)) {
      for (const item of sData) {
        if (item && item.value) {
          const rawText = String(item.text || '').trim();
          const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          usersMap.set(String(item.value), {
            id: String(item.value),
            username: rawText,
            email: emailMatch ? emailMatch[0].toLowerCase() : rawText.toLowerCase(),
            allText: rawText.toLowerCase()
          });
        }
      }
    }
  } catch (err) {
    console.error('load_user_search_list error:', err.message);
  }

  // Source 2: load_user_list (jqGrid User Management table)
  try {
    const url = `${cleanDomain}/func/fn_cpanel.users.php?cmd=load_user_list&manager_id=${managerId || ''}`;
    const postData = new URLSearchParams({
      page: '1',
      rows: '1000',
      sidx: 'id',
      sord: 'desc',
      _search: 'false'
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
      },
      body: postData.toString()
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (data && Array.isArray(data.rows)) {
      for (const r of data.rows) {
        const cell = r.cell || [];
        const allText = cell.map(c => String(c).toLowerCase().trim()).join(' ');
        const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const existing = usersMap.get(String(r.id));
        usersMap.set(String(r.id), {
          id: String(r.id),
          username: String(cell[0] || (existing ? existing.username : '')).trim(),
          email: emailMatch ? emailMatch[0].toLowerCase() : (existing ? existing.email : String(cell[1] || cell[0] || '').toLowerCase().trim()),
          allText: (allText + ' ' + (existing ? existing.allText : '')).trim()
        });
      }
    }
  } catch (err) {
    console.error('load_user_list error:', err.message);
  }

  return Array.from(usersMap.values());
}

// Register a new client user under this dealer
async function dealerRegisterUser(cleanDomain, cookies, managerId, email, sendCredentials) {
  const postData = new URLSearchParams({
    cmd: 'register_user',
    email: email.trim(),
    send: sendCredentials ? 'true' : 'false',
    manager_id: managerId || ''
  });

  const res = await fetch(`${cleanDomain}/func/fn_cpanel.users.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: postData.toString()
  });

  const text = (await res.text()).trim();
  return text; // 'OK', 'ERROR_EMAIL_EXISTS', 'ERROR_NOT_SENT'
}

// Add a GPS object under this dealer
async function dealerAddObject(cleanDomain, cookies, managerId, imei, name, expire, expireDate, userId, plateNumber = '', simNumber = '') {
  const userIdsArray = userId ? [String(userId)] : [];
  
  const postData = new URLSearchParams({
    cmd: 'add_object',
    name: name,
    imei: imei,
    model: '',
    vin: '',
    plate_number: plateNumber || '',
    device: '',
    sim_number: simNumber || '',
    manager_id: managerId || '',
    active: 'true',
    object_expire: expire ? 'true' : 'false',
    object_expire_dt: expire ? expireDate : '',
    user_ids: JSON.stringify(userIdsArray),
    vehicle_type_id: '',
    sensor_profile_id: '',
    brta_portal: '0'
  });

  const res = await fetch(`${cleanDomain}/func/fn_cpanel.objects.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: postData.toString()
  });

  const text = (await res.text()).trim();
  return text; // 'OK', 'ERROR_OBJECT_LIMIT', 'ERROR_SYSTEM_OBJECT_LIMIT'
}

// Method 1: Assign tracker object to user account (User side: add_user_objects)
async function dealerAssignObject(cleanDomain, cookies, userId, imei) {
  const postData = new URLSearchParams({
    cmd: 'add_user_objects',
    user_id: String(userId),
    imeis: JSON.stringify([String(imei)])
  });

  const res = await fetch(`${cleanDomain}/func/fn_cpanel.users.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: postData.toString()
  });

  const text = (await res.text()).trim();
  return text; // 'OK'
}

// Method 2: Link user account to tracker object (Object side: edit_object)
async function dealerLinkObjectUser(cleanDomain, cookies, managerId, imei, name, expire, expireDate, userId, plateNumber = '', simNumber = '') {
  const postData = new URLSearchParams({
    cmd: 'edit_object',
    name: name,
    imei: String(imei),
    new_imei: '',
    model: '',
    vin: '',
    plate_number: plateNumber || '',
    device: '',
    sim_number: simNumber || '',
    manager_id: managerId || '',
    active: 'true',
    object_expire: expire ? 'true' : 'false',
    object_expire_dt: expire ? expireDate : '',
    user_ids: JSON.stringify([String(userId)]),
    vehicle_type_id: ''
  });

  const res = await fetch(`${cleanDomain}/func/fn_cpanel.objects.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: postData.toString()
  });

  const text = (await res.text()).trim();
  return text; // 'OK'
}

// -------------------------------------------------------------
// UNIVERSAL SPEEDOTRACK HTTP API CALLER (For Super Admin Server API)
// -------------------------------------------------------------
async function callSpeedotrack(serverDomain, apiKey, cmd) {
  const baseUrl = normalizeServerUrl(serverDomain);
  const targetUrl = new URL(`${baseUrl}/api/api.php`);
  targetUrl.searchParams.set('api', 'server');
  targetUrl.searchParams.set('ver', '1.0');
  targetUrl.searchParams.set('key', (apiKey || '').trim());
  targetUrl.searchParams.set('cmd', cmd);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0',
        'Accept': '*/*'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    const text = (await response.text()).trim();
    const lowerText = text.toLowerCase();

    const isHtml = text.startsWith('<') || 
                   lowerText.includes('<!doctype') || 
                   lowerText.includes('<html') || 
                   lowerText.includes('<head');

    if (isHtml) {
      return {
        status: response.status,
        ok: false,
        text: text,
        error: `Server returned an HTML web page instead of an API response. Ensure Server Domain is set to the base URL (e.g. https://server.cartracker.com.ng/) and not a CPanel page.`,
        url: targetUrl.toString(),
        isHtml: true
      };
    }

    if (!response.ok) {
      return {
        status: response.status,
        ok: false,
        text: text,
        error: text || `Server returned HTTP status ${response.status}`,
        url: targetUrl.toString()
      };
    }

    if (!text) {
      return {
        status: response.status,
        ok: false,
        text: '',
        error: 'Server returned an empty response. Verify server domain and API key.',
        url: targetUrl.toString()
      };
    }

    if (text.startsWith('ERROR:') || lowerText.includes('wrong api key') || lowerText.includes('access denied')) {
      return {
        status: response.status,
        ok: false,
        text: text,
        error: text,
        url: targetUrl.toString()
      };
    }

    return {
      status: response.status,
      ok: true,
      text: text,
      url: targetUrl.toString()
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      status: 0,
      ok: false,
      text: err.name === 'AbortError' ? 'Request timed out (15s)' : err.message,
      error: err.name === 'AbortError' ? 'Request timed out (15s)' : err.message,
      url: targetUrl.toString()
    };
  }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// 1. Dealer CPanel Login & Test / Universal verify-connection route
app.post(['/api/verify-connection', '/api/dealer/test-connection'], async (req, res) => {
  const { authMode, serverDomain, username, password, apiKey } = req.body;

  if (authMode === 'server_key' || (apiKey && !password)) {
    if (!serverDomain || !apiKey) {
      return res.status(400).json({ ok: false, error: 'Server domain and API key are required.' });
    }
    try {
      const cleanDomain = normalizeServerUrl(serverDomain);
      const result = await callSpeedotrack(cleanDomain, apiKey, 'GET_OBJECTS');
      if (!result.ok || result.error) {
        return res.json({ ok: false, error: result.error || result.text, normalizedUrl: cleanDomain });
      }
      return res.json({ ok: true, message: 'Connected successfully via Super Admin API Key.', normalizedUrl: cleanDomain });
    } catch (err) {
      return res.json({ ok: false, error: err.message });
    }
  }

  if (!serverDomain || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Server domain, CPanel username, and password are required.' });
  }

  try {
    const session = await loginDealerCPanel(serverDomain, username, password);
    const users = await dealerLoadUsers(session.domain, session.cookies, session.managerId);

    return res.json({
      ok: true,
      message: `Connected successfully as ${session.username} (${session.privileges || 'Dealer'})! Found ${users.length} managed client account(s).`,
      userCount: users.length,
      privileges: session.privileges,
      username: session.username,
      normalizedUrl: session.domain
    });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// 2. Super Administrator Server API Key Test
app.post('/api/test-connection', async (req, res) => {
  const { serverDomain, apiKey } = req.body;
  if (!serverDomain || !apiKey) {
    return res.status(400).json({ ok: false, error: 'Server domain and API key are required.' });
  }

  try {
    const cleanDomain = normalizeServerUrl(serverDomain);
    const result = await callSpeedotrack(cleanDomain, apiKey, 'GET_OBJECTS');
    
    if (!result.ok || result.error) {
      return res.json({
        ok: false,
        error: result.error || result.text || `Server returned HTTP status ${result.status}`,
        normalizedUrl: cleanDomain,
        raw: result.text
      });
    }

    let parsedJson = null;
    let objectCount = 0;
    try {
      parsedJson = JSON.parse(result.text);
      if (Array.isArray(parsedJson)) {
        objectCount = parsedJson.length;
      } else if (typeof parsedJson === 'object' && parsedJson !== null) {
        objectCount = Object.keys(parsedJson).length;
      }
    } catch {
      // not JSON
    }

    return res.json({
      ok: true,
      message: parsedJson !== null 
        ? `Connection verified! Server responded successfully (${objectCount} existing devices).` 
        : `Connection verified! Server accepted Super Admin key.`,
      normalizedUrl: cleanDomain,
      raw: result.text
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Provision a Single Row (Supports both Dealer CPanel Mode & Server API Key Mode)
app.post('/api/provision-row', async (req, res) => {
  const { authMode, serverDomain, username, password, apiKey, row } = req.body;

  if (!serverDomain || !row) {
    return res.status(400).json({ ok: false, error: 'Missing required configuration or row data.' });
  }

  const email = (row.email || '').trim().toLowerCase();
  const sendCredentials = String(row.send_credentials).toLowerCase() === 'true';
  const rawImei = (row.imei || '').trim();
  const plateNumber = (row.plate_number || row.plate || row.license_plate || '').trim();
  const objectName = (row.object_name || '').trim();
  const simNumber = (row.sim_number || row.sim || row.phone || '').trim();
  const rawExpireDate = normalizeDate(row.expire_date || row.expireDate || '');
  let expire = false;
  if (row.expire !== undefined && row.expire !== null && String(row.expire).trim() !== '') {
    expire = String(row.expire).toLowerCase() === 'true' || row.expire === true || row.expire === 1 || row.expire === '1';
  } else {
    // If expire column is not specified, auto-detect from expire_date:
    // Any non-empty date that isn't 'never' or 'lifetime' enables expiration automatically.
    expire = Boolean(rawExpireDate && !['never', 'none', 'lifetime', '0000-00-00', '-'].includes(rawExpireDate.toLowerCase()));
  }
  const expireDate = expire ? (rawExpireDate || '2028-01-01') : '';

  // Validate IMEI - reject Excel scientific notation (e.g. 359E14, 3.59E+14)
  const isScientific = /^[0-9.]+[eE][+]?[0-9]+$/.test(rawImei) || /^\d+[eE]\d+$/i.test(rawImei);
  const cleanImei = rawImei.replace(/[^0-9]/g, '');

  if (isScientific || cleanImei.length < 14 || cleanImei.length > 16) {
    return res.status(400).json({
      ok: false,
      email,
      imei: rawImei,
      error: isScientific 
        ? `Corrupted IMEI "${rawImei}": Excel converted this 15-digit number into scientific notation. Re-save your CSV with IMEI column formatted as Text.`
        : `Invalid IMEI "${rawImei}": GPS tracker IMEI must be 14 to 16 numeric digits (received ${cleanImei.length} digits).`
    });
  }

  if (!email) {
    return res.status(400).json({ ok: false, error: 'Email is required.' });
  }

  if (!objectName) {
    return res.status(400).json({ ok: false, error: 'Object name is compulsory and cannot be empty.' });
  }

  const cleanDomain = normalizeServerUrl(serverDomain);

  const steps = {
    user: { action: 'none', status: 'pending', message: '' },
    object: { action: 'none', status: 'pending', message: '' },
    assign: { action: 'none', status: 'pending', message: '' }
  };

  // ==========================================
  // MODE 1: DEALER CPANEL WEB SESSION (Default)
  // ==========================================
  if (authMode === 'dealer' || (!apiKey && username && password)) {
    try {
      const session = await loginDealerCPanel(cleanDomain, username, password);

      // --- STEP 1: USER HANDLING ---
      // 1a. Check existing users using multi-source matching
      let users = await dealerLoadUsers(session.domain, session.cookies, session.managerId);
      let matchedUser = findUser(users, email);

      if (matchedUser) {
        steps.user = { action: 'exists', status: 'success', message: `User account found: ${matchedUser.username} (ID: ${matchedUser.id})` };
      } else {
        // 1b. Register new user
        const regResult = await dealerRegisterUser(session.domain, session.cookies, session.managerId, email, sendCredentials);

        if (regResult === 'OK' || regResult === 'ERROR_EMAIL_EXISTS') {
          // Allow Speedotrack database to commit new record
          await new Promise(r => setTimeout(r, 400));
          // Reload user list to fetch new user ID
          users = await dealerLoadUsers(session.domain, session.cookies, session.managerId);
          matchedUser = findUser(users, email);

          steps.user = {
            action: regResult === 'OK' ? 'created' : 'exists',
            status: 'success',
            message: `User registered under dealer ${session.username} ${matchedUser ? `(ID: ${matchedUser.id})` : ''}`
          };
        } else {
          steps.user = {
            action: 'register_user',
            status: 'error',
            message: regResult === 'ERROR_NOT_SENT' ? 'User registered, but SMTP email sending failed.' : (regResult || 'Failed to create user')
          };
        }
      }

      const userId = matchedUser ? matchedUser.id : null;
      console.log(`[PROVISION] Email: ${email} -> Resolved User ID: ${userId || 'NOT FOUND'}`);

      // --- STEP 2: OBJECT HANDLING ---
      if (steps.user.status !== 'error') {
        const sanitizedName = objectName.replace(/,/g, ' ');
        const addObjResult = await dealerAddObject(
          session.domain,
          session.cookies,
          session.managerId,
          cleanImei,
          sanitizedName,
          expire,
          expireDate,
          userId,
          plateNumber,
          simNumber
        );

        console.log(`[PROVISION] add_object ${cleanImei} (Plate: ${plateNumber || 'N/A'}, SIM: ${simNumber || 'N/A'}) response:`, addObjResult);

        if (addObjResult === 'OK') {
          steps.object = { action: 'created', status: 'success', message: `Object registered (${sanitizedName}${plateNumber ? `, Plate: ${plateNumber}` : ''})` };
        } else if (addObjResult.includes('EXIST') || addObjResult.includes('already')) {
          steps.object = { action: 'exists', status: 'success', message: 'Object already exists on server' };
        } else {
          steps.object = { action: 'add_object', status: 'error', message: addObjResult || 'Failed to add object' };
        }
      }

      // --- STEP 3: ASSIGN OBJECT TO USER (MANDATORY BIDIRECTIONAL LINKING) ---
      if (steps.user.status !== 'error' && steps.object.status !== 'error') {
        if (!userId) {
          steps.assign = {
            action: 'assign',
            status: 'error',
            message: `Could not assign vehicle: User ID for "${email}" could not be resolved from server.`
          };
        } else {
          console.log(`[PROVISION] Linking vehicle ${cleanImei} to user ID ${userId} (${email})...`);
          
          // Method 1: fn_cpanel.users.php -> cmd: add_user_objects (links object under user account)
          const assignResult = await dealerAssignObject(session.domain, session.cookies, userId, cleanImei);
          console.log(`[PROVISION] add_user_objects result:`, assignResult);

          // Method 2: fn_cpanel.objects.php -> cmd: edit_object (stores user_ids, plate_number, sim_number on tracker object)
          const linkResult = await dealerLinkObjectUser(
            session.domain,
            session.cookies,
            session.managerId,
            cleanImei,
            objectName.replace(/,/g, ' '),
            expire,
            expireDate,
            userId,
            plateNumber,
            simNumber
          );
          console.log(`[PROVISION] edit_object (link user + plate + SIM) result:`, linkResult);

          const isAssigned = assignResult === 'OK' || linkResult === 'OK' || 
                             assignResult.includes('already') || linkResult.includes('already');

          if (isAssigned) {
            steps.assign = {
              action: 'assigned',
              status: 'success',
              message: `Assigned vehicle ${cleanImei} to ${email} (User ID: ${userId})`
            };
          } else {
            steps.assign = {
              action: 'add_user_objects',
              status: 'error',
              message: `Linking failed: ${assignResult || linkResult || 'Server error'}`
            };
          }
        }
      }

      const hasError = steps.user.status === 'error' || steps.object.status === 'error' || steps.assign.status === 'error';

      return res.json({
        ok: !hasError,
        email,
        imei: cleanImei,
        objectName,
        plateNumber,
        simNumber,
        steps,
        summary: hasError 
          ? [steps.user.status === 'error' ? `User: ${steps.user.message}` : null,
             steps.object.status === 'error' ? `Object: ${steps.object.message}` : null,
             steps.assign.status === 'error' ? `Assign: ${steps.assign.message}` : null].filter(Boolean).join(' | ')
          : 'User, object & assignment completed successfully.'
      });

    } catch (err) {
      return res.status(500).json({
        ok: false,
        email,
        imei: cleanImei,
        error: err.message,
        steps
      });
    }
  }

  // ==========================================
  // MODE 2: SUPER ADMIN SERVER API KEY
  // ==========================================
  try {
    // --- STEP 1: USER HANDLING ---
    const checkUserRes = await callSpeedotrack(cleanDomain, apiKey, `CHECK_USER_EXISTS,${email}`);
    if (!checkUserRes.ok) {
      steps.user = { action: 'check_user', status: 'error', message: checkUserRes.error || checkUserRes.text };
    } else {
      const respText = checkUserRes.text.toLowerCase();
      const userExists = respText === 'true' || respText === '1' || respText.includes('exist');

      if (userExists) {
        steps.user = { action: 'exists', status: 'success', message: 'User account already exists' };
      } else {
        const addUserRes = await callSpeedotrack(cleanDomain, apiKey, `ADD_USER,${email},${sendCredentials}`);
        if (!addUserRes.ok) {
          const addText = (addUserRes.text || '').toLowerCase();
          if (addText.includes('exist')) {
            steps.user = { action: 'exists', status: 'success', message: 'User account already exists' };
          } else {
            steps.user = { action: 'add_user', status: 'error', message: addUserRes.error || addUserRes.text || 'Failed to create user' };
          }
        } else {
          steps.user = { action: 'created', status: 'success', message: `User registered (Credentials emailed: ${sendCredentials})` };
        }
      }
    }

    // --- STEP 2: OBJECT HANDLING ---
    if (steps.user.status !== 'error') {
      const sanitizedName = objectName.replace(/,/g, ' ');
      const addObjectCmd = `ADD_OBJECT,${cleanImei},${sanitizedName},${expire},${expireDate}`;
      const addObjectRes = await callSpeedotrack(cleanDomain, apiKey, addObjectCmd);

      if (!addObjectRes.ok) {
        const addObjText = (addObjectRes.text || '').toLowerCase();
        if (addObjText.includes('exist')) {
          steps.object = { action: 'exists', status: 'success', message: 'Object already exists on server' };
          // Speedotrack API 1.9 (Page 7): Update activity & expiration date on existing object
          const setActivityCmd = `OBJECT_SET_ACTIVITY,${cleanImei},true,${expire ? 'true' : 'false'},${expire ? expireDate : ''}`;
          await callSpeedotrack(cleanDomain, apiKey, setActivityCmd);
        } else {
          steps.object = { action: 'add_object', status: 'error', message: addObjectRes.error || addObjectRes.text || 'Failed to add object' };
        }
      } else {
        steps.object = { action: 'created', status: 'success', message: `Object registered (${sanitizedName})` };
        if (expire && expireDate) {
          const setActivityCmd = `OBJECT_SET_ACTIVITY,${cleanImei},true,true,${expireDate}`;
          await callSpeedotrack(cleanDomain, apiKey, setActivityCmd);
        }
      }
    }

    // --- STEP 3: ASSIGN OBJECT TO USER ---
    if (steps.user.status !== 'error' && steps.object.status !== 'error') {
      const assignCmd = `ADD_USER_OBJECT,${email},${cleanImei}`;
      const assignRes = await callSpeedotrack(cleanDomain, apiKey, assignCmd);

      if (!assignRes.ok) {
        const assignText = (assignRes.text || '').toLowerCase();
        if (assignText.includes('already') || assignText.includes('exist')) {
          steps.assign = { action: 'already_assigned', status: 'success', message: 'Object already assigned to user' };
        } else {
          steps.assign = { action: 'add_user_object', status: 'error', message: assignRes.error || assignRes.text || 'Failed to assign object' };
        }
      } else {
        steps.assign = { action: 'assigned', status: 'success', message: `Assigned object ${cleanImei} to ${email}` };
      }
    }

    const hasError = steps.user.status === 'error' || steps.object.status === 'error' || steps.assign.status === 'error';

    return res.json({
      ok: !hasError,
      email,
      imei: cleanImei,
      objectName,
      steps,
      summary: hasError 
        ? [steps.user.status === 'error' ? `User: ${steps.user.message}` : null,
           steps.object.status === 'error' ? `Object: ${steps.object.message}` : null,
           steps.assign.status === 'error' ? `Assign: ${steps.assign.message}` : null].filter(Boolean).join(' | ')
        : 'User, object & assignment completed successfully.'
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      email,
      imei: cleanImei,
      error: err.message,
      steps
    });
  }
});

// =============================================================
// CAR TRACKER NIGERIA (GPSWOX) MIGRATION & REPOINTING SUITE
// =============================================================

function normalizeCarTrackerUrl(rawUrl) {
  let clean = (rawUrl || 'https://app.cartracker.com.ng').trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }
  clean = clean.replace(/\/+$/, '');
  // Automatically fix subdomain if user enters cartracker.com.ng without app.
  if (clean.includes('cartracker.com.ng') && !clean.includes('app.cartracker.com.ng')) {
    clean = clean.replace('cartracker.com.ng', 'app.cartracker.com.ng');
  }
  if (!clean.endsWith('/api')) {
    clean = clean + '/api';
  }
  return clean;
}

// 1. Connect / Authenticate to Car Tracker Nigeria (GPSWOX)
app.post('/api/migration/cartracker/connect', async (req, res) => {
  try {
    const { cartrackerUrl, email, password, userApiHash } = req.body;
    const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);

    // If user already supplied user_api_hash, test it via get_devices or get_user_data
    if (userApiHash && userApiHash.trim()) {
      const hash = userApiHash.trim();
      const testRes = await fetch(`${apiUrl}/get_user_data?lang=en&user_api_hash=${encodeURIComponent(hash)}`);
      const testData = await testRes.json().catch(() => null);

      if (testData && (testData.status === 1 || testData.email)) {
        return res.json({
          ok: true,
          userApiHash: hash,
          user: {
            email: testData.email || 'Authenticated User',
            plan: testData.plan || 'Active'
          },
          message: 'Connected successfully using existing user_api_hash.'
        });
      }
    }

    // Authenticate with email & password
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password (or user_api_hash) are required.' });
    }

    const formData = new URLSearchParams();
    formData.append('email', email.trim());
    formData.append('password', password);

    const loginRes = await fetch(`${apiUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'SpeedotrackMigrationSuite/1.0'
      },
      body: formData.toString()
    });

    const loginData = await loginRes.json().catch(() => null);

    if (!loginData || loginData.status !== 1 || !loginData.user_api_hash) {
      return res.status(401).json({
        ok: false,
        error: (loginData && loginData.message) ? loginData.message : 'Invalid Car Tracker Nigeria credentials or unreachable API.'
      });
    }

    return res.json({
      ok: true,
      userApiHash: loginData.user_api_hash,
      message: 'Logged in to Car Tracker Nigeria successfully.'
    });

  } catch (err) {
    console.error('Car Tracker Nigeria connect error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Connection to Car Tracker Nigeria failed.' });
  }
});

// 2. Fetch all devices from Car Tracker Nigeria
app.post('/api/migration/cartracker/devices', async (req, res) => {
  try {
    const { cartrackerUrl, userApiHash } = req.body;
    if (!userApiHash) {
      return res.status(400).json({ ok: false, error: 'user_api_hash is required.' });
    }

    const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);
    const hashParam = encodeURIComponent(userApiHash.trim());

    // Fetch device fleet, account metadata, setup subscription, and admin devices in parallel
    const [devRes, userRes, setupRes, adminRes] = await Promise.all([
      fetch(`${apiUrl}/get_devices?lang=en&user_api_hash=${hashParam}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SpeedotrackBulkProvisioner/1.0' }
      }).catch(e => { console.error('get_devices fetch error:', e.message); return null; }),
      fetch(`${apiUrl}/get_user_data?lang=en&user_api_hash=${hashParam}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SpeedotrackBulkProvisioner/1.0' }
      }).catch(() => null),
      fetch(`${apiUrl}/edit_setup_data?lang=en&user_api_hash=${hashParam}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SpeedotrackBulkProvisioner/1.0' }
      }).catch(() => null),
      fetch(`${apiUrl}/admin/devices?lang=en&user_api_hash=${hashParam}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'SpeedotrackBulkProvisioner/1.0' }
      }).catch(() => null)
    ]);

    const rawData = devRes ? await devRes.json().catch(() => null) : null;
    const userData = userRes ? await userRes.json().catch(() => null) : null;
    const setupData = setupRes ? await setupRes.json().catch(() => null) : null;
    const adminData = adminRes ? await adminRes.json().catch(() => null) : null;

    if (!rawData) {
      return res.status(500).json({ ok: false, error: 'Failed to parse devices response from Car Tracker Nigeria.' });
    }

    // Check account-level expiration date (from /get_user_data or /edit_setup_data)
    let accountExpiration = '';
    if (userData && userData.expiration_date) {
      const norm = normalizeDate(userData.expiration_date);
      if (norm && norm !== '0000-00-00') accountExpiration = norm;
    }
    if (!accountExpiration && setupData && setupData.item && setupData.item.subscription_expiration) {
      const norm = normalizeDate(setupData.item.subscription_expiration);
      if (norm && norm !== '0000-00-00') accountExpiration = norm;
    }

    // Build map from admin devices if available (e.g. imei -> expiration_date)
    const adminDevicesMap = new Map();
    if (adminData && Array.isArray(adminData.data)) {
      for (const ad of adminData.data) {
        if (ad && ad.imei) {
          const cleanImei = String(ad.imei).trim();
          const adExp = normalizeDate(ad.expiration_date || ad.expires_date || '');
          if (adExp && adExp !== '0000-00-00') {
            adminDevicesMap.set(cleanImei, adExp);
          }
        }
      }
    }

    let rawList = [];
    if (Array.isArray(rawData)) {
      // [{ title: "Ungrouped", items: [...] }]
      for (const group of rawData) {
        if (group && Array.isArray(group.items)) {
          rawList.push(...group.items);
        } else if (group && group.device_data) {
          rawList.push(group);
        }
      }
    } else if (rawData.items && Array.isArray(rawData.items)) {
      rawList = rawData.items;
    }

    // Normalize each vehicle
    const devices = rawList.map(item => {
      const data = item.device_data || {};
      const imei = String(data.imei || item.imei || '').trim();
      const name = String(item.name || data.name || 'Unnamed Vehicle').trim();
      const plateNumber = String(data.plate_number || '').trim();
      const simNumber = String(data.sim_number || '').trim();
      const deviceModel = String(data.device_model || '').trim();
      const protocol = String(item.protocol || data.protocol || '').trim().toLowerCase();
      const online = String(item.online || 'offline').trim().toLowerCase();
      const lastTime = item.time || data.updated_at || '';
      const clientEmail = (data.users && Array.isArray(data.users) && data.users[0]?.email) || '';

      // 1. Inspect all potential device-level expiration properties in GPSWOX
      let rawExpiration = 
        data.expiration_date || 
        item.expiration_date || 
        data.expires_date || 
        item.expires_date || 
        data.subscription_expiration || 
        item.subscription_expiration || 
        data.expire_date || 
        item.expire_date || 
        (data.pivot && (data.pivot.expiration_date || data.pivot.expires_date)) || 
        (item.pivot && (item.pivot.expiration_date || item.pivot.expires_date)) || 
        adminDevicesMap.get(imei) || 
        '';

      // 2. Check item.services if present
      if ((!rawExpiration || rawExpiration === '0000-00-00') && Array.isArray(item.services)) {
        for (const s of item.services) {
          if (s && (s.expires_date || s.expiration_date)) {
            rawExpiration = s.expires_date || s.expiration_date;
            break;
          }
        }
      }

      // 3. Normalize date format (YYYY-MM-DD)
      let normalizedExp = normalizeDate(rawExpiration);

      // 4. Fall back to account-level expiration if device itself has no expiration
      if (!normalizedExp && accountExpiration) {
        normalizedExp = accountExpiration;
      }

      const hasExpiry = Boolean(
        normalizedExp &&
        normalizedExp !== '0000-00-00' &&
        !['never', 'none', 'lifetime', '0000-00-00', '-', 'unlimited'].includes(normalizedExp.toLowerCase())
      );

      const expireDate = hasExpiry ? normalizedExp : '';
      const expire = hasExpiry;

      return {
        id: item.id || data.id,
        name,
        imei,
        plateNumber,
        simNumber,
        deviceModel,
        protocol: protocol || 'gt06',
        online,
        lastTime,
        lat: item.lat || 0,
        lng: item.lng || 0,
        speed: item.speed || 0,
        clientEmail,
        expire,
        expireDate
      };
    }).filter(d => d.imei && d.imei.length >= 8);

    console.log(`[CarTracker] Fetched ${devices.length} valid devices from Car Tracker Nigeria.`);
    console.log(`[CarTracker] Account-level expiration fallback: "${accountExpiration || 'None / Unlimited'}"`);
    console.log(`[CarTracker] Admin devices map size: ${adminDevicesMap.size}`);
    if (rawList.length > 0) {
      console.log(`[CarTracker Sample 1 Expiration Diagnostic]:`, {
        name: rawList[0].name || (rawList[0].device_data && rawList[0].device_data.name),
        imei: rawList[0].imei || (rawList[0].device_data && rawList[0].device_data.imei),
        'item.expiration_date': rawList[0].expiration_date,
        'device_data.expiration_date': rawList[0].device_data?.expiration_date,
        'item.expires_date': rawList[0].expires_date,
        'device_data.expires_date': rawList[0].device_data?.expires_date,
        'resolved_expireDate': devices[0]?.expireDate,
        'resolved_expire': devices[0]?.expire
      });
    }

    return res.json({
      ok: true,
      count: devices.length,
      accountExpiration,
      devices
    });

  } catch (err) {
    console.error('Car Tracker Nigeria devices error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});



// 4. Send GPRS / SMS Repoint command to vehicle via Car Tracker Nigeria
app.post('/api/migration/device/repoint', async (req, res) => {
  try {
    const {
      cartrackerUrl,
      userApiHash,
      deviceId,
      imei,
      command,
      channel = 'gprs' // 'gprs' or 'sms'
    } = req.body;

    if (!userApiHash || !deviceId || !command) {
      return res.status(400).json({ ok: false, error: 'Missing userApiHash, deviceId, or command.' });
    }

    const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);
    console.log(`[REPOINT] Sending ${channel.toUpperCase()} command to Device ID ${deviceId} (IMEI: ${imei || 'N/A'}): "${command}"`);

    if (channel === 'sms') {
      const formData = new URLSearchParams();
      formData.append('devices[]', deviceId);
      formData.append('message', command);

      const smsRes = await fetch(`${apiUrl}/send_sms_command?lang=en&user_api_hash=${encodeURIComponent(userApiHash)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: formData.toString()
      });

      const smsData = await smsRes.json().catch(() => null);
      const isSuccess = smsData && (smsData.status === 1 || smsData.success);

      return res.json({
        ok: isSuccess,
        channel: 'sms',
        command,
        response: smsData,
        message: isSuccess ? 'SMS command queued successfully.' : ((smsData && smsData.error) || 'Failed to dispatch SMS command.')
      });
    }

    // Default: GPRS command
    const formData = new URLSearchParams();
    formData.append('device_id', deviceId);
    formData.append('type', 'custom');
    formData.append('data', command);
    formData.append('message', command);

    const gprsRes = await fetch(`${apiUrl}/send_gprs_command?lang=en&user_api_hash=${encodeURIComponent(userApiHash)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    });


    const gprsData = await gprsRes.json().catch(() => null);
    const isSuccess = gprsData && (gprsData.status === 1 || gprsData.success);

    return res.json({
      ok: isSuccess,
      channel: 'gprs',
      command,
      response: gprsData,
      message: isSuccess ? 'GPRS repoint command sent to device successfully.' : ((gprsData && (gprsData.error || gprsData.message)) || 'Failed to send GPRS command (vehicle may be offline).')
    });

  } catch (err) {
    console.error('Device repoint error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// =============================================================
// SPEEDOTRACK CLIENT FLEET LOADER & CUTOVER VERIFICATION
// =============================================================

// Universal Speedotrack Login (Supports both Client User and Dealer Manager)
async function loginSpeedotrackUser(serverDomain, username, password) {
  const cleanDomain = normalizeServerUrl(serverDomain);
  const loginBody = new URLSearchParams({
    cmd: 'login',
    username: username.trim(),
    password: password,
    remember_me: 'false',
    mobile: 'false'
  });

  const res = await fetch(`${cleanDomain}/func/fn_connect.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
    },
    body: loginBody.toString()
  });

  const text = (await res.text()).trim();
  if (text === 'ERROR_USERNAME_PASSWORD_INCORRECT') {
    throw new Error('Incorrect Speedotrack username or password.');
  }
  if (text !== 'LOGIN_TRACKING' && text !== 'LOGIN_CPANEL') {
    throw new Error(`Speedotrack login failed (${text || `HTTP ${res.status}`}).`);
  }

  const cookies = extractCookies(res);
  const isCpanel = text === 'LOGIN_CPANEL';

  let managerId = '';
  let privileges = isCpanel ? 'Dealer' : 'User';
  if (isCpanel) {
    try {
      const loadRes = await fetch(`${cleanDomain}/func/fn_cpanel.server.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
        body: new URLSearchParams({ cmd: 'load_cpanel_data' }).toString()
      });
      const loadJson = await loadRes.json().catch(() => null);
      if (loadJson) {
        managerId = loadJson.manager_id || '';
        privileges = loadJson.privileges || privileges;
      }
    } catch (e) {}
  }

  return {
    domain: cleanDomain,
    username: username.trim(),
    role: isCpanel ? 'dealer' : 'client',
    privileges,
    managerId,
    cookies
  };
}

// Load Objects for Client (Tracking Mode)
async function loadTrackingClientObjects(cleanDomain, cookies) {
  try {
    // 1. Fetch object metadata from fn_settings.objects.php?cmd=load_object_data
    let settingsMap = {};
    try {
      const sRes = await fetch(`${cleanDomain}/func/fn_settings.objects.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies,
          'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
        },
        body: new URLSearchParams({ cmd: 'load_object_data' }).toString()
      });
      const sJson = await sRes.json().catch(() => null);
      if (sJson && typeof sJson === 'object' && !Array.isArray(sJson)) {
        settingsMap = sJson;
      }
    } catch (e) {
      console.warn('fn_settings.objects.php cmd=load_object_data error:', e.message);
    }

    // 2. Fetch live telemetry from fn_objects.php?cmd=load_object_data
    let liveMap = {};
    try {
      const liveRes = await fetch(`${cleanDomain}/func/fn_objects.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies,
          'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
        },
        body: 'cmd=load_object_data'
      });
      const liveJson = await liveRes.json().catch(() => null);
      if (liveJson && typeof liveJson === 'object' && !Array.isArray(liveJson)) {
        liveMap = liveJson;
      }
    } catch (e) {
      console.warn('fn_objects.php error:', e.message);
    }

    console.log(`[TRACKING_OBJECTS] settingsMap objects: ${Object.keys(settingsMap).length}, liveMap objects: ${Object.keys(liveMap).length}`);

    // 3. Map settingsMap objects (primary source of name, plate, SIM)
    const imeis = new Set([...Object.keys(settingsMap), ...Object.keys(liveMap)]);
    if (imeis.size > 0) {
      return Array.from(imeis).map(imei => {
        const arr = settingsMap[imei] || [];
        const live = liveMap[imei] || {};

        let name = '';
        let simNumber = '';
        let plateNumber = '';
        let expireDate = '';

        if (Array.isArray(arr) && arr.length >= 15) {
          name = String(arr[4] || '').replace(/^:\s*/, '').trim();
          simNumber = String(arr[11] || '').trim();
          plateNumber = String(arr[14] || '').trim();
          expireDate = String(arr[33] || '').trim();
        } else if (typeof arr === 'object' && arr !== null) {
          name = String(arr.name || '').trim();
          simNumber = String(arr.sim_number || '').trim();
          plateNumber = String(arr.plate_number || '').trim();
        }

        if (!name) name = String(live.name || `Vehicle ${imei}`).trim();
        if (!plateNumber && live.plate_number) plateNumber = String(live.plate_number).trim();
        if (!simNumber && live.sim_number) simNumber = String(live.sim_number).trim();

        // Speedotrack fn_objects.php stores live points in live.d: [ [dtServer, dtTracker, lat, lng, speed, angle, ...], ... ]
        const dArray = live && Array.isArray(live.d) && live.d.length > 0 ? live.d[0] : null;
        let dtServer = live.dt_server || '';
        let dtTracker = live.dt_tracker || '';
        let lat = 0;
        let lng = 0;
        let speed = 0;

        if (dArray && Array.isArray(dArray) && dArray.length >= 4) {
          if (!dtServer || dtServer.startsWith('0000-00-00')) dtServer = String(dArray[0] || '').trim();
          if (!dtTracker || dtTracker.startsWith('0000-00-00')) dtTracker = String(dArray[1] || '').trim();
          lat = parseFloat(dArray[2]) || 0;
          lng = parseFloat(dArray[3]) || 0;
          speed = parseFloat(dArray[4]) || 0;
        }

        // Connection code: cn === 2 (connected socket), 1 (standby), 0 (offline)
        const isConnected = live.cn === 2 || String(live.connection || '').toLowerCase() === 'yes';
        const hasReported = Boolean(dtServer && !dtServer.startsWith('0000-00-00') && dtServer !== '-') || isConnected;
        const status = hasReported ? (isConnected ? 'online' : (live.st === 'm' ? 'moving' : 'standby')) : 'offline';
        const statusText = live.ststr || (hasReported ? (isConnected ? 'Online' : 'Standby') : 'Offline');

        return {
          id: imei,
          imei,
          name: name || `Vehicle ${imei}`,
          plateNumber,
          simNumber,
          expireDate,
          isConnected,
          status,
          statusText,
          dtServer,
          dtTracker,
          lat,
          lng,
          speed,
          isPointed: hasReported
        };
      });
    }


    return [];
  } catch (err) {
    console.error('loadTrackingClientObjects error:', err);
    return [];
  }
}

// Map rows from fn_cpanel.objects.php or load_user_object_list into structured vehicle objects
function mapDealerObjectRows(rows, liveMap = {}) {
  return rows.map(r => {
    const cell = r.cell || [];

    // 1. Detect 14-16 digit device IMEI
    let imei = String(r.id || '').trim();
    if (!/^\d{14,16}$/.test(imei)) {
      for (const c of cell) {
        const s = String(c || '').trim();
        if (/^\d{14,16}$/.test(s)) {
          imei = s;
          break;
        }
      }
    }
    if (!imei) {
      imei = String(r.id || cell[1] || cell[0] || '').trim();
    }

    // 2. Vehicle Name
    let name = String(cell[0] || r.id || 'Unnamed Vehicle').trim();
    if (/^\d{14,16}$/.test(name) && cell[1] && !/^\d{14,16}$/.test(cell[1])) {
      name = String(cell[1]).trim();
    }

    // 3. Plate & SIM
    let plateNumber = '';
    let simNumber = '';
    let dtServer = '';
    let dtTracker = '';

    // Inspect cells for timestamps (YYYY-MM-DD HH:mm:ss)
    for (const c of cell) {
      const s = String(c || '').trim();
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(s)) {
        if (!dtServer) dtServer = s;
        else if (!dtTracker) dtTracker = s;
      }
    }

    if (cell.length >= 6) {
      plateNumber = String(cell[4] || '').trim();
      simNumber = String(cell[5] || '').trim();
      if (!dtServer && cell[7]) dtServer = String(cell[7]).trim();
      if (!dtTracker && cell[8]) dtTracker = String(cell[8]).trim();
    }

    // 4. Merge live telemetry from liveMap if available
    const live = liveMap[imei] || {};
    if (live.name && (!name || name === 'Unnamed Vehicle')) name = live.name;
    if (live.plate_number && !plateNumber) plateNumber = live.plate_number;
    if (live.sim_number && !simNumber) simNumber = live.sim_number;

    const dArray = live && Array.isArray(live.d) && live.d.length > 0 ? live.d[0] : null;
    if (dArray && Array.isArray(dArray) && dArray.length >= 4) {
      if (!dtServer || dtServer.startsWith('0000-00-00')) dtServer = String(dArray[0] || '').trim();
      if (!dtTracker || dtTracker.startsWith('0000-00-00')) dtTracker = String(dArray[1] || '').trim();
    }
    if (live.dt_server && (!dtServer || dtServer.startsWith('0000-00-00'))) dtServer = live.dt_server;
    if (live.dt_tracker && (!dtTracker || dtTracker.startsWith('0000-00-00'))) dtTracker = live.dt_tracker;

    const isConnected = live.cn === 2 || String(live.connection || '').toLowerCase() === 'yes';
    const hasReported = Boolean(dtServer && !dtServer.startsWith('0000-00-00') && dtServer !== '-') || isConnected;
    const status = hasReported ? (isConnected ? 'online' : (live.st === 'm' ? 'moving' : 'standby')) : 'offline';

    return {
      id: imei,
      imei,
      name,
      plateNumber,
      simNumber,
      isConnected,
      dtServer,
      dtTracker,
      isPointed: hasReported,
      status
    };
  });
}


// Load Objects for Managed Client under Dealer Account
async function loadDealerClientObjects(cleanDomain, cookies, managerId, clientEmail) {
  const normTarget = (clientEmail || '').trim().toLowerCase();
  const isAll = !normTarget || normTarget === 'all' || normTarget === 'cartrack';

  // 1. Fetch live telemetry map from fn_objects.php
  let liveMap = {};
  try {
    const liveRes = await fetch(`${cleanDomain}/func/fn_objects.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
      },
      body: 'cmd=load_object_data'
    });
    const liveJson = await liveRes.json().catch(() => null);
    if (liveJson && typeof liveJson === 'object') {
      liveMap = liveJson;
    }
  } catch (e) {
    console.warn('Dealer fn_objects.php error:', e.message);
  }

  // 2. If a specific client account was requested, query client-assigned vehicles first
  const users = await dealerLoadUsers(cleanDomain, cookies, managerId);
  const matched = findUser(users, clientEmail);
  console.log(`[DEALER_OBJECTS] Target client: "${clientEmail}" -> matched?`, Boolean(matched), matched ? `(ID: ${matched.id}, User: ${matched.username})` : '');

  if (!isAll && matched && matched.id) {
    // 2a. Query fn_cpanel.users.php?cmd=load_user_object_list&id=... (Exact endpoint used by CPanel UI)
    try {
      const userObjUrl = `${cleanDomain}/func/fn_cpanel.users.php?cmd=load_user_object_list&id=${encodeURIComponent(matched.id)}`;
      const userObjRes = await fetch(userObjUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies,
          'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
        },
        body: new URLSearchParams({ page: '1', rows: '1000', sidx: 'name', sord: 'asc', _search: 'false' }).toString()
      });
      const userObjData = await userObjRes.json().catch(() => null);
      if (userObjData && Array.isArray(userObjData.rows) && userObjData.rows.length > 0) {
        console.log(`[DEALER_OBJECTS] Found ${userObjData.rows.length} object(s) via load_user_object_list for user ID ${matched.id}`);
        return mapDealerObjectRows(userObjData.rows, liveMap);
      }
    } catch (e) {
      console.warn('load_user_object_list error:', e.message);
    }
  }

  // 3. Fetch all objects under this dealer from fn_cpanel.objects.php
  let rows = [];
  try {
    const managerParam = managerId ? `&manager_id=${encodeURIComponent(managerId)}` : '';
    const objListUrl = `${cleanDomain}/func/fn_cpanel.objects.php?cmd=load_object_list${managerParam}`;
    const res = await fetch(objListUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'User-Agent': 'SpeedotrackBulkProvisioner/1.0'
      },
      body: new URLSearchParams({
        cmd: 'load_object_list',
        page: '1',
        rows: '2000',
        sidx: 'name',
        sord: 'asc',
        _search: 'false',
        manager_id: managerId || ''
      }).toString()
    });

    const data = await res.json().catch(() => null);
    if (data && Array.isArray(data.rows)) {
      rows = data.rows;
    }
    console.log(`[DEALER_OBJECTS] Total dealer rows from fn_cpanel.objects: ${rows.length}. Target client: "${clientEmail}"`);
    if (rows.length > 0) {
      console.log(`[DEALER_OBJECTS] Sample row:`, JSON.stringify(rows[0]));
    }
  } catch (e) {
    console.warn('fn_cpanel.objects.php error:', e.message);
  }

  // 4. If dealer requested all or their own dealer account, return all objects
  if (isAll) {
    if (rows.length > 0) {
      return mapDealerObjectRows(rows, liveMap);
    }
    // Fallback: extract directly from liveMap if jqGrid rows was empty
    const liveEntries = Object.entries(liveMap);
    if (liveEntries.length > 0) {
      return liveEntries.map(([imeiKey, live]) => {
        const imei = String(live.imei || imeiKey).trim();
        const isConnected = String(live.connection || '').toLowerCase() === 'yes';
        const dtServer = live.dt_server || '';
        const dtTracker = live.dt_tracker || '';
        const hasReported = Boolean(dtServer && dtServer !== '0000-00-00 00:00:00' && dtServer !== '-') || isConnected;

        return {
          id: imei,
          imei,
          name: String(live.name || live.plate_number || 'Vehicle ' + imei).trim(),
          plateNumber: String(live.plate_number || '').trim(),
          simNumber: String(live.sim_number || '').trim(),
          isConnected,
          status: hasReported ? (isConnected ? 'online' : 'standby') : 'offline',
          dtServer,
          dtTracker,
          isPointed: hasReported
        };
      });
    }
    return [];
  }

  // 5. Match target client across dealer rows
  const userNorm = matched ? matched.username.toLowerCase() : normTarget;
  const emailNorm = matched ? matched.email.toLowerCase() : normTarget;
  const userIdStr = matched ? String(matched.id) : '';

  let userAssignedImeis = new Set();
  if (matched && matched.id) {
    try {
      const uRes = await fetch(`${cleanDomain}/func/fn_cpanel.users.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
        body: new URLSearchParams({ cmd: 'load_user_data', user_id: String(matched.id) }).toString()
      });
      const uData = await uRes.json().catch(() => null);
      if (uData && Array.isArray(uData.obj_ids)) {
        uData.obj_ids.forEach(id => userAssignedImeis.add(String(id)));
      }
      if (uData && Array.isArray(uData.objects)) {
        uData.objects.forEach(id => userAssignedImeis.add(String(id)));
      }
    } catch (e) {}
  }

  let filteredRows = rows.filter(r => {
    const cell = r.cell || [];
    let imei = String(r.id || '').trim();
    if (!/^\d{14,16}$/.test(imei)) {
      for (const c of cell) {
        const s = String(c || '').trim();
        if (/^\d{14,16}$/.test(s)) {
          imei = s;
          break;
        }
      }
    }
    if (userAssignedImeis.has(imei)) return true;

    const fullRowStr = (JSON.stringify(cell) + ' ' + (r.id || '')).toLowerCase();
    if (emailNorm && fullRowStr.includes(emailNorm)) return true;
    if (userNorm && fullRowStr.includes(userNorm)) return true;
    if (userIdStr && fullRowStr.includes(`"${userIdStr}"`)) return true;
    return false;
  });

  console.log(`[DEALER_OBJECTS] Filtered rows for "${clientEmail}": ${filteredRows.length} of ${rows.length}`);

  // Fallback: if filtered is empty but dealer has objects and fleet is small, return dealer rows so user can repoint
  if (filteredRows.length === 0 && rows.length > 0) {
    console.warn(`[DEALER_OBJECTS] Filter yielded 0 for "${clientEmail}". Falling back to all ${rows.length} dealer objects.`);
    return mapDealerObjectRows(rows, liveMap);
  }

  if (filteredRows.length === 0 && Object.keys(liveMap).length > 0) {
    console.warn(`[DEALER_OBJECTS] Falling back to liveMap (${Object.keys(liveMap).length} objects).`);
    return Object.entries(liveMap).map(([imeiKey, live]) => {
      const imei = String(live.imei || imeiKey).trim();
      const isConnected = String(live.connection || '').toLowerCase() === 'yes';
      const dtServer = live.dt_server || '';
      const dtTracker = live.dt_tracker || '';
      const hasReported = Boolean(dtServer && dtServer !== '0000-00-00 00:00:00' && dtServer !== '-') || isConnected;

      return {
        id: imei,
        imei,
        name: String(live.name || live.plate_number || 'Vehicle ' + imei).trim(),
        plateNumber: String(live.plate_number || '').trim(),
        simNumber: String(live.sim_number || '').trim(),
        isConnected,
        status: hasReported ? (isConnected ? 'online' : 'standby') : 'offline',
        dtServer,
        dtTracker,
        isPointed: hasReported
      };
    });
  }

  return mapDealerObjectRows(filteredRows, liveMap);
}

// 1. Authenticate Speedotrack Client or Dealer
app.post('/api/speedotrack/client/login', async (req, res) => {
  const { serverDomain, username, password } = req.body;
  if (!serverDomain || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Server domain, username/email, and password are required.' });
  }

  try {
    const session = await loginSpeedotrackUser(serverDomain, username, password);
    return res.json({
      ok: true,
      message: `Connected successfully as ${session.username} (${session.role === 'dealer' ? 'Dealer Manager' : 'Client Account'})`,
      role: session.role,
      privileges: session.privileges,
      username: session.username,
      normalizedUrl: session.domain
    });
  } catch (err) {
    return res.status(401).json({ ok: false, error: err.message });
  }
});

// 2. Fetch Fleet from Speedotrack for Client (with Pointed / Cutover Status)
app.post('/api/speedotrack/client/vehicles', async (req, res) => {
  const { serverDomain, username, password, clientEmail } = req.body;
  if (!serverDomain || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Missing Speedotrack credentials.' });
  }

  try {
    const session = await loginSpeedotrackUser(serverDomain, username, password);
    let vehicles = [];

    if (session.role === 'dealer') {
      const targetClient = (clientEmail || '').trim() || username;
      vehicles = await loadDealerClientObjects(session.domain, session.cookies, session.managerId, targetClient);
    } else {
      vehicles = await loadTrackingClientObjects(session.domain, session.cookies);
    }

    const pointedCount = vehicles.filter(v => v.isPointed).length;
    const pendingCount = vehicles.length - pointedCount;

    return res.json({
      ok: true,
      count: vehicles.length,
      pointedCount,
      pendingCount,
      vehicles
    });
  } catch (err) {
    console.error('Speedotrack fetch vehicles error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Verify Live Cutover for Specific IMEIs on Speedotrack
app.post('/api/speedotrack/verify-cutover', async (req, res) => {
  const { serverDomain, username, password, clientEmail, imeis = [] } = req.body;
  if (!serverDomain || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Missing credentials.' });
  }

  try {
    const session = await loginSpeedotrackUser(serverDomain, username, password);
    let vehicles = [];

    if (session.role === 'dealer') {
      const targetClient = (clientEmail || '').trim() || username;
      vehicles = await loadDealerClientObjects(session.domain, session.cookies, session.managerId, targetClient);
    } else {
      vehicles = await loadTrackingClientObjects(session.domain, session.cookies);
    }

    const statusMap = {};
    for (const v of vehicles) {
      if (imeis.length === 0 || imeis.includes(v.imei)) {
        statusMap[v.imei] = {
          isPointed: v.isPointed,
          status: v.status,
          dtServer: v.dtServer,
          dtTracker: v.dtTracker
        };
      }
    }

    return res.json({ ok: true, statusMap });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Cache Car Tracker Nigeria user sessions and device maps
const ctUserSessions = new Map(); // cacheKey -> { userApiHash, expiresAt }
const ctUserDeviceMaps = new Map(); // cacheKey -> { byImei: Map, expiresAt }

async function getCarTrackerApiHash(cartrackerUrl, email, password, explicitHash = '') {
  if (explicitHash && explicitHash.trim()) return explicitHash.trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);
  const cacheKey = `${apiUrl}_${cleanEmail}`;

  const cached = ctUserSessions.get(cacheKey);
  if (cached && cached.userApiHash && Date.now() < cached.expiresAt) {
    return cached.userApiHash;
  }

  const formData = new URLSearchParams();
  formData.append('email', email.trim());
  formData.append('password', password);

  const loginRes = await fetch(`${apiUrl}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: formData.toString()
  });
  const loginData = await loginRes.json().catch(() => null);
  if (!loginData || loginData.status !== 1 || !loginData.user_api_hash) {
    throw new Error((loginData && loginData.message) || 'Invalid Car Tracker Nigeria credentials.');
  }

  ctUserSessions.set(cacheKey, {
    userApiHash: loginData.user_api_hash,
    expiresAt: Date.now() + 15 * 60 * 1000 // 15 min cache
  });
  return loginData.user_api_hash;
}

async function getCarTrackerDeviceByImei(cartrackerUrl, userApiHash, imei) {
  const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);
  const targetImei = String(imei).trim();
  const cacheKey = `${apiUrl}_${userApiHash}`;

  let devMap = ctUserDeviceMaps.get(cacheKey);
  if (!devMap || Date.now() >= devMap.expiresAt) {
    const devRes = await fetch(`${apiUrl}/get_devices?lang=en&user_api_hash=${encodeURIComponent(userApiHash)}`, {
      headers: { 'Accept': 'application/json' }
    });
    const rawData = await devRes.json().catch(() => null);
    const byImei = new Map();

    if (Array.isArray(rawData)) {
      for (const group of rawData) {
        const items = (group && Array.isArray(group.items)) ? group.items : (group && group.device_data ? [group] : []);
        for (const it of items) {
          const dData = it.device_data || {};
          const devImei = String(dData.imei || it.imei || '').trim();
          if (devImei) {
            byImei.set(devImei, {
              id: it.id || dData.id,
              imei: devImei,
              name: it.name || dData.name || '',
              online: String(it.online || 'offline').trim().toLowerCase(),
              simNumber: String(dData.sim_number || '').trim()
            });
          }
        }
      }
    }
    devMap = { byImei, expiresAt: Date.now() + 5 * 60 * 1000 };
    ctUserDeviceMaps.set(cacheKey, devMap);
  }

  return devMap.byImei.get(targetImei) || null;
}

// 4. Dispatch Repoint Command (via Car Tracker Nigeria Active Socket or Speedotrack)
app.post('/api/speedotrack/client/repoint-device', async (req, res) => {
  const {
    serverDomain = 'https://server.cartracker.com.ng/',
    username = '',
    password = '',
    imei,
    command = 'SERVER,0,103.143.148.122,10202,0#',
    channel = 'gprs',
    simNumber = '',
    gateway = 'cartracker', // 'cartracker' (active socket) or 'speedotrack'
    cartrackerUrl = 'https://app.cartracker.com.ng',
    ctPassword = '',
    ctUserApiHash = ''
  } = req.body;

  if (!imei) {
    return res.status(400).json({ ok: false, error: 'Device imei is required.' });
  }

  // A. Dispatch via Car Tracker Nigeria Active GPRS Socket
  if (gateway === 'cartracker') {
    try {
      const email = (username || '').trim();
      const ctPass = ctPassword || password;
      const apiUrl = normalizeCarTrackerUrl(cartrackerUrl);

      if (!email || (!ctPass && !ctUserApiHash)) {
        return res.status(400).json({ ok: false, error: 'Client email and password are required for Car Tracker Nigeria gateway.' });
      }

      const userApiHash = await getCarTrackerApiHash(apiUrl, email, ctPass, ctUserApiHash);
      const ctDevice = await getCarTrackerDeviceByImei(apiUrl, userApiHash, imei);

      if (!ctDevice) {
        return res.status(404).json({
          ok: false,
          gateway: 'cartracker',
          error: `IMEI ${imei} was not found on Car Tracker Nigeria account ${email}.`
        });
      }

      console.log(`[CARTRACKER GATEWAY] Sending ${channel.toUpperCase()} command to ${ctDevice.name} (Device ID: ${ctDevice.id}, IMEI: ${imei}): "${command}"`);

      if (channel === 'sms') {
        const formData = new URLSearchParams();
        formData.append('devices[]', ctDevice.id);
        formData.append('message', command);

        const smsRes = await fetch(`${apiUrl}/send_sms_command?lang=en&user_api_hash=${encodeURIComponent(userApiHash)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
          body: formData.toString()
        });
        const smsData = await smsRes.json().catch(() => null);
        const isSuccess = smsData && (smsData.status === 1 || smsData.success);

        return res.json({
          ok: isSuccess,
          gateway: 'cartracker',
          channel: 'sms',
          deviceId: ctDevice.id,
          imei,
          command,
          simNumber: ctDevice.simNumber || simNumber,
          message: isSuccess ? 'SMS command dispatched via Car Tracker Nigeria.' : ((smsData && smsData.error) || 'Failed to dispatch SMS command.')
        });
      }

      // Default: GPRS socket command
      const formData = new URLSearchParams();
      formData.append('device_id', ctDevice.id);
      formData.append('type', 'custom');
      formData.append('data', command);
      formData.append('message', command);

      const gprsRes = await fetch(`${apiUrl}/send_gprs_command?lang=en&user_api_hash=${encodeURIComponent(userApiHash)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: formData.toString()
      });
      const gprsData = await gprsRes.json().catch(() => null);
      const isSuccess = gprsData && (gprsData.status === 1 || gprsData.success);

      return res.json({
        ok: isSuccess,
        gateway: 'cartracker',
        channel: 'gprs',
        deviceId: ctDevice.id,
        imei,
        command,
        onlineStatus: ctDevice.online,
        message: isSuccess
          ? `GPRS repoint command sent to device via Car Tracker Nigeria active socket!`
          : ((gprsData && (gprsData.error || gprsData.message)) || 'Car Tracker Nigeria command error (tracker may be offline).')
      });
    } catch (err) {
      console.error(`[CARTRACKER GATEWAY ERROR] IMEI ${imei}:`, err);
      return res.status(500).json({ ok: false, gateway: 'cartracker', error: err.message });
    }
  }

  // B. Fallback: Dispatch via Speedotrack Internal Queue
  try {
    const session = await loginSpeedotrackUser(serverDomain, username, password);
    const domain = session.domain;
    const cookies = session.cookies;

    if (channel === 'sms') {
      const params = new URLSearchParams();
      params.append('cmd', 'exec_cmd_sms');
      params.append('imei', imei);
      params.append('name', 'Repoint Command');
      params.append('cmd_', command);

      const smsRes = await fetch(`${domain}/func/fn_cmd.php`, {
        method: 'POST',
        headers: { 'Cookie': cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const respText = (await smsRes.text()).trim();
      const isSuccess = respText === 'OK';

      return res.json({
        ok: isSuccess,
        gateway: 'speedotrack',
        channel: 'sms',
        statusText: respText,
        command,
        simNumber,
        message: isSuccess ? 'SMS command queued on Speedotrack.' : `Speedotrack SMS response: ${respText}`
      });
    }

    // Default: GPRS
    const params = new URLSearchParams();
    params.append('cmd', 'exec_cmd_gprs');
    params.append('imei', imei);
    params.append('name', 'Repoint Command');
    params.append('type', 'ascii');
    params.append('cmd_', command);

    const gprsRes = await fetch(`${domain}/func/fn_cmd.php`, {
      method: 'POST',
      headers: { 'Cookie': cookies, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const respText = (await gprsRes.text()).trim();
    const isSuccess = respText === 'OK';

    return res.json({
      ok: isSuccess,
      gateway: 'speedotrack',
      channel: 'gprs',
      statusText: respText,
      command,
      message: isSuccess ? 'GPRS repoint command queued on Speedotrack.' : `Speedotrack response: ${respText}`
    });
  } catch (err) {
    console.error(`[SPEEDOTRACK REPOINT ERROR] IMEI ${imei}:`, err);
    return res.status(500).json({ ok: false, gateway: 'speedotrack', error: err.message });
  }
});



// 404 Fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Speedotrack Bulk Provisioner running at http://localhost:${PORT}`);
});
