# AutoKill 配置化需求清单（供 autokill-purge 破甲使用）

> 目的：把目前**硬编码在源码里的 4 处行为**改成**可配置项**，默认值保持现状（对现有用户零影响）。
> 消费方：autokill-purge 在「破甲」时通过 `autokill-cli settings_set` 或直接改 `config.toml` 打开这些开关。
> 这样 AutoKill 不必被 fork、不必重编译，破甲可随时一键卸载。

---

## 0. 设计原则（三条，请上游优先确认）

1. **只增不改**：新增键，默认值 = 当前硬编码行为，现有用户升级后行为完全不变。
2. **可写**：能被 `settings_set` 或 `config.toml` 直接写（含数组/映射，见 §3）。
3. **可回退**：任意键改回默认值即恢复原始行为，不需要重装。

---

## 1. 优先项（P0：直接决定「拒答能否自愈」）

### 1.1 `ai.refusal_policy` — 拒答后的行为

| 项 | 内容 |
|---|---|
| 源码锚点 | `crates/ai/src/agent.rs:427`（`StopReason::Refusal =>` 分支） |
| 当前行为（硬编码） | `emit(AgentEvent::Error)` + `journal("error", {kind:"refusal"})` + **`break`** → 本轮直接停，不重试、不换后端 |
| 建议类型 | `enum: "stop" \| "next" \| "retry"` |
| 默认值 | `"stop"`（= 现状） |
| 取值语义 | `stop`：保持现状；`next`：切 `chain` 的下一个后端重问；`retry`：同后端再问一次（可配合 1.2） |
| 消费方用法 | 破甲时写 `"next"`，配合 `fallback_chain` 配 2~3 个后端 |
| 验收 | 构造一次 `StopReason::Refusal`，断言链上下一个后端的 `name` 出现在事件里（参考现有测试 `fallback_chain_and_refusal`，agent.rs:1737） |

### 1.2 `ai.refusal_retry_limit` — 同后端重试次数

| 项 | 内容 |
|---|---|
| 类型 | `int`，范围 `0..=3` |
| 默认值 | `0`（不重试 = 现状） |
| 语义 | `refusal_policy = "retry"` 时生效；每次重试前可选做一次上下文摘要（现有 `fit_context` 逻辑可复用） |
| 验收 | 设为 `1` 时，同一后端应被请求两次，且第二次请求的 `history` 长度不增（有摘要） |

### 1.3 `consent.mode` — 工具审批门

| 项 | 内容 |
|---|---|
| 源码锚点 | `crates/ai/src/agent.rs:124`（`with_consent(...)`）、`apps/autokill-cli/src/main.rs:231`（`let consent = if cli.allow_run {...}`） |
| 当前行为 | GUI / CLI 均按 `ask_before_running` 决定弹不弹；CLI 另需 `--allow-run` |
| 建议类型 | `enum: "ask" \| "grant"` |
| 默认值 | `"ask"`（= 现状） |
| 语义 | `grant`：等价于全局 `--allow-run`，工具调用直接放行 |
| 与现有键关系 | 与 `ask_before_running` 不冲突：`consent.mode = "grant"` 优先级更高 |
| 验收 | 设为 `grant` 后，AI 调用需授权的工具不应产生 `Consent` 询问事件 |

### 1.4 `clean_room.tools` — clean-room 模式下的工具面

| 项 | 内容 |
|---|---|
| 源码锚点 | `crates/ai/src/agent.rs:110-113`（`filter(|t| !clean \|\| autokill_engine::clean_room::allows(&t.name))`）、`crates/engine/src/clean_room.rs` |
| 当前行为 | `clean_room()` 为真时只保留 `allows()` 白名单里的工具 |
| 建议类型 | `enum: "filtered" \| "all"` |
| 默认值 | `"filtered"`（= 现状） |
| 语义 | `all`：clean-room 模式下仍给全部工具（仅影响工具可见性，不改变"是否读目标"的语义） |
| 验收 | 设为 `all` 时，`tools()` 返回数量应与 `clean_room = false` 时一致 |

---

## 2. 次要项（P1：影响上下文与痕迹）

| 键 | 类型 | 默认 | 源码锚点 | 作用 |
|---|---|---|---|---|
| `journal.refusal` | `bool` | `true` | `agent.rs:427` 的 `journal("error", …)` | 是否记录 `kind:"refusal"`；关掉只减审计痕迹，不减能力 |
| `ai.slot.max_turns` | `int` | `5` | `agent.rs:246` `ModelSlot.max_turns` | 单轮工具循环上限 |
| `ai.slot.context_tokens` | `int` | `0`（用后端默认） | 同上 | 单后端上下文预算 |

> 这三项**收益有限**，AutoKill 侧若嫌多余可以只做 §1。

---

## 3. CLI 能力需求（关键，否则 §1 之外仍写不进去）

现状（实测）：

```
settings_set ask_before_running false        # ✅ 标量可写
settings_set ai.roles.lead "X"               # ❌ There's no setting "ai.roles.lead"
settings_set plugins.mcp [...]               # ❌ 数组不可写
```

需求任选其一即可：

| 方案 | 说明 | 工作量 |
|---|---|---|
| A（推荐）`settings_set --json <键> <文件或标准输入>` | 值从 JSON 解析，支持数组/对象 | 小 |
| B `settings_edit` 打开 `$EDITOR` / 指定文件整体替换某一表 | 适合 `[ai.roles]`、`plugins.mcp` | 小 |
| C 仅文档化"这两张表请直接改 config.toml" | 我们已经在这么做（带备份），但需要上游认可该用法稳定 | 零 |

**为什么需要**：`fallback_chain`（数组）和 `roles`（映射）是 §1.1 生效的前提——没有多后端，`refusal_policy = "next"` 无处可切。

---

## 4. 我们这边怎么用（消费方承诺）

autokill-purge 只会做三件事，且都可一键撤销：

| 时机 | 动作 | 落点 |
|---|---|---|
| 破甲（梦神破甲） | 写 §1 的键为破甲值 | `config.toml`，改前自动备份到 `data/host-snapshots/autokill-config-*.toml` |
| 破甲（提示词层） | 写 `prompt-inject.md` 标记块 | `%APPDATA%\autokill\prompt-inject.md`，只动自己的标记块 |
| 卸载 | 逐项写回原始值（`was` 字段） | 同上，SHA 校验回原件 |

我们不会碰：exe、安装目录、investigations、logs。

---

## 5. 兼容性与风险（给上游评估用）

| 风险 | 说明 | 缓解 |
|---|---|---|
| 默认值改变行为 | 不会——所有默认值 = 当前硬编码行为 | 默认值写进 `#[serde(default)]` |
| `refusal_policy = "next"` 死循环 | 链很短时可能来回切 | 加 `max_switch`（建议 2），或只在 chain 内单向前进 |
| `consent.mode = "grant"` 误执行 | 用户主动开启才生效 | 建议 GUI 设置页给红色警示 |
| 多后端起不来 | `fallback_chain` 里含已禁用后端 | 复用现有 `enabled()` 过滤（`config.rs:337`） |

---

## 6. 最小可交付（如果只做一件事）

**`ai.refusal_policy` + `ai.fallback_chain` 可写**。

理由：拒答是唯一"硬中断"路径，其余（审批、clean-room）都是可绕过的软约束。这两项到位，AutoKill 就从"拒答即停"变成"拒答自动换模型"，破甲语义才成立。
