import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const instrumented = source.replace(
  "return { name: 'dsh-budget-view', inject, apply };",
  "return { name: 'dsh-budget-view', inject, apply, __test: { sessionCost, costFromDays, isPeakAt, isCnHoliday, isWeekendKey, CN_HOLIDAYS, mergePricing, costDisplay } };",
);

let module;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ factory }) {
        module = factory(() => ({ createElement: () => null }));
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
