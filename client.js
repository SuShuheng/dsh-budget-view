window.__ModuleLoader__.load({
  id: 'dsh-budget-view',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'dsh-budget-view';
    const inject = ['slots', 'connection', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.session'];

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
      deepseekBaseUrl: 'https://api.deepseek.com',
      codexAuthJsonPath: '',
      codexUsageUrl: 'https://chatgpt.com/backend-api/wham/usage',
      pricing: {},
    });

    let settingsState = { ...DEFAULT_SETTINGS };
    let settingsRpc;
    const settingsListeners = new Set();
    const settingsStore = {
      subscribe(callback) {
        settingsListeners.add(callback);
        return () => { settingsListeners.delete(callback); };
      },
      getSnapshot() { return settingsState; },
    };

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
        heroMode: ['both', 'current', 'codex', 'deepseek'].includes(next.heroMode) ? next.heroMode : 'both',
        heroStyle: next.heroStyle === 'plain' ? 'plain' : 'chips',
        heroDensity: next.heroDensity === 'comfortable' ? 'comfortable' : 'compact',
        heroShowIcons: next.heroShowIcons !== false,
        showHeroPeak: next.showHeroPeak !== false,
        showDockPeak: next.showDockPeak !== false,
        cnHolidays: Array.isArray(next.cnHolidays)
          ? [...new Set(next.cnHolidays.filter(isDateKey))]
          : [],
        deepseekApiKeyRef: typeof next.deepseekApiKeyRef === 'string' && next.deepseekApiKeyRef.trim() ? next.deepseekApiKeyRef.trim() : 'DEEPSEEK_API_KEY',
        deepseekBaseUrl: typeof next.deepseekBaseUrl === 'string' && next.deepseekBaseUrl.trim() ? next.deepseekBaseUrl.trim() : 'https://api.deepseek.com',
        codexAuthJsonPath: typeof next.codexAuthJsonPath === 'string' ? next.codexAuthJsonPath.trim() : '',
        codexUsageUrl: typeof next.codexUsageUrl === 'string' && next.codexUsageUrl.trim() ? next.codexUsageUrl.trim() : 'https://chatgpt.com/backend-api/wham/usage',
        pricing: next.pricing && typeof next.pricing === 'object' && !Array.isArray(next.pricing) ? next.pricing : {},
      };
    }

    function publishSettings(value) {
      settingsState = normalizeSettings(value);
      for (const listener of settingsListeners) listener();
    }

    const PRICING_CURRENCY = 'CNY';
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

    function isDeepseekModel(provider, model) {
      return /deepseek/i.test(provider || '') || /^deepseek/i.test(model || '');
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
      const date = new Date(Number(epochMs) + 8 * 60 * 60 * 1000);
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${date.getUTCFullYear()}-${month}-${day}`;
    }

    function isCnHoliday(day, settings) {
      if (CN_HOLIDAYS.has(day)) return true;
      return Array.isArray(settings?.cnHolidays) && settings.cnHolidays.includes(day);
    }

    function isWeekendKey(day) {
      const [year, month, date] = day.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
      return weekday === 0 || weekday === 6;
    }

    function isPeakAt(epochMs, settings) {
      const date = new Date(Number(epochMs) + 8 * 60 * 60 * 1000);
      const weekday = date.getUTCDay();
      if (weekday === 0 || weekday === 6) return false;
      if (isCnHoliday(beijingDayKey(epochMs), settings)) return false;
      const hour = date.getUTCHours();
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
    }

    function isPeakNow(settings) {
      return isPeakAt(Date.now(), settings);
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

    function pricingEntryFor(modelId, models) {
      const table = models && typeof models === 'object' ? models : DEFAULT_PRICING;
      const requested = typeof modelId === 'string' ? modelId.trim() : '';
      const direct = requested && Object.prototype.hasOwnProperty.call(table, requested) ? requested : null;
      const canonical = canonicalModel(requested);
      const key = direct || canonical || 'deepseek-flash';
      const rates = table[key] ?? DEFAULT_PRICING[key] ?? DEFAULT_PRICING['deepseek-flash'];
      return {
        key,
        peak: {
          input: tokenValue(rates.peak, 'input'),
          cacheRead: tokenValue(rates.peak, 'cacheRead'),
          output: tokenValue(rates.peak, 'output'),
        },
        offpeak: {
          input: tokenValue(rates.offpeak, 'input'),
          cacheRead: tokenValue(rates.offpeak, 'cacheRead'),
          output: tokenValue(rates.offpeak, 'output'),
        },
      };
    }

    function costFromDays(days, settings, table) {
      if (!days || typeof days !== 'object') return null;
      const totals = { input: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      let cny = 0;
      let peakCny = 0;
      let offCny = 0;
      const models = new Set();
      let found = false;

      for (const [day, dayData] of Object.entries(days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const usage = dayData?.cost;
        if (!usage || typeof usage !== 'object') continue;
        const holiday = isCnHoliday(day, settings);
        const offDay = holiday || isWeekendKey(day);
        const forceOffpeak = settings.useOffpeakPricing && offDay;
        for (const [provider, byModel] of Object.entries(usage)) {
          if (!byModel || typeof byModel !== 'object') continue;
          for (const [model, periods] of Object.entries(byModel)) {
            if (!isDeepseekModel(provider, model) || !periods || typeof periods !== 'object') continue;
            const entry = pricingEntryFor(model, table);
            for (const period of ['peak', 'off']) {
              const bucket = periods[period];
              if (!bucket || typeof bucket !== 'object') continue;
              const useOffpeak = forceOffpeak || (period === 'off' && settings.useOffpeakPricing);
              const rates = useOffpeak ? entry.offpeak : entry.peak;
              const uncached = tokenValue(bucket, 'uncached');
              const cacheRead = tokenValue(bucket, 'cacheRead');
              const cacheWrite = tokenValue(bucket, 'cacheWrite');
              const output = tokenValue(bucket, 'output');
              const amount = (
                (uncached + cacheWrite) * rates.input
                + cacheRead * rates.cacheRead
                + output * rates.output
              ) / 1_000_000;
              cny += amount;
              if (useOffpeak) offCny += amount;
              else peakCny += amount;
              totals.uncached += uncached;
              totals.cacheRead += cacheRead;
              totals.cacheWrite += cacheWrite;
              totals.output += output;
              models.add(entry.key);
              found = true;
            }
          }
        }
      }
      totals.input = totals.uncached + totals.cacheRead + totals.cacheWrite;
      if (!found || totals.input + totals.output === 0) return null;
      return {
        cny,
        peakCny,
        offCny,
        tokens: totals,
        models: [...models],
        source: 'context',
        offpeakActive: !isPeakNow(settings),
      };
    }

    function sessionCost(activityDays, sessionCostUsage, usage, settings, pricingTable, currentPricing, currentModel) {
      const table = pricingTable?.models && typeof pricingTable.models === 'object'
        ? pricingTable.models
        : mergePricing(settings.pricing);
      const dayCost = costFromDays(activityDays, settings, table);
      if (dayCost) return dayCost;
      const totals = { input: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      let cny = 0;
      let peakCny = 0;
      let offCny = 0;
      const models = new Set();
      let found = false;

      if (sessionCostUsage && typeof sessionCostUsage === 'object') {
        for (const [provider, byModel] of Object.entries(sessionCostUsage)) {
          if (!byModel || typeof byModel !== 'object') continue;
          for (const [model, periods] of Object.entries(byModel)) {
            if (!isDeepseekModel(provider, model) || !periods || typeof periods !== 'object') continue;
            const entry = pricingEntryFor(model, table);
            for (const period of ['peak', 'off']) {
              const bucket = periods[period];
              if (!bucket || typeof bucket !== 'object') continue;
              const useOffpeak = period === 'off' && settings.useOffpeakPricing;
              const rates = useOffpeak ? entry.offpeak : entry.peak;
              const uncached = tokenValue(bucket, 'uncached');
              const cacheRead = tokenValue(bucket, 'cacheRead');
              const cacheWrite = tokenValue(bucket, 'cacheWrite');
              const output = tokenValue(bucket, 'output');
              const amount = (
                (uncached + cacheWrite) * rates.input
                + cacheRead * rates.cacheRead
                + output * rates.output
              ) / 1_000_000;
              cny += amount;
              if (useOffpeak) offCny += amount;
              else peakCny += amount;
              totals.uncached += uncached;
              totals.cacheRead += cacheRead;
              totals.cacheWrite += cacheWrite;
              totals.output += output;
              models.add(entry.key);
              found = true;
            }
          }
        }
      }
      totals.input = totals.uncached + totals.cacheRead + totals.cacheWrite;
      if (found && totals.input + totals.output > 0) {
        return {
          cny,
          peakCny,
          offCny,
          tokens: totals,
          models: [...models],
          source: 'context',
          offpeakActive: typeof currentPricing?.offpeakActive === 'boolean' ? currentPricing.offpeakActive : !isPeakNow(settings),
        };
      }

      if (!usage || typeof usage !== 'object') return null;
      const fallback = {
        uncached: tokenValue(usage, 'uncachedInputTokens'),
        cacheRead: tokenValue(usage, 'cacheReadTokens'),
        cacheWrite: tokenValue(usage, 'cacheWriteTokens'),
        output: tokenValue(usage, 'outputTokens'),
      };
      fallback.input = fallback.uncached + fallback.cacheRead + fallback.cacheWrite;
      if (fallback.input + fallback.output === 0) return null;

      const entry = currentPricing && currentPricing.peak && currentPricing.offpeak
        ? {
            key: currentPricing.key || canonicalModel(currentModel) || 'deepseek-flash',
            peak: currentPricing.peak,
            offpeak: currentPricing.offpeak,
          }
        : pricingEntryFor(currentModel, table);
      const offpeakActive = typeof currentPricing?.offpeakActive === 'boolean' ? currentPricing.offpeakActive : !isPeakNow(settings);
      const useOffpeak = settings.useOffpeakPricing && offpeakActive;
      const rates = useOffpeak ? entry.offpeak : entry.peak;
      const amount = (
        (fallback.uncached + fallback.cacheWrite) * tokenValue(rates, 'input')
        + fallback.cacheRead * tokenValue(rates, 'cacheRead')
        + fallback.output * tokenValue(rates, 'output')
      ) / 1_000_000;
      return {
        cny: amount,
        peakCny: useOffpeak ? 0 : amount,
        offCny: useOffpeak ? amount : 0,
        tokens: fallback,
        models: [entry.key],
        source: 'tokenUsage',
        offpeakActive,
      };
    }

    function loadSettings(rpc) {
      rpc.call('/api', 'dsh-budget-view/query', { action: 'settings-get' })
        .then(result => {
          if (result?.ok && result.value?.settings) publishSettings(result.value.settings);
        })
        .catch(() => { /* keep defaults */ });
    }

    const zh = {
      'codex.fiveHour': '5h {percent}',
      'codex.sevenDay': '7d {percent}',
      'codex.unavailable': '5h — · 7d —',
      'codex.title': 'Codex · {plan}\n5 小时重置：{fiveReset}\n7 天重置：{weekReset}\n{error}',
      'deepseek.balance': '余额 {amount}',
      'deepseek.cost': '本次 {amount}',
      'deepseek.unavailable': '余额 —',
      'deepseek.title': 'DeepSeek API 余额\n总额：{total} {currency}\n赠送：{granted} {currency}；充值：{topped} {currency}\n本次会话费用：{cost}\n高峰：{peakCost}；低峰：{offCost}\nToken：输入 {input}（未命中 {uncached} / 命中 {cacheRead} / 写入 {cacheWrite}），输出 {output}\n模型：{model} · 当前{mode}\n汇率：{fx}\nToken 来源：{source}\n{error}',
      'deepseek.heroTitle': 'DeepSeek API 余额\n总额：{total} {currency}\n赠送：{granted} {currency}；充值：{topped} {currency}\n{error}',
      'source.context': 'dsh-context（按请求精确聚合）',
      'source.tokenUsage': 'DSH tokenUsage（回退）',
      'fx.live': '1 USD = ¥{rate}（ECB，{date}）',
      'fx.manual': '1 USD = ¥{rate}（手动）',
      'fx.fallback': '1 USD = ¥{rate}（备用）',
      'fx.unavailable': '汇率不可用',
      'hero.codex': 'Codex 5h {five} · 7d {week}',
      'hero.codexLabel': 'Codex',
      'hero.deepseek': 'DeepSeek 余额 {amount}',
      'hero.deepseekLabel': 'DeepSeek',
      'hero.balance': '余额 {amount}',
      'hero.separator': '  |  ',
      'peak.peak': '波峰',
      'peak.offpeak': '波谷',
      'peak.peak.title': '当前为波峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00',
      'peak.offpeak.title': '当前为波谷时段：其余时间、周末及法定节假日（按国务院日历）',
      'mode.peak': '波峰',
      'mode.offpeak': '波谷',
      'plan.unknown': '方案未知',
      'reset.unknown': '未知',
      'error.codex': '无法读取 Codex 用量：{message}',
      'error.deepseek': '无法读取余额：{message}',
      'error.rpc': '数据请求失败',
      'settings.title': '额度栏设置',
      'settings.display': '显示与刷新',
      'settings.connection': '连接',
      'settings.currency': '费用货币',
      'settings.currency.desc': '选择“自动”时跟随余额币种；DeepSeek 价格以人民币计价',
      'settings.currency.auto': '自动（跟随余额）',
      'settings.currency.USD': '美元（USD）',
      'settings.currency.CNY': '人民币（CNY）',
      'settings.fx': '汇率（USD → CNY）',
      'settings.fx.current': '当前汇率',
      'settings.fx.currentDesc': 'ECB 参考价，缓存 6 小时；可手动刷新',
      'settings.fx.desc': '自动从 ECB 参考汇率（Frankfurter）获取；只支持 USD → CNY',
      'settings.fx.auto': '自动（ECB）',
      'settings.fx.manual': '手动',
      'settings.fx.refresh': '刷新',
      'settings.fx.loading': '获取中…',
      'settings.fx.failed': '获取失败，使用备用值',
      'settings.rateFallback': '备用汇率',
      'settings.rateFallback.desc': '自动获取失败或手动模式下使用',
      'settings.showCost': '显示本次费用',
      'settings.showBalance': '显示 DeepSeek 余额',
      'settings.offpeak': '区分波峰 / 波谷计价',
      'settings.offpeak.desc': '波峰：北京时间周一至周五 9:00–12:00、14:00–18:00；周末及法定节假日为波谷',
      'settings.pricingNote': 'DeepSeek 官方人民币价（元 / 百万 tokens）：\nFlash 波峰 输入 2 · 命中 0.04 · 输出 8；波谷 1 · 0.02 · 4\nPro 波峰 9 · 0.30 · 27；波谷 4.5 · 0.15 · 13.5\n节假日按内置国务院 2025–2026 日历及设置 JSON 的 cnHolidays 追加日期归类计价。',
      'settings.refresh': '刷新间隔',
      'settings.seconds': '{seconds} 秒',
      'settings.heroMode': '新会话页显示',
      'settings.heroMode.both': 'Codex 与 DeepSeek',
      'settings.heroMode.current': '跟随当前模型',
      'settings.heroMode.codex': '仅 Codex',
      'settings.heroMode.deepseek': '仅 DeepSeek',
      'settings.ui': '界面显示',
      'settings.heroStyle': '新会话页样式',
      'settings.heroStyle.desc': '胶囊会显示图标、数值和状态徽标；纯文本沿用单行样式',
      'settings.heroStyle.chips': '胶囊 / 徽标',
      'settings.heroStyle.plain': '纯文本',
      'settings.heroDensity': '胶囊密度',
      'settings.heroDensity.desc': '紧凑适合窄窗口，标准更宽松',
      'settings.heroDensity.compact': '紧凑',
      'settings.heroDensity.comfortable': '标准',
      'settings.heroIcons': '显示图标',
      'settings.heroIcons.desc': '在 Codex / DeepSeek 胶囊中显示图标',
      'settings.heroPeak': '新会话页显示波峰 / 波谷',
      'settings.heroPeak.desc': '在 DeepSeek 胶囊内显示状态徽标',
      'settings.dockPeak': '输入栏左侧显示波峰 / 波谷',
      'settings.dockPeak.desc': '仅 DeepSeek 官方模型显示',
      'settings.codexPath': 'Codex auth.json 路径',
      'settings.codexPath.desc': '留空使用 ~/.codex/auth.json',
      'settings.deepseekRef': 'DeepSeek 凭据引用',
      'settings.deepseekBase': 'DeepSeek API 基址',
      'settings.saved': '已保存',
      'settings.saving': '正在保存…',
      'settings.error': '保存失败',
      'settings.unavailable': '设置不可用',
    };
    const en = {
      'codex.fiveHour': '5h {percent}',
      'codex.sevenDay': '7d {percent}',
      'codex.unavailable': '5h — · 7d —',
      'codex.title': 'Codex · {plan}\n5-hour reset: {fiveReset}\n7-day reset: {weekReset}\n{error}',
      'deepseek.balance': 'Balance {amount}',
      'deepseek.cost': 'This session {amount}',
      'deepseek.unavailable': 'Balance —',
      'deepseek.title': 'DeepSeek API balance\nTotal: {total} {currency}\nGranted: {granted} {currency}; topped up: {topped} {currency}\nSession cost: {cost}\nPeak: {peakCost}; off-peak: {offCost}\nTokens: input {input} (uncached {uncached} / cache read {cacheRead} / cache write {cacheWrite}), output {output}\nModel: {model} · now {mode}\nFX: {fx}\nToken source: {source}\n{error}',
      'deepseek.heroTitle': 'DeepSeek API balance\nTotal: {total} {currency}\nGranted: {granted} {currency}; topped up: {topped} {currency}\n{error}',
      'source.context': 'dsh-context (per-request usage)',
      'source.tokenUsage': 'DSH tokenUsage (fallback)',
      'fx.live': '1 USD = ¥{rate} (ECB, {date})',
      'fx.manual': '1 USD = ¥{rate} (manual)',
      'fx.fallback': '1 USD = ¥{rate} (fallback)',
      'fx.unavailable': 'FX rate unavailable',
      'hero.codex': 'Codex 5h {five} · 7d {week}',
      'hero.codexLabel': 'Codex',
      'hero.deepseek': 'DeepSeek balance {amount}',
      'hero.deepseekLabel': 'DeepSeek',
      'hero.balance': 'Balance {amount}',
      'hero.separator': '  |  ',
      'peak.peak': 'peak',
      'peak.offpeak': 'off-peak',
      'peak.peak.title': 'Current period: peak (Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00)',
      'peak.offpeak.title': 'Current period: off-peak (all other times, weekends, and Chinese public holidays)',
      'mode.peak': 'peak',
      'mode.offpeak': 'off-peak',
      'plan.unknown': 'plan unknown',
      'reset.unknown': 'unknown',
      'error.codex': 'Codex usage unavailable: {message}',
      'error.deepseek': 'Balance unavailable: {message}',
      'error.rpc': 'Data request failed',
      'settings.title': 'Budget view settings',
      'settings.display': 'Display and refresh',
      'settings.connection': 'Connection',
      'settings.currency': 'Cost currency',
      'settings.currency.desc': 'Auto follows the balance currency; DeepSeek prices are in CNY',
      'settings.currency.auto': 'Auto (follow balance)',
      'settings.currency.USD': 'USD',
      'settings.currency.CNY': 'CNY',
      'settings.fx': 'FX rate (USD → CNY)',
      'settings.fx.current': 'Current rate',
      'settings.fx.currentDesc': 'ECB reference rate, cached for six hours; refresh on demand',
      'settings.fx.desc': 'Fetched automatically from ECB reference rates (Frankfurter); USD → CNY only',
      'settings.fx.auto': 'Auto (ECB)',
      'settings.fx.manual': 'Manual',
      'settings.fx.refresh': 'Refresh',
      'settings.fx.loading': 'Fetching…',
      'settings.fx.failed': 'Fetch failed; using the fallback rate',
      'settings.rateFallback': 'Fallback rate',
      'settings.rateFallback.desc': 'Used when the automatic fetch fails or in manual mode',
      'settings.showCost': 'Show session cost',
      'settings.showBalance': 'Show DeepSeek balance',
      'settings.offpeak': 'Apply peak / off-peak pricing',
      'settings.offpeak.desc': 'Peak: Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00; weekends and Chinese public holidays are off-peak',
      'settings.pricingNote': 'DeepSeek CNY list prices (CNY per 1M tokens):\nFlash peak input 2 · cache hit 0.04 · output 8; off-peak 1 · 0.02 · 4\nPro peak 9 · 0.30 · 27; off-peak 4.5 · 0.15 · 13.5\nHolidays use the built-in 2025–2026 State Council calendar plus any cnHolidays dates in the settings JSON.',
      'settings.refresh': 'Refresh interval',
      'settings.seconds': '{seconds}s',
      'settings.heroMode': 'New-session row',
      'settings.heroMode.both': 'Codex and DeepSeek',
      'settings.heroMode.current': 'Follow current model',
      'settings.heroMode.codex': 'Codex only',
      'settings.heroMode.deepseek': 'DeepSeek only',
      'settings.ui': 'Interface',
      'settings.heroStyle': 'New-session style',
      'settings.heroStyle.desc': 'Chips show icons, values, and a status badge; plain keeps the single-line style',
      'settings.heroStyle.chips': 'Chips / badges',
      'settings.heroStyle.plain': 'Plain text',
      'settings.heroDensity': 'Chip density',
      'settings.heroDensity.desc': 'Compact fits narrow windows; comfortable adds spacing',
      'settings.heroDensity.compact': 'Compact',
      'settings.heroDensity.comfortable': 'Comfortable',
      'settings.heroIcons': 'Show icons',
      'settings.heroIcons.desc': 'Show icons inside the Codex / DeepSeek chips',
      'settings.heroPeak': 'Show peak / off-peak on the New Session row',
      'settings.heroPeak.desc': 'Show the status badge inside the DeepSeek chip',
      'settings.dockPeak': 'Show peak / off-peak at the far left of the composer',
      'settings.dockPeak.desc': 'Only for DeepSeek official models',
      'settings.codexPath': 'Codex auth.json path',
      'settings.codexPath.desc': 'Empty uses ~/.codex/auth.json',
      'settings.deepseekRef': 'DeepSeek credential reference',
      'settings.deepseekBase': 'DeepSeek API base URL',
      'settings.saved': 'Saved',
      'settings.saving': 'Saving…',
      'settings.error': 'Save failed',
      'settings.unavailable': 'Settings unavailable',
    };

    const styleText = `
      .dshBudgetView_pill{font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;padding:1px 8px;border-radius:var(--dsw-radius-sm);font-variant-numeric:tabular-nums;white-space:nowrap}
      .dshBudgetView_text{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .dshBudgetView_icon{width:14px;height:14px;flex:none;display:block}
      .dshBudgetView_settings{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:4px;padding:14px 16px}
      .dshBudgetView_settings h3{margin:0;font-size:14px;font-weight:600;line-height:22px}
      .dshBudgetView_settings h4{margin:12px 0 2px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
      .dshBudgetView_row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1)}
      .dshBudgetView_settings h3+.dshBudgetView_row{border-top:0}
      .dshBudgetView_rowText{display:flex;flex-direction:column;gap:2px;min-width:0}
      .dshBudgetView_rowLabel{font-size:13px;line-height:20px}
      .dshBudgetView_rowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
      .dshBudgetView_input,.dshBudgetView_select{box-sizing:border-box;min-width:148px;max-width:260px;height:28px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px}
      .dshBudgetView_switch{box-sizing:border-box;width:34px;height:20px;border-radius:999px;border:none;background:var(--dsw-alias-border-l2);cursor:pointer;flex:none;padding:2px;display:flex;align-items:center;transition:background-color .12s}
      .dshBudgetView_switch span{display:block;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .12s}
      .dshBudgetView_switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
      .dshBudgetView_switch[aria-checked="true"] span{transform:translateX(14px)}
      .dshBudgetView_save{min-height:18px;margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
      .dshBudgetView_fx{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0}
      .dshBudgetView_fxValue{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
      .dshBudgetView_button{box-sizing:border-box;height:26px;padding:0 9px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
      .dshBudgetView_button:disabled{opacity:.55;cursor:default}
      .dshBudgetView_note{margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-line}
      .dshBudgetView_peak{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
      .dshBudgetView_peak[data-period="peak"]{color:var(--dsw-alias-state-warn-primary,#d97706)}
      .dshBudgetView_peak[data-period="offpeak"]{color:var(--dsw-alias-state-success-primary,#16a34a)}
      .dshBudgetView_peakDot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
      .dshBudgetView_peakLabel{color:var(--dsw-alias-label-primary);font-weight:500}
      .dshBudgetView_heroGroup{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;min-width:0;max-width:100%}
      .dshBudgetView_chip{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;flex:none}
      .dshBudgetView_chip[data-density="compact"]{height:22px;padding:0 7px;gap:4px;font-size:11px}
      .dshBudgetView_chip[data-density="comfortable"]{height:26px;padding:0 9px;gap:6px;font-size:12px}
      .dshBudgetView_chipIcon{width:13px;height:13px;flex:none;display:block}
      .dshBudgetView_chip[data-density="compact"] .dshBudgetView_chipIcon{width:12px;height:12px}
      .dshBudgetView_chipLabel{color:var(--dsw-alias-label-tertiary)}
      .dshBudgetView_chipValue{color:var(--dsw-alias-label-primary)}
      .dshBudgetView_chipSep{color:var(--dsw-alias-label-tertiary);opacity:.7}
      .dshBudgetView_badge{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:1;white-space:nowrap;flex:none}
      .dshBudgetView_badge[data-period="peak"]{color:var(--dsw-alias-state-warn-primary,#d97706);background:color-mix(in srgb, currentColor 12%, transparent)}
      .dshBudgetView_badge[data-period="offpeak"]{color:var(--dsw-alias-state-success-primary,#16a34a);background:color-mix(in srgb, currentColor 12%, transparent)}
      .dshBudgetView_badgeDot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
    `;
    let stylesInjected = false;
    const EMPTY_SNAPSHOT = { current: null, routable: null, groups: [], failures: [], status: 'error', error: null };
    const EMPTY_DIRECTORY = {
      subscribe() { return () => {}; },
      getSnapshot() { return EMPTY_SNAPSHOT; },
    };

    function format(t, key, vars) {
      return typeof t === 'function' ? t(key, vars || {}) : key;
    }
    function resetTime(iso, t) {
      if (!iso) return format(t, 'reset.unknown');
      const date = new Date(iso);
      if (!Number.isFinite(date.getTime())) return format(t, 'reset.unknown');
      return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
    }
    function amount(value, digits = 2) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(digits) : '—';
    }
    function fraction(value) {
      if (!Number.isFinite(value)) return '0';
      if (value === 0) return '0';
      if (value < 0.0001) return '<0.0001';
      return value.toFixed(value < 1 ? 4 : 2);
    }
    function tokenValue(usage, key) {
      const n = Number(usage?.[key]);
      return Number.isFinite(n) ? n : 0;
    }
    function kindFor(current) {
      if (!current) return null;
      if (current.provider === 'openai-codex') return 'codex';
      if (/deepseek/i.test(current.provider || '') || /^deepseek/i.test(current.model || '')) return 'deepseek';
      return null;
    }
    function symbolFor(currency) {
      return currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency ? `${currency} ` : '—';
    }
    function walletGlyph(className = 'dshBudgetView_icon') {
      return h('svg', { className, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H13v10H3.5A1.5 1.5 0 0 1 2 11.5v-7Z', stroke: 'currentColor', strokeWidth: '1.25' }),
        h('path', { d: 'M2 5h11M9 8h4v2.5H9a1.25 1.25 0 0 1 0-2.5Z', stroke: 'currentColor', strokeWidth: '1.25', strokeLinejoin: 'round' }),
        h('circle', { cx: '10', cy: '9.25', r: '.55', fill: 'currentColor' }),
      );
    }
    function sparkGlyph(className = 'dshBudgetView_icon') {
      return h('svg', { className, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 1.5 9.7 5l3.8.5-2.8 2.7.7 3.8L8 10.2 4.6 12l.7-3.8L2.5 5.5 6.3 5 8 1.5Z', stroke: 'currentColor', strokeWidth: '1.2', strokeLinejoin: 'round' }),
        h('circle', { cx: '8', cy: '7', r: '1.3', fill: 'currentColor' }),
      );
    }
    function costDisplay(cny, settings, balanceCurrency, fxRate) {
      if (cny === null || !Number.isFinite(cny)) return null;
      const target = settings.costCurrency === 'auto'
        ? (balanceCurrency === 'USD' ? 'USD' : 'CNY')
        : settings.costCurrency;
      if (target === 'CNY') return { currency: 'CNY', value: cny, text: `¥${fraction(cny)}` };
      const rate = Number(fxRate);
      if (!Number.isFinite(rate) || rate <= 0) return null;
      const value = cny / rate;
      return { currency: 'USD', value, text: `$${fraction(value)}` };
    }
    function fxLabel(fx, settings, t) {
      const rate = Number(fx?.rate ?? settings.usdToCnyRate);
      if (!Number.isFinite(rate) || rate <= 0) return format(t, 'fx.unavailable');
      if (settings.fxMode === 'manual' || fx?.source === 'manual') {
        return format(t, 'fx.manual', { rate: rate.toFixed(4) });
      }
      if (fx?.available) return format(t, 'fx.live', { rate: rate.toFixed(4), date: fx.date || '—' });
      return format(t, 'fx.fallback', { rate: rate.toFixed(4) });
    }
    function useSettings() {
      const snapshot = React.useSyncExternalStore(
        callback => settingsStore.subscribe(callback),
        () => settingsStore.getSnapshot(),
        () => settingsStore.getSnapshot(),
      );
      return normalizeSettings(snapshot);
    }
    function useDirectory(directory, load) {
      const snapshot = React.useSyncExternalStore(
        callback => directory.subscribe(callback),
        () => directory.getSnapshot(),
        () => directory.getSnapshot(),
      );
      const current = snapshot?.current;
      React.useEffect(() => {
        if (snapshot?.status === 'idle' && current === null) load();
      }, [snapshot?.status, current, load]);
      return snapshot;
    }
    function useBudgetQuery(rpc, request, intervalMs) {
      const [state, setState] = React.useState({ data: null, error: false });
      const provider = request?.provider || '';
      const model = request?.model || '';
      React.useEffect(() => {
        setState({ data: null, error: false });
        if (!provider) return undefined;
        let stopped = false;
        let controller;
        let timer;
        const refresh = async () => {
          controller?.abort();
          controller = new AbortController();
          try {
            const result = await rpc.call('/api', 'dsh-budget-view/query', { provider, model }, controller.signal);
            if (stopped) return;
            if (result?.ok) setState({ data: result.value || null, error: false });
            else setState(previous => ({ ...previous, error: true }));
          } catch (error) {
            if (stopped || error?.name === 'AbortError') return;
            setState(previous => ({ ...previous, error: true }));
          }
        };
        refresh();
        timer = setInterval(refresh, Math.max(15_000, Number(intervalMs) || 60_000));
        return () => {
          stopped = true;
          controller?.abort();
          clearInterval(timer);
        };
      }, [rpc, provider, model, intervalMs]);
      return state;
    }

    function PeakPill({ directory, load, t }) {
      const settings = useSettings();
      const snapshot = useDirectory(directory, load);
      const current = snapshot?.current;
      const kind = kindFor(current);
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        if (!settings.showDockPeak || kind !== 'deepseek') return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
      }, [settings.showDockPeak, kind]);
      if (!settings.showDockPeak || kind !== 'deepseek') return null;
      const peak = isPeakAt(now, settings);
      return h('span', {
        className: 'dshBudgetView_peak',
        'data-period': peak ? 'peak' : 'offpeak',
        'data-composer-stat': 'budget-peak',
        title: format(t, peak ? 'peak.peak.title' : 'peak.offpeak.title'),
        role: 'status',
      },
        h('span', { className: 'dshBudgetView_peakDot' }),
        h('span', { className: 'dshBudgetView_peakLabel' }, format(t, peak ? 'peak.peak' : 'peak.offpeak')),
      );
    }

    function BudgetPill({ rpc, directory, load, useProjection, t }) {
      const settings = useSettings();
      const snapshot = useDirectory(directory, load);
      const current = snapshot?.current;
      const kind = kindFor(current);
      const usage = useProjection('tokenUsage');
      const timeline = useProjection('contextTimeline');
      const activity = useProjection('contextActivity');
      const request = kind ? { provider: current.provider, model: current.model } : null;
      const { data, error } = useBudgetQuery(rpc, request, settings.refreshSeconds * 1000);
      if (!kind) return null;
      const icon = h('svg', { className: 'dshBudgetView_icon', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3H13v10H3.5A1.5 1.5 0 0 1 2 11.5v-7Z', stroke: 'currentColor', strokeWidth: '1.25' }),
        h('path', { d: 'M2 5h11M9 8h4v2.5H9a1.25 1.25 0 0 1 0-2.5Z', stroke: 'currentColor', strokeWidth: '1.25', strokeLinejoin: 'round' }),
        h('circle', { cx: '10', cy: '9.25', r: '.55', fill: 'currentColor' }),
      );
      let text;
      let title;
      if (kind === 'codex') {
        const codex = data?.kind === 'codex' ? data.codex : null;
        const available = Boolean(codex?.available);
        const five = available && codex.fiveHour ? `${Math.round(codex.fiveHour.remainingPercent)}%` : '—';
        const week = available && codex.weekly ? `${Math.round(codex.weekly.remainingPercent)}%` : '—';
        text = available
          ? `${format(t, 'codex.fiveHour', { percent: five })} · ${format(t, 'codex.sevenDay', { percent: week })}`
          : format(t, 'codex.unavailable');
        const failure = error ? format(t, 'error.rpc') : codex?.error ? format(t, 'error.codex', { message: codex.error.message || '' }) : '';
        title = format(t, 'codex.title', {
          plan: codex?.planType || format(t, 'plan.unknown'),
          fiveReset: resetTime(codex?.fiveHour?.resetAt, t),
          weekReset: resetTime(codex?.weekly?.resetAt, t),
          error: failure,
        });
      } else {
        const deepseek = data?.kind === 'deepseek' ? data.deepseek : null;
        const balance = deepseek?.balance;
        const price = deepseek?.pricing;
        const fx = deepseek?.fx;
        const fxRate = Number(fx?.rate ?? settings.usdToCnyRate);
        const cost = sessionCost(activity?.days, timeline?.cost, usage, settings, deepseek?.pricingTable, price, current?.model);
        const balanceText = balance ? `${symbolFor(balance.currency)}${amount(balance.totalBalance)}` : '—';
        const costInfo = cost ? costDisplay(cost.cny, settings, balance?.currency, fxRate) : null;
        const peakInfo = cost ? costDisplay(cost.peakCny, settings, balance?.currency, fxRate) : null;
        const offInfo = cost ? costDisplay(cost.offCny, settings, balance?.currency, fxRate) : null;
        const costText = costInfo ? `≈${costInfo.text}` : '—';
        const parts = [];
        if (settings.showBalance) parts.push(format(t, 'deepseek.balance', { amount: balanceText }));
        if (settings.showCost) parts.push(format(t, 'deepseek.cost', { amount: costText }));
        if (parts.length === 0) return null;
        text = parts.join(' · ');
        const failure = error ? format(t, 'error.rpc') : deepseek?.error ? format(t, 'error.deepseek', { message: deepseek.error.message || '' }) : '';
        const mode = price
          ? format(t, settings.useOffpeakPricing ? (price.offpeakActive ? 'mode.offpeak' : 'mode.peak') : 'mode.peak')
          : '—';
        const modelText = cost?.models?.length ? cost.models.join(', ') : price?.key || current?.model || '—';
        const sourceText = cost?.source === 'context'
          ? format(t, 'source.context')
          : cost?.source === 'tokenUsage'
            ? format(t, 'source.tokenUsage')
            : '—';
        title = format(t, 'deepseek.title', {
          total: balance?.totalBalance ?? '—',
          granted: balance?.grantedBalance ?? '—',
          topped: balance?.toppedUpBalance ?? '—',
          currency: balance?.currency || '—',
          cost: costText,
          peakCost: peakInfo?.text ?? '—',
          offCost: offInfo?.text ?? '—',
          input: cost?.tokens?.input ?? '—',
          uncached: cost?.tokens?.uncached ?? '—',
          cacheRead: cost?.tokens?.cacheRead ?? '—',
          cacheWrite: cost?.tokens?.cacheWrite ?? '—',
          output: cost?.tokens?.output ?? '—',
          model: modelText,
          mode,
          fx: fxLabel(fx, settings, t),
          source: sourceText,
          error: failure,
        });
      }
      return h('span', {
        className: 'dshBudgetView_pill',
        title,
        'data-composer-stat': 'budget',
        'data-budget-kind': kind,
      }, icon, h('span', { className: 'dshBudgetView_text' }, text));
    }

    function HeroBudget({ rpc, directory, load, t }) {
      const settings = useSettings();
      const snapshot = useDirectory(directory, load);
      const current = snapshot?.current;
      const kind = kindFor(current);
      const mode = settings.heroMode;
      const request = mode === 'both'
        ? { provider: '__summary__', model: '' }
        : mode === 'codex'
          ? { provider: 'openai-codex', model: '' }
          : mode === 'deepseek'
            ? { provider: 'deepseek-official', model: 'deepseek-flash' }
            : current
              ? { provider: current.provider, model: current.model }
              : null;
      const { data, error } = useBudgetQuery(rpc, request, settings.refreshSeconds * 1000);
      const codex = mode === 'both' ? data?.codex : data?.kind === 'codex' ? data.codex : null;
      const deepseek = mode === 'both' ? data?.deepseek : data?.kind === 'deepseek' ? data.deepseek : null;
      const wantsCodex = mode === 'both' || mode === 'codex' || (mode === 'current' && kind === 'codex');
      const wantsDeepseek = (mode === 'both' || mode === 'deepseek' || (mode === 'current' && kind === 'deepseek')) && settings.showBalance;
      if (!wantsCodex && !wantsDeepseek) return null;

      const titleLines = [];
      const plainParts = [];
      let codexChip = null;
      let deepseekChip = null;
      const showChipLabels = settings.heroDensity !== 'compact' || !settings.heroShowIcons;

      if (wantsCodex) {
        const available = Boolean(codex?.available);
        const five = available && codex.fiveHour ? `${Math.round(codex.fiveHour.remainingPercent)}%` : '—';
        const week = available && codex.weekly ? `${Math.round(codex.weekly.remainingPercent)}%` : '—';
        const failure = error ? format(t, 'error.rpc') : codex?.error ? format(t, 'error.codex', { message: codex.error.message || '' }) : '';
        const title = format(t, 'codex.title', {
          plan: codex?.planType || format(t, 'plan.unknown'),
          fiveReset: resetTime(codex?.fiveHour?.resetAt, t),
          weekReset: resetTime(codex?.weekly?.resetAt, t),
          error: failure,
        });
        titleLines.push(title);
        if (settings.heroStyle === 'chips') {
          codexChip = h('span', {
            className: 'dshBudgetView_chip',
            'data-density': settings.heroDensity,
            'data-hero-provider': 'codex',
            title,
            'aria-label': format(t, 'hero.codex', { five, week }),
          },
            settings.heroShowIcons ? sparkGlyph('dshBudgetView_chipIcon') : null,
            showChipLabels ? h('span', { className: 'dshBudgetView_chipLabel' }, format(t, 'hero.codexLabel')) : null,
            h('span', { className: 'dshBudgetView_chipValue' }, format(t, 'codex.fiveHour', { percent: five })),
            h('span', { className: 'dshBudgetView_chipSep' }, '·'),
            h('span', { className: 'dshBudgetView_chipValue' }, format(t, 'codex.sevenDay', { percent: week })),
          );
        } else {
          plainParts.push(format(t, 'hero.codex', { five, week }));
        }
      }

      if (wantsDeepseek) {
        const balance = deepseek?.balance;
        const balanceText = balance ? `${symbolFor(balance.currency)}${amount(balance.totalBalance)}` : '—';
        const price = deepseek?.pricing;
        const peak = typeof price?.offpeakActive === 'boolean' ? !price.offpeakActive : isPeakNow(settings);
        const peakText = format(t, peak ? 'peak.peak' : 'peak.offpeak');
        const peakTitle = format(t, peak ? 'peak.peak.title' : 'peak.offpeak.title');
        const failure = error ? format(t, 'error.rpc') : deepseek?.error ? format(t, 'error.deepseek', { message: deepseek.error.message || '' }) : '';
        const title = [format(t, 'deepseek.heroTitle', {
          total: balance?.totalBalance ?? '—',
          granted: balance?.grantedBalance ?? '—',
          topped: balance?.toppedUpBalance ?? '—',
          currency: balance?.currency || '—',
          error: failure,
        }), peakTitle].join('\n');
        titleLines.push(title);
        if (settings.heroStyle === 'chips') {
          deepseekChip = h('span', {
            className: 'dshBudgetView_chip',
            'data-density': settings.heroDensity,
            'data-hero-provider': 'deepseek',
            title,
            'aria-label': `${format(t, 'hero.deepseek', { amount: balanceText })} ${peakText}`,
          },
            settings.heroShowIcons ? walletGlyph('dshBudgetView_chipIcon') : null,
            showChipLabels ? h('span', { className: 'dshBudgetView_chipLabel' }, format(t, 'hero.deepseekLabel')) : null,
            h('span', { className: 'dshBudgetView_chipValue' }, format(t, 'hero.balance', { amount: balanceText })),
            settings.showHeroPeak ? h('span', {
              className: 'dshBudgetView_badge',
              'data-period': peak ? 'peak' : 'offpeak',
              title: peakTitle,
            }, h('span', { className: 'dshBudgetView_badgeDot' }), peakText) : null,
          );
        } else {
          const plain = format(t, 'hero.deepseek', { amount: balanceText });
          plainParts.push(settings.showHeroPeak ? `${plain} · ${peakText}` : plain);
        }
      }

      if (settings.heroStyle === 'chips') {
        if (!codexChip && !deepseekChip) return null;
        return h('span', {
          className: 'dshBudgetView_heroGroup',
          'data-hero-budget': kind || mode,
          title: titleLines.join('\n\n'),
        }, codexChip, deepseekChip);
      }
      if (plainParts.length === 0) return null;
      return h('span', {
        className: 'dshBudgetView_pill',
        title: titleLines.join('\n\n'),
        'data-hero-budget': kind || mode,
      }, settings.heroShowIcons ? sparkGlyph() : null, h('span', { className: 'dshBudgetView_text' }, plainParts.join(format(t, 'hero.separator'))));
    }

    const SWITCH = (label, value, onChange, disabled) => h('button', {
      type: 'button',
      className: 'dshBudgetView_switch',
      role: 'switch',
      'aria-checked': value,
      'aria-label': label,
      disabled,
      onClick: onChange,
    }, h('span'));

    const ROW = (label, description, control, key) => h('div', { className: 'dshBudgetView_row', key },
      h('span', { className: 'dshBudgetView_rowText' },
        h('span', { className: 'dshBudgetView_rowLabel' }, label),
        description ? h('span', { className: 'dshBudgetView_rowDesc' }, description) : null,
      ),
      control,
    );

    function SettingsSection({ rpc, subject, t }) {
      t = typeof t === 'function' ? t : key => key;
      const settings = useSettings();
      const [save, setSave] = React.useState('idle');
      const [fx, setFx] = React.useState(null);
      const [fxLoading, setFxLoading] = React.useState(false);
      const activeRpc = rpc || settingsRpc;
      const isOurs = subject?.kind === 'bundle' && subject?.pkg?.name === 'dsh-budget-view';
      const refreshFx = React.useCallback(async force => {
        if (!activeRpc) return;
        setFxLoading(true);
        try {
          const result = await activeRpc.call('/api', 'dsh-budget-view/query', { action: 'fx-get', force: Boolean(force) });
          if (result?.ok) setFx(result.value?.fx ?? null);
        } catch {
          // Keep the previous value; the fallback rate is still usable.
        } finally {
          setFxLoading(false);
        }
      }, [activeRpc]);
      React.useEffect(() => {
        if (!isOurs || settings.fxMode !== 'auto') return;
        void refreshFx(false);
      }, [isOurs, settings.fxMode, refreshFx]);
      if (!isOurs) return null;
      const write = async patch => {
        if (save === 'saving' || !activeRpc) return;
        const next = { ...settings, ...patch };
        setSave('saving');
        try {
          const result = await activeRpc.call('/api', 'dsh-budget-view/query', { action: 'settings-set', settings: next });
          if (result?.ok) {
            publishSettings(result.value?.settings ?? next);
            setSave('saved');
          } else {
            setSave('error');
          }
        } catch {
          setSave('error');
        }
      };
      const saveText = save === 'saving'
        ? t('settings.saving')
        : save === 'saved'
          ? t('settings.saved')
          : save === 'error'
            ? t('settings.error')
            : '';
      const effectiveFx = settings.fxMode === 'manual'
        ? { available: true, source: 'manual', rate: settings.usdToCnyRate, date: null }
        : fx;
      const fxText = fxLoading
        ? t('settings.fx.loading')
        : fxLabel(effectiveFx ?? { available: false, rate: settings.usdToCnyRate }, settings, t);
      const selectRow = (key, label, description, options) => ROW(label, description,
        h('select', {
          className: 'dshBudgetView_select',
          value: settings[key],
          disabled: save === 'saving',
          onChange: event => { void write({ [key]: event.target.value }); },
        }, options.map(([value, text]) => h('option', { key: value, value }, text))), key);
      const toggleRow = (key, label, description) => ROW(label, description,
        SWITCH(label, settings[key], () => { void write({ [key]: !settings[key] }); }, save === 'saving'), key);
      const textRow = (key, label, description, placeholder) => ROW(label, description,
        h('input', {
          className: 'dshBudgetView_input',
          type: 'text',
          key: `${key}:${settings[key] ?? ''}`,
          defaultValue: settings[key] ?? '',
          placeholder,
          disabled: save === 'saving',
          onBlur: event => {
            const value = event.target.value.trim();
            if (value !== (settings[key] ?? '')) void write({ [key]: value });
          },
          onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); },
        }), key);
      return h('section', { className: 'dshBudgetView_settings', 'data-budget-settings': true },
        h('h3', null, t('settings.title')),
        h('h4', null, t('settings.display')),
        selectRow('costCurrency', t('settings.currency'), t('settings.currency.desc'), [
          ['auto', t('settings.currency.auto')],
          ['USD', t('settings.currency.USD')],
          ['CNY', t('settings.currency.CNY')],
        ]),
        selectRow('fxMode', t('settings.fx'), t('settings.fx.desc'), [
          ['auto', t('settings.fx.auto')],
          ['manual', t('settings.fx.manual')],
        ]),
        ROW(t('settings.fx.current'), t('settings.fx.currentDesc'), h('div', { className: 'dshBudgetView_fx' },
          h('span', { className: 'dshBudgetView_fxValue' }, fxText),
          h('button', {
            type: 'button',
            className: 'dshBudgetView_button',
            disabled: fxLoading || settings.fxMode === 'manual',
            onClick: () => { void refreshFx(true); },
          }, t('settings.fx.refresh')),
        ), 'fxRate'),
        ROW(t('settings.rateFallback'), t('settings.rateFallback.desc'), h('input', {
          className: 'dshBudgetView_input',
          type: 'number',
          key: `usdToCnyRate:${settings.usdToCnyRate}`,
          min: '0.01',
          max: '100',
          step: '0.01',
          defaultValue: String(settings.usdToCnyRate),
          disabled: save === 'saving',
          onBlur: event => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value !== settings.usdToCnyRate) void write({ usdToCnyRate: value });
          },
        }), 'usdToCnyRate'),
        toggleRow('showCost', t('settings.showCost'), null),
        toggleRow('showBalance', t('settings.showBalance'), null),
        toggleRow('useOffpeakPricing', t('settings.offpeak'), t('settings.offpeak.desc')),
        h('p', { className: 'dshBudgetView_note' }, t('settings.pricingNote')),
        selectRow('refreshSeconds', t('settings.refresh'), null, [
          [15, t('settings.seconds', { seconds: 15 })],
          [30, t('settings.seconds', { seconds: 30 })],
          [60, t('settings.seconds', { seconds: 60 })],
          [120, t('settings.seconds', { seconds: 120 })],
          [300, t('settings.seconds', { seconds: 300 })],
        ]),
        h('h4', null, t('settings.ui')),
        selectRow('heroMode', t('settings.heroMode'), null, [
          ['both', t('settings.heroMode.both')],
          ['current', t('settings.heroMode.current')],
          ['codex', t('settings.heroMode.codex')],
          ['deepseek', t('settings.heroMode.deepseek')],
        ]),
        selectRow('heroStyle', t('settings.heroStyle'), t('settings.heroStyle.desc'), [
          ['chips', t('settings.heroStyle.chips')],
          ['plain', t('settings.heroStyle.plain')],
        ]),
        selectRow('heroDensity', t('settings.heroDensity'), t('settings.heroDensity.desc'), [
          ['compact', t('settings.heroDensity.compact')],
          ['comfortable', t('settings.heroDensity.comfortable')],
        ]),
        toggleRow('heroShowIcons', t('settings.heroIcons'), t('settings.heroIcons.desc')),
        toggleRow('showHeroPeak', t('settings.heroPeak'), t('settings.heroPeak.desc')),
        toggleRow('showDockPeak', t('settings.dockPeak'), t('settings.dockPeak.desc')),
        h('h4', null, t('settings.connection')),
        textRow('codexAuthJsonPath', t('settings.codexPath'), t('settings.codexPath.desc'), '~/.codex/auth.json'),
        textRow('deepseekApiKeyRef', t('settings.deepseekRef'), null, 'DEEPSEEK_API_KEY'),
        textRow('deepseekBaseUrl', t('settings.deepseekBase'), null, 'https://api.deepseek.com'),
        h('p', { className: 'dshBudgetView_save' }, saveText),
      );
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-budget-view.locale');
      ctx.effect(() => {
        if (stylesInjected) return undefined;
        const style = document.createElement('style');
        style.dataset.dshBudgetView = 'true';
        style.textContent = styleText;
        document.head.appendChild(style);
        stylesInjected = true;
        return () => {
          style.remove();
          stylesInjected = false;
        };
      }, 'dsh-budget-view.styles');
      const models = ctx.get('modelDirectories');
      const connection = ctx.get('connection');
      if (!models || !connection) return;
      const rpc = connection.rpc;
      settingsRpc = rpc;
      loadSettings(rpc);
      const budgetInject = sessionId => {
        let dir;
        try {
          dir = models.directoryFor(sessionId);
        } catch (error) {
          console.warn('[dsh-budget-view] model directory unavailable', error);
          return { rpc, directory: EMPTY_DIRECTORY, load: () => {} };
        }
        if (!dir?.store) return { rpc, directory: EMPTY_DIRECTORY, load: () => {} };
        return {
          rpc,
          directory: dir.store,
          load: () => {
            if (dir.store.getSnapshot().status === 'idle') dir.load().catch(() => {});
          },
        };
      };
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'budget-peak',
        order: -20,
        locale: NS,
        inject: budgetInject,
      }, PeakPill));
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'budget',
        order: -10,
        locale: NS,
        inject: budgetInject,
      }, BudgetPill));
      ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
        name: 'conversation.hero.options',
        id: 'budget-hero',
        order: 0,
        locale: NS,
        inject: budgetInject,
      }, HeroBudget));
      ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'dsh-budget-view-settings',
        order: 10,
        locale: NS,
        inject: () => ({ rpc }),
      }, SettingsSection));
    }

    return { name: 'dsh-budget-view', inject, apply };
  },
});


