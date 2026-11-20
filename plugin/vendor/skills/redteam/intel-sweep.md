---
name: intel-sweep
description: 信息差巡检：从比 NVD/KEV 更早的源（Exploit-DB 现成 EXP、oss-sec 披露原文、先知利用链、FreeBuf 复现、GitHub Advisory）捞新漏洞，按"可直接打"排序并与本地模板库对撞
whenToUse: 想抢在别人前面拿到刚公开的漏洞与 EXP，而不是等 KEV/NVD 登记时
role: vuln-scan
enabled: true
---

# 信息差（领先时间就是分数）

## 1. 源地图：谁先发、领先多久、拿到什么
| 源 | 领先时间 | 你拿到的是 | 可用性 |
| --- | --- | --- | --- |
| **Exploit-DB**（RSS） | 最快 | **现成 EXP 代码**，下载即跑 | 直连可用 |
| **oss-sec**（邮件列表） | 比 NVD 早 1~7 天 | 上游维护者原文：影响版本、触发条件、补丁 commit | 直连可用 |
| **先知社区**（xz.aliyun.com） | 比 KEV 早 1~3 天 | 中文**利用链分析 + 复现步骤** | 直连可用 |
| **FreeBuf** | 当日 | 中文披露/复现，常带 PoC 片段 | 直连可用 |
| **GitHub Advisory** | 比厂商公告早 | 生态库（npm/pip/Maven）漏洞与修复版本 | 直连可用 |
| CISA KEV | 最慢（已确认在野） | "确实有人在打"的背书 | 直连可用 |
| NVD | 最慢 | 结构化 CVSS/CPE | 直连可用（限速） |
| **吾爱破解**（52pojie 安全技术区 fid=4） | 当周 | 破解成品、Keygen、x64dbg/IDA 插件、去虚拟化环境 | 直连可用（**GBK 编码**，需浏览器 UA） |
| **看雪论坛**（bbs.kanxue.com） | 当日~3 天 | 原创逆向文：hook 检测、VMP 分析、外挂/加固逆、内核注入 | 直连可用（需浏览器 UA；RSS 403） |
| Project Zero / r/netsec / inthewild / CNVD | —— | 质量高但**当前直连超时或 521**，需要代理 | 本机不可达 |

## 1.5 抓取姿势（已经做成通用件，别再手搓）

所有源统一走 `scripts/lib/fetch-web.mjs`，它解决三件事：

| 问题 | 做法 |
| --- | --- |
| **UA 白名单**（52pojie / 看雪 对默认 UA 直接 403） | 内置 5 个真实浏览器 UA 池，403/429/503 自动换 UA 重试（带 Referer + Accept-Language: zh-CN） |
| **编码混杂**（52pojie 是 GBK，按 UTF-8 读标题全乱码） | 判定链：BOM → 响应头 charset → HTML `<meta charset>` → **UTF-8 严格解码（失败才退）** → GBK → latin1，结果写进报告 |
| **首访挑战**（Discuz 常返回挑战页/需 Cookie） | 进程内 Cookie 罐，同域后续请求自动带 Set-Cookie |

临时探一个站点：`node scripts/lib/fetch-web.mjs <url>` → 打印 `状态 / 编码 / 字节数 / 重试次数 / 页面 title`；`--json` 给脚本用。

仍要注意的：
- **52pojie** 首页列表是前端渲染 → 抓 `forum.php?mod=forumdisplay&fid=4`（逆向资源区）；**看雪** RSS `/rss.php` 恒 403，走首页。
- 列表页**没有发布时间**，巡检按"抓到即最新"处理；要精确时间就进帖子页解析 `<em id="authorposton`。
- 需要登录/验证码的版面（悬赏区、精华区）→ 交 `browser-automation`，不要硬刷（封 IP）。

```
node scripts/lib/fetch-web.mjs https://www.52pojie.cn/forum.php?mod=forumdisplay&fid=4
# → 200 gbk 172691B attempts=1 | 『逆向资源区』 - 吾爱破解 - 52pojie.cn
node scripts/lib/fetch-web.mjs https://bbs.kanxue.com/
# → 200 utf-8 261101B attempts=1 | 看雪安全社区｜专业技术交流与安全研究论坛
```

## 1.6 登录态（Cookie）——只有要看悬赏区/精华区时才需要

有些版面必须登录（52pojie 悬赏区、看雪 精华/资源区）。做法是给抓取器喂一份 Cookie 文件，**不要**把 cookie 贴进对话或写进脚本：

```
$DSH_HOME/redteam/cookies/
  52pojie.cn.txt        # 文件名 = 站点 host
  bbs.kanxue.com.txt
```

两种格式都认：浏览器插件导出的 **Netscape cookies.txt**（7 个 tab 字段），或直接粘请求头串 `a=b; c=d; ...`。

验证是否真的带上：`node scripts/lib/fetch-web.mjs https://www.52pojie.cn/ --json` → 看返回里的 `cookie` 数组。

注意：① 用专用小号，cookie 等于账号；② cookie 会过期，失效后报告里该站条数骤降，重导即可；③ 文件只在 `$DSH_HOME` 下，`.gitignore` 已排除 `cookies/`、`*.cookies.txt`。

## 1.7 抓取节奏（52pojie 有风控，别当 API 刷）

实测：短时间连发 28 个请求（全 27 版块 + 首页）会被返回 **"Please enable JavaScript and refresh the page."** 的挑战页（UTF-8、37 KB、无 title），冷却约 1 分钟后恢复。

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| 间隔 | **≥3000ms**（默认 3s，±40% 抖动） | 脚本参数 `--delay 3500` |
| 单轮版块数 | **≤5**（默认 5） | `--max-boards 6` 可放宽 |
| 触发挑战 | 等 8s 复查一次，仍失败就停手 | 冷却 5~10 分钟再跑，别硬刷 |
| 已抓页面 | 进程内缓存 | 同一次运行不会重复请求 |

实测（礼貌模式）：6 个版块 / 7 个请求 / 186 帖 / 28 秒 / 无风控；版块清单 27 个一次拿全。

## 2. 一条命令跑完巡检
§node scripts/intel-sweep.mjs --days 7§
- 抓 5 个源 → 去重（按 CVE/URL）→ 与本地 nuclei 模板库对撞（命中就说明"有现成验证手段"）→ 排序
- 排序权重：现成 EXP(3) + 有 CVE(2) + 本地有模板(2) + 多源同时出现(1) + 24h 内(1)
- 产物：§$DSH_HOME/redteam/intel-sweep-YYYYMMDD.md§；§--json§ 给脚本用
- 配套：§node scripts/vuln-intel.mjs§ 管官方口径（KEV/NVD），两个一起跑就是"社区抢跑 + 官方确认"

## 3. 命中之后（决定这条情报值不值钱）
1. **有现成 EXP / 有本地模板** → 立刻用 §redteam_poc_use§ 在授权目标上验，不要先读十篇文章。
2. 验通：§redteam_vuln_add§（cve/severity/evidence=原始请求+回显）+ §redteam_poc_add§（verified: true，verified_note 写目标与回显）。
3. 拿权限：§redteam_score_hit§ + §redteam_shot_add§。
4. 验不通就标"待验证"并写清卡在哪（版本不符/需要认证/WAF），**不要**把情报当战果。

## 4. 纪律
- 情报抓取是**只读外部请求**，不向目标发包；主动验证只对授权目标做。
- 中文源的文章常带完整 payload，直接抄会踩"目标版本不匹配"的坑：先对版本，再动手。
- 单源出现的新 CVE 先当"未证实"，等第二源（oss-sec 原文 / 厂商公告）确认再排期。
