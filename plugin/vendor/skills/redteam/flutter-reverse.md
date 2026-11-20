---
name: flutter-reverse
description: Flutter 应用逆向（iOS/Android）：识别 Flutter 与脱壳状态、Dart AOT 符号恢复（Blutter/reFlutter）、定位业务逻辑与静态补丁偏移、重签名安装
whenToUse: 目标是 Flutter 写的 App（App.framework / libapp.so），需要看会员/付费/风控逻辑或做静态补丁时
role: exploit
enabled: true
---

# Flutter 逆向（Dart AOT，没有 Java/smali 可读）

来源：吾爱破解 `thread-2135331`（iOS Flutter 会员逻辑分析与静态补丁）。

## 1. 先确认技术栈（30 秒）
| 证据 | 结论 |
| --- | --- |
| `Frameworks/App.framework` + `Flutter.framework`，`flutter_assets/AssetManifest.bin` | Flutter（iOS） |
| Android：`lib/arm64-v8a/libapp.so` + `libflutter.so`，`assets/flutter_assets/` | Flutter（Android） |
| 有 `kernel_blob.bin` | **Debug/Profile 包**：Dart 快照可读，优先用它 |
| 有 `*.jsbundle` / `app-service.js` | 不是 Flutter（RN / uni-app） |
| `otool -l ... | grep -A5 LC_ENCRYPTION_INFO` 看到 `cryptid 1` | 还没脱壳，先脱 |

## 2. 符号恢复（关键一步）
Dart AOT 会把函数名剥掉，但**保留对象池与快照结构**：
- Android/iOS 通用：**Blutter**（`blutter libapp.so` / `App.framework/App`）→ 输出 `pp.txt`（对象池）与 `asm/`（带符号的反汇编）。
- 旧工程：**reFlutter**（改 `libflutter.so` 抓 `dart:io` 与 `--print-flow-graph` 级别信息）。
- 有 `kernel_blob.bin` 时直接 `dart dump_kernel`/Doldrums 出 AST，几乎等于源码。

## 3. 找业务逻辑（三条路，按命中率）
1. **字符串锚点**：`strings -a App | grep -iE "vip|member|purchase|expire|isPro"` → 在 `pp.txt` 里找同名/近名对象 → 定位引用它的函数。
2. **插件调用**：看到 `in_app_purchase` / `flutter_secure_storage` / `device_info` → 从插件 MethodChannel 名反查 Dart 侧调用点。
3. **关键常量**：会员到期时间戳/价格/接口路径，直接搜常量值（`strings` 或 `pp.txt` 里的数字池）。

## 4. 静态补丁（本技能的核心手法）
前提：**文件偏移 == 虚拟地址**（该样本成立；不成立时用 `otool -l` 的 `__TEXT` vmaddr 换算）。
1. 反汇编里找到判定分支，例如 `cmp w0,#0 ; b.eq <失败>`。
2. 改一条指令：`b.eq` → `nop`（0x1F2003D5）或直接 `mov w0,#1 ; ret`。
3. 用 `xxd`/`010 Editor` 按偏移写回（先备份 `.orig`）。
4. 重新打包：iOS 需 `codesign -f -s -`（fakesign）后 `ios-deploy` 安装；Android 改 `libapp.so` 后重签 APK（见技能 `apk-crack`）。
5. 校验：改完启动，功能按钮状态变化即成功；如果闪退，多半是改到了 Dart 的**类型检查桩**（`--obfuscate` 后更常见），换相邻分支再试。

## 5. 常见坑
| 坑 | 原因 | 对策 |
| --- | --- | --- |
| `strings` 什么都搜不到 | 开了 `--obfuscate` | 用 Blutter 的 `pp.txt` 看对象池字符串，或用 `kernel_blob` |
| `otool` 全是 `sub_xxx` | 符号被剥 | 正常，靠 Blutter 恢复 |
| 补丁后白屏 | 改到了 flutter engine 初始化路径 | 只改业务判定，别碰 `main` 附近的 AOT 引导 |
| iOS 装不上 | 签名无效 | `codesign -f -s -` 后重打包，或直接用 TrollStore/越狱设备 |

## 6. 落库
- 会员/付费判定位置（偏移 + 原指令 + 新指令）→ `redteam_vuln_add`（title="<App> 会员校验（Flutter AOT）"）；
- 补丁脚本/重签流程 → `redteam_attack_file_add`（kind=script）；
- 目标 App 资产 → `redteam_asset_add`（surface 写 Bundle ID / 版本 / Dart 版本）。
