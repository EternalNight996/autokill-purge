---
name: lab-check
description: 靶场自检与战果对照：检查靶标是否就绪、验证链路是否闭合、把"靶场里验通"的证据回填到事实库（避免把靶场结论当客户战果）
whenToUse: 每次进靶场开工前、或要把靶场验证过的 POC 提升为 verified 时
role: exploit
enabled: true
---

# 靶场自检（三件事）

## 1. 就绪检查
`node scripts/lab/check-lab.mjs` → 表格里每个靶标 ✅/❌；不全绿就别开始记分。

## 2. 链路闭合检查
按"入口 → 权限 → 内网 → 域控"逐段确认，每段都要有**可复现的命令与回显**：
| 段 | 证据 | 落库 |
| --- | --- | --- |
| 入口 | 漏洞请求/回显 | `redteam_vuln_add` |
| 权限 | `whoami`/`id` 回显 | `redteam_credential_add` / `redteam_score_hit` |
| 内网 | 隧道监听地址 + 能访问的网段 | `redteam_tunnel_add`（写 `entry_kind`） |
| 域控 | `nxc smb DC` 的 `Pwn3d!` | `redteam_score_hit` + `redteam_shot_add` |

## 3. 靶场 ≠ 客户（口径闸门）
- 靶场验证通的 POC：`redteam_poc_add({ verified: true, verified_note: "lab: <靶标名> <回显>" })` —— 写明是 lab。
- 客户目标上验证通的：`verified_note` 写目标与回显，才有得分意义。
- 报告里两者必须分开列（"实验室验证" / "实网验证"），混写会被判虚报。
