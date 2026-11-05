import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './index.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const environment = Object.fromEntries(['DSH_HOME', 'MAGPIE_ADDR', 'OPENCODE_API_KEY', 'DEEPSEEK_API_KEY', 'MAGPIE_GATEWAY_KEY']
  .map(name => [name, process.env[name]]));
const temporaryHome = await mkdtemp(join(tmpdir(), 'dsh-budget-magpie-test-'));
let handler;
const keys = new Map();
let codexToken = 'native-codex-one';
apply({
  connection: { fetch: { register(route) { handler = route.fetch; } } },
  get(name) {
    if (name === 'credentials') return { resolve: async ref => keys.has(ref) ? { value: keys.get(ref) } : undefined };
    if (name === 'codexAuth') return { credential: async () => ({ accessToken: codexToken, accountId: 'native-account' }) };
  },
});
async function rpc(payload) {
  const response = await handler(new Request('https://dsh.invalid/api/dsh-budget-view/query', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'magpie-test', method: 'dsh-budget-view/query', payload }),
  }));
  const envelope = await response.json();
  assert.equal(envelope.result.ok, true);
  return envelope.result.value;
}
let settings = { budgetSource: 'auto', fxMode: 'manual', magpieBaseUrl: 'http://127.0.0.1:3425' };
async function configure(patch) {
  settings = { ...settings, ...patch };
  return (await rpc({ action: 'settings-set', settings })).settings;
}
const fixture = () => ({ object: 'list', data: [
  { provider: 'codex', kind: 'subscription', plan: 'plus', user: 'old@example.invalid', windows: [
    { name: '5 hours', used: 90, remaining: 10 }, { name: '7 days', used: 80, remaining: 20 },
  ], lastServedAt: '2026-11-01T00:00:00Z' },
  { provider: 'codex', kind: 'subscription', plan: 'pro', user: 'recent@example.invalid', windows: [
    { name: '5 hours', used: 25, remaining: 75, resetsAt: '2099-11-05T23:00:00Z' },
    { name: '7 days', used: 12, remaining: 88 },
  ], readAt: '2026-11-05T12:00:00Z', lastServedAt: '2026-11-05T11:00:00Z', asOf: '2026-11-05T12:00:00Z' },
  { provider: 'opencode-go', kind: 'plan', windows: [
    { name: 'Month', used: 1, remaining: 99 },
    { name: '7 days', used: 5, remaining: 95 }, { name: '5 hours', used: 31, remaining: 69 },
  ] },
  { provider: 'deepseek', kind: 'balance', balance: '¥6.45' },
] });
let payload = fixture();
let gatewayStatus = 200;
let failure;
let gatewayCalls = 0;
let nativeCalls = 0;
let gatewayKey;
let expectedUrl;
globalThis.fetch = async (url, options) => {
  if (url.includes('/magpie/quotas')) {
    gatewayCalls++;
    assert.equal(url, expectedUrl);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, gatewayKey ? `Bearer ${gatewayKey}` : undefined);
    assert.ok(options.signal instanceof AbortSignal);
    if (failure) throw failure;
    return typeof payload === 'string' ? new Response(payload, { status: gatewayStatus }) : Response.json(payload, { status: gatewayStatus });
  }
  nativeCalls++;
  if (url.includes('/wham/usage')) {
    assert.equal(options.headers.authorization, `Bearer ${codexToken}`);
    return Response.json({ rate_limit: {
      primary_window: { used_percent: codexToken.endsWith('one') ? 10 : 20, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 30, limit_window_seconds: 604800 },
    } });
  }
  if (url.includes('/user/balance')) {
    assert.equal(options.headers.authorization, `Bearer ${keys.get('DEEPSEEK_API_KEY')}`);
    return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: keys.get('DEEPSEEK_API_KEY').endsWith('one') ? '10' : '20' }] });
  }
  if (url.includes('/go/v1/usage')) {
    assert.equal(options.headers.authorization, `Bearer ${keys.get('OPENCODE_API_KEY')}`);
    return Response.json({ usage: { rolling: { percent: 15 }, weekly: { percent: 25 } } });
  }
  assert.fail(`Unexpected request: ${url}`);
};
const query = (provider = 'magpie', model = 'opencode-go/deepseek-v4-pro') => rpc({ provider, model });
let scenario = 0;
async function fresh(patch = {}) {
  const base = `http://127.0.0.1:${3500 + ++scenario}`;
  expectedUrl = `${base}/v1/magpie/quotas`;
  await configure({ magpieBaseUrl: base, ...patch });
}
try {
  process.env.DSH_HOME = temporaryHome;
  for (const name of Object.keys(environment)) if (name !== 'DSH_HOME') delete process.env[name];
  expectedUrl = 'http://127.0.0.1:3425/v1/magpie/quotas';
  await configure({});
  const summary = await rpc({ provider: '__summary__', model: '' });
  assert.equal(gatewayCalls, 1, 'summary reads the gateway once');
  assert.equal(nativeCalls, 0, 'Magpie needs no native vendor credentials');
  assert.equal(summary.codex.fiveHour.remainingPercent, 75);
  assert.equal(summary.codex.weekly.remainingPercent, 88);
  assert.equal(summary.codex.planType, 'pro', 'windows come from the most recently served account');
  assert.equal(summary.codex.stale, true);
  assert.equal(summary.opencodeGo.fiveHour.remainingPercent, 69);
  assert.equal(summary.deepseek.balance.totalBalance, '6.45');
  assert.ok(!JSON.stringify(summary).includes('@example.invalid'), 'account details are not sent to the client');
  for (const route of ['magpie', 'magpie-responses', 'magpie-anthropic']) {
    assert.equal((await query(route)).kind, 'opencode-go');
    assert.equal((await query(route, 'codex/gpt-5')).codex.fiveHour.remainingPercent, 75);
    const deepseek = (await query(route, 'deepseek/deepseek-v4-pro')).deepseek;
    assert.equal(deepseek.balance.currency, 'CNY');
    assert.equal(deepseek.pricing.key, 'deepseek-v4-pro');
    assert.equal((await query(route, 'openrouter/deepseek/deepseek-v4-pro')).kind, 'none');
  }
  assert.equal(gatewayCalls, 1, 'queries reuse successful gateway responses');
  const now = Date.now();
  Date.now = () => now + 31_000;
  await query();
  assert.equal(gatewayCalls, 2);
  Date.now = originalNow;

  gatewayKey = 'gateway-private-key-one';
  keys.set('MAGPIE_GATEWAY_KEY', gatewayKey);
  await query();
  assert.equal(gatewayCalls, 3, 'changing gateway credentials invalidates the cache');
  gatewayKey = 'gateway-private-key-two';
  keys.set('MAGPIE_GATEWAY_KEY', gatewayKey);
  assert.ok(!JSON.stringify(await query()).includes(gatewayKey));
  assert.equal(gatewayCalls, 4);
  const saved = await configure({ budgetSource: 'magpie', magpieBaseUrl: 'http://127.0.0.1:3425/v1/' });
  assert.equal(saved.magpieApiKeyRef, 'MAGPIE_GATEWAY_KEY');
  assert.equal(saved.budgetSource, 'magpie');
  await query();
  await fresh({ magpieBaseUrl: '', budgetSource: 'auto' });
  process.env.MAGPIE_ADDR = '127.0.0.1:9876';
  expectedUrl = 'http://127.0.0.1:9876/v1/magpie/quotas';
  await query();

  keys.set('DEEPSEEK_API_KEY', 'native-deepseek-one');
  keys.set('OPENCODE_API_KEY', 'native-opencode-key');
  payload = { data: [] };
  await fresh();
  const fallback = await rpc({ provider: '__summary__', model: '' });
  assert.equal(fallback.codex.fiveHour.remainingPercent, 90);
  assert.equal(fallback.opencodeGo.fiveHour.remainingPercent, 85, 'native Go can use the credentials service');
  assert.equal(fallback.deepseek.balance.totalBalance, '10');
  const before = nativeCalls;
  assert.equal((await query()).opencodeGo.available, false);
  assert.equal(nativeCalls, before, 'a Magpie route never falls back to an unrelated native account');
  await configure({ budgetSource: 'magpie' });
  assert.equal((await query('openai-codex', '')).codex.available, false, 'Magpie-only mode never falls back');

  await configure({ budgetSource: 'native' });
  codexToken = 'native-codex-two';
  keys.set('DEEPSEEK_API_KEY', 'native-deepseek-two');
  assert.equal((await query('openai-codex', '')).codex.fiveHour.remainingPercent, 80);
  assert.equal((await query('deepseek-official', 'deepseek-v4-pro')).deepseek.balance.totalBalance, '20');
  keys.delete('DEEPSEEK_API_KEY');
  assert.equal((await query('deepseek-official', 'deepseek-v4-pro')).deepseek.error.code, 'missing-credentials');
  const noMagpieCalls = gatewayCalls;
  assert.equal((await query()).opencodeGo.error.code, 'missing-credentials');
  assert.equal(gatewayCalls, noMagpieCalls, 'native-only mode never queries Magpie');

  for (const [status, code] of [[401, 'invalid-auth'], [403, 'invalid-auth'], [500, 'upstream-error']]) {
    await fresh({ budgetSource: 'magpie' });
    gatewayStatus = status;
    payload = { error: gatewayKey };
    const result = await query();
    assert.equal(result.opencodeGo.error.code, code);
    assert.ok(!JSON.stringify(result).includes(gatewayKey));
  }
  gatewayStatus = 200;
  for (const name of ['TimeoutError', 'AbortError']) {
    await fresh();
    failure = Object.assign(new Error(gatewayKey), { name });
    const result = await query();
    assert.equal(result.opencodeGo.error.code, name === 'TimeoutError' ? 'timeout' : 'aborted');
    assert.ok(!JSON.stringify(result).includes(gatewayKey));
  }
  failure = null;
  for (const malformed of ['not JSON', null, {}, { data: {} }]) {
    await fresh();
    payload = malformed;
    assert.equal((await query()).opencodeGo.error.code, 'invalid-response');
  }
  for (const invalid of [null, '25', true, {}, undefined]) {
    await fresh();
    payload = fixture();
    payload.data[2].windows[2] = { name: '5 hours', remaining: invalid };
    assert.equal((await query()).opencodeGo.error.code, 'invalid-response');
  }
  await fresh();
  payload = fixture();
  payload.data[2].windows[2] = { name: '5h', used: 125 };
  payload.data[2].windows[1] = { name: 'weekly', used: -10 };
  assert.equal((await query()).opencodeGo.fiveHour.remainingPercent, 0);
  assert.equal((await query()).opencodeGo.weekly.remainingPercent, 100);
  await fresh();
  payload = fixture();
  payload.data[2].error = gatewayKey;
  const failedCard = await rpc({ provider: '__summary__', model: '' });
  assert.equal(failedCard.opencodeGo.error.code, 'upstream-error');
  assert.equal(failedCard.codex.available, true);
  assert.equal(failedCard.deepseek.error, null);
  assert.ok(!JSON.stringify(failedCard).includes(gatewayKey));

  for (const [text, currency, total] of [['USD 1,234.56', 'USD', '1234.56'], ['￥0', 'CNY', '0'], ['¥-1.24', 'CNY', '-1.24'], ['$5.00 · ¥6.45', 'CNY', '6.45']]) {
    await fresh();
    payload = fixture();
    payload.data[3].provider = 'deepseek-ai';
    payload.data[3].balance = text;
    const balance = (await query('magpie', 'deepseek-ai/deepseek-v4-pro')).deepseek.balance;
    assert.equal(balance.currency, currency);
    assert.equal(balance.totalBalance, total);
  }
  await fresh();
  payload = fixture();
  payload.data[3].balanceSplit = [{ label: 'Granted', text: '¥1.00' }, { label: 'Topped up', text: '¥5.45' }];
  const split = (await query('magpie', 'deepseek/deepseek-v4-pro')).deepseek.balance;
  assert.equal(split.grantedBalance, '1.00');
  assert.equal(split.toppedUpBalance, '5.45');
  for (const text of ['', '¥NaN', '¥1.2K', 'balance 10', '$1,23']) {
    await fresh();
    payload = fixture();
    payload.data[3].balance = text;
    assert.equal((await query('magpie', 'deepseek/deepseek-v4-pro')).deepseek.error.code, 'invalid-response');
  }
  console.log('Magpie checks passed: routing, summary, accounts, authentication, cache, native fallback, errors, balances');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(temporaryHome, { recursive: true, force: true });
}
