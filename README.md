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

- **破甲**：状态卡（能不能用一句话说清）+ 三步步骤条（① 选模型 → ② 写一句 → ③ 拿载荷）+ 3 个推荐模型 + 一句话输入 + 三个选择项 + 整宽主按钮「一键生成」。生成后每条载荷可复制、可标「这次成功了 / 被拒绝了」。
  - 选择项一：**破甲模板** —— 默认「小码酱 · dsh-purge 1.1.71」（整段照搬，21K 字符），也可选「不套模板（纯指令）」。
  - 选择项二：**任务类型** —— 自己写 / 内容边界说明 / 角色扮演 / 格式强约束 / 多步拆解 / 越狱复现研究（选中即写入输入框，可再改）。
  - 选择项三：**输出要求** —— 直接给结果 / 分步编号 / JSON / 表格 / 简洁一段。
  - 套了模板时：文本载荷 = 模板 + `---` + 本次任务 + 输出要求（一段可直接粘给模型）；Base64 / ROT13 变体只编码任务句，避免几十 KB 的无用载荷。
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

## 模型目录与破甲模板

模型目录按 2026-11 的公开版本维护，共 **24 个**（国内 18 / 国外 6），普通模式推荐位固定在
**DeepSeek V4.1 Flash**、**通义千问 Qwen3.5-Max**、**月之暗面 Kimi K2.5**。

国内全覆盖：

| 厂商 | 目录里的条目 |
| --- | --- |
| DeepSeek | V4.1 Flash（`deepseek-flash`，V4.1-Flash-1017，多模态 / 1M 上下文 / thinking 三档）、V4 Pro（`deepseek-v4-pro`） |
| 阿里云 | Qwen3.5-Max、Qwen3-Max、Qwen3-Coder |
| 智谱 AI | GLM-5、GLM-4.6 |
| 月之暗面 | Kimi K2.5、Kimi K2 |
| 字节跳动 | 豆包 Doubao 2.0 |
| 百度 | 文心 ERNIE 5.0 |
| 腾讯 | 混元 TurboS |
| MiniMax | MiniMax M2 |
| 阶跃星辰 | Step-3.5 |
| 科大讯飞 | 星火 4.0 Ultra |
| 零一万物 / 百川 | Yi-Large / Baichuan4 |
| 本机 | Ollama / vLLM |

国外保留 GPT-5.1、o4 / o4-mini、Claude Sonnet 4.5、Gemini 3 Pro、Llama 4，外加「自定义」。
`api` 字段只登记**已核实**的官方调用名（DeepSeek 两个来自官方 changelog），其余以厂商文档为准；
本工具不调用模型 API，模型只决定模板措辞与采样建议。

破甲模板：`web/prompts/sauce-1171.md` 照搬自 **dsh-purge v1.1.71**（MIT）的内置默认提示词
（面向国模「小码酱」），来源 <https://github.com/YuJunZhiXue/dsh-purge>，按该项目的署名要求标注在文件头。
用户模式的模板下拉目前只列它**真实实现**的两项：`小码酱 · dsh-purge 1.1.71` 与 `不套模板（纯指令）`。

## 宿主破甲与备份/恢复（技术模式）

破甲分两半：**内容**（本仓库的模板）与**改宿主**（dsh-purge 1.1.71 的 83 个补丁）。
改宿主这一半不复制代码，直接驱动本机已安装的 dsh-purge 引擎（`web/host.mjs`）：

| 动作 | 接口 | 说明 |
|---|---|---|
| 读状态 | `GET /api/host/status` | 83 条补丁的 `applied/pending/na`、宿主面、注入文件、快照列表 |
| 备份现在 | `POST /api/host/snapshot` | 把 59 个被补丁文件整份复制到 `data/host-snapshots/<ts>/` + sha256 清单 |
| 撤销上一次 | `POST /api/host/restore {confirm:true}` | 用最近一份快照覆盖；**覆盖前先自动再备份**（guard） |
| 恢复出厂 | `POST /api/host/factory {confirm:true}` | 从官方 `resources/app.asar` 按需提取原件覆盖（本机实测 54 个文件与原件不同） |
| 应用补丁 | `POST /api/host/apply {confirm:true}` | 调它原版 `applyPatchesAllHosts()`；写入前自动备份，返回 `restartRequired` |

三条写接口都必须 `confirm:true`，且每次写入前先存一份 guard 快照——**本次操作本身也可撤销**。
改宿主都要重启 dsh 才生效（我们不自动重启，那会杀掉正在用的会话）。

逐项对照（含 PASS / FAIL / N-G 与原因）：[破甲逐项对照-dsh-purge-1.1.71.md](docs/破甲逐项对照-dsh-purge-1.1.71.md)。
与它的评分对比：[破甲对比与评分.md](docs/破甲对比与评分.md)。

## 验收

```powershell
node test/acceptance.mjs              # 21 条：break 内核 + 协议门 + 破甲 + 分发（需服务在跑）
node test/ux2layer.mjs                # 18 条：双层接口契约（readiness / uiMode 持久化）
node test/ux2layer-ui.mjs             # 16 条：真实 headless Chrome 跑两种模式的 DOM 断言 + 三宽度截图
node _ui-test/ac-check.mjs            # 19 条：真实 server + break 内核 + 本机 memory-eternal 端到端
```

四个脚本都用 `PURGE_WEB_BASE` 指定被测实例（默认 `http://127.0.0.1:8792`），退出码 `0` = 全过。
`test/ux2layer-ui.mjs` 需要本机 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`），零依赖自建 CDP 驱动。

与 [dsh-purge 1.1.71 的对比与评分（10 个维度、三套权重）](docs/破甲对比与评分.md) 见 `docs/`；
此前的 `docs/*.md` 与 `REQUIREMENTS.md` 已按要求删除，恢复方式写在那份文档的「文档清理」一节。
