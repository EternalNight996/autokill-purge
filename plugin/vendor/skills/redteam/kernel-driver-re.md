---
name: kernel-driver-re
description: Windows 内核驱动逆向：从导入表 API 顺交叉引用找到 DispatchDeviceControl、反推设备名与 IOCTL 控制码、拆 IRP 主功能分发表、判断驱动对调用方的校验，Ring3 侧写验证程序
whenToUse: 需要评估某驱动（杀软/反作弊/EDR）暴露的内核接口，或要复现某驱动的功能（关进程、读写内存、拦截）时
role: recon
enabled: true
---

# 内核驱动逆向（从 API 反推 IOCTL）

来源：吾爱破解 `thread-2096341`（火绒剑驱动逆向）。原文结论先说：**驱动功能能逆出来，但调用会被拒** —— 因为驱动会校验调用方进程，这正是评估重点。

## 1. 五步定位（IDA，从"想做的事"倒推）
| 步 | 动作 | 本例结果 |
| --- | --- | --- |
| ① 选锚点 API | Ring0 里干这件事的内核 API（关进程=`ZwTerminateProcess`） | 在 Imports 里找到它 |
| ② 交叉引用 | `Ctrl+X` 看谁调它（xrefs） | → `TerminateProcessById`（`sub_140029870`） |
| ③ 继续上溯 | 再 xref 直到"处理 IRP 的函数" | → `sub_14000C460` → `DispatchDeviceControl` |
| ④ 拆分发表 | 看 `MajorFunction[IRP_MJ_DEVICE_CONTROL]` 里对 `IoControlCode` 的 `switch/cmp` | 得到控制码 **`0x2200B8`** |
| ⑤ 找设备名 | 看 `IoCreateDevice` / `IoCreateSymbolicLink` 的 Unicode 字符串 | `\\.\HR::ActMon`（Ring3 打开用） |

> 反向也成立：先 `strings` 找 `\Device\` / `\DosDevices\` / `\\.\` 形态的字符串 → 找引用 → 直达设备创建点。

## 2. IRP 分发结构（读懂这张表就能摸清驱动全部能力）
`DriverEntry` 里通常：
- `DriverObject->MajorFunction[IRP_MJ_CREATE]`  → 打开设备时的校验（很多驱动在这里就拦）
- `MajorFunction[IRP_MJ_DEVICE_CONTROL]` → 业务入口，内部按 `IoControlCode` 分发
- `MajorFunction[IRP_MJ_CLOSE]` / `IRP_MJ_READ/WRITE` → 清理与数据通道
评估时把 `DEVICE_CONTROL` 里的每个 case 列成表：控制码 → 功能 → 需要的输入结构 → 是否有校验。

## 3. 调用方校验（本例失败的原因，也是最该看的地方）
| 校验方式 | 在逆向里的特征 |
| --- | --- |
| 进程名/路径白名单 | `PsGetProcessImageFileName` / `ZwQueryInformationProcess` + 字符串比较 |
| 签名校验 | `CiValidateFileObject` / `SeValidateImageHeader` |
| 句柄/调用链校验 | `ObRegisterCallbacks` 注册 `OB_OPERATION_HANDLE_CREATE` 预回调，按 `PsGetCurrentProcessId` 判断 |
| 请求来源校验 | 检查 `IRP->RequestorMode`（`UserMode` 才拦）或 `PsGetCurrentProcess` 的 `Token` |
| 参数校验 | `ProbeForRead/ProbeForWrite` + 长度/对齐检查（缺了就是内核漏洞） |

评估这两面：① 校验能不能绕过（设备名/进程伪装/合法进程注入调用）；② 校验缺位处是否构成任意地址读写（`METHOD_NEITHER` + 未 probe 是经典提权面）。

## 4. Ring3 验证程序（原文的骨架，可直接复用）
```cpp
HANDLE h = CreateFileW(L"\\\\.\\HR::ActMon", GENERIC_READ|GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
if (h == INVALID_HANDLE_VALUE) { /* GetLastError 看是 5(拒绝) 还是 2(不存在) */ }
BYTE buf[16] = {0}; unsigned long long pid = 1234; memcpy(buf, &pid, 8);
DWORD ret = 0;
BOOL ok = DeviceIoControl(h, 0x2200B8, buf, sizeof(buf), buf, sizeof(buf), &ret, NULL);
// 输出缓冲第 8 字节起常放 NTSTATUS
```
错误码判读：**5 = 打开了但被拒（有校验）**，**2 = 设备名不对/驱动未加载**，**87 = 控制码或缓冲长度不匹配**。

## 5. 动态验证（静态结论必须落地）
- WinDbg 双机调试：`bp <DispatchDeviceControl>` → `g` → 触发 Ring3 调用 → 看 `IRP` 的 `Parameters.DeviceIoControl.IoControlCode` 与 `SystemBuffer`。
- 现场看分发表：`dt nt!_DRIVER_OBJECT <addr> MajorFunction`。
- 驱动加载/卸载：`sc create/start`、OSR Driver Loader；卸载前确认无 `ObRegisterCallbacks` 残留（会阻止卸载）。

## 6. 落库
- 驱动暴露面（设备名 + 控制码 + 功能 + 是否校验）→ `redteam_vuln_add`（title="<驱动> IOCTL 暴露面评估"）；
- 验证程序/脚本 → `redteam_attack_file_add`（kind=script）；
- 若发现 METHOD_NEITHER 未 probe 之类 → 按提权候选记录，evidence 写触发路径与崩溃/内存观察结果。

## 7. 纪律
只对自有机器上安装的驱动做静态分析与本地调用验证；不要拿驱动漏洞去打他人机器，也不要把可用的任意读写 PoC 外传。
