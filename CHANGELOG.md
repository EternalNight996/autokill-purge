# CHANGELOG

本项目变更记录。格式：每个里程碑一段，写明「做了什么 / 跑了什么 / 结果 / 还缺什么」。

## [unreleased] — 2026-11-15（M1 进行中）

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

### 待办
- Lin/Pixel 交活后跑全量 `node test/acceptance.mjs`（Web 部分）逐条验收。
