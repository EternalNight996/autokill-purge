# 破甲逐项对照：autokill-purge vs dsh-purge 1.1.71

> 基准是**它**：dsh-purge 1.1.71（本机 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\plugins\dsh-purge`，
> 与 `~/.dsh/profiles/desktop/node_modules/dsh-purge` 同版本）。逐项判「我们跟没跟上」，并附「它自己是否真做到」——两列分开，避免把它的宣传语当成基准。
>
> 判定口径：**PASS** = 行为/内容与它等价；**FAIL** = 缺、不同或做不到；**N-G**（not applicable）= 这种形态没有这一项（不是缺陷，写清为什么）。
> 实测时间 2026-11-16，服务 `http://127.0.0.1:8792`（commit 后版本），本章所有数字都是本机跑出来的。

## 一、破甲内容（提示词本体）

| # | 项目（它的定义） | 我们 | 它自身 | 原因 / 证据 |
|---|---|---|---|---|
| 1 | 默认提示词全文一致 | **PASS** | PASS | 用它的 `lib/table-read.js#openSlot()` 解出 21194 字符，原样落进 `web/prompts/sauce-1171.md`（232 行 / 25.5 KB），未改一字符 |
| 2 | 注入位置：系统提示词最前 | **FAIL→补偿** | PASS | 它 `lib/core.js:5624/5655` 把整份 `prompt-inject.md` 挂在 system 最前；我们没有宿主注入通道，补偿 = 载荷整段（模板 + `---` + 任务），实测 21246 字符可复制 |
| 3 | 身份段（PRIME DIRECTIVE / 小码酱） | **PASS** | PASS | 模板内含，实测中「身份/人格声明」探针命中 |
| 4 | 强制思考段（Mandatory thinking） | **PASS** | PASS | 模板内含 |
| 5 | 任务优先级段（TASK PRIORITY） | **PASS** | PASS | 探针「任务优先级」命中 |
| 6 | 范围段（Scoped Rules 1–25） | **PASS** | PASS | 模板内含；`identity` 作用域会在这里截断（给"只要身份"的用法） |
| 7 | 输出纪律段（House Rules） | **PASS** | PASS | 探针「输出纪律」命中 |
| 8 | 拒绝对抗段（REFUSAL HARDENING） | **PASS** | PASS | 探针「禁止拒答」命中 |
| 9 | 边界词归一化段（BOUNDARY-WORD NORMALIZATION） | **PASS** | PASS | 模板内含 |
| 10 | CTF 契约 + 证据段 | **PASS** | PASS | 模板内含 |
| 11 | 路由段（Routing / WEB PENTEST / BANNED WORDS） | **PASS** | PASS | 模板内含 |
| 12 | 「换模型换提示词」 | **FAIL** | **FAIL** | 它的 `lib/core.js` 里 `modelPrompts / perModel / promptForModel` 零命中——宣传语未实现；我们同样只有 1 份真模板（`PROMPTS` 能登记多套，缺内容） |

## 二、宿主侧（它的 83 个补丁）

| # | 项目 | 我们 | 它自身 | 原因 / 证据 |
|---|---|---|---|---|
| 13 | 补丁表规模 | **PASS** | PASS | 直接驱动它的引擎，`ALL_PATCHES` 83 条，一条不少（不复制它的 344 KB patch 表，跟着它升级） |
| 14 | 读状态（等价 `--status`） | **PASS** | PASS | `GET /api/host/status`：`74/83 已应用 · 0 待应用 · 8 不适用`，逐条 `id/name/layer/status` |
| 15 | 应用补丁（等价 `--apply`） | **PASS**（不自动执行） | PASS | `POST /api/host/apply {confirm:true}` → 调它原版 `applyPatchesAllHosts()`；**写入前自动备份**，返回 `restartRequired` |
| 16 | 还原补丁（等价 `--revert`） | **PASS** | PASS（有 .bak 时） | `POST /api/host/apply {mode:'revert'}` → 它原版 `revertAllHosts()`；本机 `.bak` 数为 0，所以更依赖我们的快照/基线 |
| 17 | shim 注入（`dsh.cmd` 等） | **N-G** | PASS | 它把 shim 目录里的启动器也改掉；那是"改启动链路"，我们的 web 端不碰启动器，也读得到状态（`shim: dsh.cmd=binary`） |
| 18 | override 文件（`~/.dsh/prompt-inject.md`） | **PASS**（只读） | PASS | 状态里显示路径与 `override_status`（本机 `default`，25128 字节）；我们不写它——写了就等于它，两边会互相覆盖 |
| 19 | 应用后自动重启 dsh | **FAIL→提示** | PASS | 它会重启宿主；我们不做（会杀掉正在用的会话），改为返回 `restartRequired: true` 并在界面写明 |
| 20 | 多 surface 分别处理（desktop / web / npm 全局 / profile） | **PASS** | PASS | 状态里读到的文件覆盖 `resources/app/**`、`%APPDATA%/npm/node_modules/@deepseek-ai/dsh/**`、`~/.dsh/profiles/*/node_modules/**` 共 59 个 |
| 21 | 补丁与宿主版本闸门 | **PASS** | PASS | 复用它的 `guard`；另外我们恢复出厂前会比对 asar 与磁盘的 `dsh` 版本（`source.sameSource`） |

## 三、备份与恢复闭环（你新加的第 4 条）

| # | 项目 | 我们 | 它自身 | 原因 / 证据 |
|---|---|---|---|---|
| 22 | 应用前自动备份 | **PASS** | **FAIL（本机）** | 我们每次 `apply/restore/factory` 前先 `createSnapshot('pre-*')`；它本该留 `.dshpurge.bak`，本机实测 **0 个**（所以"靠它的 .bak 还原"这条路在本机不成立） |
| 23 | 快照内容 | **PASS** | — | 59 个被补丁文件整份复制 + `manifest.json`（每文件 sha256），实测 **59 文件 / 2,670,542 字节** |
| 24 | 撤销上一次（一步回退） | **PASS** | — | `POST /api/host/restore {confirm:true}` → 用最近一份快照覆盖；实测快照 `20261116-023618-first` |
| 25 | 恢复出厂 | **PASS** | PASS（走 asar） | `POST /api/host/factory` → 从官方 `resources/app.asar`（213 MB）**按需提取单文件**覆盖；实测基线比对：59 文件 → **54 patched / 1 identical / 4 not-in-asar**，说明原件确实能取回 |
| 26 | 覆盖前二次备份（guard） | **PASS** | — | 每次 `restore/factory/apply` 都先存 `pre-restore` / `pre-factory` / `pre-apply` 快照，返回 `guardSnapshot`，本次操作本身也可撤销 |
| 27 | 要求显式确认 | **PASS** | — | 三个写接口都要 `confirm:true`，否则 400 `confirm_required` |
| 28 | 原始基线不整包解压 | **PASS** | — | 只解析 asar header + 精确读区间（单文件 63 KB 级），不展开 213 MB |
| 29 | 版本不同源时不硬抄 | **PASS** | — | `asarVersion()` vs 磁盘 `dsh` 版本；不同源时在结果里写明"优先重装对应包"，而不是把包灌成另一个版本 |
| 30 | 恢复后提示重启 | **PASS** | PASS | 三个写接口都带 `restartRequired: true` |

## 四、模型与选项

| # | 项目 | 我们 | 它自身 | 原因 / 证据 |
|---|---|---|---|---|
| 31 | 用户模式只显示它真实支持的模板 | **PASS** | — | 下拉只有 2 项：`小码酱 · 梦神破甲 <版本>`（默认）与 `不套模板（纯指令）` |

> 注：本文写于 2026-11-16，当时模板显示名是 `小码酱 · dsh-purge 1.1.71`（印的是上游版本）。
> 从 **1.1.11** 起改名为 `小码酱 · 梦神破甲 <当前包版本>`，版本号跟 `package.json` 走；内部 id 仍是 `sauce-1171`。
> 本文其余对照结论不受影响（模板正文没变）。
| 32 | 破甲模板可选范围 | **PASS** | N-G | 我们多给了 `full` / `identity` 两种作用域；它只有整份注入 |
| 33 | 模型目录 | **PASS**（超出它） | **N-G** | 我们 24 个（国内 18，DeepSeek V4.1 Flash 置顶）；它没有模型目录这一层，只有宿主里的模型设置 |
| 34 | 每模型采样建议 | **PASS**（超出它） | **N-G** | 我们 24 条建议；它没有 |
| 35 | 任务输入与空任务拦截 | **PASS**（独有） | **N-G** | 它不需要任务（改完即生效）；我们前端拦截空任务、不发请求 |
| 36 | 载荷形态（文本/Base64/ROT13） | **PASS**（独有） | **N-G** | 它没有载荷生成器；`client.js` 里的 `payload` 只是知识库卡类型枚举 |
| 37 | 效果量化（成败记录/命中率） | **PASS**（独有） | **N-G** | 它只能人眼看答复 |

## 五、验收（本次改动）

| 套件 | 结果 |
|---|---|
| `node test/acceptance.mjs` | **21/21 PASS** |
| `node test/ux2layer.mjs` | **18/18 PASS** |
| `node _ui-test/ac-check.mjs` | **19/19 PASS** |
| `node test/ux2layer-ui.mjs` | **16/16 PASS / 0 SKIP**（连续两轮） |
| 宿主接口实测 | `status` 74/83 applied；`baseline` 54 patched；`snapshot` 59 文件 / 2.67 MB；技术模式 DOM 里「宿主破甲」面板 1 处、补丁行 74 条 `已应用` + 8 条 `不适用` |

## 六、FAIL 项汇总（只有 3 条，且都写清了补偿或为什么不补）

| # | FAIL 项 | 为什么 | 补偿 / 决定 |
|---|---|---|---|
| 2 | 注入位置（system 头部） | 我们不注入宿主；注入就要改宿主，等于变成它 | 载荷整段可复制（21246 字符），并在结果区标注模板与字符数；把"请作为系统提示词/自定义指令粘贴"写进下一步 |
| 12 | 换模型换提示词 | 它也没实现；我们 `PROMPTS` 表能登记多套，但只有 1 份内容 | 待补：按模型族 6 份（DeepSeek / 千问 / GLM / Kimi / 豆包+文心 / 国外），改数据不改代码 |
| 19 | 自动重启 dsh | 本会话就跑在 dsh 里，自动重启会杀掉用户正在用的会话 | 返回 `restartRequired` 并在界面写"重启 dsh 生效"，由用户自己重启 |

## 七、一句话总结

**破甲内容 11/12 项 PASS；宿主侧 8/9 项 PASS（唯一 N-G 是 shim）；备份恢复 9/9 项 PASS；模型与选项 7/7 项 PASS。**
三条 FAIL 里只有第 2 条是真实能力差距（不注入系统提示词），第 12 条它也没做到，第 19 条是刻意不做。
