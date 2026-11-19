# 能力补齐层（web/ops）

> 目标：把 **dsh-purge 的整套能力面**补齐到 autokill-purge，同时诚实标出「机制不同、效果等价」的部分。
> 结论先行：**注入/回滚/落地**这条主线已在 1.1.13 等价且更强；1.1.14 把剩下的 5 项用外部等价物补齐，
> 只有「56 个 redteam_* 工具」这一项无法由外部控制台提供（必须由宿主插件注册），改为**托管 + 显式告警**。

## 1. 为什么是「外部等价物」而不是照搬

dsh-purge 是**宿主内插件**：它跑在 DSH 进程里，能挂 `ctx.on("prompt/assemble")`、能注册工具、能看到 session 对象。
autokill-purge 是**外部控制台**（独立 node 进程 + Web UI），只能做三件事：读写文件、起停进程、发 HTTP。

所以逐项改写：

| dsh-purge 原能力 | 上游机制 | 本项目补法 | 等价度 |
|---|---|---|---|
| 83 条宿主补丁 apply/revert | 进程内改文件 | vendor 同一份 `core.js`，外部调用（1.1.13 已通） | **等价** |
| 密封 asar 落地 | `restartSealedDesktopIfNeeded` | kill（不带 /T）→ 改名 `app.asar.dshpurge-aside` → 拉起（1.1.13） | **等价** |
| 启动自动重放 `reapply.js` | 启动钩子 + stamp | `web/ops/reapply.mjs`：探活 + pending 检测 + 幂等重放 + stamp | 等价（需人/计划触发） |
| 官方更新交接 `official-update.js` | marker + WScript | 同上模块：asar 身份变化 → 重解包 → 重放 → 落地 | 等价 |
| 优雅重启 `restart-desktop.js` | WScript/PowerShell 助手 | `web/ops/restart.mjs`：直接复用 vendor 里的同一份助手 | **同一份代码** |
| settle 时机判定 `settle-policy.js` | 纯函数 | 移植 `applyShouldRestart` / `DESKTOP_SETTLE_DELAY_MS` | **等价** |
| 组装期身份改写 `identity.js` | `prompt/assemble` 钩子 | `web/ops/identity.mjs`：片段库 → 编译成 `prompt-inject.md` | 效果等价（机制不同） |
| 会话回溯 `rewind.js` | 改 session 对象 | `web/ops/rewind.mjs`：文件级截断/隐藏 + 备份 | 效果等价（粒度到文件） |
| 48 技能 + 5 角色 `skills.js` | 插件内置 | `web/ops/redteam-pack.mjs`：写入 `~/.dsh/skills/<id>/SKILL.md` | 等价（DSH 原生读 skills 目录） |
| 56 个 `redteam_*` 工具 | 插件注册 | **无法外部提供**：检测插件是否在位 + 冲突告警 + 给出两条替代路径 | 缺失（显式声明） |

## 2. 契约

每个能力一个文件 `web/ops/<id>.mjs`，导出：

```js
export const META = { id, zh, en, kind: 'read'|'write'|'both', requires: string[], note?: string }
export async function status(ctx)              // 只读：不许写盘/起进程/杀进程
export async function run(ctx, opts)            // 幂等；自己 catch，返回 { ok, changed, summary, detail, error? }
export async function plan(ctx, opts)           // 可选：执行前的只读计划
```

`ctx` 由 `web/ops/index.mjs` 注入（`dataDir / dshHome / resourcesDir / appDir / asarPath / asidePath / desktopExe / log() / snapshot()`）。
注册表用**动态 import + 缺省降级**：某个模块不存在或语法坏掉，只让它自己那一行变成「未就绪」，控制台照常工作。

路由：

```
GET  /api/ops                    → { ok, contract:1, ctx, ops:[{id,zh,kind,available,summary,...}] }
GET  /api/ops/<id>/status        → 只读状态
POST /api/ops/<id>/plan          → 只读计划（{} 即可）
POST /api/ops/<id>/run           → 执行，必须 { confirm:true }；支持 { dryRun:true } 的模块会明确返回 changed:false
```

## 3. 五个能力

### reapply（启动自动重放 + 官方更新交接）
- 读：`resources/app` 是否存在、`app.asar` 是否已让位、`app/dsh/package.json` 版本 vs aside 里的版本、vendor 引擎的 pending 条数。
- 判定：`needsRepack`（官方升级后目录与归档不同源）/ `needsReapply`（pending>0）/ `needsHandoff`（asar 又回来了）。
- 执行：默认只做安全步骤（重放补丁）；`{ auto:true }` 才允许重解包与落地。
- stamp：`data/reapply-stamp.json` 记 `appliedRev / appVersion / asarIdentity / at`。

### restart（优雅重启）
- 复用 `web/patch-engine/vendor/restart-desktop.js`（与上游同一份）：kill Electron → 释放 asar → 拉起 → 窗口提前台。
- settle：桌面启动后先静 `4000ms`；`applyShouldRestart({ complete, sealed, appliedCount, promptReady })` 与上游同语义。
- 历史：`data/restart-history.json`（最近 50 条）。

### identity（PromptPatch 管线）
- 片段库 `data/identity-patches.json`：身份卡（最高优先级）/ 目标段 / redteam 角色段 / CTF 契约段 / 能力协议段 / 工作目录后缀。
- `plan()` 给顺序、字数、编译后 sha256、与当前 override 的 diff 摘要；`run({apply:true})` 才写 `~/.dsh/prompt-inject.md`（写前备份到 `data/identity-backups/`）。
- 注意 DSH 0.2.x 不再提供 `{{cwd}}` 变量，编译时不留该占位符（否则会话在第一个模型请求前就抛 unknown prompt variable）。

### rewind（会话回溯）
- **真实存储不是裸 jsonl**：`~/.dsh/sessions/<项目槽>/<session-id>/session.v4.jsonl.zstd` 是**多帧 zstd 拼接容器**（一帧一批事件），
  而 `zstdDecompressSync` **只解第一帧**（实测 676 帧的文件只吐 214 字节）。所以照 `@deepseek-ai/dsh-session-persistence-jsonl` 的
  `scanZstdFrames` 语义自己按帧头/块头切帧，写回时逐帧压并带 `ZSTD_c_checksumFlag`。
- 事件行 `{"type","seq",…}`，头行 `{"type":"session"}` 无 seq；人类消息 = `user/message` 且 `data.source.kind==='user'`
  （runtime-context / skill-catalog / time-context / plugin 都不算）。
- 回退语义沿用上游：只在最近**已闭合**的 `turn/end` 窗口里找轮提示，起点优先取该窗口 `turn/start`（整轮连上下文快照一起退）；三种模式 `last-turn` / `last-turns:N` / `to-seq`。
- 四道闸：路径必须在 `<dshHome>/sessions` 下且文件名匹配、拒 dataDir、mtime<3s 拒绝、再 200ms 二次采样确认没在增长（`force` 仅应急）；
  写前整份备份 + sha256 核对，重写前自解码校验，落盘后重读核对行数/sha，对不上立刻用备份还原；发布用同目录临时文件 rename 原子替换。
- 生效时点：宿主仍持有旧写句柄时，回退后要**重开该会话或重启宿主**才彻底生效（建议串 `restart`）。

### redteam-pack（技能/角色落地 + 工具面托管）
- 48 篇技能解析 frontmatter（含块标量/引号/注释子集）后剥掉上游私有字段 `role`/`enabled`，按官方 bundle 布局落
  `~/.dsh/skills/<frontmatter.name>/SKILL.md`，正文逐字节保真。**DSH 的 skill watcher 会立刻发现**——实测 install 后技能目录当场多出 48 条。
- 角色落**真实机制** `~/.dsh/.agent-presets/redteam/`（`dsh-agent-presets` 扫这里；不是 `~/.dsh/presets`），
  写入时把 `{{REDTEAM_SKILLS_DIR}}` 替换成 `!!js dshHomePath('redteam/skills')`；机制不存在时退 `data/redteam-roles/` 并标「DSH 侧未接入」。
- 台账 `data/redteam-pack-state.json` 区分 **stale**（源升级了、该覆盖）与 **modified**（用户手改过、默认不动，`force` 才写）；
  装前备份 `data/redteam-pack-backups/<ts>-<action>/` + manifest。
- 工具面**只体检不安装**：从插件 `lib/redteam/tools.js` 实数得 **58 个** `redteam_*`（任务书标称 56，以源码为准，`toolCountNote` 点明差异）。
  不在位时 `detail.toolHosting.paths` 给两条：装插件（并关它的自动重放）/ 用 `break/break.mjs` + patch-engine 载荷。
- 冲突告警：有效配置 = profile `cordis.patch.yml` 覆盖 > 插件自带 patch（只看 `id: dsh-purge` 后 3KB 内的 `autoApplyOnStart`，避免误判别的插件）；
  开着 → `warning.level='warn'` / `code='auto-apply-conflict'`，直说「会覆盖本项目注入结果」。

### instruction-inject（指令层 · 免重启）
- **为什么另开一条**：宿主补丁路线要「落地 + 重启客户端」；用户明确不重启时，这条路不可用。
- **机制**：DSH 原生 `dsh-agent-instructions` 在每个 agent step 前读 `<dshHome>/AGENTS.md`（用户全局）与项目 `AGENTS.md/CLAUDE.md`，
  以 `source.kind='agent-instructions'` 的用户消息注入；写文件即生效（预算 `maxBytes=65536`）。
- **本实现**：写带标记的块（`<!-- autokill-purge:agents:begin/end -->`），APPLY 先摘旧块再写、REMOVE 只摘块，用户原有内容保留；
  同内容幂等，超预算拒绝，写前备份到 `data/instruction-backups/`；控制台破甲页两个按钮 + 右侧栏「指令层」行。
- **权重**：走用户消息通道，低于 `prompt-inject.md` 的系统提示词头部；要最强权重仍走宿主补丁 + 重启。
### plugin-install（插件注入，与内核补丁同一事务）

**为什么需要它**：宿主补丁改的是 `resources/app` 里的内核文件；插件装的是 profile 的 `node_modules` + `dsh.profile.bundles`。
两件事必须一起成功或一起回滚，否则会出现「补丁生效了但插件没装」「插件装一半 profile 被 pnpm 清掉」这类半成品。

**只走官方通道**（这是踩坑换来的）：

| 步骤 | 用什么 | 不许用什么 |
|---|---|---|
| 写依赖 | `pnpm add <file:tgz>` | 手放目录到 `node_modules`（pnpm 会移进 `.ignored`）、`npm i`（pnpm 项目里会重装整树） |
| 登记 bundle | app-boot 的 `writeProfileBundles` | 手写 `package.json` 的 `dsh.profile.bundles` |
| 安装后校验 | app-boot 的 `loadProfileDirectory` → `skippedBundles` 必须为空 | 只看有没有目录 |

**事务**：安装前把 `package.json` + `pnpm-lock.yaml` 整份备份到 `data/plugin-install-backups/<ts>/`；
任一步失败 → 恢复声明 → `pnpm install --frozen-lockfile` 兜底；校验不过同样回滚。幂等：已装且已登记直接跳过，**不跑 pnpm**。

**与内核注入合并**：`POST /api/host/apply { confirm:true, plugins:["autokill-purge-plugin"] }`
→ 先插件（装 + 登记 + 校验，失败 500 且不继续）→ 再 83 条补丁 → 返回 `pluginResult` 与 `pendingHandoff`。
UI 里是「同时注入 autokill-purge 插件」勾选项（默认勾选）。

## 3.5 实测（1.1.14，本机）

```
契约层      node test/ops-acceptance.mjs --dry-run  → 35 PASS / 0 FAIL
能力单测    identity 85 · rewind 36 · reapply 83 · redteam-pack 142 → 381 断言全绿
reapply     needsReapply=false / needsRepack=false / needsHandoff=false；plan=[noop]
restart     procs=11 · asar 已让位 · shouldRestart=true（可选动作，未触发）
identity    片段 6/6 · 编译 46 行 / 4,327B / sha f8d37c3f…（当前 override 是 25,128B 种子默认，未覆盖）
rewind      可回退会话 14/20（共 1,171 个）；当前会话 fromSeq=1044 dropCount=453，dryRun 前后 sha 一致
redteam     技能 0/48 → 48/48（写 48 跳过 3）；角色 2/3 一致（1 个被 gear 改过，默认保护）
工具面      58 个 redteam_* 在册（插件 1.1.71 在位）
```

## 4. 验收

```bash
node test/ops-acceptance.mjs           # 契约层：26 项（只读，不动盘）
node test/ops-acceptance.mjs --dry-run # 额外验证 dryRun 不产生改动
node test/ops-identity.mjs             # 各能力自己的单测
node test/ops-rewind.mjs
# …每个 web/ops/<id>.mjs 对应一份 test/ops-<id>.mjs
```

## 5. 风险与回滚

| 动作 | 风险 | 回滚 |
|---|---|---|
| reapply（重放） | 覆盖宿主文件 | 跑之前自动 `snapshot('ops-reapply')`；`/api/host/restore` 最近一份 |
| reapply（重解包/落地） | 宿主重启、会话断 | `app.asar.dshpurge-aside` 改回 `app.asar`；`/api/host/asar` |
| restart | 同上 | 同上 |
| identity（写 override） | 提示词变化 | `data/identity-backups/` 或 `/api/host/prompt/reset` |
| rewind | 会话历史被截 | `data/rewind-backups/<ts>-<id>/` 覆盖回会话文件 |
| redteam-pack | 技能目录变多 | `run({action:'uninstall'})`；装前备份在 `data/redteam-pack-backups/` |
