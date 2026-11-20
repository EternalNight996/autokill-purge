---
name: av-evasion
description: 免杀工程（隔离实验室）：静态特征与区段熵、AMSI/ETW 用户态绕过、反射加载与分离免杀、LOLBin 与回调执行、检出矩阵验证（Defender 事件）
whenToUse: 需要在自建实验环境验证载荷能否落地，或评估某终端防护的实际检出能力时
role: exploit
enabled: true
---

# 免杀（只在自己实验室验证检出率）

## 1. 先看它凭什么拦你
| 层 | 检测 | 观察点 |
| --- | --- | --- |
| 静态 | 特征串、导入表、区段熵、签名 | Defender 事件 1116/1117、`Get-MpThreatDetection` |
| 内存/行为 | AMSI（脚本内容）、ETW、行为链 | 4104、Sysmon 1/8/10 |
| 网络 | C2 域名/IP 信誉 | 出站拦截日志 |
> 改特征只能过静态；行为检测要靠"少做可疑动作"（不加自启动、不扫盘、不批量枚举）。

## 2. 静态层（成本最低，收益递减）
- 载荷加密 + 运行解密（XOR/AES），不留明文 shellcode 常量。
- 降熵：压缩/编码后填充，区段熵别逼近 8.0。
- 导入表混淆：动态解析 `LoadLibrary/GetProcAddress`，API 名用哈希而非明文。
- 签名：自签只能骗"看有没有签名"的检查，骗不过信誉体系。

## 3. AMSI / ETW（用户态）
- AMSI：patch `AmsiScanBuffer` 返回 `AMSI_RESULT_CLEAN`；PowerShell 可置空 `AmsiUtils` 的 `amsiInitFailed`。
- ETW：patch `EtwEventWrite` 为 `ret`（只影响用户态事件，不影响内核）。
- 两者 patch 本身就是特征——实验里用来验证"检测是否只靠 AMSI"。

## 4. 加载方式
| 方式 | 说明 |
| --- | --- |
| 反射加载（sRDI/Donut） | PE/shellcode 转位置无关，`VirtualAlloc + CreateThread`；用 RX 不用 RWX（RWX 是强特征） |
| 回调执行 | `EnumWindows` / `CreateTimerQueueTimer` 回调跑 shellcode，避开 `CreateThread` 监控 |
| LOLBin | `mshta` / `rundll32` / `regsvr32` / `installutil` |
| 进程注入 | `QueueUserAPC` / `NtMapViewOfSection` 比 `CreateRemoteThread` 低调 |

## 5. 验证（必须做）
1. 隔离 VM + 快照，开 Defender 实时保护与云保护；
2. 记录三态：落地即删 / 运行被杀 / 存活 N 分钟；
3. 对照组：同一载荷不加密跑一遍，确认差异来自哪一层；
4. 产出检出矩阵（手法 × 防护产品 × 结果）——这才是报告要的东西。

## 6. 边界
只对自己拥有或书面授权的实验环境使用；产物不外传；报告只写检出结论，不附可用载荷。
