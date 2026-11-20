---
name: software-cracking
description: 桌面软件破解工作流：定位授权校验（本地签名 / 网络校验 / 试用计时）、patch 字节与重签、keygen 与 license 伪造、.NET/Java/Electron 各自入口
whenToUse: 需要解除试用限制、绕过序列号校验、复现激活逻辑，或评估某商业软件的授权实现强度时
role: exploit
enabled: true
---

# 软件破解（先定性，再动手）

## 0. 三分钟定性：它到底怎么校验
| 现象 | 大概率 | 入口 |
| --- | --- | --- |
| 断网可用、只输一次 | 本地离线校验（RSA/ECC 签名或对称解密 license） | 找 `RSA_verify` / `EVP_Verify` / 大整数运算 / `bcrypt` |
| 每次启动联网 | 服务端校验 | 抓包看请求体；先判能否离线伪造响应 |
| 有天数倒计时 | 本地时间戳/注册表 | 找 `GetSystemTime` / 文件 mtime / 注册表 `InstallTime` |
| Electron/JS | asar 打包 | `npx asar extract app.asar out`，逻辑基本明文 |
| .NET | IL 可读 | `dnSpy`/`ILSpy` 直接看 `LicenseManager`、`Validate` |
| Java | jar/class | `jadx`/`cfr`，找 `verifyLicense`、`MessageDigest` |

## 1. 定位校验点（静态优先）
- 字符串交叉引用：`strings -n 6 bin | grep -iE "licen|serial|activ|trial|expire"`，再在 `r2`/`Ghidra` 里 `axt @ str.xxx`。
- 分支形态：校验函数典型是"返回 bool → 调用方 `test al,al; jz fail`"，找**唯一决定成败的跳转**，不要逐个改。
- 动态确认：`x64dbg` 在候选函数下断，输入错误序列号看是否命中；命中即锁定。

## 2. 三种改法（按侵入性排序）
| 改法 | 做法 | 适用 | 风险 |
| --- | --- | --- | --- |
| 改判断 | `jz`→`jmp`/`nop`，或把 `return 0` 改 `return 1`（`mov al,1; ret`） | 单点校验 | 有完整性自校验时会被发现 |
| 造 license | 逆出签名算法，用自有私钥/对称 key 生成合法 license | 离线签名校验 | 需要完整逆算法，工作量大但最干净 |
| 拦网络 | hosts/代理劫持校验域名，返回伪造成功包 | 服务端校验但可离线 | 需要能改响应，且注意 TLS pinning |

## 3. 改完必须做的三件事
1. **重签/校验和**：Windows 无签名也能跑；.NET 强名称需 `sn -Vr *`；macOS 需 `codesign --force --deep --sign -`；Android 见技能 `apk-crack`。
2. **回滚副本**：原文件留 `.orig`，记录 `OFFSET / 原字节 / 新字节`——这三样才是可复现的成果。
3. **落库**：`redteam_vuln_add`（title=软件+版本+校验类型，evidence=函数/偏移/原指令）；可复用脚本进 `redteam_attack_file_add`（kind=script）。

## 4. 常见反破解与对策
| 保护 | 特征 | 对策 |
| --- | --- | --- |
| 代码完整性自校验 | 启动时算自身 hash | 先定位校验函数一并 patch，或改比较值为常量 |
| 反调试 | `IsDebuggerPresent`、`NtQueryInformationProcess` | 见技能 `anti-debug-bypass` |
| 加壳/虚拟化 | 区段名异常、入口在壳段 | 见技能 `unpacking` |
| 多线程校验 | 校验在工作线程 | 在线程创建处下断，别只跟主线程 |

红线：只对自己持有授权的软件/靶场样本做；产物不进交付报告正文，只记方法与偏移。
