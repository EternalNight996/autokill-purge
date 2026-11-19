# AutoKill 破甲相关改动提案（代码级）

> 目标：把「拒答即停」变成可配置行为，默认值保持现状。
> 全部改动默认关闭，现有用户行为零变化。
> 锚点基于 v0.6.1（`F:\MyApp\eternal\AutoKill`，workspace `crates/*` + `apps/*`）。

---

## 1. 新增 `RefusalPolicy`（`crates/ai/src/agent.rs`，`LoopConfig` 附近 ~258 行）

```rust
/// 模型拒答（StopReason::Refusal）时的行为。
/// 默认 `Stop`：报错并结束本轮——与 v0.6.1 完全一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RefusalPolicy {
    #[default]
    Stop,
    /// 切 fallback 链里的下一个后端，用同一份 history 重问。
    Next,
    /// 同一后端最多再问 n 次（每次重提前先按上下文预算裁剪）。
    Retry(u32),
}
```

`LoopConfig` 加一个字段：

```rust
pub struct LoopConfig {
    pub beginner: bool,
    pub prices: BTreeMap<String, crate::config::Price>,
    pub transcript: Option<std::path::PathBuf>,
    pub deep: bool,
    pub context_tokens: u64,
    pub lean_for_local: bool,
    /// 新增：拒答策略（默认 Stop = 现状）
    pub refusal: RefusalPolicy,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            beginner: false,
            prices: BTreeMap::new(),
            transcript: None,
            deep: true,
            context_tokens: 0,
            lean_for_local: false,
            refusal: RefusalPolicy::default(), // Stop
        }
    }
}
```

`ApiConversation` 加一个计数器：

```rust
pub struct ApiConversation {
    chain: Vec<ModelSlot>,
    current: usize,
    /// 新增：当前后端已因拒答重试过几次（成功回答后清零）
    refusal_retries: u32,
    history: Vec<Msg>,
    // …
}
```

---

## 2. 改 `StopReason::Refusal` 分支（`agent.rs:427`）

现状：

```rust
StopReason::Refusal => {
    self.emit(AgentEvent::Error {
        message: "The model declined to answer this request.".into(),
        remediation: Some("Rephrase the question, say why you're examining the software, or try another backend.".into()),
        log: None,
    });
    self.host.journal("error", json!({"kind": "refusal", "backend": slot_name}));
    // Drop the refused turn so the conversation stays usable.
    break;
}
```

改成：

```rust
StopReason::Refusal => {
    // 拒绝的那一轮本来就不进 history（下面 break 前的注释已说明），
    // 所以 continue 等于「用同一份历史再问一次」，不会污染上下文。
    self.host.journal(
        "error",
        json!({"kind": "refusal", "backend": slot_name, "policy": format!("{:?}", self.cfg.refusal)}),
    );
    match self.cfg.refusal {
        RefusalPolicy::Stop => {
            self.emit(AgentEvent::Error {
                message: "The model declined to answer this request.".into(),
                remediation: Some("Rephrase the question, say why you're examining the software, or try another backend.".into()),
                log: None,
            });
            break;
        }
        RefusalPolicy::Next => {
            if self.current + 1 < self.chain.len() {
                self.current += 1;
                self.refusal_retries = 0;
                let next = self.chain[self.current].name.clone();
                self.emit(AgentEvent::Status { text: format!("Trying {next}") });
                continue;
            }
            self.emit(AgentEvent::Error {
                message: "Every backend in the chain declined this request.".into(),
                remediation: Some("Add another backend to fallback_chain, or rephrase the request.".into()),
                log: None,
            });
            break;
        }
        RefusalPolicy::Retry(limit) => {
            if self.refusal_retries < limit {
                self.refusal_retries += 1;
                self.emit(AgentEvent::Status {
                    text: format!("Retrying {slot_name} ({}/{limit})", self.refusal_retries),
                });
                continue;
            }
            self.emit(AgentEvent::Error {
                message: format!("The model declined {} times in a row.", limit + 1),
                remediation: Some("Try another backend, or change the request.".into()),
                log: None,
            });
            break;
        }
    }
}
```

正常回答的分支里补一行清零：

```rust
StopReason::EndTurn => {
    self.refusal_retries = 0; // 新增
    // …既有逻辑
}
```

---

## 3. `consent.mode`（两处）

### 3.1 配置结构（`crates/ai/src/config.rs`，`AiConfig`）

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsentMode {
    #[default]
    Ask,
    Grant,
}

pub struct AiConfig {
    pub backends: Vec<BackendEntry>,
    pub roles: BTreeMap<String, String>,
    pub fallback_chain: Vec<String>,
    pub prices: BTreeMap<String, Price>,
    pub install_id: Option<String>,
    /// 新增：工具审批门。grant = 等价于全局 --allow-run
    pub consent_mode: ConsentMode,
}
```

### 3.2 CLI（`apps/autokill-cli/src/main.rs:231`）

```rust
pub fn call_options(cli: &Cli, cancel: &CancelToken) -> CallOptions<'static> {
    let grant = cli.allow_run || cli.ai_consent_granted(); // 读 settings.consent_mode
    let consent = if grant { Consent::Granted } else { Consent::NotAsked };
    CallOptions::new(caller()).with_consent(consent).with_cancel(cancel.clone())
}
```

GUI 侧同理：把 `with_consent(if consent { Granted } else { NotAsked })`（`agent.rs:124`）的 `consent` 来源改成 `session.settings.ai.consent_mode == Grant || 用户点了允许`。

---

## 4. `clean_room.tools`（`agent.rs:110-113`）

现状：

```rust
fn tools(&self, enabled: &BTreeSet<Toolset>) -> Vec<ToolDef> {
    let clean = self.clean_room();
    registry_tools(self.0.registry(), enabled)
        .into_iter()
        .filter(|t| !clean || autokill_engine::clean_room::allows(&t.name))
        .collect()
}
```

改成（读 engine settings，新增枚举 `CleanRoomTools { Filtered, All }`）：

```rust
fn tools(&self, enabled: &BTreeSet<Toolset>) -> Vec<ToolDef> {
    let clean = self.clean_room()
        && self.0.try_session().map(|s| s.settings.clean_room_tools == CleanRoomTools::Filtered).unwrap_or(true);
    registry_tools(self.0.registry(), enabled)
        .into_iter()
        .filter(|t| !clean || autokill_engine::clean_room::allows(&t.name))
        .collect()
}
```

> 注意：`clean_room()` 本身（是否允许读目标内部）**不改**，只新增「是否按白名单砍工具」。

---

## 5. `settings_set` 支持 JSON 值（可选但推荐）

`apps/autokill-cli/src/main.rs` 的 `settings_set` 目前只解析标量。改成：

```rust
let value: serde_json::Value = serde_json::from_str(&raw)?; // 任意 JSON
```

这样 `settings_set ai.fallback_chain '["Codex","Claude Code"]'` 可用，`ai.roles` 也能整表写。
若不想动标量解析逻辑，加一个 `--json` flag 只走这条分支即可。

---

## 6. 验收用例（建议加进 `crates/ai/src/agent.rs` 测试）

```rust
#[test]
fn refusal_next_switches_backend() {
    let refusing = Scripted { turns: VecDeque::from([turn(vec![], StopReason::Refusal)]), seen: Arc::default() };
    let ok = Scripted { turns: VecDeque::from([turn(vec![Block::Text { text: "ok".into() }], StopReason::EndTurn)]), seen: Arc::default() };
    let chain = vec![
        ModelSlot { name: "A".into(), model: Box::new(refusing), local: false, effort: None, max_turns: 5, context_tokens: 0 },
        ModelSlot { name: "B".into(), model: Box::new(ok), local: false, effort: None, max_turns: 5, context_tokens: 0 },
    ];
    let mut cfg = LoopConfig::default();
    cfg.refusal = RefusalPolicy::Next;
    // start → send → 断言：出现 "Trying B"，最终 TurnDone{backend:"B"}，无 Error 事件
}

#[test]
fn refusal_retry_repeats_same_backend() {
    let flaky = Scripted { turns: VecDeque::from([turn(vec![], StopReason::Refusal), turn(vec![Block::Text { text: "ok".into() }], StopReason::EndTurn)]), seen: Arc::default() };
    // cfg.refusal = Retry(1) → 断言同一后端被请求 2 次，history 长度不变
}

#[test]
fn refusal_stop_is_unchanged_by_default() {
    // 默认 LoopConfig（Stop）→ 仍应产生 Error 事件并结束（防回归）
}
```

---

## 7. 默认值一览（兼容性检查表）

| 键 / 字段 | 默认 | 行为 |
|---|---|---|
| `RefusalPolicy::default()` | `Stop` | 与 v0.6.1 一致 |
| `AiConfig.consent_mode` | `Ask` | 与 v0.6.1 一致 |
| `CleanRoomTools::default()` | `Filtered` | 与 v0.6.1 一致 |
| `settings_set` 标量解析 | 不变 | 新增 JSON 分支不影响旧调用 |

**结论：所有新增项默认关闭，升级后现有用户行为零变化。**

---

## 8. autokill-purge 侧的用法（改动完成后）

```bash
# 破甲（梦神破甲）
autokill-cli settings_set consent_mode '"grant"'
autokill-cli settings_set --json ai.fallback_chain '["Codex","Claude Code"]'
# 若 Config 结构里 refusal_policy 也暴露为键：
autokill-cli settings_set refusal_policy '"next"'
```

卸载时逐项写回（我方已实现 `was` 回滚 + SHA 校验）。
