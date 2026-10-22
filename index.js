import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const name = 'dsh-budget-view';

const DEFAULT_CODEX_URL = 'https://chatgpt.com/backend-api/wham/usage';
const DEFAULT_DEEPSEEK_BASE = 'https://api.deepseek.com';
const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
const FX_URL = 'https://api.frankfurter.app/latest?from=USD&to=CNY';
const FX_SOURCE = 'ECB reference rates via Frankfurter';
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const PRICING_CURRENCY = 'CNY';

const DEFAULT_SETTINGS = Object.freeze({
  costCurrency: 'auto',
  fxMode: 'auto',
  usdToCnyRate: 7.1,
  showCost: true,
  showBalance: true,
  useOffpeakPricing: true,
  refreshSeconds: 60,
  heroMode: 'both',
  heroStyle: 'chips',
  heroDensity: 'compact',
  heroShowIcons: true,
  showHeroPeak: true,
  showDockPeak: true,
  cnHolidays: [],
  deepseekApiKeyRef: 'DEEPSEEK_API_KEY',
  deepseekBaseUrl: DEFAULT_DEEPSEEK_BASE,
  codexAuthJsonPath: '',
  codexUsageUrl: DEFAULT_CODEX_URL,
  pricing: {},
});

function settingsPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-budget-view.json');
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeSettings(value) {
  const next = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    costCurrency: next.costCurrency === 'USD' || next.costCurrency === 'CNY' ? next.costCurrency : 'auto',
    fxMode: next.fxMode === 'manual' ? 'manual' : 'auto',
    usdToCnyRate: boundedNumber(next.usdToCnyRate, 0.01, 100, DEFAULT_SETTINGS.usdToCnyRate),
    showCost: next.showCost !== false,
    showBalance: next.showBalance !== false,
    useOffpeakPricing: next.useOffpeakPricing !== false,
    refreshSeconds: Math.round(boundedNumber(next.refreshSeconds, 15, 600, DEFAULT_SETTINGS.refreshSeconds)),
    heroMode: ['both', 'current', 'codex', 'deepseek', 'opencode-go'].includes(next.heroMode) ? next.heroMode : 'both',
    heroStyle: next.heroStyle === 'plain' ? 'plain' : 'chips',
    heroDensity: next.heroDensity === 'comfortable' ? 'comfortable' : 'compact',
    heroShowIcons: next.heroShowIcons !== false,
    showHeroPeak: next.showHeroPeak !== false,
    showDockPeak: next.showDockPeak !== false,
    cnHolidays: Array.isArray(next.cnHolidays)
      ? [...new Set(next.cnHolidays.filter(isDateKey))]
      : [],
    deepseekApiKeyRef: typeof next.deepseekApiKeyRef === 'string' && next.deepseekApiKeyRef.trim() ? next.deepseekApiKeyRef.trim() : DEFAULT_SETTINGS.deepseekApiKeyRef,
    deepseekBaseUrl: typeof next.deepseekBaseUrl === 'string' && next.deepseekBaseUrl.trim() ? next.deepseekBaseUrl.trim() : DEFAULT_DEEPSEEK_BASE,
    codexAuthJsonPath: typeof next.codexAuthJsonPath === 'string' ? next.codexAuthJsonPath.trim() : '',
    codexUsageUrl: typeof next.codexUsageUrl === 'string' && next.codexUsageUrl.trim() ? next.codexUsageUrl.trim() : DEFAULT_CODEX_URL,
    pricing: next.pricing && typeof next.pricing === 'object' && !Array.isArray(next.pricing) ? next.pricing : {},
  };
}

async function readSettings() {
  try {
    const text = await readFile(settingsPath(), 'utf8');
    return normalizeSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(value) {
  const normalized = normalizeSettings(value);
  if (Object.keys(normalized.pricing).length === 0) {
    const existing = await readSettings();
    if (Object.keys(existing.pricing).length > 0) normalized.pricing = existing.pricing;
  }
  const target = settingsPath();
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(normalized, null, 2), 'utf8');
  await rm(target, { force: true });
  await rename(temporary, target);
  return normalized;
}

const codexCache = new Map();
const opencodeGoCache = new Map();
const deepseekCache = new Map();
const fxCache = new Map();

// DeepSeek's official CNY list price, per one million tokens. Peak is twice off-peak.
const DEFAULT_PRICING = Object.freeze({
  'deepseek-flash': Object.freeze({
    peak: Object.freeze({ input: 2, cacheRead: 0.04, output: 8 }),
    offpeak: Object.freeze({ input: 1, cacheRead: 0.02, output: 4 }),
  }),
  'deepseek-v4-pro': Object.freeze({
    peak: Object.freeze({ input: 9, cacheRead: 0.3, output: 27 }),
    offpeak: Object.freeze({ input: 4.5, cacheRead: 0.15, output: 13.5 }),
  }),
});

const MODEL_ALIASES = Object.freeze({
  'deepseek-flash': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
  'deepseek-chat': 'deepseek-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek-reasoner': 'deepseek-v4-pro',
});

function canonicalModel(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (!id) return null;
  if (MODEL_ALIASES[id]) return MODEL_ALIASES[id];
  if (id.startsWith('deepseek-v4-pro')) return 'deepseek-v4-pro';
  if (id.startsWith('deepseek')) return 'deepseek-flash';
  return null;
}

// Chinese public holidays from the State Council 2025/2026 notices. Weekends are
// already off-peak in DeepSeek's rule; the ranges include them for completeness.
const CN_HOLIDAY_RANGES = Object.freeze([
  Object.freeze(['2025-01-01', '2025-01-01']),
  Object.freeze(['2025-01-28', '2025-02-04']),
  Object.freeze(['2025-04-04', '2025-04-06']),
  Object.freeze(['2025-05-01', '2025-05-05']),
  Object.freeze(['2025-05-31', '2025-06-02']),
  Object.freeze(['2025-10-01', '2025-10-08']),
  Object.freeze(['2026-01-01', '2026-01-03']),
  Object.freeze(['2026-02-15', '2026-02-23']),
  Object.freeze(['2026-04-04', '2026-04-06']),
  Object.freeze(['2026-05-01', '2026-05-05']),
  Object.freeze(['2026-06-19', '2026-06-21']),
  Object.freeze(['2026-09-25', '2026-09-27']),
  Object.freeze(['2026-10-01', '2026-10-07']),
]);

function expandHolidayRanges(ranges) {
  const days = new Set();
  for (const [start, end] of ranges) {
    const [startYear, startMonth, startDay] = start.split('-').map(Number);
    const [endYear, endMonth, endDay] = end.split('-').map(Number);
    const from = Date.UTC(startYear, startMonth - 1, startDay);
    const to = Date.UTC(endYear, endMonth - 1, endDay);
    for (let time = from; time <= to; time += 86_400_000) {
      days.add(new Date(time).toISOString().slice(0, 10));
    }
  }
  return days;
}

const CN_HOLIDAYS = expandHolidayRanges(CN_HOLIDAY_RANGES);

function beijingDayKey(epochMs) {
  const date = new Date(Number(epochMs) + BEIJING_OFFSET_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function isCnHoliday(day, extraHolidays) {
  if (CN_HOLIDAYS.has(day)) return true;
  return Array.isArray(extraHolidays) && extraHolidays.includes(day);
}

function isPeakAt(epochMs, extraHolidays) {
  const date = new Date(Number(epochMs) + BEIJING_OFFSET_MS);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (isCnHoliday(beijingDayKey(epochMs), extraHolidays)) return false;
  const hour = date.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

function mergePricing(overrides) {
  const merged = {};
  for (const [model, rates] of Object.entries(DEFAULT_PRICING)) {
    merged[model] = {
      peak: { ...rates.peak },
      offpeak: { ...rates.offpeak },
    };
  }
  if (overrides && typeof overrides === 'object') {
    for (const [model, rates] of Object.entries(overrides)) {
      if (model === '__proto__' || !rates || typeof rates !== 'object') continue;
      const prior = merged[model] ?? { peak: {}, offpeak: {} };
      merged[model] = {
        peak: { ...prior.peak, ...(rates.peak && typeof rates.peak === 'object' ? rates.peak : {}) },
        offpeak: { ...prior.offpeak, ...(rates.offpeak && typeof rates.offpeak === 'object' ? rates.offpeak : {}) },
      };
    }
  }
  return merged;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function pricingFor(modelId, overrides, extraHolidays) {
  const table = mergePricing(overrides);
  const requested = typeof modelId === 'string' ? modelId.trim() : '';
  const direct = requested && Object.prototype.hasOwnProperty.call(table, requested) ? requested : null;
  const canonical = canonicalModel(requested);
  const key = direct || canonical || 'deepseek-flash';
  const rates = table[key] ?? DEFAULT_PRICING['deepseek-flash'];
  const peakNow = isPeakAt(Date.now(), extraHolidays);
  return {
    model: requested,
    key,
    matched: Boolean(direct || (canonical && Object.prototype.hasOwnProperty.call(table, canonical))),
    currency: PRICING_CURRENCY,
    peak: {
      input: numberOrZero(rates.peak?.input),
      cacheRead: numberOrZero(rates.peak?.cacheRead),
      output: numberOrZero(rates.peak?.output),
    },
    offpeak: {
      input: numberOrZero(rates.offpeak?.input),
      cacheRead: numberOrZero(rates.offpeak?.cacheRead),
      output: numberOrZero(rates.offpeak?.output),
    },
    peakNow,
    offpeakActive: !peakNow,
  };
}

function pricingTable(overrides) {
  return { currency: PRICING_CURRENCY, models: mergePricing(overrides) };
}

function errorResult(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

function sanitizedError(error, fallback = 'Request failed') {
  const status = Number(error?.status ?? error?.statusCode);
  if (Number.isFinite(status) && status > 0) {
    const code = error?.code === 'invalid-auth' ? 'invalid-auth' : 'upstream-error';
    return { code, message: fallbackFor(code, fallback) };
  }
  const rawCode = typeof error?.code === 'string' ? error.code : '';
  const allowed = new Set(['missing-credentials', 'invalid-auth', 'timeout', 'aborted', 'invalid-response', 'upstream-error']);
  const code = allowed.has(rawCode) ? rawCode : rawCode === 'ENOENT' || rawCode === 'ENOTFOUND' ? 'missing-credentials' : 'upstream-error';
  return { code, message: fallbackFor(code, fallback) };
}

function fallbackFor(code, fallback) {
  switch (code) {
    case 'missing-credentials': return 'Authentication is not configured';
    case 'invalid-auth': return 'Authentication failed';
    case 'timeout': return 'The request timed out';
    case 'aborted': return 'The request was cancelled';
    case 'invalid-response': return 'The service returned an invalid response';
    default: return fallback;
  }
}

function combineSignal(signal, milliseconds) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(milliseconds);
    if (!signal) return timeout;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  }
  if (typeof AbortController === 'undefined') return signal;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), milliseconds);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  controller.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }, { once: true });
  return controller.signal;
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function windowRemaining(window) {
  if (!window || typeof window !== 'object') return null;
  let remaining;
  if (typeof window.used_percent === 'number' && Number.isFinite(window.used_percent)) {
    remaining = 100 - window.used_percent;
  } else {
    remaining = Number(window.remaining_percent);
    if (!Number.isFinite(remaining)) return null;
  }
  const seconds = Number(window.limit_window_seconds);
  let reset;
  if (window.reset_at != null && Number.isFinite(Number(window.reset_at))) {
    reset = new Date(Number(window.reset_at) * 1000);
  } else if (window.reset_after_seconds != null && Number.isFinite(Number(window.reset_after_seconds))) {
    reset = new Date(Date.now() + Number(window.reset_after_seconds) * 1000);
  }
  return {
    remainingPercent: clamp(remaining),
    resetAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : undefined,
    windowSeconds: Number.isFinite(seconds) ? seconds : undefined,
  };
}

function findWindow(rateLimit, seconds) {
  const windows = rateLimit && typeof rateLimit === 'object'
    ? Object.values(rateLimit).filter(value => value && typeof value === 'object')
    : [];
  return windows.find(window => Number(window.limit_window_seconds) === seconds) ?? null;
}

async function readCodexCredential(ctx, cfg, signal) {
  try {
    const service = ctx.get('codexAuth');
    if (service?.credential) {
      const credentials = await service.credential(signal);
      if (credentials?.accessToken) return { accessToken: credentials.accessToken, accountId: credentials.accountId };
    }
  } catch {
    // Fall through to the auth file for installations without a usable service credential.
  }
  const authPath = cfg.codexAuthJsonPath || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  const text = await readFile(authPath, 'utf8');
  const auth = JSON.parse(text);
  const accessToken = auth?.tokens?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) throw Object.assign(new Error('No Codex credential'), { code: 'missing-credentials' });
  return { accessToken, accountId: auth?.tokens?.account_id, authPath };
}

async function queryCodex(ctx, cfg, signal) {
  let authPath = cfg.codexAuthJsonPath || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  try {
    const credential = await readCodexCredential(ctx, cfg, signal);
    authPath = credential.authPath || authPath;
    const url = cfg.codexUsageUrl;
    const cacheKey = `${authPath}\u0000${url}`;
    const cached = codexCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { kind: 'codex', codex: cached.value };

    const requestSignal = combineSignal(signal, 10_000);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        ...(credential.accountId ? { 'chatgpt-account-id': credential.accountId } : {}),
        'content-type': 'application/json',
        'user-agent': 'dsh-budget-view/0.4.0',
      },
      signal: requestSignal,
    });
    if (!response.ok) throw Object.assign(new Error('Codex request failed'), { status: response.status, code: response.status === 401 ? 'invalid-auth' : 'upstream-error' });
    const payload = await response.json();
    const rateLimit = payload?.rate_limit;
    const fiveHour = windowRemaining(findWindow(rateLimit, 18000));
    const weekly = windowRemaining(findWindow(rateLimit, 604800));
    if (!fiveHour || !weekly) throw Object.assign(new Error('Missing usage windows'), { code: 'invalid-response' });
    const value = {
      available: true,
      ...(typeof payload.plan_type === 'string' ? { planType: payload.plan_type } : {}),
      fiveHour,
      weekly,
    };
    codexCache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
    return { kind: 'codex', codex: value };
  } catch (error) {
    const failure = sanitizedError(error, 'Could not load Codex usage');
    return { kind: 'codex', codex: { available: false, error: failure } };
  }
}

function opencodeGoWindow(window, windowSeconds) {
  if (!window || typeof window !== 'object') return null;
  // The current API uses percent/resetsAt; the original endpoint used
  // usagePercent/resetInSec in rollingUsage and weeklyUsage.
  const used = window.percent ?? window.usagePercent;
  if (window.status !== 'rate-limited' && (typeof used !== 'number' || !Number.isFinite(used))) return null;
  const reset = typeof window.resetsAt === 'string'
    ? new Date(window.resetsAt)
    : typeof window.resetInSec === 'number' && Number.isFinite(window.resetInSec)
      ? new Date(Date.now() + window.resetInSec * 1000)
      : null;
  return {
    remainingPercent: window.status === 'rate-limited' ? 0 : clamp(100 - used),
    resetAt: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : undefined,
    windowSeconds,
  };
}

async function queryOpencodeGo(signal) {
  try {
    const key = process.env.OPENCODE_API_KEY?.trim();
    if (!key) throw Object.assign(new Error('Missing OpenCode API key'), { code: 'missing-credentials' });
    const cacheKey = createHash('sha256').update(key).digest('hex');
    const cached = opencodeGoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { kind: 'opencode-go', opencodeGo: cached.value };
    const response = await fetch(OPENCODE_GO_USAGE_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      redirect: 'error',
      signal: combineSignal(signal, 10_000),
    });
    if (!response.ok) throw Object.assign(new Error('OpenCode Go request failed'), {
      status: response.status,
      code: response.status === 401 || response.status === 403 ? 'invalid-auth' : 'upstream-error',
    });
    const payload = await response.json().catch(() => {
      throw Object.assign(new Error('Invalid usage JSON'), { code: 'invalid-response' });
    });
    const fiveHour = opencodeGoWindow(payload?.usage?.rolling ?? payload?.rollingUsage, 18000);
    const weekly = opencodeGoWindow(payload?.usage?.weekly ?? payload?.weeklyUsage, 604800);
    if (!fiveHour || !weekly) throw Object.assign(new Error('Missing usage windows'), { code: 'invalid-response' });
    const value = { available: true, fiveHour, weekly };
    const resets = [fiveHour, weekly].map(window => Date.parse(window.resetAt)).filter(time => time > Date.now());
    opencodeGoCache.clear();
    opencodeGoCache.set(cacheKey, { value, expiresAt: Math.min(Date.now() + 30_000, ...resets) });
    return { kind: 'opencode-go', opencodeGo: value };
  } catch (error) {
    if (error?.name === 'TimeoutError') error = { code: 'timeout' };
    else if (error?.name === 'AbortError') error = { code: 'aborted' };
    return { kind: 'opencode-go', opencodeGo: { available: false, error: sanitizedError(error, 'Could not load OpenCode Go usage') } };
  }
}

async function queryFx(cfg, signal, force = false) {
  const manualRate = boundedNumber(cfg.usdToCnyRate, 0.01, 100, DEFAULT_SETTINGS.usdToCnyRate);
  if (cfg.fxMode === 'manual') {
    return {
      available: true,
      base: 'USD',
      quote: 'CNY',
      rate: manualRate,
      date: null,
      source: 'manual',
      fetchedAt: new Date().toISOString(),
      stale: false,
      error: null,
    };
  }

  const cached = fxCache.get(FX_URL);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, stale: false };
  }

  try {
    const response = await fetch(FX_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'dsh-budget-view/0.4.0',
      },
      signal: combineSignal(signal, 8_000),
    });
    if (!response.ok) throw Object.assign(new Error('FX request failed'), { status: response.status, code: 'upstream-error' });
    const payload = await response.json();
    const rate = Number(payload?.rates?.CNY);
    if (!Number.isFinite(rate) || rate <= 0) throw Object.assign(new Error('Missing CNY rate'), { code: 'invalid-response' });
    const value = {
      available: true,
      base: 'USD',
      quote: 'CNY',
      rate,
      date: typeof payload?.date === 'string' ? payload.date : null,
      source: FX_SOURCE,
      fetchedAt: new Date().toISOString(),
      stale: false,
      error: null,
    };
    fxCache.set(FX_URL, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return value;
  } catch (error) {
    const failure = sanitizedError(error, 'Could not load the USD → CNY rate');
    if (cached?.value) return { ...cached.value, stale: true, error: failure };
    return {
      available: false,
      base: 'USD',
      quote: 'CNY',
      rate: manualRate,
      date: null,
      source: 'manual fallback',
      fetchedAt: new Date().toISOString(),
      stale: false,
      error: failure,
    };
  }
}

async function deepseekApiKey(ctx, cfg) {
  const ref = cfg.deepseekApiKeyRef || 'DEEPSEEK_API_KEY';
  try {
    const credentials = ctx.get('credentials');
    const resolved = await credentials?.resolve(ref);
    if (typeof resolved?.value === 'string' && resolved.value) return resolved.value;
  } catch {
    // Try process environment after the credential service.
  }
  if (typeof process.env[ref] === 'string' && process.env[ref]) return process.env[ref];
  throw Object.assign(new Error('Missing DeepSeek API credential'), { code: 'missing-credentials' });
}

async function queryDeepseek(ctx, cfg, model, signal) {
  const pricing = pricingFor(model, cfg.pricing, cfg.cnHolidays);
  const table = pricingTable(cfg.pricing);
  const fxPromise = queryFx(cfg, signal);
  const cacheKey = `${cfg.deepseekApiKeyRef || 'DEEPSEEK_API_KEY'}\u0000${cfg.deepseekBaseUrl || DEFAULT_DEEPSEEK_BASE}`;

  const cached = deepseekCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const fx = await fxPromise;
    return { kind: 'deepseek', deepseek: { pricing, pricingTable: table, balance: cached.balance, fx, error: null } };
  }

  try {
    const key = await deepseekApiKey(ctx, cfg);
    const base = (cfg.deepseekBaseUrl || DEFAULT_DEEPSEEK_BASE).replace(/\/+$/, '');
    const response = await fetch(`${base}/user/balance`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
      signal: combineSignal(signal, 10_000),
    });
    if (!response.ok) throw Object.assign(new Error('DeepSeek balance request failed'), { status: response.status, code: response.status === 401 ? 'invalid-auth' : 'upstream-error' });
    const payload = await response.json();
    const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
    const first = infos.find(info => info && info.currency === 'CNY') ?? infos[0] ?? null;
    if (!first) throw Object.assign(new Error('Missing balance details'), { code: 'invalid-response' });
    const balance = {
      isAvailable: Boolean(payload.is_available),
      currency: typeof first.currency === 'string' ? first.currency : '',
      totalBalance: String(first.total_balance ?? ''),
      grantedBalance: String(first.granted_balance ?? ''),
      toppedUpBalance: String(first.topped_up_balance ?? ''),
    };
    deepseekCache.set(cacheKey, { balance, expiresAt: Date.now() + 60_000 });
    const fx = await fxPromise;
    return { kind: 'deepseek', deepseek: { pricing, pricingTable: table, balance, fx, error: null } };
  } catch (error) {
    const fx = await fxPromise;
    return {
      kind: 'deepseek',
      deepseek: { pricing, pricingTable: table, balance: null, fx, error: sanitizedError(error, 'Could not load DeepSeek balance') },
    };
  }
}

async function querySummary(ctx, cfg, signal) {
  const [codex, deepseek, opencodeGo] = await Promise.all([
    queryCodex(ctx, cfg, signal),
    queryDeepseek(ctx, cfg, 'deepseek-flash', signal),
    queryOpencodeGo(signal),
  ]);
  return { kind: 'summary', codex: codex.codex, deepseek: deepseek.deepseek, opencodeGo: opencodeGo.opencodeGo };
}

export const inject = ['connection'];

function serverResponse(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result });
}

export function apply(ctx) {
  return ctx.connection.fetch.register({
    path: '/api/dsh-budget-view/query',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      if (request.method !== 'POST') return new Response('not found', { status: 404 });
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') return new Response('content type must be application/json', { status: 415 });
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response('invalid JSON', { status: 400 });
      }
      const rpcId = typeof body?.rpcId === 'string' && body.rpcId ? body.rpcId : 'invalid-request';
      if (body?.type !== 'client-request' || body?.method !== 'dsh-budget-view/query') {
        return serverResponse(rpcId, errorResult('bad-request', 'invalid request envelope'));
      }
      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
      const action = typeof payload.action === 'string' ? payload.action : 'query';
      if (action === 'settings-get') {
        return serverResponse(rpcId, { ok: true, value: { settings: await readSettings() } });
      }
      if (action === 'settings-set') {
        if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
          return serverResponse(rpcId, errorResult('bad-request', 'settings object is required'));
        }
        try {
          return serverResponse(rpcId, { ok: true, value: { settings: await writeSettings(payload.settings) } });
        } catch {
          return serverResponse(rpcId, errorResult('internal', 'could not save settings'));
        }
      }
      if (action === 'fx-get') {
        const cfg = await readSettings();
        try {
          const fx = await queryFx(cfg, request.signal, payload.force === true);
          return serverResponse(rpcId, { ok: true, value: { fx } });
        } catch {
          return serverResponse(rpcId, errorResult('internal', 'could not load the exchange rate'));
        }
      }
      if (action !== 'query') return serverResponse(rpcId, errorResult('bad-request', 'unknown action'));
      if (typeof payload.provider !== 'string' || typeof payload.model !== 'string') {
        return serverResponse(rpcId, errorResult('bad-request', 'provider and model are required'));
      }
      const provider = payload.provider;
      const model = payload.model;
      const cfg = await readSettings();
      let result;
      try {
        if (provider === '__summary__') result = { ok: true, value: await querySummary(ctx, cfg, request.signal) };
        else if (provider === 'openai-codex') result = { ok: true, value: await queryCodex(ctx, cfg, request.signal) };
        else if (provider === 'opencode-go') result = { ok: true, value: await queryOpencodeGo(request.signal) };
        else if (/deepseek/i.test(provider) || /^deepseek/i.test(model)) result = { ok: true, value: await queryDeepseek(ctx, cfg, model, request.signal) };
        else result = { ok: true, value: { kind: 'none' } };
      } catch {
        result = errorResult('internal', 'request failed');
      }
      return serverResponse(rpcId, result);
    },
  });
}


