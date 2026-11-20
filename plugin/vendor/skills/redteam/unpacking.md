---
name: unpacking
description: 加壳识别与脱壳：UPX/ASPack/VMProtect/Themida/自研壳特征、ESP 定律找 OEP、dump 与 IAT 修复、.NET/Java/Electron 路线
whenToUse: 目标区段异常、导入表极小、入口在非代码段，或需要拿到真实代码做静态分析时
role: exploit
enabled: true
---

# 脱壳（先识别，再选路线）

## 1. 识别
| 特征 | 壳 |
| --- | --- |
| 区段 `UPX0/UPX1`，`upx -l` 能认 | UPX（`upx -d` 直接脱） |
| 区段 `.aspack`/`.adata` | ASPack |
| 区段 `.vmp0/.vmp1`、导入表几乎空 | VMProtect（虚拟化） |
| 区段 `.themida`、反调试强、体积大 | Themida / WinLicense |
| 入口在最后区段、`pushad` 开头 | 常见压缩壳（ESP 定律可用） |
| Android，`libjiagu/libshell` | 加固壳 → 走技能 `apk-crack` |
| .NET，入口 `jmp` 到混淆方法 | ConfuserEx → `de4dot` |

## 2. 通用脱壳（压缩壳）
1. 入口 `pushad` → 给 `esp` 下**硬件访问断点**（ESP 定律）。
2. 运行到 `popad` 附近、跨段跳转处即 **OEP**。
3. OEP 处 dump（Scylla / OllyDumpEx）。
4. 修 IAT：Scylla `IAT Autosearch` → `Get Imports` → `Fix Dump`，修完 `rabin2 -i` 确认导入表恢复。
5. 校验：脱壳后能启动、`strings` 出现业务字符串。

## 3. 虚拟化壳（VMProtect / Themida）
- 不要试图还原虚拟化段（成本极高）。路线改为**动态跟踪到关键判断点**：在 API 断点（`RegOpenKey`、`CreateFile`、`send`）读寄存器/内存拿结论。
- 必须静态时：只逆**未被虚拟化**的函数（通常只保护 20%~30% 关键函数）。
- 反调试配合见 `anti-debug-bypass`。

## 4. .NET / Java / Electron
| 目标 | 工具 | 备注 |
| --- | --- | --- |
| .NET 混淆 | `de4dot` → dnSpy | 强名称需 `sn -Vr *` |
| Java jar | cfr / procyon | 混淆多为 `a.a.a`，按调用关系改名 |
| Electron | `npx asar extract` | 若再套 bytenode `.jsc`，需 bytenode 反编译 |

## 5. 落库
壳类型/版本/OEP 偏移/IAT 修复方式 → `redteam_vuln_add`（title=样本+壳+版本）；脱壳脚本 → `redteam_attack_file_add`。


## 6. OllyDbg 路线（压缩壳实战，来源：吾爱 tid=2079978 WinUpack 0.37-0.39）

x64dbg+Scylla 是默认路线；遇到老壳（WinUpack/ASPack/nspack）用 OllyDbg 三件套更快，流程固定：

| 步骤 | 操作 | 判据 |
| --- | --- | --- |
| ① 查壳 | ExeinfoPe / PEiD | 区段名 + 熵，确认是压缩壳（不是 VMP/Themida） |
| ② 起手 | OllyDbg 打开，入口即 `pushad` | 典型压缩壳入口 |
| ③ ESP 定律 | 单步**一次** `pushad`，在 ESP 上右键"数据窗口跟随" → 数据区右键"断点 → 硬件访问 → Word" | 期望命中 `popad` 前后的栈访问 |
| ④ 找 OEP | 运行到断点 → **删掉硬件断点** → 右键"分析 → 分析代码" → 单步数次，落到跨段跳转处 | 出现正常编译器序言（`push ebp; mov ebp,esp` / MSVC 的 `call __security_init_cookie`）即 OEP（示例：`1DDAC`） |
| ⑤ dump | LordPE → 完整转储（Dump Full） | 进程还挂着时抓，别先关 |
| ⑥ 修 IAT | ImportREConstructor（ImportREC）：选进程 → 填 OEP → 自动搜索 → 获取导入 → Fix Dump | 修完 `rabin2 -i`/PE 查看器能看到正常导入表 |
| ⑦ 验收 | 脱壳文件能独立启动，`strings` 出现业务串 | 起不来多半是 IAT 没修全或校验未过 |

补充（原文没写但一定会踩）：
- ImportREC 的 "Auto Search" 找不到 IAT 时，手工填 RVA/Size（在 dump 里找连续的函数指针数组）。
- 脱壳后仍崩溃 → 先怀疑**完整性校验**（启动时算自身 hash），去 `unpacking` 第 4 节对付。
- 老壳常把 TLS 回调放在壳段，dump 后要检查 `IMAGE_DIRECTORY_ENTRY_TLS` 是否指向已 dump 的区间。


## 7. ESP 定律原理（为什么它能找到 OEP）

压缩壳的固定套路：入口先 `pushad` 保存 8 个通用寄存器（ESP 随之减 0x20），解压完再 `popad` 恢复、然后跳到 OEP。
- 所以**入口那一刻的 ESP 值，在整个解压过程中不会被改写**（除非壳自己又 `push`，所以要在 `pushad` 之后、单步**一次**再取 ESP）；
- 在这个栈地址上下**硬件访问断点（Word/Dword）**，壳一旦 `popad` 读它，断点立刻命中；
- 命中点就在 `popad` 附近，往前/往后单步到**跨段跳转**，落点即 OEP。

失效场景：壳把栈换了（`mov esp, xxx`）、或 `popad` 前又压了多层数据 → 断点命中在无关位置，此时改在 `popad` 指令本身的地址下断，或改用"内存写入断点跟 `VirtualProtect`"。

## 8. 老壳对照表（按特征认壳，别硬试）

| 壳 | 区段特征 | 入口特征 | 首选路线 |
| --- | --- | --- | --- |
| UPX | `UPX0/UPX1` | `pushad` | `upx -d` 一键脱 |
| ASPack | `.aspack/.adata` | `pushad`，解压后有 `jmp eax` | ESP 定律 + Scylla |
| **WinUpack 0.37-0.39** | 区段名被改、导入表极小 | `pushad` | **OllyDbg + LordPE + ImportREC**（见第 6 节） |
| nspack | 区段名 `nsp0/nsp1`、体积小 | 入口在最后区段 | 同上；nspack 变种多，IAT 常需手工填 |
| PECompact | `.pec`/`.pec1` | `pushad` + `call` | ESP 定律；新版有反调试 |
| VMProtect | `.vmp0/.vmp1`、导入表几乎空 | 首条指令在 `.vmp0` | **不要脱**，动态跟关键 API 断点（见第 3 节） |
| Themida/WinLicense | `.themida`、体积巨大 | 入口后有大量 `cpuid/rdtsc` | 同 VMProtect；先过反调试（`anti-debug-bypass`） |
