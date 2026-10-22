import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const instrumented = source.replace(
  "return { name: 'dsh-budget-view', inject, apply };",
  "return { name: 'dsh-budget-view', inject, apply, __test: { sessionCost, costFromDays, isPeakAt, isCnHoliday, isWeekendKey, CN_HOLIDAYS, mergePricing, costDisplay, kindFor, normalizeSettings, publishSettings, BudgetPill, HeroBudget, zh, en } };",
);

let module;
let budgetState = { data: null, error: false };
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  useState: () => [budgetState, () => {}],
  useEffect: () => {},
};
const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ factory }) {
        module = factory(() => react);
      },
    },
  },
  console,
  URL,
};
vm.runInNewContext(instrumented, sandbox, { filename: 'client.js' });
assert.ok(module?.__test, 'client test hook missing');

const { sessionCost, costFromDays, isPeakAt, isCnHoliday, isWeekendKey, CN_HOLIDAYS, mergePricing, costDisplay } = module.__test;
const settings = { useOffpeakPricing: true, cnHolidays: [], pricing: {} };
const table = { models: mergePricing({}) };
const at = iso => Date.parse(`${iso}+08:00`);
const million = 1_000_000;
const bucket = { uncached: million, cacheRead: million, cacheWrite: 0, output: million };

// Peak calendar: holidays, weekends, make-up workdays, lunch, and normal weekdays.
assert.equal(CN_HOLIDAYS.size, 61);
assert.equal(isPeakAt(at('2026-10-01T10:00:00'), settings), false);
assert.equal(isPeakAt(at('2026-10-08T10:00:00'), settings), true);
assert.equal(isPeakAt(at('2026-10-10T10:00:00'), settings), false);
assert.equal(isPeakAt(at('2026-02-17T10:00:00'), settings), false);
assert.equal(isPeakAt(at('2026-02-24T10:00:00'), settings), true);
assert.equal(isPeakAt(at('2025-10-06T10:00:00'), settings), false);
assert.equal(isPeakAt(at('2025-10-09T10:00:00'), settings), true);
assert.equal(isPeakAt(at('2026-10-22T10:00:00'), settings), true);
assert.equal(isPeakAt(at('2026-10-22T12:30:00'), settings), false);
assert.equal(isCnHoliday('2026-01-02', settings), true);
assert.equal(isCnHoliday('2026-01-04', settings), false);
assert.equal(isWeekendKey('2026-10-10'), true);
assert.equal(isWeekendKey('2026-10-09'), false);

const dayCost = (day, period = 'peak') => ({
  [day]: { cost: { 'deepseek-official': { 'deepseek-flash': { [period]: bucket } } } },
});

const holiday = costFromDays(dayCost('2026-10-01'), settings, table);
assert.ok(holiday);
assert.equal(holiday.cny.toFixed(2), '5.02');
assert.equal(holiday.peakCny.toFixed(2), '0.00');
assert.equal(holiday.offCny.toFixed(2), '5.02');

const normal = costFromDays(dayCost('2026-10-08'), settings, table);
assert.ok(normal);
assert.equal(normal.cny.toFixed(2), '10.04');
assert.equal(normal.peakCny.toFixed(2), '10.04');

const noOffpeak = costFromDays(dayCost('2026-10-01'), { ...settings, useOffpeakPricing: false }, table);
assert.equal(noOffpeak.cny.toFixed(2), '10.04');
assert.equal(noOffpeak.offCny, 0);

const custom = costFromDays(dayCost('2027-01-04'), { ...settings, cnHolidays: ['2027-01-04'] }, table);
assert.ok(custom);
assert.equal(custom.cny.toFixed(2), '5.02');

const timeline = { 'deepseek-official': { 'deepseek-flash': { peak: bucket, off: bucket } } };
const price = {
  key: 'deepseek-flash',
  offpeakActive: false,
  peak: { input: 2, cacheRead: 0.04, output: 8 },
  offpeak: { input: 1, cacheRead: 0.02, output: 4 },
};
const activityCost = sessionCost(dayCost('2026-10-01'), timeline, null, settings, table, price, 'deepseek-flash');
assert.equal(activityCost.cny.toFixed(2), '5.02');
assert.equal(activityCost.source, 'context');

const aggregateCost = sessionCost(null, timeline, null, settings, table, price, 'deepseek-flash');
assert.equal(aggregateCost.cny.toFixed(2), '15.06');

const usage = { uncachedInputTokens: million, cacheReadTokens: million, cacheWriteTokens: 0, outputTokens: million };
const fallbackCost = sessionCost(null, null, usage, settings, table, price, 'deepseek-flash');
assert.equal(fallbackCost.cny.toFixed(2), '10.04');
assert.equal(fallbackCost.source, 'tokenUsage');

const cny = costDisplay(15.06, { costCurrency: 'CNY' }, 'CNY', 6.6761);
const usd = costDisplay(15.06, { costCurrency: 'USD' }, 'CNY', 6.6761);
assert.equal(cny.text, '¥15.06');
assert.equal(usd.text, '$2.26');

console.log('client checks passed:', {
  holidays: CN_HOLIDAYS.size,
  holidayCost: holiday.cny.toFixed(2),
  normalCost: normal.cny.toFixed(2),
  fallback: fallbackCost.source,
});

const { kindFor, normalizeSettings, publishSettings, BudgetPill, HeroBudget, zh, en } = module.__test;
assert.equal(kindFor({ provider: 'opencode-go', model: 'deepseek-v4-pro' }), 'opencode-go');
assert.equal(kindFor({ provider: 'opencode-go', model: 'kimi-k2.7' }), 'opencode-go');
assert.equal(kindFor({ provider: 'openai-codex', model: 'gpt-5' }), 'codex');
assert.equal(kindFor({ provider: 'deepseek-official', model: 'deepseek-flash' }), 'deepseek');
assert.equal(normalizeSettings({ heroMode: 'opencode-go' }).heroMode, 'opencode-go');

const quota = {
  available: true,
  fiveHour: { remainingPercent: 69, resetAt: '2026-10-22T10:00:00Z' },
  weekly: { remainingPercent: 95, resetAt: '2026-10-29T10:00:00Z' },
};
const current = { provider: 'opencode-go', model: 'deepseek-v4-pro' };
const props = {
  rpc: {}, directory: { getSnapshot: () => ({ current, status: 'ready' }) },
  load() {}, useProjection: () => null,
};
const textOf = node => typeof node === 'string' ? node : node?.children?.map(textOf).join('') || '';
const find = (node, predicate) => node && typeof node === 'object'
  ? predicate(node) ? node : node.children?.map(child => find(child, predicate)).find(Boolean)
  : undefined;
for (const messages of [zh, en]) {
  props.t = (key, vars = {}) => (messages[key] || key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  publishSettings({ heroMode: 'current' });
  budgetState = { data: { kind: 'opencode-go', opencodeGo: quota }, error: false };
  const pill = BudgetPill(props);
  assert.equal(pill.props['data-budget-kind'], 'opencode-go');
  assert.match(textOf(pill), /OpenCode Go · 5h 69% · 7d 95%/);
  assert.match(pill.props.title, /OpenCode Go/);
  assert.ok(!pill.props.title.includes('Codex'));

  for (const mode of ['both', 'current', 'opencode-go']) {
    for (const style of ['chips', 'plain']) {
      publishSettings({ heroMode: mode, heroStyle: style, showBalance: false });
      budgetState = { data: mode === 'both'
        ? { kind: 'summary', opencodeGo: quota, codex: quota }
        : { kind: 'opencode-go', opencodeGo: quota }, error: false };
      const hero = HeroBudget(props);
      assert.match(textOf(hero), /OpenCode Go.*5h 69%.*7d 95%/);
      if (style === 'chips') {
        const chip = find(hero, node => node.props['data-hero-provider'] === 'opencode-go');
        assert.ok(chip);
        assert.match(chip.props['aria-label'], /OpenCode Go 5h 69% · 7d 95%/);
      }
    }
  }
  publishSettings({ heroMode: 'opencode-go', heroShowIcons: false });
  budgetState = { data: { kind: 'opencode-go', opencodeGo: {
    available: false, error: { message: 'Authentication is not configured' },
  } }, error: false };
  assert.match(textOf(BudgetPill(props)), /OpenCode Go · 5h — · 7d —/);
  assert.match(HeroBudget(props).props.title, /Authentication is not configured/);
  budgetState = { data: null, error: true };
  assert.match(textOf(HeroBudget(props)), /OpenCode Go.*5h —.*7d —/);
}
console.log('OpenCode Go client checks passed: provider routing, dock, hero modes, styles, locales, failures');
