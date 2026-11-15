# autokill-purge · 技术决策记录

> 记录 `REQUIREMENTS.md` §10 的 6 个未决问题。**均按默认建议执行，等待 YG 拍板**；在拍板前不改契约，遇到需要真改契约的地方记在这里并请示。

| # | 问题 | 默认建议 | 本仓库执行 | 状态 |
|---|---|---|---|---|
| Q1 | 技术栈 | 全 Node（复用 `web/server.mjs`） | **全 Node**：break CLI + web 服务均 Node，无 Python/Rust 双栈 | 按默认执行，等 YG |
| Q2 | 是否并入 `pure-console` | 并入但重写样式 | **并入**：六页交互/文案/API 形状复用 `pure-console`，样式重写为深色单强调色 `#6EA8FF` | 按默认执行，等 YG |
| Q3 | break 是否迁 Rust | 不迁（最快） | **不迁**：break 保持 Node（`break/break.mjs`），Rust 仅用于 WASM 插件 | 按默认执行，等 YG |
| Q4 | 是否支持 ELF/Mach-O/APK | 先 PE，其余按需 | **只 PE**：非 PE 返回退出码 4 +「当前只支持 PE」 | 按默认执行，等 YG |
| Q5 | 云端记忆是否必需 | 本地优先 | **本地优先**：默认连本机 `127.0.0.1:7999`；云端需显式 `cloud.enabled` 开启 | 按默认执行，等 YG |
| Q6 | 破甲页「12 技术」 | 全量 | **全量 12 技术**：角色框定、拒绝抑制、前缀注入、编码绕行、多轮拆分、上下文覆盖、格式约束、元提示递归、语言切换、载荷分片、少样本引导、采样重试 | 按默认执行，等 YG |

## 执行含义（对实现的具体影响）

- **Q1 全 Node**：`web/server.mjs` 继续做唯一后端；`test/acceptance.mjs` 用 Node 统一跑（不混 bash/jq/python 三套）。
- **Q2 并入重写样式**：复用 `pure-console` 的页面结构/文案/`state.json` 结构/协议门实现；**不复用**其 Python 后端与原生 JS 混搭（语言栈归一到 Q1）。
- **Q3 不迁 Rust**：`break` 无 `.rs` 二进制；`cargo` 只出现在 `gear/autokill-purge-plugin/`（WASM 组件）。
- **Q4 只 PE**：`break/pe.mjs` 只读 PE；ELF/Mach-O/APK 排期在 PE 全绿之后（M1 范围外）。
- **Q5 本地优先**：`web/server.mjs` 的 `resolveService` 顺序 = cloud（显式开启）→ env `PURGE_MEMORY_URL` → config → 守护端口发现 → fallback 本机；默认无 cloud。
- **Q6 全量 12 技术**：`web` 端技术库 12 条全量，每条 `{desc, 适用模型, 模板}`。

## 待 YG 拍板的衍生问题

1. **AC-3.1「7 节」vs 样例「6 节」**（见 `docs/ACCEPTANCE.md` 第五节）：`_smoke/sample.exe` 实测 6 节，按现行契约 M1 正向 1 无法全绿；解法三选一待定。
2. 其余按默认执行，暂无阻塞。

## 记录纪律

- 拍板结果到达后：更新本表状态列 → 同步改 `REQUIREMENTS.md`（若涉及契约）→ 重跑 `test/acceptance.mjs` 确认。
- 未经拍板，不自行改 §10 契约或测试阈值。
