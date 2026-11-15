# CHANGELOG

本项目变更记录。格式：每个里程碑一段，写明「做了什么 / 跑了什么 / 结果 / 还缺什么」。

## [unreleased] — 2026-11-16（整套破甲照抄 dsh-purge 1.1.71 + 宿主破甲备份/恢复闭环）

### Added（宿主破甲：驱动 dsh-purge 1.1.71 的补丁引擎，不复制它的 344 KB 代码）
- `web/host.mjs`：`dshPurgeRoot()` 定位本机插件 → 动态 import 它的 `lib/core.js`；`hostStatus()` 输出 83 条补丁的 `applied/pending/na`、宿主面（desktop/web）、注入文件、shim、被补丁文件清单（59 个，跨 `resources/app/**`、`%APPDATA%/npm/node_modules/@deepseek-ai/dsh/**`、`~/.dsh/profiles/*/node_modules/**`）。
- `asarRead()`：只解析 `app.asar` header 再按区间精确读单文件（213 MB 不整包解压），作为「原件基线」。
- `applyHostPatches()`：调它原版 `applyPatchesAllHosts()` / `revertAllHosts()`，效果与它一致且跟着它升级。
- 路由：`GET /api/host/status`、`GET /api/host/baseline`、`POST /api/host/{snapshot,restore,factory,apply}`；四个写接口一律 `confirm:true` 才执行。

### Added（备份与恢复闭环，两级 + guard）
- 快照：`createSnapshot()` 把 59 个被补丁文件整份复制到 `data/host-snapshots/<ts>-<tag>/` 并记 sha256 清单（实测 59 文件 / 2,670,542 字节）。
- 撤销上一次：`restoreSnapshot()` 用最近一份快照覆盖。
- 恢复出厂：`factoryRestore()` 用 `app.asar` 原件覆盖；实测基线比对 **54 patched / 1 identical / 4 not-in-asar**。
- **每次写入前先自动存 `pre-apply` / `pre-restore` / `pre-factory` 快照**，响应返回 `guardSnapshot` —— 本次操作本身也可撤销。
- 版本闸门：`asarVersion()` vs 磁盘 `dsh` 版本不同源时不硬抄，结果里写明"优先重装对应包"。
- 本机实测 `.dshpurge.bak` 数量为 **0**（它自己的回滚在本机不可用），所以恢复不依赖 `.bak`。

### Changed（前端）
- 技术模式「破甲·诊断」组新增**宿主破甲面板**：74/83 已应用 · 0 待应用 · 8 不适用、基线可读性、注入文件、四个动作按钮（备份现在 / 撤销上一次 / 恢复出厂 / 应用补丁）、83 行补丁表、快照表；每个写动作都有二次确认与结果提示。
- 修模式持久化竞态：点开关后 15 秒内刷新页面时，服务端可能还没写完 POST，之前会出现"刷新后模式反转"（技术↔普通颠倒）；现在以本机最近一次点击为准并回写服务端。
- 用户模式破甲模板下拉**只列它真实实现的两项**：`小码酱 · dsh-purge 1.1.71` / `不套模板（纯指令）`。

### Added（文档）
- `docs/破甲逐项对照-dsh-purge-1.1.71.md`：39 项逐条 PASS / FAIL / N-G + 原因 + 实测证据；同时分列「我们」与「它自身是否真做到」。
  汇总：破甲内容 11/12 PASS；宿主侧 8/9 PASS（唯一 N-G 是 shim）；备份恢复 9/9 PASS；模型与选项 7/7 PASS；FAIL 3 条（① 不进系统提示词 ② 换模型换提示词——它也没实现 ③ 不自动重启 dsh）。

### 实测（2026-11-16，8792）
- `GET /api/host/status`：`74/83 applied · 0 pending · 8 na`，基线可读，59 个文件，1 份快照。
- `GET /api/host/baseline`：`54 patched / 1 identical / 4 not-in-asar`（原位对照 asar 原件）。
- `POST /api/host/snapshot`：`20261116-023618-first`，59 文件 / 2,670,542 字节。
- 技术模式 DOM：`宿主破甲` 1 处、`已应用` 74 行、`不适用` 8 行、四个动作按钮齐全。
- 回归：acceptance **21/21**、ux2layer **18/18**、ac-check **19/19**、ux2layer-ui **16/16**（连续两轮）。

### 还缺什么
- 不自动重启 dsh（会杀掉当前会话），应用后需用户自行重启。
- 补丁应用后若需回滚到"未破甲"，走 `factory` + 重启；npm 全局那份若与 asar 版本不同源，正确做法是重装该包。

## [unreleased] — 2026-11-16（文档清理 + 与 dsh-purge 1.1.71 的对比评分）

### Removed（文档清理，按用户要求）
- 删除 `docs/ACCEPTANCE.md`、`docs/API.md`、`docs/DECISIONS.md`、`docs/PRODUCT-UX-2LAYER.md`、`docs/UX-2LAYER-CONTRACT.md`、`docs/memory-eternal-*.md`（4 份）、`docs/message-to-memory-eternal.txt`、根目录 `REQUIREMENTS.md`。
- 保留 `README.md`、`CHANGELOG.md`、`SKILL.md`、`docs/shots-ux2/`（截图证据）。
- 本地恢复副本：`_archive/docs-before-2026-11-16/`（已被 `.gitignore` 忽略）；仓库内恢复走 git 历史（旧文件在 `555759a` 及更早提交）。

### Added
- `docs/破甲对比与评分.md`：唯一的说明性文档。含机制差异表、载荷"破甲要素"覆盖度实测（不套模板 2/6 · 45 字符 → 套 dsh-purge 模板 6/6 · 21246 字符）、10 个维度打分与三套权重总分（默认 6.58 vs 8.10；评测者 7.03 vs 7.88；红队全链 8.30 vs 6.05）、双方硬伤与改进优先级。

### 实测（复用 dsh-purge 1.1.71 本机安装）
- 用其 `lib/table-read.js#openSlot()` 解出默认提示词 21194 字符；`lib/core.js:5624/5655` 确认注入位置为系统提示词头部；`lib/core.js` 内 `modelPrompts/perModel/promptForModel` 零命中，证实"一模型一提示词"未实现。
- 同一任务、同一模型，仅换 `template`：`none` → 45 字符 / 要素 2/6；`sauce-1171` → 21246 字符 / 要素 6/6。

## [unreleased] — 2026-11-16（模型目录更新 + 破甲照搬 dsh-purge 1.1.71 + 任务区选择项）

### Changed（模型目录：9 → 24，国内全覆盖）
- `MODELS` 重写为 **24 个**（国内 18 / 国外 6），按 2026-11 公开版本维护：DeepSeek **V4.1 Flash（`deepseek-flash`，V4.1-Flash-1017，多模态 / 1M 上下文 / 384K 输出 / thinking 三档）** 与 **V4 Pro（`deepseek-v4-pro`）**、Qwen3.5-Max / Qwen3-Max / Qwen3-Coder、GLM-5 / GLM-4.6、Kimi K2.5 / K2、豆包 2.0、文心 ERNIE 5.0、混元 TurboS、MiniMax M2、Step-3.5、星火 4.0 Ultra、Yi-Large、Baichuan4、本机 Ollama/vLLM；国外更新为 GPT-5.1、o4 / o4-mini、Claude Sonnet 4.5、Gemini 3 Pro、Llama 4。
- 每条模型新增 `vendor / domestic / api / tagline / notes`，其中 `api` 只写**已核实**的官方调用名（DeepSeek 两个取自官方 changelog：V4.1 Flash 用 `deepseek-flash`，旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍路由到它；V4 Pro 用 `deepseek-v4-pro`）。
- 普通模式推荐位改为读服务端 `recommended`：**DeepSeek V4.1 Flash / 通义千问 Qwen3.5-Max / 月之暗面 Kimi K2.5**。
- `TECHNIQUES[].models` 与 `MODEL_ADVICE` 全量对齐新 id（12 项技术的适用模型、24 条采样建议）。

### Added（破甲照搬 dsh-purge v1.1.71）
- `web/prompts/sauce-1171.md`（232 行 / 25.5 KB）：从 dsh-purge **v1.1.71** 的内置默认提示词槽（`lib/default-prompt-inject.md` → `lib/asset-table.js`，用其 `table-read.js#openSlot` 解开）原样导出，头部标注来源与署名（MIT，<https://github.com/YuJunZhiXue/dsh-purge>）。
- 后端 `PROMPTS` 登记两套模板（`sauce-1171` / `none`），`readPromptScope()` 支持 `full` 与 `identity`（截到 Scoped Rules 之前）两种范围；正文按需读盘，不进 `/api/state`。
- `POST /api/breach/build` 新增 `template` / `scope`：套模板时文本载荷 = 模板 + `---` + 技术模板(任务) + 输出要求；Base64 / ROT13 只编码任务句。响应新增 `result.template / scope / templateChars`。

### Added（任务区选择项）
- 普通模式「写一句你要它做什么」下方三列选择项：**破甲模板** / **任务类型**（自己写、内容边界说明、角色扮演、格式强约束、多步拆解、越狱复现研究，选中即写入输入框可再改）/ **输出要求**（直接给结果、分步编号、JSON、表格、简洁一段）。
- 技术模式「角色与输出要求」组新增「破甲模板」下拉，带默认值徽标与恢复默认；两种模式的模板选择共用 `S.breach.template`，切换模式不丢。
- 结果区新增一行模板说明（哪套模板 + 字符数）；装备页 busy 空窗按本次要装的组合先算件数，不再闪「已装备 0 件」。

### 实测（2026-11-16，8792）
- `POST /api/state`：`models=24 / techniques=12 / prompts=2 / outputChoices=5 / taskPresets=6`，国内 18，推荐位 = DeepSeek V4.1 Flash · Qwen3.5-Max · Kimi K2.5。
- `POST /api/breach/build {template:'sauce-1171', scope:'full'}`：`variants=3`、`templateChars=21194`、首条载荷 21228 字符（模板 21194 + 任务）。
- `node test/ux2layer-ui.mjs`：**16/16 PASS / 0 SKIP**（#3 首屏可交互 8 个、#4 禁用词 0 命中、#7 剪贴板 20895 字符与卡片全文一致 = 整段模板可复制）。
- `node test/acceptance.mjs` **21/21**、`node test/ux2layer.mjs` **18/18**、`node _ui-test/ac-check.mjs` **19/19**（断言同步为 24 models）。
- 截图 `docs/shots-ux2/` 已更新为带选择项的版本。

### 还缺什么
- 其余国内厂商的 `api` 调用名未逐一核实（只登记了 DeepSeek 两个），界面与技术模式不展示 `api`，不影响生成。
- 模板目前只有 dsh-purge 1.1.71 一份；「不同模型换不同提示词」还需后续按模型登记多套。

## [unreleased] — 2026-11-16（双层体验交付：普通模式 / 技术模式一键切换）

用户版（引导式流水线）+ 技术版（可配置项全）合并进同一个 web 端，顶栏一个开关切换；
同一套后端与同一份数据，切换不刷新、不丢输入。规格 `docs/PRODUCT-UX-2LAYER.md`，实现契约 `docs/UX-2LAYER-CONTRACT.md`。

### Added（前端 `web/public/**`）
- **模式状态机**：`S.uiMode`，读序「服务端 `settings.uiMode` > `localStorage["ap.uiMode"]` > `simple`」；`#modeSwitch`（`role="switch"`、`aria-checked`）一键切换，即时生效、保留当前输入；切换时 `POST /api/settings {uiMode}`，存服务端失败只 toast 不回滚。
- **普通模式 4 页**（破甲 / 装备 / 记忆 / 设置）：普通模式访问 `#/assign`、`#/about` 自动落回破甲页。
- **破甲页＝一键全自动向导**：状态卡（吃 `/api/readiness`，绿 / 黄 / 红；接口不可用整块隐藏、不挡主流程）+ 三步步骤条（选模型 → 写一句 → 拿载荷）+ 3 张推荐模型卡 + 一句话输入 + 整宽唯一主色按钮「一键生成」；点击后内部自动取 `layer=prompt`、推荐 3 技术、默认角色与输出要求，一次出全部载荷（含 Base64 / ROT13 变体），支持「复制」「复制全部」与「这次成功了 / 被拒绝了」记录。首屏可交互元素 5 个（预算 ≤ 8）。
- **普通模式文案硬约束**：可见文本不含 `breakDir/pluginPath/wasm/token/memoryBase/payload/variant/layer/technique/schema/API/HTTP/403/400/500`；错误一律「发生了什么 + 下一步点哪」。
- **技术模式零删减 + 5 组折叠**：基础 → 生成策略 → 采样 → 路径与文件 → 诊断（默认只展开「基础」，折叠态记 `localStorage["ap.groups"]`）；9 模型矩阵、3 层、12 技术 chips、技术库说明、角色 / 输出要求、采样建议、零宽样本、编码变体、命中率、二进制破甲全套子块全部保留。
- **三宽度适配**：1280 / 390 / 320 下两种模式均无横向溢出，`window.__apErrors` 为 0。

### Added（后端 `web/server.mjs`）
- `GET /api/readiness`：四项 checks（`agreement` / `catalog` / `kernel` / `memory`）+ `level` + `action`；`memory` 只作 optional 不参与判级，探测带 1.5s 上限（最坏实测 1515ms ≤ 2000ms 预算）；仍在协议门之内（未签署 403）。
- `settings.uiMode` 持久化：`POST /api/settings {uiMode}` 只接受 `simple|technical`，非法值 400 且不落盘；老 `state.json` 由默认值合并自动补齐，无迁移。
- **并发写修复**：`writeState()` 的临时文件从固定 `state.json.tmp` 改为「pid + 序号 + 随机」唯一名，rename 失败重试（最多 3 次，20/50/80ms 退避）。此前两个实例同时写会偶发 `ENOENT ... rename` → HTTP 500。
- **500 响应不再泄露绝对路径**：新增 `publicError()`，把 `C:\...` 类路径替换为 `<path>` 并截断到 300 字符。

### Added（测试与证据）
- `test/ux2layer.mjs`（18 条）：双层接口契约——ping、未签署 403、readiness 形状与 level 一致性、响应 ≤2s、`uiMode` 往返与非法值 400、`memoryBase`/`breakDir:''` 回归；服务不可达时给人话诊断不抛栈。
- `test/ux2layer-ui.mjs`（16 条）：零依赖自建 CDP 驱动（Node 内置 `WebSocket` + 本地 Chrome），真实点击跑两种模式，覆盖导航项数、禁用词扫描、首屏元素预算、一键生成、空任务拦截、复制一致性、记录增减、三宽度溢出与 `__apErrors`，并出 7 张截图；含「前端未落地」阻塞诊断（exit 2）与剪贴板不可读时的 SKIP 语义（不给假 PASS）。
- `docs/shots-ux2/`：simple / technical × 1280 / 390 / 320 + 技术模式首屏，共 7 张。
- `_ui-test/ac-check.mjs` 路径修复：硬编码 `D:\autokill-purge` 改为按脚本位置推导项目根，基址取 `PURGE_WEB_BASE`；断言逻辑未改（此前在 F: 工作区必挂）。`.gitignore` 相应放行该脚本，仅忽略截图与日志。

### 实测（2026-11-16，8792 正式实例）
- `node test/acceptance.mjs` → **21/21 PASS**（M1 12 条 + 协议门 + 破甲 6 变体 + 空任务 400 + 分发 2→3 卡 + 未选智能体 400）。
- `node test/ux2layer.mjs` → **18/18 PASS**（readiness `level=green`、35ms）。
- `node _ui-test/ac-check.mjs` → **19/19 PASS**（真实 server + break + memory-eternal，恢复 7999 后）。
- `node test/ux2layer-ui.mjs` → **16/16 PASS / 0 SKIP**，连续两轮稳定复现（`details=6`：5 个分组 + 技术库说明折叠）。
- 并发压测：两个实例交替 200 次 `POST /api/settings` → **200/200 成功**，最慢 557ms，无 `.tmp` 残留。
- 交付态 `data/state.json` 已清成干净首启（协议保留签署，`signer=yg`；`equipment` / `assignments` / `attempts` 清空）。

### 还缺什么
- 普通模式的「装备」点击瞬间会短暂渲染旧件数（请求回来即正确），未做乐观 UI。
- 技术模式破甲页折叠块为 6 个（5 组 + 技术库说明独立折叠），与契约 §2.5 字面 5 组相差 1，属展示分组而非能力差异。
- AutoKill 插件 `.wasm` 仍未产出（缺联网构建环境，见下条）。

## [unreleased] — 2026-11-16（M1–M3 交付）

### Added
- `git init` + 基线提交 `a00e965`（59 文件，4051 行）：break CLI + gear 插件 + web + catalog + _smoke 夹具，重写前快照。
- `.gitignore`：排除 `node_modules/`、`*.db*`、`*.bak`、`_smoke/vault-live/`。
- `docs/API.md`：§5.1–5.5 接口契约副本（break CLI / 插件 WIT / Web HTTP / 数据文件 / memory-eternal）。
- `docs/ACCEPTANCE.md`：§4 AC + §8 矩阵（正向 20 / 负向 15 / 回归 5）→ 可执行用例，统一 Node。
- `docs/DECISIONS.md`：§10 六项按默认执行 + 待拍板项。
- `test/acceptance.mjs`：§12 最小脚本（Windows 可跑，无 jq），含 §6 计时与负向核心；文件式 stdio 捕获（沙箱/真机双环境可用）。
- `test/make-7s-fixture.mjs`：从 `sample.exe` 可复现生成 7 节夹具 `_smoke/sample-7s.exe`（AC-3.1 选 (a) 落地）。

### Changed（由 Lin 并行交付，本记录为观察结果）
- `break/break.mjs` FR-8 强化：`{ok,...}` 统一包装、退出码 2/3/4/5、`--min-xrefs`、`journal`、`.bak` sha 校验、`format`/`packerHints`。

### 实测
- `node test/acceptance.mjs --break-only`：**M1 用例 1–12 全 PASS**（info 7 节、scan 483 命中、plan 8 候选、patch 353ms、verify differingBytes=7、journal 1 条、restore sha 回原、invert、负向退出码 3/4/2/5、§6 计时全达标）。

### 决策
- AC-3.1「7 节」vs 样例「6 节」：**已决（2026-11-15，小梦代 YG）**选 (a) 补 ≥7 节样例，不降阈值、不改 `>6`。

### Added（M2/M3 交活）
- 六页控制台 `web/public/**`（Pixel）：协议闸、破甲两栏、装备、分发、记忆中心、设置/关于。
- Web 服务 `web/server.mjs`（Lin）：FR-3 + §5.3 全端点、协议闸、break 白名单、memory 不可达 503 语义。
- `web/catalog.json` 扩到 21 条四态；`gear/autokill-purge-plugin/src/tools.rs` + `gear/tools-check/`（插件 4 工具离线自检 6/6）。
- `_smoke/web-settings-persist.mjs`：FR-7 设置持久化探针（重启后 `breakDir`/`pluginPath` 仍保留）。

### Fixed（FR-7）
- `POST /api/settings` 此前只存 memoryBase/memoryToken/language，丢弃 `breakDir`/`pluginPath`；现按 FR-7 持久化（`pluginPath` 空串可清空，`breakDir` 空串保留原值，>1024 拒绝）。

### 实测（2026-11-16，小梦复跑）
- `node test/acceptance.mjs`（server 8793）：**21/21 PASS** — M1 12 条、协议门 403/200、破甲 6 variants、空任务 400、分配 2→3 卡、未选智能体 400。
- `node _smoke/web-settings-persist.mjs`：**9/9 PASS**，重启后两个字段保留。
- `cargo test --offline`（gear/tools-check）：**6/6 PASS**。

### 待办
- AutoKill 插件 `.wasm` 未产出：本机出网被拦，缺 `wit-bindgen-rust-macro`；在联网机器执行 `cargo build --release --target wasm32-unknown-unknown` 即可。
- §8 共 40 条（正向 20 / 负向 15 / 回归 5），自动化覆盖 21 条，其余按 `docs/ACCEPTANCE.md` 手测清单执行。
