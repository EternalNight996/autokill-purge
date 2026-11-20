---
name: zero-day-hunting
description: 0day 挖掘与 1day 抢跑：情报巡检（KEV/NVD/本地模板对撞）、补丁差分（patch diff）、覆盖率引导 fuzz、代码审计 sink 清单、验证与落库口径
whenToUse: 需要找"现成能打的新漏洞"，或要把某个组件/固件/协议从"能跑"推到"能挖出未公开问题"时
role: vuln-scan
enabled: true
---

# 0day 与 1day（先分清你要的是哪种）

| 你要的 | 实际能拿到的 | 入口 |
| --- | --- | --- |
| 真正的 0day（未公开、无补丁） | 只能自己挖：补丁差分 / fuzz / 审计 | 本技能第 2~4 节 |
| 准 0day（刚公开就被在野利用） | CISA KEV 新增条目 | §node scripts/vuln-intel.mjs§ |
| 1day（已公开、补丁已出、目标没打） | NVD 近 N 天 critical + 本地模板库对撞 | 同上 |

## 1. 情报巡检（一条命令，每天跑）
§node scripts/vuln-intel.mjs --nvd-days 5 --kev-days 7§
输出三块：KEV 新增（在野利用）、NVD 新增 critical、**本地 nuclei 模板是否已有可验证模板**（命中就直接能验）。产物落 §$DSH_HOME/redteam/vuln-intel-YYYYMMDD.md§。
判定优先级：KEV 命中 > 有本地模板的高危 > 10.0/9.9 新公开 > 其余。

## 2. 补丁差分（产出 0day 最快的一条路）
1. 拿到补丁前后两个版本（源码 §git log -p§；二进制则取前后安装包）。
2. 源码：§git diff v1..v2 -- <可疑目录>§，重点看"加了什么检查"——缺的检查就是漏洞。
3. 二进制：Ghidra Version Tracking / Diaphora / BinDiff 做函数比对，先看**新增函数与新增分支**。
4. 反推 PoC：把新增的校验条件取反构造输入；能绕过就是 1day（补丁未落地）或 0day（未公开修复）。
5. 工具链细节见技能 §binary-re§ / §unpacking§。

## 3. 覆盖率引导 fuzz（协议/解析器/文件格式）
- 目标选择：解析外部输入的组件（图片/文档/协议/固件 web 服务）。
- 最小 harness：§afl-clang-fast§ 编译 + §__AFL_LOOP§；无源码则 QEMU 模式 §afl-fuzz -Q§。
- 语料：用真实样本做种子（§-i seeds -o out§），先跑 §-c§ 裁剪再长跑。
- 判据：崩溃去重（§afl-collect§/§casr§）→ ASAN 报告栈 → 手写 PoC 复现；只有稳定复现才算漏洞。
- IoT/固件：§binwalk -e§ 取文件系统 → 找 web 服务二进制 → §qemu-<arch>§ 跑起来再 fuzz（技能 §unpacking§）。

## 4. 代码审计（没补丁可比时）
按 sink 反查，不按目录翻：
| sink | 危险形态 |
| --- | --- |
| 反序列化 | §readObject§ / §unserialize§ / §pickle.loads§ / §ObjectInputStream§ 前是否有类型白名单 |
| 模板/表达式注入 | §eval§ / §Template§ / §SpEL§ / §OGNL§ / §new Function§ 的参数来源 |
| 命令执行 | §Runtime.exec§ / §ProcessBuilder§ / §system§ / §exec§ 拼接 |
| 路径 | §join(base, input)§ 未规范化 → 穿越；§sendFile§ / §readFile§ |
| 鉴权 | 路由是否漏挂中间件；§@PreAuthorize§ 缺失；IDOR（直接用请求里的 id） |
| 上传 | 扩展名校验在前端 / §Content-Type§ 可伪造 / 解析漏洞目录 |
| SSRF | §urlopen§ / §requests.get(user_url)§ / §HttpClient§ 无出站白名单 |

产出格式：**触发条件 + 最小请求 + 影响 + 是否需要认证**，四样齐了才算漏洞，否则只是"可疑"。

## 5. 验证与落库（这条决定成果算不算数）
- 先在本机/靶场复现：抓原始请求，保存 §runs/§ 下证据。
- §redteam_vuln_add§ 写 §cve§（有就写）、§severity§、§confidence§、§evidence§（原始请求 + 回显）。
- 可复用 POC → §redteam_poc_add§，§verified: true§ 且 §verified_note§ 写"在哪台目标、什么回显"；**没验证的一律 false**。
- 打到权限 → §redteam_score_hit§；截图 §redteam_shot_add§。

## 6. 纪律
- 只对授权目标做主动验证；情报巡检（KEV/NVD）是只读外部请求，不碰目标。
- 挖出未公开问题先内部报备，不要先发公网；PoC 不写进报告正文。
- 别把"扫描器报了"当 0day：没有复现证据的一律按"待验证"处理。
