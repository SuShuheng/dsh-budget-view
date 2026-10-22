import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './index.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalKey = process.env.OPENCODE_API_KEY;
const originalDshHome = process.env.DSH_HOME;
const temporaryHome = await mkdtemp(join(tmpdir(), 'dsh-budget-view-test-'));
let handler;
apply({
  connection: { fetch: { register(route) { handler = route.fetch; } } },
  get(service) {
    if (service === 'codexAuth') return { credential: async () => ({ accessToken: 'test-codex-token' }) };
    if (service === 'credentials') return { resolve: async () => ({ value: 'test-deepseek-key' }) };
  },
});

async function rpc(payload) {
  const response = await handler(new Request('https://dsh.invalid/api/dsh-budget-view/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'dsh-budget-view/query', payload }),
  }));
  const envelope = await response.json();
  assert.equal(envelope.result.ok, true);
  return envelope.result.value;
}

const query = () => rpc({ provider: 'opencode-go', model: 'deepseek-v4-pro' });
const fixture = () => ({ usage: {
  rolling: { status: 'ok', percent: 31, resetsAt: '2099-10-22T10:00:00Z' },
  weekly: { status: 'ok', percent: 5, resetsAt: '2099-10-29T10:00:00Z' },
} });
let calls = 0;
let upstream = fixture();
let status = 200;
let failure;
let keyNumber = 0;
const changeKey = () => { process.env.OPENCODE_API_KEY = `test-opencode-key-${++keyNumber}`; };
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(url, 'https://opencode.ai/zen/go/v1/usage');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.authorization, `Bearer ${process.env.OPENCODE_API_KEY.trim()}`);
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  if (failure) throw failure;
  return typeof upstream === 'string'
    ? new Response(upstream, { status })
    : Response.json(upstream, { status });
};

try {
  process.env.DSH_HOME = temporaryHome;
  delete process.env.OPENCODE_API_KEY;
  assert.equal((await query()).opencodeGo.error.code, 'missing-credentials');
  process.env.OPENCODE_API_KEY = '   ';
  assert.equal((await query()).opencodeGo.error.code, 'missing-credentials');
  assert.equal(calls, 0);

  changeKey();
  process.env.OPENCODE_API_KEY = ` ${process.env.OPENCODE_API_KEY} `;
  const first = await query();
  assert.equal(first.kind, 'opencode-go');
  assert.equal(first.opencodeGo.fiveHour.remainingPercent, 69);
  assert.equal(first.opencodeGo.weekly.remainingPercent, 95);
  assert.equal(first.opencodeGo.fiveHour.resetAt, '2099-10-22T10:00:00.000Z');
  assert.equal(first.opencodeGo.weekly.windowSeconds, 604800);
  assert.ok(!JSON.stringify(first).includes('test-opencode-key'));
  await query();
  assert.equal(calls, 1, 'successful responses are cached');
  const now = Date.now();
  Date.now = () => now + 31_000;
  await query();
  assert.equal(calls, 2, 'cache expires after 30 seconds');
  Date.now = originalNow;
  changeKey();
  await query();
  assert.equal(calls, 3, 'changing credentials bypasses the cache');

  changeKey();
  upstream = fixture();
  upstream.usage.rolling = { status: 'rate-limited', percent: 40 };
  upstream.usage.weekly.percent = 150;
  const exhausted = (await query()).opencodeGo;
  assert.equal(exhausted.fiveHour.remainingPercent, 0);
  assert.equal(exhausted.weekly.remainingPercent, 0);

  changeKey();
  upstream = { rollingUsage: { usagePercent: 25, resetInSec: 60 }, weeklyUsage: { usagePercent: 0, resetInSec: 3600 } };
  const legacy = (await query()).opencodeGo;
  assert.equal(legacy.fiveHour.remainingPercent, 75);
  assert.equal(legacy.weekly.remainingPercent, 100);
  assert.ok(Math.abs(Date.parse(legacy.fiveHour.resetAt) - Date.now() - 60_000) < 1000);

  for (const percent of [null, '', '25', true, {}, undefined]) {
    changeKey();
    upstream = fixture();
    upstream.usage.rolling.percent = percent;
    assert.equal((await query()).opencodeGo.error.code, 'invalid-response');
  }
  for (const malformed of [{ usage: {} }, { usage: { rolling: { percent: 0 } } }, null, '<html>not JSON</html>']) {
    changeKey();
    upstream = malformed;
    assert.equal((await query()).opencodeGo.error.code, 'invalid-response');
  }
  for (const [httpStatus, code] of [[401, 'invalid-auth'], [403, 'invalid-auth'], [429, 'upstream-error'], [500, 'upstream-error']]) {
    changeKey();
    status = httpStatus;
    upstream = { error: process.env.OPENCODE_API_KEY };
    const result = await query();
    assert.equal(result.opencodeGo.error.code, code);
    assert.ok(!JSON.stringify(result).includes(process.env.OPENCODE_API_KEY));
  }
  status = 200;
  for (const [name, code] of [['TimeoutError', 'timeout'], ['AbortError', 'aborted'], ['Error', 'upstream-error']]) {
    changeKey();
    failure = Object.assign(new Error(process.env.OPENCODE_API_KEY), { name });
    const result = await query();
    assert.equal(result.opencodeGo.error.code, code);
    assert.ok(!JSON.stringify(result).includes(process.env.OPENCODE_API_KEY));
  }
  failure = null;
  changeKey();
  upstream = fixture();
  const saved = await rpc({ action: 'settings-set', settings: { heroMode: 'opencode-go', fxMode: 'manual' } });
  assert.equal(saved.settings.heroMode, 'opencode-go');
  assert.equal((await rpc({ action: 'settings-get' })).settings.heroMode, 'opencode-go');

  globalThis.fetch = async url => {
    if (url === 'https://opencode.ai/zen/go/v1/usage') return Response.json(fixture());
    if (url.includes('/wham/usage')) return Response.json({ rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
    } });
    if (url.includes('/user/balance')) return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '6.45' }] });
    assert.fail('unexpected upstream URL');
  };
  let summary = await rpc({ provider: '__summary__', model: '' });
  assert.equal(summary.opencodeGo.available, true);
  assert.equal(summary.codex.available, true);
  assert.equal(summary.deepseek.balance.totalBalance, '6.45');
  delete process.env.OPENCODE_API_KEY;
  summary = await rpc({ provider: '__summary__', model: '' });
  assert.equal(summary.opencodeGo.available, false);
  assert.equal(summary.codex.available, true);
  assert.equal(summary.deepseek.error, null);
  console.log('host checks passed: OpenCode Go RPC, authentication, windows, cache, errors, settings, summary');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = originalKey;
  if (originalDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = originalDshHome;
  await rm(temporaryHome, { recursive: true, force: true });
}
