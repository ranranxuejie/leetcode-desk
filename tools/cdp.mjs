// Minimal CDP driver using Node's native WebSocket (Node 22+).
// Usage: node cdp.mjs <url> <jsExpressionFile> [waitMs]
// Prints JSON result of evaluating the expression in page context.
import fs from 'node:fs';

const [, , url, exprFile, waitArg] = process.argv;
const waitMs = Number(waitArg || 6000);
const expr = fs.readFileSync(exprFile, 'utf8');

function discover() {
  if (process.env.CDP_WS) return { wsUrl: process.env.CDP_WS };
  const home = process.env.LOCALAPPDATA || process.env.HOME;
  const candidates = [
    `${home}\\Google\\Chrome\\User Data\\DevToolsActivePort`,
    `${home}/.config/google-chrome/DevToolsActivePort`,
    `${home}/Library/Application Support/Google/Chrome/DevToolsActivePort`,
  ];
  for (const p of candidates) {
    try {
      const [port, wsPath] = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      if (port && wsPath) return { wsUrl: `ws://127.0.0.1:${port.trim()}${wsPath.trim()}` };
    } catch {}
  }
  throw new Error('DevToolsActivePort not found');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || ''))));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    });
    const api = {
      send(method, params = {}, sessionId) {
        const mid = ++id;
        return new Promise((res, rej) => {
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { ws.close(); },
    };
  });
}

const { wsUrl } = discover();
const api = await connect(wsUrl);

const { targetId } = await api.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await api.send('Target.attachToTarget', { targetId, flatten: true });

const events = [];
api.on((m) => { if (m.sessionId === sessionId) events.push(m); });

await api.send('Page.enable', {}, sessionId);
await api.send('Network.enable', {}, sessionId);
await api.send('Runtime.enable', {}, sessionId);

await api.send('Page.navigate', { url }, sessionId);
await new Promise((r) => setTimeout(r, waitMs));

let out;
try {
  const r = await api.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
  }, sessionId);
  out = r.result?.value !== undefined ? r.result.value : r;
} catch (e) {
  out = { error: String(e) };
}

// collect graphql-ish responses seen in network
const gql = events
  .filter((m) => m.method === 'Network.responseReceived')
  .map((m) => m.params.response.url)
  .filter((u) => /graphql|api\//.test(u));

console.log(JSON.stringify({ result: out, network: [...new Set(gql)] }, null, 2));

await api.send('Target.closeTarget', { targetId });
api.close();
process.exit(0);
