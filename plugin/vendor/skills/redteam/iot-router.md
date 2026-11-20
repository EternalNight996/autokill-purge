---
name: iot-router
description: 家用路由器/IoT 网关漏洞挖掘（OpenWrt 魔改系）：固件解包（ubifs→ubireader+unsquashfs）、Lua CGI 定位、魔改 luac 反编译、formvalue 直接进 shell/uci 的审计点、未授权 vs 授权接口的取舍
whenToUse: 目标是家用路由器/网关（小米、OpenWrt 系），需要从固件里挖未授权/RCE 或复现历史漏洞时
role: vuln-scan
enabled: true
---

# 路由器/IoT 固件漏洞挖掘（OpenWrt 魔改系）

来源：吾爱破解 `thread-2040053`（某米路由器漏洞挖掘分享），配合 `unpacking`、`iot-ble` 使用。

## 1. 取固件与解包
1. 官方下载页取固件（注意可能不是最新版）；拿到 `.bin` 后先 `binwalk -e` 看是不是 ubifs/squashfs。
2. **ubifs**（小米常见，不加密）：`ubireader_extract_images fw.bin` → `ubireader_extract_files -o out img.ubifs`；squashfs 段用 `unsquashfs`。
3. 关键目录（OpenWrt/LuCI 系）：
   - `usr/lib/lua/luci/controller/` —— CGI 路由与处理函数（**审计主战场**）
   - `usr/lib/lua/xiaoqiang/`（厂商自建库，如 `XQFunction`、`getErrorMessage`）
   - `etc/config/`、`etc/init.d/`、`usr/sbin/`（看有没有 `system()` 包装脚本）
4. 顺手确认：`/etc/shadow` 是否明文、`dropbear` 是否可登录、`nginx/uhttpd` 配置里的 `cgi-prefix`。

## 2. 反编译魔改 luac
- 直接打开 `.lua` 是**编译后的 luac**，且是厂商魔改版（标准 unluac 会报错）。
- 现成工具：**NyaMisty/unluac_miwifi**（针对小米魔改字节码）；其他厂商找对应 fork。
- 反编译出的是 `L0/L1/_UPVALUE0_` 风格，可读性差——**丢给模型做语义还原**（本例就是这么做的），还原出 `formvalue("mac")` / `_setMacFilter(...)` 这类真实调用，效率提升明显。

## 3. 审计点（按命中率排序）
| 点 | 特征 | 危害 |
| --- | --- | --- |
| **未授权接口** | 路由注册时没有 `luci.sys.iuser("root")` / `XQFunction.isAuth()` 校验 | 直接未授权（历史高危多出在这） |
| **formvalue 直进命令** | `formvalue("x")` 的值拼进 `os.execute` / `luci.sys.exec` / `io.popen` | 命令注入 RCE |
| **formvalue 直进 uci/文件** | `uci.set` / `io.open(path,"w")` 未过滤 `../` | 配置篡改 / 任意文件写 |
| **参数类型校验缺失** | 只判空不判格式（`datatypes.macaddr` 之类被绕过） | 逻辑绕过 |
| **诊断/测速类接口** | ping/traceroute/dns 参数直传 | 命令注入（经典） |
| **备份/恢复接口** | 上传 `.tar.gz` 直接解包 | 任意文件覆盖 → RCE |

## 4. 定位与验证（不用真机也能推进大半）
1. 静态：从 `controller/*.lua` 里 grep `formvalue` → 顺着看有没有进 `exec`/`io.open`/`uci`。
2. 路由：拼出 URL（LuCI 的 `/cgi-bin/luci/;stok=/...` 或厂商自定义前缀），确认是否需要 `stok`/token。
3. 动态：QEMU 跑固件（`qemu-mipsel -L ./ ./usr/sbin/uhttpd`）或用 FirmAE 一键起，再用 curl 打接口。
4. 判据：**未带任何 Cookie/token 也返回 200 且产生副作用**（写配置、执行命令），才算未授权。

## 5. 提交与合规（原文的真实经验）
- 厂商 SRC（如小米）对这类漏洞有赏金，先确认**在范围内、最新固件仍复现**。
- 报告结构：固件版本 → 解包与反编译证据 → 请求包（原始 HTTP）→ 回显/副作用 → 影响面 → 修复建议。
- 别在公网设备上验证（哪怕只读）；用自己买的同型号设备或 QEMU。

## 6. 落库
- 漏洞 → `redteam_vuln_add`（cve 可空，title 写"<型号> <接口> 未授权/命令注入"，evidence 放原始请求 + 回显）；
- 复现脚本/请求包 → `redteam_attack_file_add`（kind=poc）；
- 设备资产 → `redteam_asset_add`（surface 写型号/固件版本/接口前缀）。
