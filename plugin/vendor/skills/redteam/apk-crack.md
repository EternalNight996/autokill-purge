---
name: apk-crack
description: Android 应用破解：签名校验与完整性检测、去广告与解锁付费、加固脱壳（360/梆梆/爱加密）、root 与模拟器检测绕过、重打包与 v2/v3 签名
whenToUse: 需要改 APK 行为（去广告、解锁功能、绕过检测），或分析加固样本时
role: exploit
enabled: true
---

# APK 破解（脱壳 → 改 → 重签 → 验）

## 0. 工具与顺序
`apktool d -f app.apk -o out`（资源/smali）→ `jadx -d src app.apk`（读 Java 语义）→ 改 smali → `apktool b out -o patched.apk` → `apksigner sign --ks my.jks patched.apk` → `adb install -r`。
先跑 `aapt2 dump badging app.apk`：包名、版本、是否 debuggable、targetSdk（影响 frida 与存储路径）。

## 1. 四类常见校验与改法
| 校验 | 特征 | 改法（smali） |
| --- | --- | --- |
| 签名校验 | `getPackageInfo` + `GET_SIGNATURES`、`Signature.hashCode` | 让比较恒等：改 `if-eq`/`if-ne` 为无条件跳转，或两侧置同值 |
| 完整性/加固自检 | `checkSignature`、`verifyIntegrity`、native `JNI_OnLoad` 校验 | 先脱壳；native 校验用 frida hook 返回值 |
| root/模拟器检测 | `/system/xbin/su`、`test-keys`、`Build.FINGERPRINT` | hook `Runtime.exec`/`File.exists`，或把方法改返回常量 |
| 付费/会员判断 | `isVip`、`isPro`、`getUserLevel`、`purchaseState` | 方法体改 `const/4 v0, 0x1` 后 `return v0` |

## 2. 加固脱壳（顺序不能反）
1. 识别：`unzip -l app.apk | grep -E "libjiagu|libshell|libDexHelper|libsecexe"` → 360 / 梆梆 / 爱加密 / 乐固。
2. 脱壳（择一）：`frida-dexdump -U -f <pkg>`（最省事）；设备端 `BlackDex`；动态 dump 后修 dex header。
3. 验证：脱出 dex 里能搜到业务类名（如 `com.xxx.pay`）才算成功；只有壳类名说明还没脱到。
4. 脱壳产物直接用 `jadx` 读，**不要**改了再塞回加固包（会再次校验）。

## 3. 运行时绕过（比改包稳）
- `objection -g <pkg> explore` → `android root disable`、`android sslpinning disable`、`android hooking search classes <kw>`。
- frida：`Java.perform` hook 目标方法返回 true；native 用 `Interceptor.attach` 改 `retval`。
- 抓包：pinning 绕过后用 mitmproxy；证书装**系统区**（Android 7+ 不信任用户证书），或 `adb shell settings put global http_proxy`。

## 4. 重打包兼容检查
- `apksigner verify -v patched.apk` 必须过 v2/v3（Android 11+ 拒装只签 v1 的包）。
- `targetSdk >= 30` 时 `android:exported` 必须显式声明，否则装不上。
- 改过的包不要上传应用商店/第三方平台做分发测试。

## 5. 落库
校验类型与绕过点 → `redteam_vuln_add`（evidence 写类名+方法签名+改前改后 smali）；通杀脚本 → `redteam_poc_add`（category=auth-bypass）；目标 App → `redteam_asset_add`（surface 写包名/版本/加固厂商）。
