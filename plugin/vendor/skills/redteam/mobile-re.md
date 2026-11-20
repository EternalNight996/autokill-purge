---
name: mobile-re
description: Android / iOS 逆向与移动端攻防：jadx/apktool/frida/objection/adb 标准流程 + 上游 51 个技能的用法约定（NoraStory/reverse-SKILL、8kSec 索引）
whenToUse: 目标是 APK / IPA / 小程序包，或需要绕过证书固定、脱壳、抓包、改包重签时
role: exploit
enabled: true
---

# 移动端逆向（Android 优先）

## 标准流程（每一步都有落点）
| 阶段 | 命令 | 落库 |
| --- | --- | --- |
| 取包 | `adb shell pm path <pkg>` → `adb pull`；iOS 走 frida-ios-dump / 越狱设备 | 资产：`redteam_asset_add` |
| 看清单/权限 | `apktool d -f app.apk -o out`、`aapt2 dump badging` | 指纹：`redteam_asset_link` |
| 读逻辑 | `jadx -d src app.apk`（先搜 URL / 密钥 / 硬编码 token） | 漏洞：`redteam_vuln_add` |
| 动态 | `frida-ps -U` → `frida -U -f <pkg> -l hook.js`；`objection -g <pkg> explore` | 证据：`redteam_http_evidence_add` |
| 抓包 | 系统代理 + `objection android sslpinning disable` / frida 脚本绕 pinning | 请求包进 evidence |
| 改包重签 | `apktool b` + `apksigner sign` / `uber-apk-signer` | 攻击文件：`redteam_attack_file_add` |

## 本机工具（缺失就在「环境适配」页填路径）
`adb`、`jadx`、`apktool`、`frida` / `frida-server`、`objection`。
设备侧：`adb push frida-server /data/local/tmp/ && adb shell su -c "/data/local/tmp/frida-server &`。

## 上游技能库
- `NoraStory/reverse-SKILL`：**51 个技能包**，按"任务"分（脱壳 / 混淆还原 / 协议 / 反调试）。用法：先读它的 SKILL.md 索引，**把命中的那一篇展开成本次任务的步骤**，不要整包塞上下文。
- `8kSec/awesome-mobile-security`：移动端全景索引（工具 / 论文 / 靶场），拿来做补充检索。
- 通用逆向工具链与资源索引见技能 `re-arsenal`。

## 红线
- 只在授权靶标 / 自有设备上装 frida-server；不要批量扫描第三方 App 商店。
- 抓到的 token、证书、密钥一律进本机事实库，**不要贴进报告正文**。
