---
name: lab-build
description: 靶场搭建 runbook：四段隔离网络（攻击/DMZ/内网/域）＋ 六类靶标（Web、AD 域、IoT 固件、破解逆向、内网隧道、检测验证）＋ 一键起停与验收清单
whenToUse: 需要一套能复现、能回滚、不出网的本地靶场来验证漏洞或练链路时
role: exploit
enabled: true
---

# 靶场搭建（先隔离，再分层，最后验收）

## 0. 三条铁律
1. **物理隔离**：靶场 VM 只用 Host-Only/内网模式，**不要桥接**；宿主机跑 pfSense/OPNsense 做唯一出口，默认 deny。
2. **随时回滚**：每个靶标起之前打快照，命名 `<靶标>-<日期>-before`；动手前先回滚到干净态，否则第二次验证的结论不可信。
3. **流量留证**：靶场内部署一台 `tcpdump -i any -w runs/` 或 Zeek，便于事后对照"我到底发了什么"。

## 1. 拓扑（四段，够用且能推着练）
~~~
[宿主机] ── 管理网(VMnet1, 仅宿主可进)
   │
[攻击机 Kali] ── attack-net 10.10.10.0/24
   │
[DMZ 10.10.20.0/24]  Web 靶标 / 跳板入口
   │
[内网 10.10.30.0/24]  办公 PC / 文件服务 / 数据库
   │
[域 10.10.40.0/24]   DC + 成员服务器（至少一台 Win2019/2022 + 一台 Win10）
~~~
每段之间用 pfSense 虚拟机做路由 + 默认 deny + 只放行你要练的端口；这样"边界突破""内网横向"才有真实阻力。

## 2. Web / 通用靶标（一条命令）
`bash scripts/lab/up-web.sh` → 起 juice-shop(8081)、dvwa(8082)、sqli-labs(8083)、upload-labs(8084)、webgoat(8085)、未授权 redis(6379)。
`node scripts/lab/check-lab.mjs` 出就绪表（可直接贴报告）。
需要真实 CVE 环境时用 vulhub：`git clone --depth 1 https://github.com/vulhub/vulhub.git ~/vulhub` → 进对应目录 `docker compose up -d`（每个 CVE 一个目录，打完 `down -v` 就干净）。

## 3. AD 域靶场（内网/横向的主战场）
| 方案 | 成本 | 说明 |
| --- | --- | --- |
| **GOAD**（Game of Active Directory） | 8~16 GB 内存 | 一条命令拉起多域多机，预置 ACL/委派/ADCS 错配，直接配技能 `ad-attack` |
| 手搭 | 4 GB 起 | Win2022 装 AD DS → 建 OU/用户 → 加一台 Win10 入域；再用 `BadBlood` 灌脏数据 |
| DetecionLab | 中 | 偏蓝队/日志（配检测验证用） |

手搭最小可用：DC（DNS+AD DS）＋ 一台成员 Web 服务器（IIS）＋ 一台 Win10；域账号给 2 个普通用户 + 1 个服务账号（设 SPN，练 Kerberoast）。

## 4. IoT / 固件
- 固件：`binwalk -e firmware.bin` → `squashfs-root` → 找 `/etc/init.d/` 与 web 二进制（技能 `unpacking`）。
- 运行：`qemu-<arch> -L ./lib ./usr/sbin/httpd`，或直接用 **FirmAE**（自动跑通固件服务）。
- 靶标包：**IoTGoat**（刻意有洞的 OpenWrt）、**DVRF**（练栈溢出/命令注入）、路由器真机（二手，隔离网段）。
- 摄像头/DVR 类：用 vulhub 的未授权/弱口令靶替代真机，别碰公网设备。

## 5. 破解 / 逆向靶场
| 类型 | 资源 | 用途 |
| --- | --- | --- |
| CrackMe（多平台） | `crackmes.one` | 配技能 `software-cracking` 练定位校验 |
| 安卓 | `AndroGoat` / `InsecureBankv2` | 配技能 `apk-crack` / `mobile-re` |
| 游戏内存 | 单机离线游戏（自建服务端） | 配技能 `game-cheat`，只在离线环境 |
| 样本分析 | 隔离 VM + 断网 + 快照 | 配技能 `av-evasion` 的检出矩阵 |

## 6. 内网隧道 / 出口
- 在 attack-net 上起 `frps`/`chisel server`，从 DMZ 靶标回连，验证"目标侧入口"（`entry_kind=target-outbound`）。
- WebShell 通道用 `suo5`/`Neo-ReGeorg`，配技能 `suo5-tunnel` / `webshell-toolkit`。
- 出口带宽与延迟故意限速（`tc qdisc`），练真实条件下的稳定性。

## 7. 检测验证（蓝队侧，报告要的证据）
- Windows 开审计 + Sysmon（配 SwiftOnSecurity 配置），Linux 上 auditd。
- 用 **Atomic Red Team** 逐条执行技术点，对照 `redteam_vuln_add` 里"哪些日志会记录我"（技能 `opsec-hide`）。
- 需要 SIEM 就 Wazuh 单机（4 GB 内存够）。

## 8. 验收（打不出来就是没搭好）
1. 攻击机能扫到 DMZ，DMZ **不能**直连内网（边界存在）。
2. 从 DMZ 拿 shell 后能建隧道进内网（`redteam_tunnel_add` 能记 `entry_kind`）。
3. 内网能打到 DC，`redteam_score_hit` 能落"域控权限"。
4. 快照回滚后所有服务能正常起（可重复）。
5. `node scripts/lab/check-lab.mjs` 全绿。

## 9. 硬件与成本
- 最低：16 GB 内存 / 4 核 / 200 GB SSD（Kali 4G + Web 靶 4G + DC 4G + Win10 4G）。
- 舒服：32 GB + NVMe，AD 靶场（GOAD）单独留 16 GB。
- 云上：一台 8C32G 的裸金属跑嵌套虚拟化，**只在内网**，不要暴露公网端口。
