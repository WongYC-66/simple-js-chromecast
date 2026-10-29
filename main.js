// By Claude

// Mobile "cast remote": run this on a computer (or Raspberry Pi / NAS) on your Wi-Fi,
// then open  http://<that-computer's-IP>:3000  in Chrome on your phone.
//
// Setup:  npm install chromecast-api        (Node 18+)
// Run:    node cast-server.js
// Tip:    http://<ip>:3000/?url=<m3u8 link> pre-fills the URL box.
// The TV fetches the video straight from the URL; this server only sends the commands.
// Keep this on your home network only: it has no login.

const http = require('http')
const os = require('os')
const ChromecastAPI = require('chromecast-api')

const PORT = 3000
const devices = new Map()   // friendlyName -> device

const client = new ChromecastAPI()
client.on('device', (d) => {
  if (!devices.has(d.friendlyName)) console.log('Found:', d.friendlyName)
  devices.set(d.friendlyName, d)
})

function lanIp () {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) return i.address
    }
  }
  return 'localhost'
}

const readJson = (req) => new Promise((resolve) => {
  let s = ''
  req.on('data', (c) => { s += c })
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } })
})
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}
// The callback can fire twice if the TV drops the connection later; only answer once.
const cb = (res) => (err) => {
  if (res.writableEnded) return
  if (err) json(res, 500, { error: err.message })
  else json(res, 200, { ok: true })
}

// When the TV closes a connection (idle, sleep, end of a session) the library keeps the
// dead client around, and its next play()/close() crashes with "reading 'destroy'".
// Dropping a dead client first makes the library reconnect cleanly.
function freshen (dev) {
  const c = dev.client
  const alive = c && c.client && c.client.socket
  if (c && !alive) {
    dev.client = null
    dev.player = null
  }
}

// Late errors from the cast library must not take the server down.
process.on('uncaughtException', (e) => console.error('Ignored error:', e.message))

http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }
    if (path === '/api/devices') return json(res, 200, [...devices.keys()])

    if (req.method === 'POST' && path.startsWith('/api/')) {
      const b = await readJson(req)
      const dev = devices.get(b.device)
      if (!dev) return json(res, 404, { error: 'Pick a TV first (or wait for discovery)' })
      freshen(dev)
      if (path === '/api/cast') {
        if (!/^https?:\/\//i.test(b.url || '')) return json(res, 400, { error: 'Enter a valid http(s) URL' })
        const type = /\.m3u8(\?|$)/i.test(b.url) ? 'application/x-mpegURL' : undefined
        return dev.play({ url: b.url, contentType: type }, cb(res))
      }
      if (path === '/api/pause') return dev.pause(cb(res))
      if (path === '/api/resume') return dev.resume(cb(res))
      if (path === '/api/stop') return dev.stop(cb(res))
    }
    res.writeHead(404); res.end('not found')
  } catch (e) {
    if (!res.headersSent) json(res, 502, { error: String(e) })
    else res.end()
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Open on your phone: http://${lanIp()}:${PORT}`)
})

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cast Remote</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f6f4; --fg:#1a1a1a; --card:#fff; --line:#d8d8d2; --accent:#1a73e8; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161616; --fg:#eee; --card:#222; --line:#3a3a3a; --accent:#6ea8fe; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:16px/1.4 system-ui, sans-serif; max-width:520px; margin-inline:auto; }
  h1 { font-size:20px; margin:4px 0 16px; }
  label { display:block; font-size:13px; opacity:.7; margin:14px 0 4px; }
  input[type=text], select { width:100%; padding:12px; font-size:16px; border:1px solid var(--line); border-radius:10px; background:var(--card); color:var(--fg); }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; }
  button { padding:13px; font-size:16px; border:1px solid var(--line); border-radius:10px; background:var(--card); color:var(--fg); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; width:100%; margin-top:16px; }
  #msg { margin-top:14px; min-height:1.4em; font-size:14px; }
</style></head>
<body>
  <h1>Cast Remote</h1>
  <label for="dev">TV</label>
  <div class="row">
    <select id="dev"></select>
    <button id="refresh" style="flex:0 0 auto">Refresh</button>
  </div>
  <label for="url">Video URL (.m3u8, .mp4 ...)</label>
  <input id="url" type="text" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://...">
  <button class="primary" id="cast">Cast</button>
  <div class="row" style="margin-top:10px">
    <button id="pause">Pause</button><button id="resume">Resume</button><button id="stop">Stop</button>
  </div>
  <div id="msg"></div>
<script>
  const $ = (id) => document.getElementById(id)
  const say = (t) => { $('msg').textContent = t }
  async function api(path, body) {
    const r = await fetch(path, body ? { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || r.statusText)
    return j
  }
  async function loadDevices() {
    say('Searching for TVs...')
    try {
      const names = await api('/api/devices')
      const keep = $('dev').value || localStorage.getItem('dev')
      $('dev').innerHTML = names.map((n) => '<option>' + n.replace(/</g, '&lt;') + '</option>').join('')
      if (names.includes(keep)) $('dev').value = keep
      say(names.length ? '' : 'No TV found yet. Tap Refresh in a few seconds.')
    } catch (e) { say(e.message) }
  }
  function send(action) {
    return async () => {
      try {
        localStorage.setItem('dev', $('dev').value)
        await api('/api/' + action, { device: $('dev').value, url: $('url').value.trim() })
        say(action === 'cast' ? 'Casting...' : 'Done')
      } catch (e) { say('Error: ' + e.message) }
    }
  }
  $('refresh').onclick = loadDevices
  $('cast').onclick = send('cast')
  $('pause').onclick = send('pause')
  $('resume').onclick = send('resume')
  $('stop').onclick = send('stop')
  $('url').value = new URLSearchParams(location.search).get('url') || ''
  loadDevices()
  setTimeout(loadDevices, 4000)
</script>
</body></html>`