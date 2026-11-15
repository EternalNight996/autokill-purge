# CHANGELOG

本项目变更记录。格式：每个里程碑一段，写明「做了什么 / 跑了什么 / 结果 / 还缺什么」。

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
