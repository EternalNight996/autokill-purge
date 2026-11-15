# autokill-purge

AutoKill 的破甲装备：**AutoKill 看，purge 动手**。

| 组成 | 是什么 |
| --- | --- |
| gear/autokill-purge-plugin/ | WASM 组件插件：给 AutoKill 加 4 个纯函数工具（壳识别、候选排序、解包计划、结论审计） |
| break/ | 破甲 CLI：PE 结构、许可字符串与引用点、按字节提案、下刀、逐字节验证、一键还原 |
| web/ | 独立 web 端：两层界面（普通 / 技术）+ 破甲 + 装备 + 记忆，一键切换 |

分工：AutoKill 保持干净（只观察与读结构）；改字节这件事只在 purge 里发生，且只改副本。

工作流见 break/WORKFLOW.md，装车见 gear/README.md。

---

## 跑起来

```powershell
node web/server.mjs            # http://127.0.0.1:8792
# 换端口：$env:PURGE_WEB_PORT=8800; node web/server.mjs
```

零依赖：只要 Node ≥ 22（本机 24.19），不需要 `npm install`、没有构建步骤。
首次打开会要求签署《安全与法律协议》；未签署时除首页、静态资源与 `/api/ping`、`/api/agreement` 外一律 403。

## 两层界面，一键切换

顶栏右侧一个开关，两种模式**同一套后端、同一份数据**，切换不刷新、不丢输入。

### 普通模式（默认，引导式流水线）

给不懂技术的人用：写一句话 → 点一个按钮 → 拿到能复制的载荷。

- **破甲**：状态卡（能不能用一句话说清）+ 三步步骤条（① 选模型 → ② 写一句 → ③ 拿载荷）+ 3 个推荐模型 + 一句话输入 + 整宽主按钮「一键生成」。生成后每条载荷可复制、可标「这次成功了 / 被拒绝了」。
- **装备**：一个主按钮「一键装备推荐组合」，装完显示「已装备 N 件」。
- **记忆**：搜索框 + 结果列表，未连接时给「去设置」。
- **设置**：连接状态 + 测试连接、语言、切到技术模式、重签协议、版本与关于。

普通模式不出现第二层里的任何参数名词（层、技术、采样、路径、令牌、模型矩阵）。

### 技术模式（能力零删减）

同一套页面按 **基础 → 生成策略 → 采样 → 路径与文件 → 诊断** 五组折叠，默认只展开「基础」：

- 9 模型矩阵、3 层、12 技术 chips + 技术库说明、角色 / 输出要求、采样建议、零宽样本、编码变体、尝试记录与命中率；
- 二进制破甲全套：`info / scan / plan / patch / invert / verify / restore / journal`，双栏对比与逐字节 diff；
- 记忆分发、记忆中心、设置里的全部路径与令牌字段（令牌保存后不回显）。

模式来源优先级：服务端 `settings.uiMode` → 浏览器 `localStorage["ap.uiMode"]` → 普通模式。
开关位置两种模式都在，`#/assign`、`#/about` 在普通模式下会落回破甲页。

界面截图见 `docs/shots-ux2/`（1280 / 390 / 320 三个宽度，两种模式）。

## 验收

```powershell
node test/acceptance.mjs              # 21 条：break 内核 + 协议门 + 破甲 + 分发（需服务在跑）
node test/ux2layer.mjs                # 18 条：双层接口契约（readiness / uiMode 持久化）
node test/ux2layer-ui.mjs             # 16 条：真实 headless Chrome 跑两种模式的 DOM 断言 + 三宽度截图
node _ui-test/ac-check.mjs            # 19 条：真实 server + break 内核 + 本机 memory-eternal 端到端
```

四个脚本都用 `PURGE_WEB_BASE` 指定被测实例（默认 `http://127.0.0.1:8792`），退出码 `0` = 全过。
`test/ux2layer-ui.mjs` 需要本机 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`），零依赖自建 CDP 驱动。

接口契约见 `docs/UX-2LAYER-CONTRACT.md`，双层体验规格见 `docs/PRODUCT-UX-2LAYER.md`，
验收清单映射见 `docs/ACCEPTANCE.md`。
