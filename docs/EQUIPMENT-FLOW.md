# 装备触发流程（现状 vs 补齐后）

## 一、现状：四条链路，只有一条能区分「哪个装备」

```
┌─────────────────────────────────────────────────────────────────────┐
│ 链路 1 · 破甲台「一并装备」（autokill-purge 控制台）                  │
│                                                                     │
│  勾预设 redteam/recon/lateral/radio/re  →  逐项勾能力项              │
│         │                                                           │
│         ▼                                                           │
│  POST /api/equipment { preset, presets[], agents[], items[] }        │
│         │                                                           │
│         ├──► state.equipment 追加一条记录（只是记录）                 │
│         ├──► 装备卡写入 mem-purge（pending，等审核）                  │
│         └──► agents 含 autokill 时：挂 MCP 插件（只挂插件，不传预设）  │
│                                                                     │
│  对 AutoKill 行为的影响：无（除非触发挂载）                            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 链路 2 · AutoKill「装备模式」下拉（ui.slots → build.gear）            │
│                                                                     │
│  新建项目页选「破甲装备 (purge)」                                     │
│         │                                                           │
│         ▼                                                           │
│  build.gear = ["purge"]      ← 只能放 MCP 的 toolset id              │
│         │                                                           │
│         ▼                                                           │
│  Deep 构建 → MCP server 带 --toolset purge                          │
│           → 构建提示词末尾「Gear: this run carries purge…」           │
│                                                                     │
│  能区分预设吗：不能（值只有 purge / 空）                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 链路 3 · MCP 工具（唯一能区分预设的）                                 │
│                                                                     │
│  AutoKill 会话里 AI 主动：                                            │
│    purge_modes          → 拿到 6 个预设（id/名称/能力/技能）          │
│    purge_use_mode{mode} → 登记一次装备 + 返回阶段式工作流              │
│    purge_search{q}      → 查 mem-purge 已审核卡                      │
│    purge_breach         → 宿主版本 + 破甲状态                        │
│                                                                     │
│  缺点：完全靠 AI 自己想起来调（没人告诉它"本次该用侦察刀"）            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ 链路 4 · 记忆库                                                     │
│                                                                     │
│  装备卡（kind=skill）审核通过 → purge_search 能查到 → AI 引用         │
│  作用：知识补给，不是"装备生效"                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**结论**：`一并装备` 与 `build.gear` 都只解决"挂不挂 purge"，**预设本身没有传递通道**——这就是"选了侦察刀但没反应"的原因。

---

## 二、缺口只有一个：预设无处存放

| 想传递的东西 | 现有载体 | 结果 |
|---|---|---|
| 挂不挂 purge | `build.gear = ["purge"]` / `[]` | ✅ 有效 |
| 用哪个预设 | 无 | ❌ `recon` 写进 `build.gear` 会被 `gear()` 丢弃（不是合法 toolset id） |

AutoKill 侧 `settings.rs:194` 明确：

```rust
/// An id that can't name a toolset is dropped rather than saved
pub fn gear(&self) -> Vec<String> { … }
```

---

## 三、补齐后的完整闭环

```
┌──────────────────────────────────────────────────────────────────────┐
│ ① 选装备（AutoKill 新建项目页 / 构建助手旁）                            │
│                                                                      │
│    装备模式 [ 侦察刀 ▾ ]  ← ui.slots, setting = "purge.mode"           │
│         │                                                            │
│         ▼                                                            │
│    config.toml:  [purge] mode = "recon"                              │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼  （AutoKill 启动时读入设置）
┌──────────────────────────────────────────────────────────────────────┐
│ ② 构建开始（Deep）                                                    │
│                                                                      │
│    build.gear = ["purge"]  → MCP server 以 --toolset purge 启动        │
│    MCP server 读 config: purge.mode = "recon"                         │
│         │                                                            │
│         ▼                                                            │
│    purge_breach / 会话首包返回：                                       │
│      「当前装备模式：侦察刀（recon）—— 阶段：被动收集 → 指纹 → 攻击面」  │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ③ AI 按预设执行                                                       │
│                                                                      │
│    AI 调 purge_use_mode{}（无参 → 用 purge.mode）                      │
│         │                                                            │
│         ├──► 阶段 1 被动收集   skills: passive-recon, fofa-recon      │
│         ├──► 阶段 2 指纹识别   skills: web-fingerprint, asset-…       │
│         ├──► 阶段 3 资产图谱   skills: asset-correlation              │
│         └──► 每阶段先 purge_search 查库，结果落 evidence               │
│                                                                      │
│    同时 POST /api/equipment 登记一条（可追溯"这次用了哪个预设"）        │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ④ 破甲（在 autokill-purge 控制台）                                     │
│                                                                      │
│    应用梦神破甲 → 9 项配置 + 挂 MCP + 注入插槽（一键）                  │
│    卸载        → 全部撤销 + 杀 mcp-server 残留进程                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 四、落地清单

### AutoKill 侧（1 个结构体 + 1 个字段）

```rust
// crates/engine/src/settings.rs
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PurgeSettings {
    /// 装备模式，由 autokill-purge 解释："" = 不装备
    pub mode: String,
}

// Settings 里加：
pub purge: PurgeSettings,
```

### autokill-purge 侧（2 处）

1. `purgeSlotBlocks()` 的 `setting` 从 `build.gear` 改为 `purge.mode`，`mode = "scalar"`，选项列 6 个预设
2. `scripts/mcp-server.mjs` 增加：启动时读 `config.toml` 的 `purge.mode`，`purge_breach` 与 `purge_use_mode` 无参时都用它

### 验收

```bash
# 1. UI 选「侦察刀」后
autokill-cli settings_show | grep -A2 '\[purge\]'     # mode = "recon"

# 2. MCP 侧读到
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"purge_breach"}}' \
  | node scripts/mcp-server.mjs | grep 装备模式

# 3. AI 调用
purge_use_mode({}) → 返回侦察刀的阶段式工作流（不是红队全装）
```
