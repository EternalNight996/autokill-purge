---
name: vuln-intel
description: 漏洞情报口径：NVD + CNVD + Exploit-DB + CISA KEV + ATT&CK 的查询顺序、证据要求与落库规范（国产组件先查 CNVD，在野利用先查 KEV）
whenToUse: 拿到组件/版本要判断"有没有已知漏洞、有没有在野利用、有没有现成 POC"时
role: vuln-scan
enabled: true
---

# 漏洞情报（按这个顺序查，别乱搜）

1. **CNVD**（国产组件/中间件首发常比 NVD 早）→ 组件名 + 版本；
2. **NVD / CVE**（`https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-XXXX-XXXX`，无 key 有速率限制；查 keyword 时加 `keywordSearch`）；
3. **Exploit-DB / PoC-in-GitHub**（有没有现成 EXP，判断可利用性）；
4. **CISA KEV**（`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`）→ 是否**在野已利用**，决定优先级；
5. **MITRE ATT&CK**（打完拿到的权限对照战术/技术编号，用于报告与得分点归属）。

## 判定与落库
- 查到 ≠ 命中：必须在自己目标上用 `redteam_vuln_add` 写清 `cve`、`severity`、`confidence`、`evidence`（原始请求/回显）。
- 有现成 POC 且验证过 → `redteam_poc_add`（`verified: true` + `verified_note` 写目标与回显）；只有情报没有验证 → `verified: false`，别当战果。
- 利用成功 → `redteam_score_hit`，`evidence` 里带 CVE 与命令回显；未验证的一律标"待验证"。

## 纪律
- 情报查询是**只读外部请求**，不触碰目标；不要把 payload 直接打到未授权资产上。
- 版本号只信自己从响应里取到的（`Server:`、favicon hash、`/actuator/info`），不信扫描器猜的。
- 报告里引用编号即可，**不要整段复制厂商公告**。
