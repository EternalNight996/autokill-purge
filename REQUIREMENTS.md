# autokill-purge · 需求清单（交接版 v1.0）

> 给接手开发的完整说明。**照着做能验收，不用来问背景。**
> 作者：EternalNight996（YG） · 写于 2026-11-15 · 仓库：`F:\MyApp\eternal\autokill-purge`
> 参考实现：`F:\MyApp\eternal\pure-console`（破甲台原型，可复用 UI 与交互，见 §1.4）

---

## 0. 一句话、目标、非目标

**一句话**：AutoKill 负责「看」，purge 负责「动手」——在**副本**上做二进制与模型两边的破甲动作，每一步都给证据、能回滚，并把能力装到具体智能体上、把知识实时分给它们。

| | 内容 |
|---|---|
| 目标 | ① 一套**不猜**的破甲内核（PE 结构 → 许可字符串 → 引用点 → 字节提案 → 下刀 → 逐字节验证 → 一键还原）；② 一个**六页控制台**（破甲 / 装备 / 记忆分发 / 记忆中心 / 设置 / 关于）；③ 一个 **AutoKill 插件**（4 个纯函数工具）；④ 与 memory-eternal 的**实时分发**与**审核式写卡** |
| 非目标 | 不改 AutoKill 的净室语义；不写对话层/不编排 agent 阶段；不实现 shellcode、免杀、签名伪造、密钥提取；不做联网云端 SaaS；不绕过任何远端策略 |

---

## 1. 现状盘点（先看这里，别重写已成的）

### 1.1 已有且可复用

| 模块 | 路径 | 现状 | 处理 |
|---|---|---|---|
| break CLI | `break/break.mjs`（9.3 KB）+ `break/pe.mjs`（3.1 KB） | 7 条命令，JSON 输出，实测 38 MB PE 通过（见下） | **保留逻辑，重构输出与错误码**（见 FR-8） |
| 装备插件 | `gear/autokill-purge-plugin/`（Rust + WIT，13.4 KB lib.rs） | 4 个纯函数工具，已能编译加载 | 保留，补测试与版本号（见 FR-9） |
| web 服务 | `web/server.mjs`（16.5 KB）+ `web/public/`（11.9 KB） | 记忆服务解析（cloud/env/config/守护端口发现）、`/lookup` 四态、写卡守卫、`~/.autokill-purge/config.json`、`writes.log` | **保留解析与守卫逻辑**，UI 换成六页（见 §7） |
| 清单 | `web/catalog.json` | 6 条装备清单，绑定 memory-eternal 查询词 | 保留并扩到 20+ 条（FR-10） |
| 文档 | `break/README.md`、`break/WORKFLOW.md`、`gear/README.md`、`docs/*` | 工作流、装车、记忆需求 | 作为输入，不再新增平行文档 |

**实测基线（38 MB 真实 PE，`_smoke/sample.exe`）**
```
info    x86-64 · imageBase 0x140000000 · .text 31.5 MB · 熵 6.219 · 无 CLR
scan    200 条字符串命中，其中 1 条被代码引用 19 次
patch   0xA5638: 488D1509AED701 -> 90909090909090
verify  differingBytes 7，逐字节 48->90、8D->90 …
restore 还原后 sha256 与原文件一致
```

### 1.2 参考实现（可直接抄交互，不要抄语言混搭）

`F:\MyApp\eternal\pure-console`（Python stdlib + 原生 JS，32 KB JS / 26 KB server）：
- 六页导航 + 首启协议弹窗 + 服务端 403 强制；
- 破甲页：9 模型 × 3 层 × 12 技术 → 生成载荷变体（含 base64/ROT13/分片）→ 采样建议 → 尝试记录与命中率；
- 装备页：6 预设 × 3 智能体 × 3 权限档 → 可复制配置；
- 记忆分发：选卡 → `GET /api/assign/<agent>.md` 实时合并；
- 记忆中心：真实接 `http://127.0.0.1:7999/memory-eternal/api`（实测 9585 张卡）；
- 设置 / 关于。

**可直接复用**：页面结构、文案、API 形状、`state.json` 结构、协议门实现。
**不要复用**：Python 与 Node 两套后端并存（技术栈二选一，见 §10-Q1）。

### 1.3 必须补的缺口（本次开发的主要工作量）

1. Web 里**没有任何二进制破甲能力**——break 只在终端；FR-3 要求把 break 接到 Web（选文件、跑 info/scan/plan/patch/verify/restore、看逐字节 diff）。
2. break 只做 PE，**ELF/Mach-O/APK 一律没有**；先保 PE 达标，其余按 §10-Q5 排期。
3. break 没有**作业记录**：每次下刀前后的 sha256、字节区间、verify 结果没有落盘journal。
4. 插件 4 工具**没有测试**，也没有与 AutoKill 版本绑定的兼容检查。
5. 记忆写卡**没有走审核队列**的可验证路径（只有写守卫），需要 `/write` → pending → 审核中心可见的闭环。
6. 无一键**安装/启动/自检**脚本（现在要手敲三条命令）。
7. 无**负向测试**（越界、非 PE、已改文件、权限不足、协议未签署）。

### 1.4 代码量参考

现有可复用约 40 KB；预计新增 6–8 KB/页（六页）+ 3 KB break 作业记录 + 2 KB 测试脚手架 ≈ **35–50 KB 净新增**。

---

## 2. 用户与场景

| 角色 | 场景 | 期望 |
|---|---|---|
| **YG（本人）** | 拿一个自有/授权的程序，想知道许可判定在哪、能不能在不破坏文件的情况下验证行为 | 一条龙：看结构 → 找引用 → 提案 → 下刀 → 证明 → 还原 |
| **红队操作者** | 把「破甲」这套能力装到 dsh / mengbot / autokill 上，并让它们带着记忆库里对应的知识与技能干活 | 装备可复制、记忆实时下发、权限档清楚 |
| **模型红队研究者** | 针对不同模型选技术做提示/协议层研究，记录成功率 | 模型目录、技术库、载荷生成、命中率 |

---

## 3. 产品形态（四件套，缺一不算交付）

```text
autokill-purge/
├─ break/        破甲内核 CLI（PE 结构 / 许可引用 / 提案 / 下刀 / 验证 / 还原 + 作业 journal）
├─ gear/         AutoKill WASM 插件（4 个纯函数工具）
├─ web/          控制台（六页 + 协议门 + break 作业面板 + 记忆分发）
└─ docs/         本文件 + 工作流 + 接口契约
```

**分工铁律**：AutoKill 只看不改；改字节只发生在 `break`，且只改副本；Web 只是编排与呈现，自己不写字节。

---

## 4. 功能需求

> 每条都有编号，验收标准（AC）可脚本化。**AC 未写到的行为不要求实现。**

### FR-1 协议门（首启签署）

| 项 | 要求 |
|---|---|
| 触发 | 首次打开（或重置后），弹窗遮罩，页面不可交互 |
| 内容 | 仅限本人拥有/书面授权的系统与模型；禁止未授权入侵、破解、窃取、破坏；使用者自负后果；发现非法用途即停支持、留证移交 |
| 交互 | 必须勾选复选框，「签署并进入」才可点；可填签署人（可选） |
| 落库 | `state.json.agreement = {accepted, version, at, signer}`；版本号随文案变化 +1 |
| 服务端 | **未签署时除 `/`、静态资源、`/api/ping`、`/api/agreement` 外一律 403**，返回 `{ok:false,error:"agreement"}` |
| 重签 | 设置页可「重新签署协议」→ 清空并重新弹窗 |

**AC-1.1** 未签署：`GET /api/memory/stats` → 403。**AC-1.2** 签署后同请求 → 200。**AC-1.3** 不勾选时按钮 `disabled`。**AC-1.4** 重签后可再次弹窗。

### FR-2 控制台 · 破甲页（模型选择性破甲，导航第一位）

| 项 | 要求 |
|---|---|
| 模型目录 | ≥ 9 类：GPT-4o/4.1、o3/o4-mini、Claude 3.5/3.7、Gemini 2.5、DeepSeek V3/R1、Qwen3、Llama 3.3 自托管、本地（Ollama/vLLM）、自定义；每类一行「拒绝风格说明」 |
| 突破层 | 提示层 / 参数层 / 协议层（可多选技术，层决定生成策略） |
| 技术库 | ≥ 12 种：角色框定、拒绝抑制、前缀注入、编码绕行、多轮拆分、上下文覆盖、格式约束、元提示递归、语言切换、载荷分片、少样本引导、采样重试；每种带 `desc`、适用模型、模板 |
| 生成 | 输入：模型 + 层 + 技术集合 + 任务 + 角色 + 输出要求；输出：≥1 条载荷/技术，含 base64 变体与 ROT13 变体，附**该模型的采样建议**（temperature/top_p/重试策略）与零宽变体样本 |
| 记录 | 每次尝试记 `{model, technique, result∈{pass,partial,refused}, note, at}`；统计总次数、通过率、按模型、按技术的命中 |
| 边界 | 不调用任何模型 API；不保存被测模型的输出原文（只存你自己写的备注） |

**AC-2.1** 选 3 技术 + 填任务 → 至少 3 条载荷，含 1 条编码变体。**AC-2.2** 空任务点生成 → 明确提示，不产生载荷。**AC-2.3** 保存 1 条「通过」后，命中率从 0% 变 100%。**AC-2.4** 切换模型后「当前模型说明」随之变化。

### FR-3 控制台 · 破甲页（二进制侧，接 break 内核）

> **这是现有 Web 最缺的一块。** 一页两栏：左边选文件与动作，右边结果与证据。

| 动作 | 输入 | 输出 | 对应 break 命令 |
|---|---|---|---|
| 定性 | 文件路径 | 格式、架构、节表（名/大小/熵）、加壳信号、imageBase | `break info` |
| 找入口 | 文件 + 关键词（默认许可类词表） | 命中字符串 + 每个的代码引用点（x64 RIP 相对），标出引用次数 | `break scan` |
| 提案 | 文件 + 选定字符串/引用点 | 候选列表：offset + 期望字节 + 建议写入 + 理由 + 信心 | `break plan` |
| 下刀 | offset + `--expect` + 写入字节或 `--nop N` | 写入结果 + 前后 sha256 + 写入区间 | `break patch` |
| 翻转 | offset（条件跳转） | 原始字节 → 翻转后字节 + 语义（jz↔jnz） | `break invert` |
| 验证 | 原文件 + 现文件 | sha256 两枚 + 逐字节差异表（offset/before/after） | `break verify` |
| 还原 | 文件 | 恢复 .bak 后 sha256 与原值一致 | `break restore` |

**硬性交互要求**
- 下刀前必须展示 `--expect` 实际读到的字节；不匹配**直接拒绝写入**并显示 `found <HEX> - nothing written`。
- 每次下刀写入前服务端自动做 `.bak`（若不存在），并把作业记入 journal（见 5.4）。
- 结果区固定显示：文件 sha256（前/后）、differingBytes、写入/还原按钮。
- **禁止**在 Web 上提供「任意偏移无校验写入」的入口（必须有 expect 或 invert 二选一）。

**AC-3.1** 对 `_smoke/sample.exe` 跑 info，返回 7 个以上节与熵值。**AC-3.2** scan 默认词表命中 ≥ 1 条带引用点的字符串。**AC-3.3** 故意传错 expect → 返回 409 + 文件 sha 不变。**AC-3.4** patch 成功后 verify 的 differingBytes 等于写入长度。**AC-3.5** restore 后 sha 与原始一致。**AC-3.6** 对 `.txt` 跑 info → 400 并说明「不是可识别的可执行文件」。

### FR-4 控制台 · 装备页

| 项 | 要求 |
|---|---|
| 装备包 | ≥ 6：红队全装、侦察刀、内网横向、无线电/IoT、逆向研究、自定义 |
| 目标智能体 | `dsh`（DeepSeek Harness）、`mengbot`、`autokill`、自定义（输入名字） |
| 权限档 | 只读 / 受控 / 全权，每档一句后果说明 |
| 产出 | 可复制的配置 JSON（含 `preset, agents[], permissions, memory_endpoint, notes`） |
| 记录 | 发放历史（时间、包、智能体、权限、备注），可复制单条 |

**AC-4.1** 未选智能体点发放 → 拒绝并提示。**AC-4.2** 发放后历史出现一条，复制内容与预览一致。

### FR-5 控制台 · 记忆分发（实时）

| 项 | 要求 |
|---|---|
| 选智能体 | dsh / mengbot / autokill / 自定义 |
| 选卡 | 从 memory-eternal 搜索（q + kind 过滤），多选 |
| 定制模式 | `只发技能卡`（kind=skill）、`实时同步`（每次请求重新合并，不缓存） |
| 实时端点 | `GET /api/assign/<agent>.md` → Markdown：标题、生成时间、每张卡的小节与全文；未选则明确「尚未选择」 |
| 接入片段 | 页面给出 `curl` 与 DSH 追加片段（`>> ~/.dsh/AGENTS.md`） |

**AC-5.1** 勾 2 张卡保存后，端点返回 2 个小节。**AC-5.2** 再勾 1 张保存，同一端点立即返回 3 个（无需重启）。**AC-5.3** 打开「只发技能卡」后，非 skill 卡被过滤并在页面提示过滤了多少。**AC-5.4** 记忆服务不可达时，端点返回「服务不可用」而不是 500。

### FR-6 控制台 · 记忆中心（内嵌）

| 项 | 要求 |
|---|---|
| 统计 | 总数、今日新增、按 kind 分布（来自 `/stats`） |
| 检索 | 关键词 + kind 过滤；空结果有空态文案 |
| 详情 | 点开显示卡片路径、状态、正文（YAML 头 + Markdown），可复制 |
| 写卡 | **只走审核**：提交后为 pending，页面明示「已进审核中心，待批准」；服务端不调用 approve/reject |
| 云端切换 | 支持把 base 切到云端（配置项），并在页头显示当前来源（local/cloud/env） |

**AC-6.1** 统计数字与服务端 `/stats` 一致。**AC-6.2** 搜索 `技能` 有结果且可打开。**AC-6.3** 写卡后返回 `status: pending`，且审核接口未被调用（日志可证）。

### FR-7 控制台 · 设置 / 关于

| 页 | 要求 |
|---|---|
| 设置 | 记忆中心地址、令牌（password 输入，留空保持不变）、连接测试、AutoKill 插件路径、break 工作目录、语言、协议重签、数据文件位置、版本与端口 |
| 关于 | 项目名、版本、作者 EternalNight996（YG）、许可 MIT、能力清单、声明 |

**AC-7.1** 改地址后「测试连接」给出成功/失败与原因。**AC-7.2** 令牌保存后不在页面上回显明文。

### FR-8 break CLI 强化（不改变已有语义）

| 项 | 要求 |
|---|---|
| 命令 | `info / scan / plan / patch / invert / verify / restore` 保持；新增 `journal`（列作业）与 `--json`（已默认） |
| 输出 | 全部 JSON：`{ok, command, file, ...}`；错误 `{ok:false, error:{code,message,hint}}` |
| 退出码 | `0` 成功；`2` 参数错；`3` expect 不匹配；`4` 非目标格式；`5` 文件被占用/权限 |
| 作业记录 | 每次 patch/invert/restore 追加 `<file>.purge/journal.jsonl`：`{at, command, offset, before, after, sha_before, sha_after, expect, argv}` |
| 备份 | 首次写前 `<file>.bak`；`restore` 校验 `.bak` 的 sha 与 journal 首条 `sha_before` 一致再还原 |
| 边界 | 只支持 PE 时，其他格式返回 code 4 并写明「当前只支持 PE」 |

**AC-8.1** `break patch --expect` 错误 → 退出码 3 且文件 sha 不变。**AC-8.2** 成功下刀后 `journal` 有一条完整记录。**AC-8.3** 手工改坏 `.bak` 后 restore → 拒绝并说明。**AC-8.4** 非 PE → 退出码 4。

### FR-9 装备插件（WASM）

| 项 | 要求 |
|---|---|
| 工具 | `scan_packer_markers`、`rank_check_candidates`、`plan_unpack`、`audit_claims`（名字进 AutoKill 后带 `purge_` 前缀） |
| 契约 | 不导入文件/网络/环境/时钟（AutoKill 插件契约）；纯文本进、JSON 出 |
| 语义 | 不匹配就明说不匹配；结论必须分「有证据/待办」；每步工具都写「通过条件」 |
| 版本 | 组件 WIT 版本与 AutoKill 插件 API 对齐（`autokill:plugin@0.1.x`） |
| 自检 | `plugins_list` → `kind:"wasm"`、`problem` 为空；`plugins_refresh` 列出 4 工具 |

**AC-9.1** 喂含 `UPX!` 的字符串列表 → 命中并给行号。**AC-9.2** 喂无关文本 → 返回「未命中」且不给推荐。**AC-9.3** `audit_claims` 对无证据结论返回待办列表。**AC-9.4** 未启用 `--features wasm-plugins` 时 AutoKill 只记日志不报错。

### FR-10 清单与记忆同步

| 项 | 要求 |
|---|---|
| 清单 | `catalog.json` ≥ 20 条：4 工具 + 1 技能卡 + 装车流程 + break 7 命令 + 协议门 + 分发端点 + 6 页面 |
| 状态 | 每条用 `query` 命中 memory-eternal，映射四态：`present / pending / missing / stale` |
| 缺失 | 缺失项进「待提交」区，可一键生成写卡草稿（**pending**，不进审核自动通过） |
| 刷新 | 页面手动刷新 + 启动时一次；显示上次刷新时间 |

**AC-10.1** 20 条清单逐条有四态之一。**AC-10.2** 缺失项生成的草稿在 pending 状态。**AC-10.3** 断网时显示「记忆服务不可用」而不是空白。

---

## 5. 接口契约（照抄，别自创）

### 5.1 break CLI

> 现状已实现：`info / scan(--keywords,--min-len) / plan(file) / patch(--at,--expect,--write,--nop) / invert / verify / restore`。
> **本次新增**：`scan --min-xrefs`、`plan --string`、`journal`、统一退出码与错误对象（下述契约为交付目标态）。

```text
break info   <file>                                   -> {ok, file, sha256, format, machine, imageBase, sections[{name,size,entropy,executable}], packerHints[]}
break scan   <file> [--keywords a,b] [--min-xrefs N]   -> {ok, hits:[{string, offset, xrefs:[{rva, fileOffset, instruction}]}]}
break plan   <file> [--string S]                       -> {ok, candidates:[{offset, expect, suggest, reason, confidence}]}
break patch  <file> --at 0xOFF (--expect HEX) (--write HEX | --nop N)
                                                       -> {ok, offset, before, after, shaBefore, shaAfter}
break invert <file> --at 0xOFF                         -> {ok, offset, before, after, from, to}
break verify <before> <after>                          -> {ok, shaBefore, shaAfter, differingBytes, diffs:[{offset,before,after}]}
break restore <file>                                   -> {ok, restoredFrom, sha}
break journal <file>                                   -> {ok, entries:[...]}
```

### 5.2 插件工具签名（WIT 摘要）

```wit
// 4 个导出，均为 (input: string) -> string(JSON)
scan_packer_markers(input)   // {texts:[...], sections:[...]} -> {matched:bool, hits:[{line,text,marker,confidence}]}
rank_check_candidates(input) // {strings:[...], xrefs:{...}}   -> {ranked:[{target,score,reasons[],missing[]}]}
plan_unpack(input)           // {format, packer}               -> {steps:[{tool,why,passCondition,needsProcess}]}
audit_claims(input)          // {claims:[{text,evidence[]}]}    -> {accepted[],todo[],rejected[]}
```

### 5.3 Web HTTP API

```text
GET  /                      控制台（未签署也可见，仅弹窗）
GET  /api/ping              {ok,version}
GET  /api/state             {ok,state,version,models[],layers[],techniques[],agreementVersion}
POST /api/agreement         {accepted,signer} -> {ok,agreement}
POST /api/agreement/reset   （已签署时）
POST /api/settings          {memoryBase,memoryToken?,language} -> {ok,settings}
GET  /api/memory/stats      {ok,stats} | {ok:false,error}
GET  /api/memory/cards?q=&kind=&limit=  {ok,cards[]}
GET  /api/memory/card?path= {ok,card:{path,status,text}}
GET  /api/memory/lookup?q=  四态
POST /api/memory/claim      {title,kind,tags,body} -> {ok,status:"pending"}
GET  /api/assign            {ok,assignments,equipment}
POST /api/assign            {agent,cards[],mode:{skillsOnly,autoSync}}
GET  /api/assign/<agent>.md  Markdown 实时合并
POST /api/breach/build      {model,layer,techniques[],task,role,output} -> {ok,result:{variants[],advice[],zero_wide_sample}}
POST /api/breach/attempt    {model,technique,result,note} -> {ok,attempt,stats}
POST /api/equipment         {preset,agents[],permissions,notes} -> {ok,equipment}
POST /api/break/run         {command,file,args} -> break 的 JSON（服务端调用 break CLI，只允许白名单命令）
```

### 5.4 数据文件

```jsonc
// data/state.json（version 1；原子写：临时文件 + rename）
{
  "version": 1,
  "agreement": {"accepted": true, "version": "1", "at": "ISO8601", "signer": "..."},
  "settings": {"memoryBase": "http://127.0.0.1:7999/memory-eternal/api", "memoryToken": "", "language": "zh",
               "breakDir": "F:\\...\\autokill-purge\\break", "pluginPath": "F:\\...\\purge.wasm"},
  "equipment": [{"id":"e1","preset":"redteam","agents":["dsh"],"permissions":"read-only","notes":"","at":"ISO8601"}],
  "assignments": {"dsh": {"cards":["path/to/card.md"], "mode":{"skillsOnly":false,"autoSync":true}, "at":"ISO8601"}},
  "attempts": [{"id":"a1","model":"gpt-4o","technique":"persona","result":"pass","note":"","at":"ISO8601"}]
}
```

```text
<file>.purge/journal.jsonl   一行一条作业：{at, command, offset, before, after, sha_before, sha_after, expect, argv}
<file>.bak                   首次写入前的原件副本
```

### 5.5 memory-eternal 契约（实测可用）

```text
GET  {base}/health     {ok, vault, db, db_bytes, ...}
GET  {base}/stats      {ok, total, today, week, byKind{...}}
GET  {base}/cards?q=&kind=&limit=   {ok, cards:[{path,kind,title,tags,summary,status,...}]}
GET  {base}/card?path= {ok, path, status, text}
POST {base}/write      -> 落库为 pending（**不得调用 approve/reject**）
```

---

## 6. 非功能需求

| 类别 | 要求 | 验收方式 |
|---|---|---|
| 原件安全 | 原件永不原地改；首次写前 `.bak`；`restore` 后 sha 与原始一致 | AC-3.5 / AC-8.3 |
| 写入前置 | 必须有 `--expect` 或 `invert`；不匹配不写 | AC-3.3 |
| 证据 | 每次动作返回 sha 前后、偏移、字节；journal 可回放 | AC-8.2 |
| 离线 | 默认只连本机 memory-eternal；云端需显式开启 | AC-6.3/AC-10.3 |
| 性能 | 38 MB PE：info ≤ 2s、scan ≤ 5s、patch ≤ 1s、verify ≤ 3s | 脚本计时 |
| 平台 | Windows 10/11 主目标；macOS/Linux 需能运行（路径/argv 转义正确） | CI 或脚本 |
| 可靠性 | state/journal 原子写；写入中断不留半文件 | 断电模拟（杀进程后复查） |
| 可观测 | 所有错误 `{code,message,hint}`；Web 显示原始命令与原始输出 | 抽检 |
| 可测 | 每条 AC 对应一个可执行用例（bash/node/python 任选，统一一种） | 测试脚本 |

---

## 7. UI 规格

- **导航**：顶部一条，顺序固定：**破甲 / 装备 / 记忆分发 / 记忆中心 / 设置 / 关于**；破甲默认打开。
- **风格**：深色、单强调色（建议 `#6EA8FF`）、卡片式、圆角 12px；正文 14.5px / 行高 1.65；不堆仪表盘。
- **信息层级**：每页 h1 + 一句 `lead` + 编号小节（1·2·3…）；动作按钮在输入下方靠左。
- **空态**：每页都有（例：破甲未生成 → 「选择模型、层与技术，然后点生成」）。
- **错误态**：红色内联条 + `hint` 下一步，不用弹窗打断。
- **协议门**：居中卡片，正文可滚动，勾选后才能签署；未签署页面其余部分不可点。
- **移动端**：≤ 720px 单列；导航可换行；表格横向滚动。
- **可访问性**：所有按钮可键盘聚焦；颜色不作为唯一状态提示（badge 带文字）。

---

## 8. 测试矩阵（必须交付这些用例）

**正向（≥ 18）**：info/scan/plan/patch/invert/verify/restore 各 1；协议签署 → 记忆可读；破甲生成 3 技术；记录→命中率；装备发放；分配 2 卡→端点 2 节；再加 1 卡→3 节；只发技能卡过滤；记忆搜索→打开卡片；设置测试连接；插件 4 工具各 1。

**负向（≥ 15）**：expect 不匹配（退出 3、sha 不变）；offset 越界；非 PE（退出 4）；文件只读；.bak 缺失/损坏；未签署访问 API（403）；空任务生成；未选智能体发放；记忆服务不可达（端点 503 语义）；令牌错误；路径含空格/中文；并发两次分配；重复 restore；插件未启用 wasm；state.json 损坏后自愈。

**回归（≥ 5）**：38 MB 样例全流程；restore 后 sha 一致；协议重签；状态文件 BOM；Windows 路径。

**验收命令示例**
```console
node break/break.mjs info _smoke/sample.exe
node break/break.mjs scan _smoke/sample.exe --min-xrefs 1
node break/break.mjs patch _smoke/sample.exe --at 0xA5638 --expect 488D1509AED701 --nop 7
node break/break.mjs verify _smoke/sample.exe.bak _smoke/sample.exe
node break/break.mjs restore _smoke/sample.exe
curl -s http://127.0.0.1:8792/api/ping
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8792/api/memory/stats   # 期望 403（未签署）
```

---

## 9. 交付物与里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 内核可用**（3–4 天） | break 7+1 命令、JSON 契约、退出码、journal、.bak 校验；38 MB 样例全流程；负向用例 10 条 | §8 正向 1–7 + 负向核心用例全绿 |
| **M2 控制台六页**（5–7 天） | 六页 UI + 协议门 + 破甲两栏（模型侧 + 二进制侧接 break）+ 装备 + 记忆中心读 | 手工走查 §7，AC-1/2/3/4/6/7 全绿 |
| **M3 打通与装车**（3–4 天） | 记忆分发实时端点、装备配置、清单四态、写卡 pending 闭环、插件 4 工具自检、安装脚本 | AC-5/9/10 全绿 + 一键安装后 `plugins_list` 无 problem |

**交付清单**：源码（四件套）、`docs/REQUIREMENTS.md`（本文件核对版）、`docs/API.md`、测试脚本 + 运行记录、样例与截图、安装/升级说明、`CHANGELOG`。

---

## 10. 未决问题（由 YG 拍板，开发不要自行决定）

| # | 问题 | 选项 | 影响 |
|---|---|---|---|
| Q1 | 技术栈 | (a) 全 Node（复用 `web/server.mjs`）(b) 全 Python（复用 `pure-console`）(c) Rust 全栈 | 决定可复用代码与打包方式 |
| Q2 | 是否把 `pure-console`（破甲台原型）并进来 | 并入 = 省 3 天 UI；不并 = 重写但可控 | 交付时间 |
| Q3 | break 是否从 Node 迁到 Rust | 迁 = 单二进制、易分发；不迁 = 最快 | 2–3 天差 |
| Q4 | 是否支持 ELF / Mach-O / APK | 先 PE，其余按需 | M1 范围 |
| Q5 | 云端记忆是否必需 | 本地优先 / 云端双写 | 安全面与配置复杂度 |
| Q6 | 破甲页是否保留「12 技术」全量 | 全量 / 精简 8 条 | 页面密度 |

**默认建议**（未拍板时按此做）：Q1 全 Node、Q2 并入但重写样式、Q3 不迁、Q4 先 PE、Q5 本地优先、Q6 全量。

---

## 11. 交接材料

| 材料 | 路径 |
|---|---|
| 破甲内核 | `break/break.mjs`、`break/pe.mjs`、`break/WORKFLOW.md` |
| 装备插件 | `gear/autokill-purge-plugin/`（`src/lib.rs`、`wit/plugin.wit`、`gear/README.md`） |
| Web 服务与 UI | `web/server.mjs`、`web/catalog.json`、`web/public/` |
| 参考实现（六页原型） | `F:\MyApp\eternal\pure-console`（`server.py`、`static/`、`README.md`） |
| 样例 | `_smoke/sample.exe`（38 MB，配套 `.bak`） |
| 记忆服务 | `http://127.0.0.1:7999/memory-eternal/api`（本机实测 9585 卡） |
| 既有文档 | `docs/memory-eternal-requirements.md`、`docs/...detail.md`、`SKILL.md` |

---

## 12. 附：最小验收脚本（拿去改）

```bash
#!/usr/bin/env bash
set -e
PORT=${PORT:-8792}
B=http://127.0.0.1:$PORT
S=_smoke/sample.exe

echo "== break 内核 =="
node break/break.mjs info "$S" | jq -e '.ok and (.sections|length>6)'
node break/break.mjs scan "$S" --min-xrefs 1 | jq -e '.ok and (.hits|length>0)'
node break/break.mjs patch "$S" --at 0xA5638 --expect 488D1509AED701 --nop 7 | jq -e '.ok'
node break/break.mjs verify "$S.bak" "$S" | jq -e '.ok and .differingBytes==7'
node break/break.mjs restore "$S" | jq -e '.ok'
echo "== 协议门 =="
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/memory/stats)" = "403" ]
curl -s -X POST $B/api/agreement -H 'content-type: application/json' -d '{"accepted":true,"signer":"qa"}' | jq -e '.ok'
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/memory/stats)" = "200" ]
echo "== 破甲 =="
curl -s -X POST $B/api/breach/build -H 'content-type: application/json' \
  -d '{"model":"gpt-4o","layer":"prompt","techniques":["persona","encoding"],"task":"授权靶场的弱口令验证步骤"}' \
  | jq -e '.ok and (.result.variants|length>=2)'
echo "== 分发实时性 =="
curl -s -X POST $B/api/assign -H 'content-type: application/json' \
  -d '{"agent":"dsh","cards":["A.md"],"mode":{"skillsOnly":false,"autoSync":true}}' >/dev/null
curl -s $B/api/assign/dsh.md | grep -q 'A.md'
echo "ALL PASS"
```
