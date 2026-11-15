# autokill-purge · API 契约

> 本文档是 `REQUIREMENTS.md` 第 5 节的**接口契约副本**，交付态（v1.0）目标。实现必须逐字段对齐；本节未列出的接口一律不实现、不自创。
> 唯一契约源：`REQUIREMENTS.md §5`。本文只做展开与字段说明，不新增语义。

---

## 5.1 break CLI

入口：`node break/break.mjs <command> [args]`。所有命令输出 `JSON`（`--json` 默认开启），成功为 `{ok:true, …}`，失败为 `{ok:false, error:{code, message, hint}}`，且**退出码**按 FR-8：

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `2` | 参数错误 |
| `3` | `--expect` 不匹配（未写入） |
| `4` | 非目标格式（当前只支持 PE） |
| `5` | 文件被占用 / 权限不足 |

### 命令

```text
break info   <file>
  -> {ok, file, sha256, format, machine, imageBase,
      sections:[{name, size, entropy, executable}], packerHints:[]}

break scan   <file> [--keywords a,b] [--min-len 6] [--min-xrefs N]
  -> {ok, hits:[{string, offset, xrefs:[{rva, fileOffset, instruction}]}]}

break plan   <file> [--string S]
  -> {ok, candidates:[{offset, expect, suggest, reason, confidence}]}

break patch  <file> --at 0xOFF (--expect HEX) (--write HEX | --nop N)
  -> {ok, offset, before, after, shaBefore, shaAfter}

break invert <file> --at 0xOFF
  -> {ok, offset, before, after, from, to}

break verify <before> <after>
  -> {ok, shaBefore, shaAfter, differingBytes, diffs:[{offset, before, after}]}

break restore <file>
  -> {ok, restoredFrom, sha}

break journal <file>
  -> {ok, entries:[…]}
```

### 字段说明

| 命令 | 关键字段 |
|---|---|
| `info` | `format` 为目标格式（PE 时为 `"pe"`）；`sections[].entropy` 为该节字节熵（0–8）；`sections[].executable` 布尔；`packerHints` 加壳信号数组（可空） |
| `scan` | `hits[].offset` 为字符串的**文件偏移**；`hits[].xrefs[]` 为代码引用点（x64 RIP 相对），`instruction` 为该处字节/反汇编片段；`--min-xrefs N` 过滤掉引用数 < N 的命中 |
| `plan` | `candidates[].offset` + `expect`（期望读到的原字节）+ `suggest`（建议写入）+ `reason` + `confidence` |
| `patch` | 下刀前服务端/CLI 自动做 `<file>.bak`（若不存在）并记 journal；`--expect` 与 `--write`/`--nop` 二选一必填其一 |
| `invert` | 仅认条件跳转；`from`/`to` 为语义（如 `jz`↔`jnz`） |
| `verify` | `differingBytes` = 差异字节数；`diffs` 逐字节 `{offset,before,after}`（大写 HEX 字符串） |
| `restore` | 校验 `<file>.bak` 的 sha256 与 journal 首条 `sha_before` 一致后还原；不一致拒绝 |
| `journal` | 读 `<file>.purge/journal.jsonl`，一条一行 |

### 写入安全线（FR-8 / §6）

1. 原件永不原地改：首次写前 `<file>.bak`；`restore` 后 sha 与原始一致。
2. `--expect` 不匹配 → 退出码 `3`，**不写入**，文件 sha 不变。
3. 非 PE → 退出码 `4`，错误信息写明「当前只支持 PE」。
4. 每次 `patch`/`invert`/`restore` 追加 journal 一行：`{at, command, offset, before, after, sha_before, sha_after, expect, argv}`。

---

## 5.2 插件工具签名（WIT 摘要）

`gear/autokill-purge-plugin/wit/plugin.wit`：`package autokill:plugin@0.1.0`。四个导出均为 `(input: string) -> string(JSON)`；回答 `{"ok": <any>}` 或 `{"error": "…"}`。插件**不导入文件/网络/环境/时钟**（AutoKill 插件契约），每次调用在独立实例、工作与内存限制内执行。

```wit
scan_packer_markers(input)   // {texts:[...], sections:[...]} -> {matched:bool, hits:[{line,text,marker,confidence}]}
rank_check_candidates(input) // {strings:[...], xrefs:{...}}   -> {ranked:[{target,score,reasons[],missing[]}]}
plan_unpack(input)           // {format, packer}               -> {steps:[{tool,why,passCondition,needsProcess}]}
audit_claims(input)          // {claims:[{text,evidence[]}]}    -> {accepted[],todo[],rejected[]}
```

> 装车后工具名带 `purge_` 前缀：`purge_scan_packer_markers` 等。组件 WIT 版本对齐 `autokill:plugin@0.1.x`。
> 注：实现当前字段名为 `found/hits/products/note`（scan）、`ranked/note`（rank）、`steps/note`（plan）、`backed/unbacked/note`（audit），与 §5.2 摘要的字段名存在差异；以 `REQUIREMENTS.md §5.2` 为交付目标，集成时由 Lin 对齐字段名或在此注明差异。

---

## 5.3 Web HTTP API

前缀无；`GET /` 与静态资源不鉴权（未签署时页面可见但仅弹窗）。

```text
GET  /                      控制台（未签署也可见，仅弹窗）
GET  /api/ping              {ok,version}
GET  /api/state             {ok,state,version,models[],layers[],techniques[],agreementVersion}
POST /api/agreement         {accepted,signer} -> {ok,agreement}
POST /api/agreement/reset   （已签署时）
POST /api/settings          {memoryBase,memoryToken?,language} -> {ok,settings}
GET  /api/memory/stats      {ok,stats} | {ok:false,error}
GET  /api/memory/cards?q=&kind=&limit=   {ok,cards[]}
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

### 协议门（FR-1）

- 未签署时：除 `/`、静态资源、`/api/ping`、`/api/agreement` 外一律 `403`，返回 `{ok:false, error:"agreement"}`。
- `POST /api/agreement` 落 `state.json.agreement = {accepted, version, at, signer}`；版本号随文案变化 +1。
- `POST /api/agreement/reset` 清空并重新弹窗（仅已签署时）。

### 关键语义

| 端点 | 语义 |
|---|---|
| `/api/memory/stats` | 转发 memory-eternal `/stats`；服务不可达时 `{ok:false, error:…}`（语义 503，不 500） |
| `/api/memory/claim` | 只走审核：提交即 `status:"pending"`，服务端**不调用** approve/reject |
| `/api/assign/<agent>.md` | 每次请求重新合并（`autoSync` 时不缓存）；未选则「尚未选择」 |
| `/api/breach/build` | 输出 `variants`（≥1 条载荷，含 base64 与 ROT13 变体）+ `advice`（该模型采样建议）+ `zero_wide_sample`；**不调用任何模型 API**、不保存被测模型输出原文 |
| `/api/break/run` | 白名单命令（info/scan/plan/patch/invert/verify/restore/journal），服务端转发给 break CLI |

---

## 5.4 数据文件

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

> 原子写 / BOM 自愈：`state.json` 与 `config.json` 读入时剥离 BOM；损坏后回退默认并自愈（回归用例）。

---

## 5.5 memory-eternal 契约（实测可用）

```text
GET  {base}/health     {ok, vault, db, db_bytes, ...}
GET  {base}/stats      {ok, total, today, week, byKind{...}}
GET  {base}/cards?q=&kind=&limit=   {ok, cards:[{path,kind,title,tags,summary,status,...}]}
GET  {base}/card?path= {ok, path, status, text}
POST {base}/write      -> 落库为 pending（**不得调用 approve/reject**）
```

> `{base}` 默认 `http://127.0.0.1:7999/memory-eternal/api`；来源可为 `local`/`cloud`/`env`（`PURGE_MEMORY_URL`）。
> 写卡**永不**调用 approve/reject；卡片只写方法与结论，目标身份（真实路径/sha256/客户名/账号/token）不进记忆库。

---

## 附：接口与 AC 对照（快速定位）

| 接口 | 相关 AC |
|---|---|
| break info/scan/plan/patch/invert/verify/restore/journal | AC-3.1–3.6, AC-8.1–8.4 |
| GET /api/memory/stats（未签署 403） | AC-1.1 / AC-1.2 |
| POST /api/breach/build / attempt | AC-2.1–2.4 |
| POST /api/equipment | AC-4.1 / AC-4.2 |
| POST /api/assign + /api/assign/<agent>.md | AC-5.1–5.4 |
| /api/memory/stats + /api/memory/claim | AC-6.1–6.3 |
| POST /api/settings | AC-7.1 / AC-7.2 |
| plugins_list / plugins_refresh | AC-9.1–9.4 |
| catalog.json 四态 | AC-10.1–10.3 |
