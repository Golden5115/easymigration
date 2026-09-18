const fs = require('fs');

async function main() {
  const loginParams = new URLSearchParams();
  loginParams.append('cmd', 'login');
  loginParams.append('username', 'Olawale.Olayinka@clicktgi.net');
  loginParams.append('password', 'Tracker1');
  loginParams.append('remember_me', 'true');

  const loginRes = await fetch('https://server.cartracker.com.ng/func/fn_connect.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginParams.toString(),
    redirect: 'manual'
  });

  const cookies = loginRes.headers.get('set-cookie');
  const cookieHeader = cookies.split(';')[0];

  const trackRes = await fetch('https://server.cartracker.com.ng/tracking.php', {
    headers: { Cookie: cookieHeader }
  });
  const html = await trackRes.text();
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  const scripts = [];
  while ((match = scriptRegex.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  for (const s of scripts) {
    const url = s.startsWith('http') ? s : 'https://server.cartracker.com.ng/' + s;
    const res = await fetch(url, { headers: { Cookie: cookieHeader } });
    const text = await res.text();
    if (text.includes('function transformToHistoryRoute') || text.includes('transformToHistoryRoute=')) {
      console.log('Found definition in:', s);
      let p = text.indexOf('transformToHistoryRoute');
      console.log(text.substring(p - 30, p + 500));
    }
  }



}

main().catch(console.error);


