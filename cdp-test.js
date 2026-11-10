const WebSocket = require("ws");
const { spawn } = require("child_process");
const http = require("http");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9223;
const BASE = "http://localhost:5173";
const API = "http://localhost:4000";

function httpJson(method, url, headers = {}, body = undefined) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); } catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleLogs = [];
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === "Runtime.consoleAPICalled") {
          const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
          this.consoleLogs.push(`[console.${msg.params.type}] ${args}`);
        }
        if (msg.method === "Runtime.exceptionThrown") {
          this.consoleLogs.push(`[exception] ${JSON.stringify(msg.params.exceptionDetails).slice(0, 500)}`);
        }
      }
    });
    this.ready = new Promise((resolve, reject) => {
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { exception: r.exceptionDetails.text };
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  // ---- Prepare a real device via the API (real browser will stream real coords) ----
  const login = await httpJson("POST", `${API}/api/auth/login`, {}, { email: "admin@sentinel.local", password: "ChangeMe!12345" });
  if (login.status !== 200) { console.log("FAIL login:", login.status, JSON.stringify(login.body)); process.exit(1); }
  const jwt = login.body.token;
  const enroll = await httpJson("POST", `${API}/api/devices`, { Authorization: `Bearer ${jwt}` }, { name: "CDP E2E Phone", platform: "ANDROID" });
  if (enroll.status !== 201) { console.log("FAIL enroll:", enroll.status, JSON.stringify(enroll.body)); process.exit(1); }
  const deviceToken = enroll.body.deviceToken;
  const deviceId = enroll.body.deviceId;
  console.log("DEVICE ENROLLED:", deviceId);

  const pairUrl = `${BASE}/enroll/${deviceToken}`;

  // ---- Launch headless Edge ----
  const profile = `${process.env.TEMP}\\edge-cdp-sentinel`;
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--headless=new`, `--disable-gpu`, `--no-first-run`,
    `--no-default-browser-check`, `--user-data-dir=${profile}`, `--window-size=1440,900`, `about:blank`,
  ], { stdio: "ignore" });

  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json/list`); if (targets.length) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!targets || !targets.length) { console.log("FAIL: no browser target"); edge.kill(); process.exit(1); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Tab 2: the "device" opening its pairing link with real geolocation ----
  const tabId = await cdpSendRaw(targets, "Target.createTarget", { url: "about:blank" });
  const targets2 = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const devTab = targets2.find((t) => t.id === tabId.targetId);
  const cdp2 = new Cdp(devTab.webSocketDebuggerUrl);
  await cdp2.send("Page.enable");
  await cdp2.send("Runtime.enable");
  await cdp2.send("Network.enable");
  await cdp2.send("Emulation.setGeolocationOverride", { latitude: 19.076, longitude: 72.8777, accuracy: 10 });
  await cdp2.send("Page.navigate", { url: pairUrl });
  await sleep(4500);

  const devInfo = await cdp2.eval(`document.body.innerText`);
  console.log("DEVICE PAGE:", (devInfo || "").slice(0, 300).replace(/\n/g, " | "));

  try {
    await cdp2.send("Browser.grantPermissions", { permissions: ["geolocation"], origin: BASE });
  } catch (e) { console.log("grantPermissions:", e.message); }

  // Auto-detect stage: if consent page -> check + start; if stopped -> go to consent
  const stageNow = await cdp2.eval(`(() => {
    const cb = document.querySelector('input[type=checkbox]');
    if (cb) { cb.click(); return 'consent-found'; }
    const startBtn = [...document.querySelectorAll('button')].find(x => /START LIVE/i.test(x.innerText));
    if (startBtn) { startBtn.click(); return 'stopped-start'; }
    return 'unknown';
  })()`);
  console.log("DEVICE STAGE:", stageNow);
  await sleep(600);
  await cdp2.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Allow Location/i.test(x.innerText));
    if (b) { b.click(); return 'started'; }
    return 'no-allow-btn';
  })()`);
  console.log("ALLOW CLICKED, waiting for live...");
  await sleep(7000);

  const devLive = await cdp2.eval(`document.body.innerText`);
  console.log("DEVICE AFTER START:", (devLive || "").slice(0, 400).replace(/\n/g, " | "));

  const devMetrics = await cdp2.eval(`(() => {
    const text = document.body.innerText;
    return JSON.stringify({ live: text.includes('STOP SHARING LOCATION'), fixCount: (text.match(/Fixes delivered\\s+([0-9]+)/) || [])[1] || null, lat: (text.match(/Latitude\\s+([\\d.]+)/) || [])[1] || null, lon: (text.match(/Longitude\\s+([\\d.]+)/) || [])[1] || null });
  })()`);
  console.log("DEVICE METRICS:", devMetrics);

  // ---- Tab 1: dashboard live location ----
  const pageTarget = targets.find((t) => t.type === "page");
  const cdp1 = new Cdp(pageTarget.webSocketDebuggerUrl);
  await cdp1.send("Page.enable");
  await cdp1.send("Runtime.enable");
  await cdp1.send("Network.enable");
  // login on tab1
  await cdp1.send("Page.navigate", { url: `${BASE}/login` });
  await sleep(3500);
  await cdp1.eval(`(() => {
    const inputs = document.querySelectorAll('input');
    const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    let e = inputs[0], p = inputs[1];
    for (const i of inputs) { if (i.type === 'email') e = i; if (i.type === 'password') p = i; }
    setVal(e, 'admin@sentinel.local'); setVal(p, 'ChangeMe!12345');
    return 'filled';
  })()`);
  await sleep(300);
  await cdp1.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => /authenticate/i.test(x.innerText)); if (b) b.click(); return 'ok'; })()`);
  await sleep(4000);
  const path1 = await cdp1.eval(`location.pathname`);
  console.log("DASH PATH:", path1);

  await cdp1.send("Page.navigate", { url: `${BASE}/live-location` });
  await sleep(8000);
  const liveBody = await cdp1.eval(`document.body.innerText`);
  console.log("LIVE PAGE:", (liveBody || "").slice(0, 400).replace(/\n/g, " | "));

  const mapState = await cdp1.eval(`(() => {
    const pins = document.querySelectorAll('.live-pin, .live-dot');
    const tiles = document.querySelectorAll('.leaflet-tile');
    const bodyText = document.body.innerText;
    return JSON.stringify({
      pins: pins.length,
      tiles: tiles.length,
      feedConnected: bodyText.includes('Live feed connected'),
      wsError: bodyText.match(/Live feed:[^\\n]*/) ? (bodyText.match(/Live feed:[^\\n]*/) || [])[0] : null,
      deviceLive: bodyText.includes('CDP E2E Phone'),
      hasLat: (bodyText.match(/Latitude\\s+([\\d.]+)/) || [])[1] || null,
      hasLon: (bodyText.match(/Longitude\\s+([\\d.]+)/) || [])[1] || null,
    });
  })()`);
  console.log("MAP STATE:", mapState);

  console.log("\n=== DEVICE TAB CONSOLE ===");
  cdp2.consoleLogs.slice(0, 50).forEach((l) => console.log(l));
  console.log("\n=== DASH TAB CONSOLE ===");
  cdp1.consoleLogs.slice(0, 50).forEach((l) => console.log(l));

  // Cleanup
  await httpJson("DELETE", `${API}/api/devices/${deviceId}`, { Authorization: `Bearer ${jwt}` });
  cdp1.close(); cdp2.close(); edge.kill();
  process.exit(0);
}

async function cdpSendRaw(targets, method, params) {
  const t = targets.find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const result = await new Promise((res, rej) => {
    ws.on("message", (raw) => { const m = JSON.parse(raw.toString()); if (m.id === 1) { m.error ? rej(new Error(m.error.message)) : res(m.result); ws.close(); } });
    ws.send(JSON.stringify({ id: 1, method, params }));
  });
  return result;
}

main().catch((e) => { console.error("TEST ERROR:", e); process.exit(1); });
