---
name: iot-ble
description: BLE 蓝牙通信分析：Android 系统级 HCI 抓包、Wireshark 解析、service/characteristic 还原、指令重放与蓝牙锁/充电桩/门禁类设备测试
whenToUse: 目标是 BLE 设备（充电桩、蓝牙锁、手环、门禁、医疗器械），需要抓包还原指令或验证未授权写入时
role: exploit
enabled: true
---

# BLE 通信分析（先抓包，再还原，最后重放）

来源：吾爱破解 `thread-1909864`（扫码充电桩蓝牙 BLE 通信分析）。

## 1. 抓包（三种，按可达性选）
| 方式 | 做法 | 适用 |
| --- | --- | --- |
| **手机系统级 HCI 日志**（最省事） | ColorOS：拨号 `*#800#` → 反馈工具箱 → 通信模组 → 蓝牙 → 开始抓取 → 操作 App → 结束；然后 `adb pull /sdcard/Android/data/com.oplus.logkit/files/Log .`，日志在 `Log/<日期>/common/debuglogger/connsyslog/bthci/CsLog_*/xxx.cfa` | 国产 ROM（OPPO/一加/realme 等） |
| 原生 Android btsnoop | `adb shell setprop persist.bluetooth.btsnooplogmode full` → 抓完 `adb pull /data/misc/bluetooth/logs/btsnoop_hci.log`（需 root） | AOSP/可 root 设备 |
| 硬件嗅探 | nRF Sniffer（nRF52 dongle）/ Ubertooth / ESP32 BLE sniffer → Wireshark | iOS 目标、或需要抓广播与配对过程 |

Wireshark 打开 HCI 日志后先看 `btle` / `btatt` 层；关键过滤：
`btatt.opcode == 0x52`（Write Command）、`btatt.opcode == 0x12`（Write Request）、`btatt.handle == 0x0012`、`btatt.value`。

## 2. 还原协议（BLE 概念只有两层）
- 一个设备 = 多个 **Service**，一个 Service = 多个 **Characteristic**；
- 所有业务动作都是对某个 Characteristic 做 **read / write / notify**；
- 日志里记的是 `handle`（不是 UUID），先用 nRF Connect 把 handle ↔ UUID ↔ 权限（read/write/notify）对上。

步骤：
1. 按 `handle` 聚合写入的 `value`（十六进制），排出指令序列；
2. 找固定头（magic/命令字）、长度、序号、校验（CRC/异或和）、时间戳；
3. 用 App 的可见状态对照（例如"启用充电"按钮）→ 定位**那一条**关键写指令；
4. 把该条指令拆成字段表（opcode/参数/校验），下一步才能改。

## 3. 重放与验证（不需要 App）
| 工具 | 用法 |
| --- | --- |
| nRF Connect | 手动写 characteristic，验证单条指令是否生效 |
| `gatttool -b <MAC> -I` → `connect` / `char-write-req 0x0012 <hex>` | Linux 脚本化 |
| Python `bleak` | `await client.write_gatt_char(uuid, bytes.fromhex(...))`，可批量与自动化 |
| Flipper Zero / ESP32 | 现场无电脑时重放 |

判定标准：**不经过 App、直接写那条指令**，设备状态发生变化 = 无认证写入成立。

## 4. 五类常见问题（测试点）
| 问题 | 怎么验 |
| --- | --- |
| 无认证写入 | 断开 App，直接用 nRF Connect 写关键 handle |
| 静态密钥/明文 | 写入值里出现固定段（同型号设备一致）→ 说明没做每设备密钥 |
| 重放 | 抓一条成功指令，隔几分钟原样重放；仍生效 = 无防重放（无 nonce/时间窗） |
| 广播泄漏 | `btle` 层看 Advertising Data，是否带设备 ID/固件版本/序列号 |
| 配对降级 | 支持 Just Works 的设备可用任意手机配对后读敏感特征 |

## 5. 落库
- 关键指令（hex + 含义 + 是否需要配对）→ `redteam_vuln_add`（title="<设备型号> BLE 未授权写入"，evidence 写"不经 App 写入后设备状态变化"）；
- 重放脚本/字段表 → `redteam_attack_file_add`（kind=script）；
- 设备资产 → `redteam_asset_add`（surface 写 MAC/型号/固件版本）。

## 6. 纪律
只对自有或授权设备做；不要扫公共场所的 BLE 设备（会干扰他人设备，也容易被定位）。
