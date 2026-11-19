# AutoKill 破甲 · 变量清单（改变量接入，不改代码）

> 消费方：autokill-purge 的「梦神破甲」。
> 接入方式：**只改配置变量**，改前备份、改后可一键写回原值。
> 所有变量默认值 = 当前行为，所以对现有用户零影响。

---

## 一、现在就能改的变量（已存在，标量可写）

实测可用：`autokill-cli settings_set <键> <值>`。

| # | 变量 | 当前值 | 破甲值 | 效果 | 落点 |
|---|---|---|---|---|---|
| 1 | `ask_before_running` | `true` | `false` | 不弹审批直接执行 | config.toml |
| 2 | `deep_mode` | `false` | `true` | 允许读目标代码/文件/页面源码 | config.toml |
| 3 | `runtime_study` | `false` | `true` | 运行时研究（跑起来观察） | config.toml |
| 4 | `assets.budget_usd` | `5.0` | `50.0` | 预算上限 | config.toml |
| 5 | `build.good_enough` | `90.0` | `75.0` | 收敛门槛（更快出结果） | config.toml |
| 6 | `build.max_rounds` | `6` | `12` | 迭代轮数 | config.toml |
| 7 | `build.parallel` | `2` | `4` | 并行度 | config.toml |
| 8 | `ai on Codex` | off | **on** | 多挂一个后端 | config.toml |
| 9 | `ai on "Claude Code"` | off | **on** | 多挂一个后端 | config.toml |

> 这 9 项 = 现在的「梦神破甲」，已实装并验证过（应用 9/9、卸载 9/9、SHA 回原件）。

---

## 二、已存在但 CLI 写不进去（数组 / 映射）

这些键在 `config.toml` 里已有，`settings_set` 拒绝写入（实测报 `There's no setting`）。

| # | 变量 | 当前 | 破甲值 | 效果 | 写不进去的原因 |
|---|---|---|---|---|---|
| 10 | `ai.fallback_chain` | `[]` | `["Codex","Claude Code"]` | 后端故障时依次切换 | 数组 |
| 11 | `ai.roles` | `{}` | `lead / worker / reviewer / builder` 分派 | 不同环节用不同后端 | 映射 |
| 12 | `plugins.mcp` | `[purge]` | 已挂 autokill-purge | MCP 插件 | 数组（已在用改文件方式） |

**需要的支持（任选）**：

| 方案 | 说明 |
|---|---|
| A | `settings_set --json <键> '<JSON>'`（新增 flag，只走 JSON 解析） |
| B | 认可「这两张表直接改 `config.toml`」为稳定用法（我们已这么做，带备份） |

---

## 三、需要新增暴露的变量（代码里加配置字段）

这 5 个是当前**硬编码**在源码里的行为，要变成变量才能"只改变量"接入。

| # | 变量名 | 类型 | 默认（=现状） | 破甲值 | 语义 | 源码锚点 | 优先级 |
|---|---|---|---|---|---|---|---|
| V1 | `refusal_policy` | `"stop" \| "next" \| "retry"` | `"stop"` | `"next"` | 模型拒答后：停 / 切链上下一个后端 / 同后端重试 | `crates/ai/src/agent.rs:427` | **P0** |
| V2 | `refusal_retry_limit` | `int 0..3` | `0` | `1` | `retry` 时的重试次数 | 同上 | P2 |
| V3 | `consent_mode` | `"ask" \| "grant"` | `"ask"` | `"grant"` | 工具审批门（`grant` = 全局 `--allow-run`） | `agent.rs:124`、`apps/autokill-cli/src/main.rs:231` | **P1** |
| V4 | `clean_room_tools` | `"filtered" \| "all"` | `"filtered"` | `"all"` | clean-room 下是否按白名单砍工具（不影响"是否读目标"） | `agent.rs:110-113` | P1 |
| V5 | `journal_refusal` | `bool` | `true` | `true`（建议保持） | 是否记 `kind:"refusal"` 痕迹 | `agent.rs:433` | P2 |

### 每个变量的实现要点（给 AutoKill 侧）

| 变量 | 加在哪 | serde 要求 | 验收 |
|---|---|---|---|
| V1 | `LoopConfig`（随会话走，不是全局 Settings） | `#[default] Stop` | 造一次 `StopReason::Refusal`，`refusal_policy="next"` 时应出现 `Trying <下一个后端>` 事件 |
| V2 | 同上 | `0` | 同一个后端应被请求 `1 + limit` 次，且 `history` 长度不变 |
| V3 | `AiConfig`（`[ai] consent_mode`） | `Ask` | `grant` 时工具调用不应产生 Consent 询问 |
| V4 | `Session.settings`（engine 侧） | `Filtered` | `all` 时 `tools()` 数量应等于 `clean_room=false` 时 |
| V5 | `LoopConfig` 或 `[ai]` | `true` | 关掉后 journal 里不再出现 `kind:"refusal"` |

> V1/V2 放 `LoopConfig`（`agent.rs:258`）而不是全局 Settings，是因为它随「这一次会话」生效，语义更准；
> 若希望全局可配，也可同时映射到 `[ai]` 表，两者取并集（会话配置优先）。

---

## 四、环境变量备选（沿用现有先例）

源码 `crates/ai/src/prompt.rs:6` 已有先例：

```rust
/// Local overlay: `AUTOKILL_PROMPT_INJECT` if set, else `<config>/autokill/prompt-inject.md`.
```

按同样风格加三只，用于单次覆盖 / A/B 对比：

| 环境变量 | 等价配置 | 优先级 |
|---|---|---|
| `AUTOKILL_REFUSAL_POLICY` | `refusal_policy` | 高于 config |
| `AUTOKILL_CONSENT` | `consent_mode` | 高于 config |
| `AUTOKILL_CLEAN_ROOM_TOOLS` | `clean_room_tools` | 高于 config |

---

## 五、autokill-purge 侧怎么接（变量驱动）

改动量：把补丁表从 9 项扩成 9 + N 项，**代码逻辑不用改**。

```js
// web/server.mjs 的 AUTOKILL_PATCHES 追加条目（示例）
{ id: 'ak-refusal', kind: 'setting', key: 'refusal_policy', target: 'next', was: 'stop',
  label: '拒答时切下一个后端', risk: '可能多花后端额度' },
{ id: 'ak-consent', kind: 'setting', key: 'consent_mode', target: 'grant', was: 'ask',
  label: '工具调用免审批', risk: '误执行无拦截' },
{ id: 'ak-cleanroom', kind: 'setting', key: 'clean_room_tools', target: 'all', was: 'filtered',
  label: 'clean-room 不砍工具', risk: '工具面变大' },
```

写入路径（三条，已有两条）：

| 变量类型 | 写入方式 | 现状 |
|---|---|---|
| 标量 | `autokill-cli settings_set <键> <JSON 标量>` | ✅ 已有 |
| 数组/映射 | 直接改 `config.toml` + 备份 + 读回校验 | ✅ 已有（MCP 就这么挂的） |
| 新增的 V1–V5 | 同上（它们只是标量/枚举，`settings_set` 天然支持） | ✅ 等 AutoKill 暴露即可 |

卸载：每项带 `was` 字段，逐项写回 + 读回核对 + SHA 比对原件（已实现并测过 9/9）。

---

## 六、版本门控

变量是有版本前提的，`autokill-purge` 按宿主版本决定展示哪些项：

```js
HOST_SUPPORT.autokill = { verified: '0.6.1', label: '梦神破甲 9 项 + 提示词层' }
```

AutoKill 新增 V1–V5 后升版（如 `0.7.0`），我这边改成：

```js
{ verified: '0.7.0', label: '梦神破甲 9 + 5 项（含拒答切换）', vars: ['refusal_policy', ...] }
```

低版本仍只显示 9 项——**不会把写不进去的键推给旧版**（现在已有这套 `exact / compatible / unknown` 判定）。

---

## 七、落地顺序（建议）

| 阶段 | 做什么 | 需要改 AutoKill 代码？ | 我方改动 |
|---|---|---|---|
| 第 1 步 | 暴露 V1 + `fallback_chain` 可写（方案 A 或 B） | 是（V1）；B 方案零改动 | 补丁表 +2 项 |
| 第 2 步 | 暴露 V3、V4 | 是 | 补丁表 +2 项 |
| 第 3 步 | V2、V5 | 可选 | 补丁表 +2 项 |

**如果只做一件事**：V1 + `fallback_chain` 可写。拒答是唯一"硬中断"路径，它一开，AutoKill 就从「拒答即停」变成「拒答自动换模型」。

---

## 八、变量生效与验证（每次改完都要过）

```bash
# 1. 写入
autokill-cli settings_set refusal_policy '"next"'

# 2. 读回（settings_show 里应看到新值）
autokill-cli settings_show | grep refusal

# 3. 重启 AutoKill（配置文件在启动时读入）

# 4. 造一次拒答，看 journal：
#    <project>/journal 或 %APPDATA%\autokill\logs\agent-*.log
#    应出现 {"kind":"refusal","backend":"...","action":"next"} 与 "Trying <next>"
```

---

## 九、风险与回退

| 风险 | 缓解 |
|---|---|
| `refusal_policy="next"` 死循环 | 链内单向前进（`current += 1` 不回头），全拒则停 |
| `consent_mode="grant"` 误执行 | 只在我们主动写入时生效；卸载即恢复 `ask` |
| 多后端额度消耗 | `budget_usd` 独立控制（已有键） |
| 变量写坏 config | 每次改前备份 `data/host-snapshots/autokill-config-*.toml` |

回退：`梦神破甲 → 一键卸载`，逐项写回 `was` 并 SHA 比对原件（已实现）。
