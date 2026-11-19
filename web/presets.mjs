// 装备预设（从 web/public/app.js 的 PRESETS 抽出来的同一份数据，供 /api/presets 与 MCP 使用）
// 改这里要同步改前端，或以后让前端也从 /api/presets 读。
export const EQUIP_PRESETS = [
  { id: "redteam", name: "红队全装", desc: "侦察、打点、横向、权限维持，一条链的默认装备。", agents: ["dsh"], items: [
    { id: "recon", name: "侦察与资产测绘", desc: "被动/主动收集、指纹识别、资产落库", skills: ["passive-recon", "fofa-recon", "recon-pipeline", "active-scan", "web-fingerprint", "asset-correlation"] },
    { id: "vuln", name: "漏洞验证与打点", desc: "Nday/1day、未授权、Web 漏洞链", skills: ["nuclei-scan", "unauth-exploit", "dir-bruteforce", "java-deserialization", "vuln-intel"] },
    { id: "shell", name: "WebShell 与隧道", desc: "冰蝎/哥斯拉马、suo5 socks5", skills: ["webshell-toolkit", "suo5-tunnel", "chisel-tunnel"] },
    { id: "lateral", name: "内网横向", desc: "凭据复用、域内枚举、跳板", skills: ["gogo-intranet", "fscan-intranet", "credential-attack", "lateral-movement", "privesc", "ad-attack"] },
    { id: "report", name: "战果与报告", desc: "攻击链、复现命令、证据截图", skills: ["kb-maintenance", "opsec-hide"] },
  ] },
  { id: "recon", name: "侦察刀", desc: "被动收集、资产测绘、指纹识别；只读，不碰目标。", agents: ["dsh", "autokill"], items: [
    { id: "passive", name: "被动收集", desc: "FOFA / crt.sh / 备案 / 被动 DNS", skills: ["passive-recon", "fofa-recon"] },
    { id: "fingerprint", name: "指纹识别", desc: "框架、中间件、CMS、组件版本", skills: ["web-fingerprint", "asset-correlation"] },
    { id: "asset-graph", name: "资产图谱", desc: "域名↔IP↔C 段↔证书↔服务", skills: ["asset-correlation", "recon-pipeline"] },
    { id: "surface", name: "攻击面清单", desc: "边缘资产、未备案、暴露服务", skills: ["active-scan", "nuclei-scan"] },
  ] },
  { id: "lateral", name: "内网横向", desc: "隧道、凭据、域内枚举；要求受控权限。", agents: ["dsh"], items: [
    { id: "tunnel", name: "隧道代理", desc: "suo5 / chisel / frp 出网", skills: ["suo5-tunnel", "chisel-tunnel", "frp-tunnel"] },
    { id: "cred", name: "凭据获取与复用", desc: "抓取、喷洒、PtH", skills: ["credential-attack", "lateral-movement"] },
    { id: "ad-enum", name: "域内枚举", desc: "BloodHound、Kerberoast、ACL", skills: ["ad-attack", "lateral-movement"] },
    { id: "privesc", name: "提权", desc: "配置类优先，内核最后", skills: ["privesc", "av-evasion"] },
  ] },
  { id: "radio", name: "无线电 / IoT", desc: "BLE、RFID、固件；偏硬件，动作小。", agents: ["mengbot"], items: [
    { id: "ble", name: "BLE 抓包与重放", desc: "HCI 抓包、service/characteristic 还原", skills: ["iot-ble"] },
    { id: "rfid", name: "RFID / 门禁", desc: "读卡、克隆、重放", skills: ["iot-ble"] },
    { id: "firmware", name: "固件解包", desc: "ubifs / squashfs、CGI 审计", skills: ["iot-router"] },
  ] },
  { id: "re", name: "逆向研究", desc: "样本、二进制、协议；本地隔离，只读原件。", agents: ["autokill"], items: [
    { id: "static", name: "静态逆向", desc: "r2 / Ghidra、符号与交叉引用", skills: ["binary-re", "re-arsenal"] },
    { id: "dynamic", name: "动态调试", desc: "x64dbg / Frida、断点与 hook", skills: ["re-arsenal", "mobile-re"] },
    { id: "unpack", name: "脱壳与样本", desc: "加壳识别、dump、IAT 修复", skills: ["unpacking", "unpacking"] },
    { id: "protocol", name: "协议还原", desc: "C2 协议、加密字段、重放", skills: ["binary-re", "jsvmp-reverse"] },
  ] },
  { id: "custom", name: "自定义", desc: "自己选智能体、权限与备注。", agents: [], items: [] },
];;
