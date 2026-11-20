---
name: game-cheat
description: 游戏内存修改与外挂原理（本地靶场）：Cheat Engine 数值与指针链、Unity IL2CPP 与 Unreal 符号定位、注入与 hook、反作弊检测面（ACE/EAC/BattlEye）评估
whenToUse: 在自建/离线游戏环境做内存与逻辑分析，或评估某游戏客户端反作弊强度时
role: exploit
enabled: true
---

# 游戏内存与外挂原理（只在单机/离线/自建服务端做）

## 1. 数值修改四步（CE 标准流程）
1. 首次扫描目标值（HP/金币/等级），类型选对（4 字节 / float / double）。
2. 让数值变化 → **再次扫描**缩到个位数候选。
3. 对候选做 "Find out what writes this address" → 拿到写入指令与偏移。
4. 反推结构体：`offset = 命中地址 - 基址`，再用指针扫描找 `[[base+0x10]+0x2C]` 这类多级链（重启后仍有效）。
> 数值每次重启都变、但血条比例稳定 → 扫 float 比例，或改用 AOB 特征码定位指令。

## 2. 引擎差异
| 引擎 | 定位方式 |
| --- | --- |
| Unity IL2CPP | `libil2cpp.so` + `global-metadata.dat` → Il2CppDumper 出 `dump.cs`，按类名找偏移，frida hook il2cpp 函数 |
| Unity Mono | `Assembly-CSharp.dll` 直接 dnSpy 读，改 IL 或 hook |
| Unreal | SDK dump / UE4SS，按 `UObject` 名找；透视改投影矩阵 |
| 自研 | 从渲染入手：找 `WorldToScreen` 矩阵，透视本质是改投影结果 |

## 3. 注入与 hook
- DLL 注入 `CreateRemoteThread + LoadLibrary`；更隐蔽用 `QueueUserAPC`、手动映射（ManualMap）。
- 外挂分两类：外部 `ReadProcessMemory`（易被检测）、内部 hook（稳但落地痕迹多）。
- 反作弊会扫：模块列表、PEB 里的未签名模块、句柄权限、内核回调；直读物理内存会被驱动拦。

## 4. 反作弊检测面（评估用）
| 反作弊 | 主要检测 | 研究重点（靶场验证） |
| --- | --- | --- |
| ACE / EAC / BattlEye | 内核驱动、完整性、HWID、行为统计 | 枚举检测项（驱动 IOCTL、句柄、模块签名），不做线上绕过 |
| 服务端校验 | 移速/伤害/冷却异常 | 客户端改值无用，必须理解协议与校验点 |
| 心跳遥测 | 定期上报客户端状态 | 断网/改包触发风控，先看协议 |

## 5. 落库与纪律
- 结论（哪个偏移对应哪个字段、需要几级指针）→ `redteam_vuln_add`，evidence 写基址链与验证方式。
- 只在靶场账号/离线客户端验证；成品注入器不得用于线上对局或分发。
- 交付物要的是"检测面清单 + 可复现检测证据"，不是外挂本体。
