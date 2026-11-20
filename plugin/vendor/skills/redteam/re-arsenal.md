---
name: re-arsenal
description: 逆向 / 协议 / 样本分析的武器库入口：本机工具链（r2 / Ghidra / IDA / x64dbg / Frida）＋ 六个上游资源索引（mcp-reverse、rea、Awesome-REA、两份 awesome-reverse-engineering）先查再动手
whenToUse: 需要逆二进制 / 分析样本 / 还原协议 / 找现成脚本或论文，或不确定该类问题已有现成工具时
role: recon
enabled: true
---

# 逆向武器库（先查索引，别重造轮子）

## 本机工具链（先看这里，再决定要不要装）
| 用途 | 命令 | 缺失时 |
| --- | --- | --- |
| 静态反汇编 / 脚本化 | `r2` / `radare2`（`~/.dsh/redteam/toolkit/radare2/r2`） | 环境适配页填路径 |
| 反编译 + 反汇编（免费、可批处理） | `analyzeHeadless`（Ghidra，`~/.dsh/redteam/toolkit/ghidra/support/analyzeHeadless`） | 同上 |
| 交互式逆向（生态最全） | `idat64` / `ida64` | 有 IDA 就走 `dsh-re-workbench` 类 MCP 桥 |
| Windows 动态调试 | `x64dbg` / `x32dbg` | — |
| 动态插桩（跨平台/移动端） | `frida` / `frida-ps` / `frida-trace` | — |
| 符号/字符串/PE 头速查 | `strings`、`objdump`、`readelf`、`dumpbin /headers` | 系统自带 |

## 上游资源索引（联网可查，**查完把结论落库**）
| 索引 | 规模 | 干什么用 |
| --- | --- | --- |
| `1llu50ry/mcp-reverse`（MIT, ★567） | 4100+ 技能 + 源码归档 + MCP server | **首选**：整库是结构化知识库，可直接当 MCP 挂进来（见下） |
| `morluto/rea`（MIT） | 面向 agent 的 RE 引擎（bridge/mcp.json/native） | 想要"agent 自己逆"的上层框架时看 |
| `reacher-z/Awesome-REA`（MIT, ★2.6k） | 631 资源 / 170 论文 / 3309 仓库 | 找论文与前沿方法 |
| `morluto/awesome-reverse-engineering`（CC0, ★2k） | 按"你要做的事"组织 | 不确定用什么工具时按任务反查 |
| `alphaSeclab/awesome-reverse-engineering`（★5.2k） | 3500+ 工具 / 2300 文章视频 | 量大但**2021 年后停更**，当历史清单用 |
| `8kSec/awesome-mobile-security` | 移动端全景（小仓库） | 移动端具体流程见技能 `mobile-re` |

纪律：★数只作参考（`morluto/rea` 的 star 数明显异常，别拿它当选型依据）；索引里的工具**没装就是没装**，不要假设可用。

## 把 mcp-reverse 挂成 MCP（知识库直连）
1. 克隆后按它的 README 起服务（`db/` 就是那 4100+ 技能库，docker 也有 `docker-compose.yml`）。
2. 在 profile 里加一行 MCP server（stdio 或 http 按其 README），工具名会以 `mcp__*` 出现在工具目录。
3. 之后先 `mcp__*` 搜"这类问题有没有现成技能"，再决定自己写脚本。
注意：mcp-reverse 仓库 ~3.1 GB（带源码归档），别克隆进工作区，放 `$DSH_HOME/redteam/third_party/`。

## 产出落库（不落库等于没做）
- 方法/工具结论 → `redteam_vuln_add`（evidence 写清"哪个样本/函数/偏移"）；
- 可复用脚本 → `redteam_attack_file_add`（只在真跑通时）；
- 通用 POC/套路 → `redteam_poc_add`（category / verified / verified_note 三件套）。
