---
name: opsec-hide
description: 行动隐蔽（OPSEC）：出口 IP 与代理链、主机落地痕迹最小化、命令历史与日志、"哪些日志会记录我"的检测面清单、通信伪装、收尾自检
whenToUse: 演练进入实战阶段需要降低被发现概率，或收尾时要确认没留下暴露来源的痕迹
role: exploit
enabled: true
---

# 隐蔽（先管出口，再管落地，最后管时间线）

## 1. 出口与身份隔离
- **分阶段换出口**：侦察用代理池（`cn-proxy-pool`），利用阶段用 VPS（`vps-reverse-shell`）；同一 IP 不跨阶段复用。
- 代理链：`proxychains4` / SOCKS5 隧道（`suo5-tunnel`、`chisel-tunnel`），DNS 走 DoH 防泄漏。
- 身份：每个靶标独立 UA/Cookie/时区；浏览器用 `browser-automation` 的独立 profile。
- 红线：出口 IP 与自己的 VPS/邮箱/域名不要在注册信息上关联。

## 2. 主机落地痕迹最小化
| 痕迹 | 处理 |
| --- | --- |
| 上传文件 | 优先无文件：`powershell -enc`、`mshta`；Linux 用 `memfd_create` 执行不落盘 |
| 命令历史 | `unset HISTFILE; export HISTSIZE=0`；退出前 `history -c`（只对本会话有效） |
| 临时文件 | 放 `/dev/shm` 等易失目录，任务结束删除 |
| 时间戳 | 覆盖后 `touch -r 原文件` 对齐 mtime |
| 进程 | 名字伪装（`prctl(PR_SET_NAME)`）；不留长驻监听，按需回连 |
| 账号 | 不加用户不改密码；必须加时记录原状以便回滚 |

## 3. "哪些日志会记录我"（比幻想清日志有用）
- Windows：4624/4625 登录、4688 进程创建（需开审核）、Sysmon 1/3/11、PowerShell 4104（**会记明文脚本块**）。
- Linux：`/var/log/auth.log`、auditd、`journalctl`、bash history、`wtmp/btmp`。
- 原则：演练中**不删**生产日志；只在自建靶场验证日志清理，并把"被记录点"写进报告。

## 4. 通信伪装
- C2 走 443 + 合法证书；域名前置/DoH 隧道；心跳加抖动，不要固定 60s。
- WebShell 用正常参数名（`?id=`），响应掺正常 HTML；见 `webshell-toolkit`。
- 隧道必须写清 `entry_kind`（`target-http` / `target-outbound`），否则报告里不算边界突破。

## 5. 收尾自检（逐条给结论）
1. 目标上还有我起的进程/监听/定时任务吗？
2. 上传的文件都清了吗（含 `/tmp`、回收站、下载目录）？
3. 有明文凭据落进 history 或临时日志吗？
4. 出口 IP 与时间线是否落在授权窗口内（超出要单独说明）？
5. 交付物里有没有夹带来源信息（内网 IP、跳板、个人路径）？

## 6. 落库
隐蔽手法与检测面清单 → `redteam_vuln_add`（category=other，title 写"检测面评估"）；证据截图 `redteam_shot_add`，**不要**把凭据原文写进 evidence。
