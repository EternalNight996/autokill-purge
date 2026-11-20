---
name: anti-debug-bypass
description: 反调试 / 反虚拟机 / 反沙箱 检测项清单与绕过：PEB 与 NtQueryInformationProcess、时间差与异常、硬件断点检测、CPUID/注册表/驱动特征
whenToUse: 调试器一挂上目标就退出或行为异常，或样本在虚拟机里不跑时
role: exploit
enabled: true
---

# 反调试与反虚拟机（按检测项逐条拆）

## 1. 用户态反调试
| 检测 | 表现 | 绕过 |
| --- | --- | --- |
| `PEB.BeingDebugged` | 直接退出 | ScyllaHide 默认处理，或 patch PEB |
| `NtQueryInformationProcess`（DebugPort/DebugFlags/ObjectHandle） | 返回值异常 | hook 该 API 返回 0 |
| `NtSetInformationThread(HideFromDebugger)` | 调试事件收不到 | 在调用处下断，改参数或跳过 |
| `OutputDebugString` + `GetLastError` | 判断有无调试器 | patch 返回值 |
| 时间差（`rdtsc` / `QueryPerformanceCounter`） | 单步就退 | 在计算处下断，把差值改常量 |
| 硬件断点检测（`GetThreadContext` 的 Dr0-3） | 断点被清 | 改用内存/软件断点，或 hook 该调用 |
| `SetUnhandledExceptionFilter` | 故意触发异常看接管者 | 调试器关闭"首次机会"接管 |
| 窗口/模块/进程扫描 | 发现 x64dbg、ScyllaHide | 改窗口类名/进程名，或用内核调试 |

## 2. 反虚拟机 / 反沙箱
- 硬件指纹：`CPUID` hypervisor 位、VMware/VBOX 注册表与驱动、MAC 前缀 `00:0C:29` / `08:00:27`、磁盘型号 `VBOX HARDDISK`。
- 行为指纹：CPU 核数 < 2、内存 < 2G、鼠标不动、开机时长过短、`Sleep` 被加速。
- 绕过：
  1. 换**裸机 + 独立磁盘**做分析（最省事）；
  2. 改 VM 配置（`hypervisor.cpuid.v0 = FALSE`、换 SMBIOS/磁盘序列号、伪装 MAC）；
  3. hook 检测 API 返回"真机"值（`GetSystemFirmwareTable`、WMI 查询）。

## 3. 工具组合
Windows：ScyllaHide（x64dbg 插件，勾掉 20+ 检测）→ TitanHide（驱动级）→ HyperDbg（VT 调试，绕用户态检测最彻底）。
Linux：`gdb` + `set follow-fork-mode`；`ptrace` 冲突用 `LD_PRELOAD` 假 `ptrace`。

## 4. 验证
不要凭"能跑起来"判断：在检测函数返回处下断，确认返回"未调试"；再跑一遍不挂调试器的对照组，行为一致才算过。

## 5. 落库
检测项清单 + 对应对策 → `redteam_vuln_add`（title=样本+保护类型）；配置与脚本 → `redteam_attack_file_add`。
