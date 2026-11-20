---
name: kb-maintenance
description: 红队库运维：nuclei 模板灌库、情报巡检、论坛抓取与入库（kb_note）、覆盖率统计、三份副本同步与重启验证——改库前后都按这份 runbook 走
whenToUse: 要给知识库灌数据、扩技能/工具、排查"改了没生效"、或需要统计抓取覆盖率时
role: vuln-scan
enabled: true
---

# 库运维 runbook（改库 = 改代码 + 灌数据 + 同步 + 重启）

## 1. 三份安装副本（最容易漏的一步）
仓库改完必须同步到运行中的两份，否则 dsh 读的还是旧文件：
```bash
SRC=F:/MyApp/梦神破甲-v1.1.71
for C in "$USERPROFILE/.dsh/profiles/desktop/node_modules/梦神破甲" \
         "C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/plugins/梦神破甲"; do
  cp "$SRC/lib/redteam/"*.js "$C/lib/redteam/"
  cp "$SRC/skills/redteam/"*.md "$C/skills/redteam/"
  cp "$SRC/scripts/"*.mjs "$C/scripts/" 2>/dev/null
done
cp "$SRC/skills/redteam/"*.md "$USERPROFILE/.dsh/redteam/skills/"
```
然后 `node --check` 每个改动文件 → **重启 dsh**（插件模块只在启动时加载）。

## 2. 数据面：两张表 + 一个目录
| 对象 | 位置 | 写入方式 |
| --- | --- | --- |
| `poc`（漏洞/POC，跨靶标） | `knowledge.db` | `import-nuclei-templates.mjs` / `redteam_poc_add` |
| `kb_note`（论坛帖、文章、资源索引） | `knowledge.db` | `pojie-import-kb.mjs` / `kanxue-article.mjs --import` / `redteam_note_add` |
| 原文 Markdown | `$DSH_HOME/redteam/{pojie,kanxue}-articles/` | 抓取脚本自动落盘 |

检索：`redteam_note_search({ q })`（<3 字走 LIKE，≥3 字走 FTS5 trigram）、`redteam_poc_search({ q })`。

## 3. 灌库命令（按需选）
```bash
node scripts/import-nuclei-templates.mjs            # nuclei 模板（幂等，--reset 清表，--content all|none）
node scripts/pojie-import-kb.mjs                     # 吾爱原文 + 列表快照 → kb_note
node scripts/kanxue-article.mjs 293473 --import      # 看雪单帖 → kb_note
node scripts/intel-sweep.mjs --days 7                # 情报巡检 → intel-sweep-*.md
node scripts/pojie-stats.mjs --delay 4000            # 覆盖率统计（版块/主题/深度三口径）
```

## 4. 抓取节奏（写死，别改快）
- 间隔 **≥4000ms**（±40% 抖动），单轮 **≤5 个版块**；
- 遇到挑战页（"Please enable JavaScript"）→ 等 8s 复查，仍失败**整轮停手**，冷却 5~10 分钟；
- 站内搜索/付费区需要 cookie：放 `$DSH_HOME/redteam/cookies/<host>.txt`（Netscape 或 `a=b; c=d`），用 `node scripts/check-login.mjs <url> --path /xxx` 验 `LOGGED_IN`。

## 5. 三个已踩过的坑（别再犯）
| 坑 | 现象 | 对策 |
| --- | --- | --- |
| 迁移判断写错 | `kb_note` 每次打开被 DROP，数据只剩 1 条 | 判断条件只能是"唯一键不含 kind"，别加恒真子句 |
| FTS 分词 | 搜「脱壳」0 条 | `tokenize='trigram'` + 短词 LIKE 兜底 |
| 产物覆盖 | 每轮抓取写同一个 JSON，历史批次丢失 | 文件名带时间戳与 fids |

## 6. 验收清单
1. `node --check` 全部通过；
2. `redteam_note_search` 能搜到新灌条目，`noteStats.total` 增长；
3. `redteam_preflight` 里新工具/新技能可见；
4. 面板技能库页无 parse 失败（`parseSkillDocument` 全 true）；
5. 重启后 `preset-declare.json` 仍为 `registered`。
