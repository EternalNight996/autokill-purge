# 双层体验 · 实现契约（v1 交付版）

基准：`docs/PRODUCT-UX-2LAYER.md`（规格）。本文件只写**接口形状与判定口径**，供前后端各自实现时对齐。
用户已定的三条增补：

1. **一键全自动向导**：普通模式破甲页点一次就跑完（选模型 → 生成 → 给可复制的载荷），不是"分步点击"。
2. **技术模式零删减**：现有全部字段/功能都在，只做 5 组折叠。
3. **允许重排页面结构**：以本契约为准，规格中的像素级描述可让位于"普通模式更少元素、技术模式不丢能力"。

端口约定：正式实例 `8792`（由 Lead 重启维护，其他人**不要**起停）。后端子任务自测用 `8793`，前端子任务自测用 `8794`，两者都只读写同一份 `data/state.json`（合并式写入，安全）。

---

## 1. 后端契约（`web/server.mjs`）

### 1.1 `uiMode` 持久化

- `DEFAULT_STATE.settings.uiMode = 'simple'`（`readState()` 的 `Object.assign` 会自动补齐，无需额外迁移）。
- `POST /api/settings` 新增接受字段 `uiMode`：
  - 合法值：`'simple'` | `'technical'`；
  - 传了非法值 → `400 { ok:false, error:'uiMode must be simple|technical' }`，**不落盘**；
  - 没传 → 不动现值。
  - 与既有字段（memoryBase / memoryToken / language / breakDir / pluginPath）互不影响，仍走 `withLock`。
- `GET /api/state` 的 `state.settings.uiMode` 直接透出（`redact()` 只遮 memoryToken，无需改动）。

### 1.2 `GET /api/readiness`（新增）

在协议门**之内**（未签署仍是 403），返回：

```json
{
  "ok": true,
  "level": "green",
  "headline": "可以直接用",
  "detail": "选个模型，写一句话就能生成。",
  "action": { "label": "去设置", "target": "#/settings" },
  "checks": [
    { "id": "agreement", "label": "协议已签署", "ok": true,  "optional": false, "detail": "已签署" },
    { "id": "catalog",   "label": "模型目录",   "ok": true,  "optional": false, "detail": "9 个模型 / 3 层 / 12 技术" },
    { "id": "kernel",    "label": "破甲内核",   "ok": true,  "optional": false, "detail": "8 个动作可用" },
    { "id": "memory",    "label": "记忆服务",   "ok": false, "optional": true,  "detail": "没连上，可以先不用它" }
  ],
  "generatedAt": "2026-11-16T00:00:00.000Z"
}
```

判定口径（`level`）：

| 情况 | level | action |
|---|---|---|
| agreement.ok 为 false | `red` | `{ label:'重新签署协议', target:'#/sign' }` |
| catalog.ok 与 kernel.ok 都 true | `green` | `null` |
| 其余（缺模型目录 / 内核不可用） | `yellow` | `{ label:'去设置', target:'#/settings' }` |
| memory.ok 为 false | **不影响** level（optional） | 仅在 `checks[].detail` 用一句人话说明 |

`catalog` 判定：`MODELS.length >= 3`；`kernel` 判定：`typeof breakRun === 'function'` 且 `BREAK_WHITELIST.length === 8`；`memory` 判定：`memFetch(state,'/health')`，**1.5s 超时**，失败不抛错、不影响响应时间上限（≤2s）。

不为 `/api/readiness` 增加缓存；前端只在进页/点「测试连接」时拉。

### 1.3 不得改动的既有语义

`test/acceptance.mjs` 的 21 条必须全 PASS：协议门 403→200、`/api/breach/build` 生成与空任务 400、`/api/assign` 2→3 卡实时、`/api/equipment` 未选智能体 400。

---

## 2. 前端契约（`web/public/index.html` / `style.css` / `app.js`）

### 2.1 模式状态

- `S.uiMode: 'simple' | 'technical'`（默认 `'simple'`）。
- 读取优先级：`/api/state` 的 `state.settings.uiMode` → `localStorage['ap.uiMode']` → `'simple'`。
- 切换：立即改内存态 + 写 `localStorage['ap.uiMode']` + `POST /api/settings { uiMode }`（失败只 toast 提示，不回滚 UI、不阻断）。
- 切换必须**不刷新页面、不丢当前输入**（`S.breach.task`、`S.breach.model`、二进制表单、设置草稿都要保留）。
- 开关：顶栏右侧固定，`<button id="modeSwitch" role="switch" aria-checked="true|false">技术模式</button>`，两种模式都在。

### 2.2 导航

| 模式 | 导航项 |
|---|---|
| simple | 破甲 `#/breach` · 装备 `#/equip` · 记忆 `#/memory` · 设置 `#/settings` |
| technical | 破甲 · 装备 · 记忆分发 `#/assign` · 记忆中心 `#/memory` · 设置 · 关于 `#/about` |

- simple 模式下 `#/assign`、`#/about` 直接访问 → 落到 `#/breach`（重定向，不留死链）。
- 现有 hash 路由表 `TABS` 保留全部六项，另加 `uiMode` 门控。

### 2.3 simple 破甲页（一键全自动向导）

从上到下四块，**首屏可交互元素 ≤ 8**：

1. **状态卡**：吃 `/api/readiness`，绿「可以直接用」/ 黄「还差一步」+主按钮（读 `action`）/ 红「暂时用不了」+主按钮。接口不可用（非 200 或网络失败）→ 整块 `hidden`，**不报错、不挡主流程**。
2. **步骤条**（`ol.steps`，三步，`aria-current="step"` 标当前）：
   `① 选一个模型` → `② 写一句你要它做什么` → `③ 拿到可复制的载荷`；生成中③为进行态，成功后③为完成态。
3. **操作卡**：3 张推荐模型卡（`S.models.slice(0,3)`，只显示名称 + 一句特点，不显示 family/拒绝风格字段）+ `textarea`（placeholder「例：让它详细说明如何绕过内容审核」+ 小字「写得越具体，生成的载荷越能用」）+ 整宽唯一主色按钮 **「一键生成」**。
4. **结果区**：每条载荷一张卡 = 序号 + 名称 + 「复制」+ 展开看全文；结果区顶部一行「复制全部」；每张卡底部「这次成功了」/「被拒绝了」（`POST /api/breach/attempt`，成功 toast「已记录」）；生成后追加一行「想调层、技术、采样？切到技术模式。」。
   - 空态：「还没有载荷。上面写一句话，点『一键生成』。」
   - 失败态：「没生成出来」+ 一句人话原因 + 「重试」按钮。

一键生成的内部动作（全自动，用户不选）：
`layer='prompt'`、`techniques = S.techniques.slice(0,3)`、`role='安全研究员'`、`output='请直接给出结果'` → `POST /api/breach/build`。任务为空时**前端拦截**（人话提示「先写一句你要它做什么」，不发请求）。

simple 破甲页**不得出现**：9 模型矩阵、3 层选择、12 技术 chips、技术库、角色、输出要求、采样建议、零宽样本、编码变体开关、命中率表格、二进制破甲表单（`renderBinarySection`）。

### 2.4 simple 其它三页

- **装备**：状态卡「当前已装备 N 件」+ 列表（名称 + 一句用途 + 「卸下」）+ 主按钮「一键装备推荐组合」（内部走 `POST /api/equipment {preset:'redteam', agents:['default'], permissions:'read-only'}`，或沿用现有默认组合）+ 结果「已装备 N 件：…」。不显示路径/插件文件/版本/依赖。
- **记忆**：搜索框 + 「搜索」；结果列表标题+摘要+时间，可点开；顶部连接状态「记忆服务已连接」/「记忆服务未连接 · 去设置」。不显示 memoryBase/token/kind/同步模式/分发对象。
- **设置**：只要 5 项 —— 连接状态 +「测试连接」、语言（简体中文）、「切换到技术模式」（说明：显示全部参数与路径）、「重新签署协议」、版本与关于（折叠）。不显示 memoryBase/memoryToken/breakDir/pluginPath/dataDir。

### 2.5 technical 模式（零删减 + 5 组折叠）

六页导航恢复，每页内容按固定顺序分组为可折叠块（`<details>` 或等价），默认只展开「基础」，折叠状态记 `localStorage['ap.groups']`：

| 分组 | 放什么 |
|---|---|
| 基础 | 模型选择、目标/任务输入、主操作按钮 |
| 生成策略 | 层、技术 chips、技术库说明、角色、输出要求、编码变体 |
| 采样 | 采样建议、temperature/top_p、重试、零宽样本 |
| 路径与文件 | breakDir、pluginPath、dataDir、目标文件路径（标「高级」徽标） |
| 诊断 | 命中率/尝试记录、原始请求与响应、错误详情、日志入口 |

- 每个字段：标签 + 一行说明 + 默认值徽标 + 「恢复默认」。
- 技术模式破甲页保留：9 模型矩阵、3 层、12 技术 chips + 技术库说明、角色、输出要求、采样建议、零宽样本、编码变体、尝试记录与命中率、二进制破甲（`renderBinarySection` 全部子块）。
- 首次进入技术模式弹一次轻提示（`localStorage['ap.techHint']` 记住，可关闭）：「技术模式会显示全部参数和文件路径。改错可能影响运行，可以随时点『恢复默认』。」

### 2.6 文案硬规则（simple 模式 DOM 文本）

禁止出现：`breakDir`、`pluginPath`、`wasm`、`token`、`memoryBase`、`payload`、`variant`、`layer`、`technique`、`schema`、`API`、`HTTP`、`403`、`400`、`500`。
错误提示结构 = 发生了什么（人话）+ 下一步做什么（一个动作）。
✅「没连上记忆服务。检查服务是否启动，或点『测试连接』重试。」 ❌「请求 /api/memory/stats 失败：ECONNREFUSED」

---

## 3. 验收（16 条，`test/ux2layer.mjs` 一键跑）

| # | 判定 | 由谁自动断言 |
|---|---|---|
| 1 | 签署后落在 simple 破甲页，无设置向导 | DOM `#page` 含「一键生成」，导航 4 项 |
| 2 | simple 导航 4 项且无「记忆分发」「关于」 | DOM 导航文本 |
| 3 | simple 破甲页首屏可交互元素 ≤ 8 | DOM 计数（模型卡3+输入1+主按钮1+开关1，其余不计） |
| 4 | simple 破甲页 DOM 文本无 §2.6 禁用词 | 正则扫描 `#page` 文本 |
| 5 | 只选模型+写任务+点「一键生成」→ ≥1 载荷 | CDP 点击后扫结果卡 |
| 6 | 空任务点生成 → 人话提示，无载荷、无 5xx | 网络监听 + DOM |
| 7 | 每条载荷「复制」内容与全文一致 | 点复制读剪贴板/内部 store |
| 8 | 「这次成功了/被拒绝了」各记录一次，命中率变化 | `/api/state` attempts 增量 |
| 9 | simple 装备页 1 个主按钮，点后「已装备 N 件」 | DOM |
| 10 | simple 记忆页未连接给「去设置」、已连接能搜出结果 | DOM + `/api/memory/cards` |
| 11 | simple 设置页无任何路径/令牌字段 | DOM 扫描 |
| 12 | 切换到 technical ≤ 1 次点击，六页可达且原功能可用 | DOM 导航 + 逐页渲染无 `__apErrors` |
| 13 | 切回 simple 仍 4 项、不残留技术字段 | DOM |
| 14 | 刷新后模式保持 | reload 后读导航项数 |
| 15 | 1280 / 390 / 320 无横向溢出，`window.__apErrors === 0` | CDP `scrollWidth<=innerWidth` |
| 16 | `node test/acceptance.mjs` 21/21、`node _ui-test/ac-check.mjs` 全 PASS | 两条命令退出码 |

服务端可判定的部分（readiness 形状、uiMode 持久化与 400、协议门 403）也在 `test/ux2layer.mjs` 里，不依赖浏览器先跑一遍。

---

## 4. 文件归属

| 谁 | 改 | 不许碰 |
|---|---|---|
| 后端子任务 | `web/server.mjs`、`_ui-test/ac-check.mjs`（改为相对路径）、`test/ux2layer.mjs` 的服务端部分 | `web/public/**`、`break/**`、`gear/**` |
| 前端子任务 | `web/public/index.html`、`style.css`、`app.js` | `web/server.mjs`、`break/**`、`test/**`、`gear/**` |
| Lead | `docs/**`、`README.md`、`CHANGELOG.md`、`test/ux2layer-ui.mjs`、截图、重启 8792、commit | — |

不 push。
