# CHANGELOG

本项目变更记录。格式：每个里程碑一段，写明「做了什么 / 跑了什么 / 结果 / 还缺什么」。

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
