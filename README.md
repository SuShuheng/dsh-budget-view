# DSH Budget View

<p align="center">
  <img src="icon.svg" width="72" height="72" alt="dsh-budget-view icon">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-budget-view"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-budget-view"></a>
  <a href="https://github.com/SuShuheng/dsh-budget-view/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/SuShuheng/dsh-budget-view"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/SuShuheng/dsh-budget-view"><img alt="DSH plugin" src="https://img.shields.io/badge/DSH-plugin-5B8DEF"></a>
</p>

**DSH Budget View** 是一个 DeepSeek Harness 插件，在输入框下方和新会话页展示：

- **Codex** 5 小时 / 7 天剩余额度
- **OpenCode Go** 5 小时 / 7 天剩余额度（读取 `OPENCODE_API_KEY` 环境变量）
- **DeepSeek API** 账户余额
- DeepSeek **波峰 / 波谷** 状态
- 按 DeepSeek 官方人民币峰谷价估算的**本次会话费用**

`0.4.0` 沿用面向 DSH Desktop `0.2.1-rc.2` 的原生 Slot、Projection、主题变量和 RPC 接口。配置对应服务的凭据后即可显示额度或余额；启用 `dsh-context` 后可按请求精确计算 token 与费用。

## 功能

### 输入框下方

最左侧显示 DeepSeek 波峰 / 波谷徽标，随后是余额与本次费用：

```text
● 波峰   余额 ¥6.45 · 本次 ≈¥6.10
```

- 波峰为琥珀色，波谷为绿色；每 30 秒自动刷新
- 悬停可查看北京时间峰谷规则
- 仅 DeepSeek 官方模型显示峰谷徽标
- Codex 模型显示 5h / 7d 剩余额度
- `opencode-go` 提供商的模型显示 `OpenCode Go · 5h 69% · 7d 95%`，悬停查看重置时间

### 新会话页

在工作区、预设模式同一行的右侧显示紧凑胶囊：

- **Codex**：星标 + `5h 69%` + `7d 95%`
- **OpenCode Go**：`OpenCode Go` + `5h 69%` + `7d 95%`
- **DeepSeek**：钱包 + `余额 ¥6.45` + `波峰 / 波谷` 徽标
- 支持胶囊 / 纯文本两种样式，紧凑 / 标准两种密度
- 窄窗口自动换行

### 插件详情设置

打开 **设置 → 插件 → dsh-budget-view**，在插件详情页调整并自动保存：

| 设置 | 可选值 | 默认 |
| --- | --- | --- |
| 费用货币 | 自动 / USD / CNY | 自动 |
| 汇率模式 | 自动（ECB）/ 手动 | 自动 |
| 备用 USD → CNY 汇率 | 0.01–100 | 7.1 |
| 显示本次费用 | 开 / 关 | 开 |
| 显示 DeepSeek 余额 | 开 / 关 | 开 |
| 区分波峰 / 波谷计价 | 开 / 关 | 开 |
| 刷新间隔 | 15 / 30 / 60 / 120 / 300 秒 | 60 秒 |
| 新会话页显示 | 全部（Codex / DeepSeek / OpenCode Go）/ 跟随当前模型 / 仅 Codex / 仅 DeepSeek / 仅 OpenCode Go | 全部 |
| 新会话页样式 | 胶囊 / 徽标、纯文本 | 胶囊 |
| 胶囊密度 | 紧凑 / 标准 | 紧凑 |
| 显示图标 | 开 / 关 | 开 |
| 新会话页波峰 / 波谷 | 开 / 关 | 开 |
| 输入栏左侧波峰 / 波谷 | 开 / 关 | 开 |
| Codex auth.json 路径 | 路径文本 | `~/.codex/auth.json` |
| DeepSeek 凭据引用 | 凭据键名 | `DEEPSEEK_API_KEY` |
| DeepSeek API 基址 | URL | `https://api.deepseek.com` |

设置保存在 `$DSH_HOME/storages/dsh-budget-view.json`。

### OpenCode Go 凭据

在运行 DSH 的环境中设置 `OPENCODE_API_KEY`，然后完全退出并重新启动 DSH，让 Host 进程读取新的环境变量。Windows PowerShell 可持久化为用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable('OPENCODE_API_KEY', '你的 OpenCode API Key', 'User')
```

额度由 Host 使用 Bearer 认证查询 `https://opencode.ai/zen/go/v1/usage`。接口来源见 [OpenCode 官方用量接口 PR](https://github.com/anomalyco/opencode/pull/16513)。当前响应的 `usage.rolling` / `usage.weekly` 对应 5 小时 / 7 天窗口，`percent` 是已用百分比；插件显示 `100 - percent`，并兼容旧版 `rollingUsage` / `weeklyUsage` 响应。

- Key 只从 Host 的进程环境读取，不写入插件设置，也不会返回浏览器。
- 使用既有刷新间隔，Host 对成功结果缓存最多 30 秒；更换 Key 会使用独立缓存。
- `rate-limited` 窗口显示 `0%` 剩余；缺少 Key、认证失败或查询失败时显示 `—`，悬停查看原因。
- `opencode-go` 下的 DeepSeek 模型显示 Go 订阅额度，不展示 DeepSeek 官方账户余额或会话费用。

## 计价规则

费用按 [DeepSeek 官方价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 的人民币价计算（元 / 百万 tokens）：

| 模型 | 时段 | 输入未命中 | 输入命中 | 输出 |
| --- | --- | ---: | ---: | ---: |
| `deepseek-flash` | 波峰 | 2.00 | 0.04 | 8.00 |
| `deepseek-flash` | 波谷 | 1.00 | 0.02 | 4.00 |
| `deepseek-v4-pro` | 波峰 | 9.00 | 0.30 | 27.00 |
| `deepseek-v4-pro` | 波谷 | 4.50 | 0.15 | 13.50 |

- **波峰**：北京时间周一至周五 `9:00–12:00`、`14:00–18:00`
- **波谷**：其余时间、周末、中国法定节假日全天
- 调休上班的周六 / 周日仍按官方“周末全天”规则计为波谷
- 内置国务院 [2025 年放假通知](https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm) 与 [2026 年放假通知](https://www.gov.cn/zhengce/content/202511/content_7047090.htm) 的完整放假日期
- 可通过设置 JSON 的 `cnHolidays` 追加日期：

```json
{
  "cnHolidays": ["2027-01-01"]
}
```

### Token 来源

优先读取 **dsh-context** 的按日 `contextActivity` 账本，并把节假日工作日的 `peak` token 重新按波谷价计价；普通工作日继续使用 `contextTimeline` 的 `peak` / `off` 分桶。

如果 dsh-context 不可用：

1. 回退到 `contextTimeline.cost`（不能重新归类历史节假日）
2. 再回退到 DSH `tokenUsage`，按当前模型和当前时段估算

费用是估算值，不等同于 DeepSeek 账单。

## 汇率

仅支持 **USD → CNY**。`fxMode: "auto"` 时 Host 从 ECB 参考汇率（[Frankfurter](https://api.frankfurter.app/latest?from=USD&to=CNY)）获取，缓存 6 小时；失败时回退到手动备用汇率。设置页显示当前汇率、日期和刷新按钮。

DeepSeek 价格本身为人民币；美元显示按 `CNY 成本 ÷ USD→CNY 汇率` 计算。

## 安装

### 通过插件页面

1. 打开 DSH Desktop 的“插件”页面，添加插件。
2. 输入 npm 包名：

   ```text
   dsh-budget-view@0.4.0
   ```

3. 安装后完全退出并重新打开 DSH。
4. 在输入框下方和新会话页查看预算信息。

安装源可选择 npm 官方源或镜像源。镜像同步可能延迟，固定版本可使用 `dsh-budget-view@0.4.0`。

### 使用 dsh 命令

先启动一次 DSH Desktop 完成初始化，再完全退出，在终端运行：

```powershell
dsh plugin --profile desktop add dsh-budget-view@0.4.0
```

安装后重新打开 DSH。

### 从 Release 或本地包安装

从 [v0.4.0 Release](https://github.com/SuShuheng/dsh-budget-view/releases/tag/v0.4.0) 下载 [dsh-budget-view-0.4.0.tgz](https://github.com/SuShuheng/dsh-budget-view/releases/download/v0.4.0/dsh-budget-view-0.4.0.tgz)，在插件页面选择本地安装。也可以使用版本标签：

```text
github:SuShuheng/dsh-budget-view#v0.4.0
```

本地开发目录可直接添加；安装后同样需要重启 DSH。

### 从 0.3.1 升级

更新到 `dsh-budget-view@0.4.0`，设置 `OPENCODE_API_KEY` 后完全重启 DSH。既有设置会保留；新会话页原来的“Codex 与 DeepSeek”（`heroMode: "both"`）现在显示全部三项，也可在插件设置中选择“跟随当前模型”或“仅 OpenCode Go”。

## 兼容性与依赖

- **DSH Desktop**：`0.2.1-rc.2`（使用公开 Slot、Projection、主题 token 与 Host RPC）
- **dsh-context**：可选，建议启用，用于精确 token 与按日峰谷重算
- **dsh-codex-auth**：可选，用于读取 Codex 凭据；未安装时回退 `~/.codex/auth.json`
- 不需要额外 npm 依赖

网络接口：

- Codex：`https://chatgpt.com/backend-api/wham/usage`
- OpenCode Go：`https://opencode.ai/zen/go/v1/usage`
- DeepSeek：`https://api.deepseek.com/user/balance`
- 汇率：`https://api.frankfurter.app/latest?from=USD&to=CNY`

DeepSeek API Key 通过 DSH credentials 服务读取，Codex 凭据通过 `codexAuth` 服务或本地 `auth.json` 读取，OpenCode Go Key 从 `OPENCODE_API_KEY` 环境变量读取，**不会返回给浏览器**。

## 开发与验证

```powershell
npm run check
npm test
```

`npm test` 覆盖：

- 2025 / 2026 国务院节假日与调休上班日
- 波峰 / 波谷边界（9:00、12:00、14:00、18:00）
- 节假日按波谷重算、普通工作日按波峰计算
- `cnHolidays` 追加日期
- `contextActivity` / `contextTimeline` / `tokenUsage` 三级回退
- CNY / USD 显示
- OpenCode Go 的 Host RPC、Bearer 认证、剩余额度换算、新旧响应、缓存与换 Key
- OpenCode Go 的缺失凭据、认证失败、超时、无效响应及汇总查询隔离
- OpenCode Go 的输入栏、新会话页显示模式、胶囊 / 纯文本及中英文文案

发布前会执行 `prepublishOnly` 的语法检查与测试。

## 版本记录

| 版本 | 内容 |
| --- | --- |
| **0.4.0** | 新增 OpenCode Go 5 小时 / 7 天剩余额度；读取 `OPENCODE_API_KEY`；支持输入栏与新会话页显示。 |
| **0.3.1** | 按国务院 2025–2026 节假日将法定节假日计为波谷；使用 `contextActivity` 按日重算；新增 `cnHolidays`。 |
| **0.3.0** | 输入栏新增波峰 / 波谷徽标；新会话页改为可配置胶囊；新增样式、密度、图标与徽标设置。 |
| **0.2.0** | 插件详情设置；新会话页 Codex / DeepSeek 信息；ECB 实时汇率；DeepSeek 人民币峰谷价。 |
| **0.1.0** | 初版输入栏预算胶囊与 DeepSeek 余额。 |

## License

[MIT](LICENSE) © 2026 SuShuheng
