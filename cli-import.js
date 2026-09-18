#!/usr/bin/env node
/**
 * Speedotrack Bulk Provisioner CLI
 * Usage:
 *   Dealer Mode:
 *     node cli-import.js --file ./devices.csv --server https://server.cartracker.com.ng/ --username cartrack --password YOUR_PASS
 *   Server API Mode:
 *     node cli-import.js --file ./devices.csv --server https://server.cartracker.com.ng/ --key YOUR_SERVER_KEY
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: '',
    server: '',
    username: '',
    password: '',
    key: '',
    delay: 250 // ms between requests
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) options.file = args[++i];
    if (args[i] === '--server' && args[i + 1]) options.server = args[++i];
    if (args[i] === '--username' && args[i + 1]) options.username = args[++i];
    if (args[i] === '--password' && args[i + 1]) options.password = args[++i];
    if (args[i] === '--key' && args[i + 1]) options.key = args[++i];
    if (args[i] === '--delay' && args[i + 1]) options.delay = parseInt(args[++i], 10);
  }

  return options;
}

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
    if (parts[0]) cookieMap.set(parts[0], parts.slice(1).join('='));
  }
  const merged = [];
  for (const [k, v] of cookieMap.entries()) {
    merged.push(`${k}=${v}`);
  }
  return merged.join('; ');
}

async function loginDealer(cleanDomain, username, password) {
  const loginBody = new URLSearchParams({
    cmd: 'login',
    username: username.trim(),
    password: password,
    remember_me: 'false',
    mobile: 'false'
  });

  const res = await fetch(`${cleanDomain}/func/fn_connect.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody.toString()
  });

  const text = (await res.text()).trim();
  if (text === 'ERROR_USERNAME_PASSWORD_INCORRECT') {
    throw new Error('Incorrect CPanel username or password.');
  }
  if (text !== 'LOGIN_CPANEL' && text !== 'LOGIN_TRACKING') {
    throw new Error(`Login failed: ${text}`);
  }

  let cookies = extractCookies(res);
  let managerId = '';

  try {
    const loadBody = new URLSearchParams({ cmd: 'load_cpanel_data' });
    const loadRes = await fetch(`${cleanDomain}/func/fn_cpanel.server.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies
      },
      body: loadBody.toString()
    });
    cookies = extractCookies(loadRes, cookies);
    const loadJson = await loadRes.json();
    managerId = loadJson.manager_id || '';
  } catch {}

  return { cookies, managerId };
}

function findUser(users, targetEmail) {
  if (!Array.isArray(users) || !targetEmail) return null;
  const norm = targetEmail.trim().toLowerCase();
  let found = users.find(u => u.email === norm);
  if (found) return found;
  found = users.find(u => (u.username || '').toLowerCase() === norm);
  if (found) return found;
  found = users.find(u => u.allText && u.allText.includes(norm));
  if (found) return found;
  const prefix = norm.split('@')[0];
  if (prefix && prefix.length >= 3) {
    found = users.find(u => (u.username || '').toLowerCase() === prefix);
    if (found) return found;
  }
  return null;
}

async function dealerLoadUsers(cleanDomain, cookies, managerId) {
  const usersMap = new Map();

  try {
    const sUrl = `${cleanDomain}/func/fn_cpanel.users.php?cmd=load_user_search_list&manager_id=${managerId || ''}`;
    const sRes = await fetch(sUrl, {
      method: 'GET',
      headers: { 'Cookie': cookies, 'User-Agent': 'SpeedotrackBulkProvisionerCLI/1.0' }
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
  } catch {}

  try {
    const url = `${cleanDomain}/func/fn_cpanel.users.php?cmd=load_user_list&manager_id=${managerId || ''}`;
    const postData = new URLSearchParams({ page: '1', rows: '1000', sidx: 'id', sord: 'desc', _search: 'false' });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
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
  } catch {}

  return Array.from(usersMap.values());
}

async function dealerRegisterUser(cleanDomain, cookies, managerId, email, sendCredentials) {
  const postData = new URLSearchParams({
    cmd: 'register_user',
    email: email.trim(),
    send: sendCredentials ? 'true' : 'false',
    manager_id: managerId || ''
  });
  const res = await fetch(`${cleanDomain}/func/fn_cpanel.users.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
    body: postData.toString()
  });
  return (await res.text()).trim();
}

async function dealerGetObjectData(cleanDomain, cookies, imei) {
  try {
    const postData = new URLSearchParams({
      cmd: 'load_object_data',
      imei: String(imei).trim()
    });
    const res = await fetch(`${cleanDomain}/func/fn_cpanel.objects.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
      body: postData.toString()
    });
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function dealerAddObject(cleanDomain, cookies, managerId, imei, name, expire, expireDate, userId, plateNumber = '', simNumber = '') {
  const existingData = await dealerGetObjectData(cleanDomain, cookies, imei);
  let existingUserIds = [];
  if (existingData) {
    if (Array.isArray(existingData.users)) {
      existingUserIds = existingData.users.map(u => String(u.value || u.id || u)).filter(Boolean);
    } else if (Array.isArray(existingData.user_ids)) {
      existingUserIds = existingData.user_ids.map(String).filter(Boolean);
    }
  }

  const incomingUserIds = Array.isArray(userId)
    ? userId.map(String).filter(Boolean)
    : (userId ? [String(userId)] : []);

  const combinedUserIds = Array.from(new Set([...existingUserIds, ...incomingUserIds])).filter(Boolean);

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
    user_ids: JSON.stringify(combinedUserIds)
  });
  const res = await fetch(`${cleanDomain}/func/fn_cpanel.objects.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
    body: postData.toString()
  });
  return (await res.text()).trim();
}

async function dealerAssignObject(cleanDomain, cookies, userId, imei) {
  const postData = new URLSearchParams({
    cmd: 'add_user_objects',
    user_id: String(userId),
    imeis: JSON.stringify([String(imei)])
  });
  const res = await fetch(`${cleanDomain}/func/fn_cpanel.users.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
    body: postData.toString()
  });
  return (await res.text()).trim();
}

async function dealerLinkObjectUser(cleanDomain, cookies, managerId, imei, name, expire, expireDate, userId, plateNumber = '', simNumber = '') {
  const existingData = await dealerGetObjectData(cleanDomain, cookies, imei);
  let existingUserIds = [];
  if (existingData) {
    if (Array.isArray(existingData.users)) {
      existingUserIds = existingData.users.map(u => String(u.value || u.id || u)).filter(Boolean);
    } else if (Array.isArray(existingData.user_ids)) {
      existingUserIds = existingData.user_ids.map(String).filter(Boolean);
    }
  }

  const incomingUserIds = Array.isArray(userId)
    ? userId.map(String).filter(Boolean)
    : (userId ? [String(userId)] : []);

  const combinedUserIds = Array.from(new Set([...existingUserIds, ...incomingUserIds])).filter(Boolean);

  const finalName = name || (existingData && existingData.name) || 'GPS Tracker';
  const finalPlate = plateNumber || (existingData && existingData.plate_number) || '';
  const finalSim = simNumber || (existingData && existingData.sim_number) || '';

  const postData = new URLSearchParams({
    cmd: 'edit_object',
    name: finalName,
    imei: String(imei),
    new_imei: '',
    model: '',
    vin: '',
    plate_number: finalPlate,
    device: '',
    sim_number: finalSim,
    manager_id: managerId || '',
    active: 'true',
    object_expire: expire ? 'true' : 'false',
    object_expire_dt: expire ? expireDate : '',
    user_ids: JSON.stringify(combinedUserIds),
    vehicle_type_id: ''
  });
  const res = await fetch(`${cleanDomain}/func/fn_cpanel.objects.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
    body: postData.toString()
  });
  return (await res.text()).trim();
}

async function callSpeedotrack(serverDomain, apiKey, cmd) {
  const baseUrl = normalizeServerUrl(serverDomain);
  const targetUrl = new URL(`${baseUrl}/api/api.php`);
  targetUrl.searchParams.set('api', 'server');
  targetUrl.searchParams.set('ver', '1.0');
  targetUrl.searchParams.set('key', (apiKey || '').trim());
  targetUrl.searchParams.set('cmd', cmd);

  const res = await fetch(targetUrl.toString(), {
    method: 'GET',
    headers: { 'User-Agent': 'SpeedotrackBulkProvisionerCLI/1.0' }
  });
  const text = (await res.text()).trim();
  const lowerText = text.toLowerCase();

  const isHtml = text.startsWith('<') || 
                 lowerText.includes('<!doctype') || 
                 lowerText.includes('<html') || 
                 lowerText.includes('<head');

  if (isHtml) {
    throw new Error(`Server returned an HTML web page instead of an API response. Ensure --server is set to base URL (e.g. https://server.cartracker.com.ng/) without /cpanel.php`);
  }

  if (text.startsWith('ERROR:') || lowerText.includes('wrong api key') || lowerText.includes('access denied')) {
    throw new Error(text);
  }

  return { ok: res.ok, status: res.status, text };
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const values = [];
    let cur = '';
    let inQuote = false;
    for (let c of rawLine) {
      if (c === '"') {
        inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        values.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    values.push(cur.trim());

    const record = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] || '';
    });
    records.push(record);
  }
  return records;
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const opts = parseArgs();

  if (!opts.file || !opts.server || (!opts.key && (!opts.username || !opts.password))) {
    console.log(`
==================================================
  Speedotrack Bulk Provisioner CLI
==================================================
Usage (Dealer Mode):
  node cli-import.js --file <csv> --server <url> --username <user> --password <pass> [--delay 250]

Usage (Super Admin Server API Mode):
  node cli-import.js --file <csv> --server <url> --key <server-api-key> [--delay 250]

Example:
  node cli-import.js --file ./devices.csv --server https://server.cartracker.com.ng/ --username cartrack --password MY_PASS
    `);
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] File not found: ${filePath}`);
    process.exit(1);
  }

  const cleanDomain = normalizeServerUrl(opts.server);
  const isDealer = Boolean(opts.username && opts.password);

  console.log(`[INFO] Reading file: ${filePath}`);
  const csvContent = fs.readFileSync(filePath, 'utf8');
  const rows = parseCSV(csvContent);
  console.log(`[INFO] Parsed ${rows.length} records.`);
  console.log(`[INFO] Authentication mode: ${isDealer ? `Dealer CPanel (${opts.username})` : 'Server API Key'}`);

  let session = null;
  if (isDealer) {
    console.log(`[INFO] Authenticating dealer session with ${cleanDomain}...`);
    session = await loginDealer(cleanDomain, opts.username, opts.password);
    console.log(`[SUCCESS] Dealer authenticated successfully.\n`);
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawEmailInput = row.emails || row.email || '';
    const emailList = Array.isArray(rawEmailInput)
      ? rawEmailInput.map(e => String(e).trim().toLowerCase()).filter(Boolean)
      : String(rawEmailInput).split(/[,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    const emailDisplay = emailList.join(', ');
    const sendCreds = String(row.send_credentials).toLowerCase() === 'true';
    const rawImei = String(row.imei || '').trim();

    const isScientific = /^[0-9.]+[eE][+]?[0-9]+$/.test(rawImei) || /^\d+[eE]\d+$/i.test(rawImei);
    const imei = rawImei.replace(/[^0-9]/g, '');

    const name = String(row.object_name || '').replace(/,/g, ' ').trim();
    const plateNumber = (row.plate_number || row.plate || row.reg || '').trim();
    const simNumber = (row.sim_number || row.sim || row.phone || row.mobile || '').trim();
    const rawExpireDate = normalizeDate(row.expire_date || row.expiry || '');
    let expire = false;
    if (row.expire !== undefined && String(row.expire).trim() !== '') {
      expire = String(row.expire).toLowerCase() === 'true';
    } else {
      expire = Boolean(rawExpireDate && !['never', 'none', 'lifetime', '0000-00-00', '-'].includes(rawExpireDate.toLowerCase()));
    }
    const expireDate = expire ? (rawExpireDate || '2028-01-01') : '';

    console.log(`[${i + 1}/${rows.length}] Processing [${emailDisplay}] -> ${rawImei} (${name || 'NO NAME'}${plateNumber ? ` | ${plateNumber}` : ''})...`);

    if (!name) {
      console.error(`  ✖ FAILED: Missing object_name. Object name is compulsory.\n`);
      failCount++;
      continue;
    }

    if (isScientific || imei.length < 14 || imei.length > 16) {
      console.error(`  ✖ FAILED: Corrupted or invalid IMEI "${rawImei}". Expected 14-16 digits (did Excel convert it to scientific notation?)\n`);
      failCount++;
      continue;
    }

    if (emailList.length === 0) {
      console.error(`  ✖ FAILED: Missing email address.\n`);
      failCount++;
      continue;
    }

    try {
      if (isDealer) {
        // Dealer CPanel mode
        let users = await dealerLoadUsers(cleanDomain, session.cookies, session.managerId);
        const resolvedUsers = [];

        for (const singleEmail of emailList) {
          let user = findUser(users, singleEmail);
          if (!user) {
            console.log(`  └─ Registering user ${singleEmail}...`);
            const regRes = await dealerRegisterUser(cleanDomain, session.cookies, session.managerId, singleEmail, sendCreds);
            if (regRes !== 'OK' && regRes !== 'ERROR_EMAIL_EXISTS') {
              console.warn(`  ⚠️ Register user ${singleEmail} warning: ${regRes}`);
            }
            await new Promise(r => setTimeout(r, 400));
            users = await dealerLoadUsers(cleanDomain, session.cookies, session.managerId);
            user = findUser(users, singleEmail);
          }
          if (user) resolvedUsers.push(user);
        }

        const userIds = resolvedUsers.map(u => u.id);
        console.log(`  └─ Resolved user ID(s): [${userIds.join(', ') || 'NONE'}]`);

        console.log(`  └─ Registering tracker ${imei} (${name}${plateNumber ? ` | Plate: ${plateNumber}` : ''}${simNumber ? ` | SIM: ${simNumber}` : ''})...`);
        const addObjRes = await dealerAddObject(cleanDomain, session.cookies, session.managerId, imei, name, expire, expireDate, userIds, plateNumber, simNumber);

        if (addObjRes !== 'OK' && !addObjRes.includes('EXIST') && !addObjRes.includes('already')) {
          throw new Error(`Add object failed: ${addObjRes}`);
        }

        if (userIds.length > 0) {
          for (const u of resolvedUsers) {
            console.log(`  └─ Assigning vehicle ${imei} to user ${u.username} (ID: ${u.id})...`);
            await dealerAssignObject(cleanDomain, session.cookies, u.id, imei);
          }
          await dealerLinkObjectUser(cleanDomain, session.cookies, session.managerId, imei, name, expire, expireDate, userIds, plateNumber, simNumber);
        } else {
          console.warn(`  ⚠️ Warning: No User IDs could be resolved for ${emailDisplay}. Tracker registered but not linked.`);
        }

        console.log(`  ✔ SUCCESS\n`);
        successCount++;

      } else {
        // Server API Key mode
        for (const singleEmail of emailList) {
          const checkRes = await callSpeedotrack(cleanDomain, opts.key, `CHECK_USER_EXISTS,${singleEmail}`);
          const respText = (checkRes.text || '').toLowerCase();
          const userExists = respText === 'true' || respText === '1' || respText.includes('exist');

          if (!userExists) {
            console.log(`  └─ Creating user ${singleEmail}...`);
            await callSpeedotrack(cleanDomain, opts.key, `ADD_USER,${singleEmail},${sendCreds}`);
          }
        }

        console.log(`  └─ Registering tracker ${imei}...`);
        await callSpeedotrack(cleanDomain, opts.key, `ADD_OBJECT,${imei},${name},${expire},${expireDate}`);

        for (const singleEmail of emailList) {
          console.log(`  └─ Assigning tracker to user ${singleEmail}...`);
          await callSpeedotrack(cleanDomain, opts.key, `ADD_USER_OBJECT,${singleEmail},${imei}`);
        }

        console.log(`  ✔ SUCCESS\n`);
        successCount++;
      }
    } catch (err) {
      console.error(`  ✖ FAILED: ${err.message}\n`);
      failCount++;
    }

    if (opts.delay > 0) {
      await sleep(opts.delay);
    }
  }

  console.log(`==================================================`);
  console.log(`Completed! Success: ${successCount} | Failed: ${failCount}`);
  console.log(`==================================================`);
}

main().catch(console.error);
