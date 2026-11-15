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

### Changed（由 Lin 并行交付，本记录为观察结果）
- `break/break.mjs` FR-8 强化：`{ok,...}` 统一包装、退出码 2/3/4/5、`--min-xrefs`、`journal`、`.bak` sha 校验、`format`/`packerHints`。

### 实测
- `node test/acceptance.mjs --break-only`：M1 用例 2–12 **PASS**（scan 483 命中、plan 8 候选、patch 386ms、verify differingBytes=7、journal 1 条、restore sha 回原、invert、负向退出码 3/4/2/5、§6 计时全达标）。
- 用例 1（info）**FAIL**：`_smoke/sample.exe` 实测 6 节，AC-3.1/§12 要求「7 节以上」。

### 待办
- YG 拍板 AC-3.1「7 节」vs 样例「6 节」（解法见 `docs/ACCEPTANCE.md` §五）。
- Lin/Pixel 交活后跑全量 `node test/acceptance.mjs`（Web 部分）逐条验收。
