# memory-eternal 需求说明书

| 项 | 内容 |
| --- | --- |
| 版本 | v1.1（详细版） |
| 状态 | 待实现 |
| 提出方 | autokill-purge（web 端 web/server.mjs、装备清单 web/catalog.json） |
| 读者 | memory-eternal 的维护者 / 实现者 |
| 日期 | 2026-11-14 |

---

## 一页摘要（TL;DR）

我需要 **四件事**，都不涉及改检索算法：

1. **主键**：cards 加 card_key（唯一索引），从卡片 frontmatter 抽。
2. **存在性查询**：dsh-memory lookup <key...> --json 与 POST /api/lookup，返回 **四态**（approved / pending / rejected / missing），一次最多 200 个，≤100 ms，顺序与请求一致。
3. **写入回执 + 幂等**：capture 改成 upsert，返回 {action, key, id, state, path}，提交后立刻可查。
4. **健康单一来源**：GET /api/health 只给一个 version，alive 以「端口能否服务」为准。

**明确不动**：recall 的排序与召回、审批模型（我的写入永远进 pending）、现有 7550 张卡的内容。

---

## 1. 背景：谁在调用，为什么

```text
autokill-purge（本机）
  web/public        人的界面：装备清单、同步状态、云端开关
  web/server.mjs    服务端：只调 memory-eternal 的接口，不直连 SQLite
  web/catalog.json  要查询的条目（当前 6 项：4 个工具 + 1 个技能 + 1 个工作流）
        |
        v  CLI 或 HTTP
memory-eternal（本机 7999）
```

每次启动要回答的问题：

> 「purge.gear.plan_unpack 这条，在记忆库里是什么状态？」

| 状态 | 界面显示 | 下一步动作 |
| --- | --- | --- |
| approved | 已入库 | 无 |
| pending | 待审核 | 提示去审核中心 |
| rejected | 被驳回 | 显示驳回原因，允许重新提交 |
| missing | 缺失 | 提供「登记待审」按钮 |

### 为什么现在的做法不行

当前用 dsh-memory recall 之后再在命中内容里找 key 字符串，问题有三：

- recall 是**模糊召回**：对 6 个从未存在的 key，实测 **6/6 全部命中**，没有判断力；
- 待审卡**不在 cards 表里**（只在文件与 audit 日志里），查不到；
- capture 只返回一个路径（且带 degraded:true），没有 key/id/状态，无法追踪；
- 健康信息里三个版本号并存，且 alive:false 但端口在服务，调用方无法判断。

---

## 2. 术语

| 词 | 含义 |
| --- | --- |
| vault | 一个记忆库目录（~/.dsh/memory-vault），含 memory-eternal.db 与 Markdown 卡 |
| card | 一张知识卡：frontmatter + 正文 + 状态 |
| key | card_key，卡的稳定标识，跨库跨备份不变 |
| state | approved / pending / rejected / missing |
| kind | knowledge / project / skill / tool / workflow / mistake … |
| source | 谁提交：autokill-purge / deepseek-harness / session:<id> … |
| quarantine | 隔离区：损坏或无法解析的卡，不阻塞启动 |

---

## 3. 现状实测（证据）

2026-11-14 对 vault 副本做只读统计：

```text
cards 7550 · body 19.5 MB · DB 文件 121 MB（大头是 card_vec 14626 行向量 + FTS 索引）
kind:   knowledge 4741 · project 1583 · skill 370 · mistake 355 · content 325 · tool 142 · prompt 19 · business 13
status: approved 7550（pending 不在表内） · quarantine 22
recall 对 6 个未登记 key：6/6 命中（假阳性 100%）
body LIKE 全表扫描：36–42 ms/键（能查但不可索引，脆）
dsh-memory status --json：pkgVersion 0.15.0 · watchdog 0.40.1 · servedVersion 0.45.0 · alive=false 但 7999 返回 200
```

---

## 4. 需求总览

| 编号 | 需求 | 优先级 | 影响面 |
| --- | --- | --- | --- |
| R1 | 存在性查询（lookup，四态、批量、有序） | **必须** | 新增 CLI 子命令 + HTTP 端点 |
| R2 | 稳定主键 card_key + 索引 + 待审入库 | **必须** | 一次 schema 迁移 |
| R3 | capture upsert + 回执 | 强烈需要 | 改现有命令的返回值与语义 |
| R4 | GET /api/health 单一版本口径 | 强烈需要 | 新增只读端点 |

```text
R2（schema）--+--> R1（lookup 走索引）
              +--> R3（upsert 靠唯一索引做幂等）
R4 独立，不依赖其它三项
```

---

## 5. R1 · 存在性查询

### 5.1 接口

```sh
dsh-memory lookup <key> [<key> ...] --json [--source S] [--kind K] [--prefix P]
```

```http
POST /api/lookup
Content-Type: application/json

{
  "keys": ["purge.gear.plan_unpack", "purge.gear.audit_claims"],
  "filter": { "source": "autokill-purge", "prefix": "purge." }
}
```

filter 三个字段都可选，同时给出按 AND 组合；keys 为空时可按 filter 返回该来源全部卡。

### 5.2 响应

```json
{
  "ok": true,
  "results": [
    { "key": "purge.gear.plan_unpack", "state": "approved",
      "path": "03-Knowledge/解包计划.md", "kind": "tool", "source": "autokill-purge",
      "content_hash": "9f2c…", "updated_at": "2026-11-14T10:02:11Z" },
    { "key": "purge.gear.audit_claims", "state": "pending",
      "path": "04-Content/结论审计.md", "submitted_at": "2026-11-14T11:30:00Z" },
    { "key": "purge.gear.scan_packer_markers", "state": "rejected", "reason": "与已有卡重复" },
    { "key": "purge.flow.gear-install", "state": "missing" }
  ]
}
```

### 5.3 字段规则

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| key | 是 | 原样回显请求里的 key |
| state | 是 | approved / pending / rejected / missing |
| path | 有卡时 | vault 内相对路径 |
| kind / source | 有卡时 | 卡的元数据 |
| content_hash | approved 时 | 供同步比对 |
| updated_at / submitted_at | 有卡时 | ISO-8601 UTC |
| reason | rejected 时 | 驳回原因 |

### 5.4 硬性要求

1. **四态齐全**，pending 必须能查到（现在只在文件里）。
2. **批量**：一次最多 **200** 个 key，超出返回 400 too_many_keys。
3. **顺序**：results[i].key 必须等于 keys[i]（调用方按下标渲染）。
4. **性能**：200 keys ≤ **100 ms**，走 idx_cards_key，禁止全表 LIKE。
5. **确定性**：同 key 连续两次状态相同，不受其它卡内容影响。
6. **不返回正文**：body 不出现在响应里（体积与隐私）。
7. **只读**：不得修改 recall_count / last_recalled_at（那不是一次召回）。

### 5.5 错误码

| 场景 | HTTP | 错误码 | remediation |
| --- | --- | --- | --- |
| keys 超过 200 | 400 | too_many_keys | 分批，每批 ≤200 |
| key 不符合正则 | 400 | invalid_key | 指出第几个 key 非法 |
| 库不可用 | 503 | vault_unavailable | 先看 /api/health |

---

## 6. R2 · 稳定主键与索引

### 6.1 迁移 SQL（只增列、只加索引）

```sql
BEGIN;
ALTER TABLE cards ADD COLUMN card_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_key    ON cards(card_key) WHERE card_key IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX        IF NOT EXISTS idx_cards_source ON cards(source);
CREATE INDEX        IF NOT EXISTS idx_cards_kind   ON cards(kind);
COMMIT;
```

### 6.2 回填算法（幂等，可重复跑）

```text
对每张 card_key IS NULL 的卡：
  1. 读 frontmatter，取 key: ；没有则取 id: ；
  2. 校验 ^[a-z0-9][a-z0-9._-]{2,64}$，不合法则跳过；
  3. 若 key 已被占用（唯一索引冲突）→ 写 quarantine，reason=duplicate_key；
  4. UPDATE cards SET card_key=? WHERE id=?;
  5. 解析失败/文件缺失 → card_key 保持 NULL，进 quarantine，记日志，不阻塞启动。
```

### 6.3 schema 版本

```text
if schema_version < 2: 执行 6.1 + 6.2，然后写 schema_version = 2
if schema_version > 2: 拒绝启动并提示「库来自更新的版本」（不要静默降级）
```

实现方式二选一：新建 schema_version 表，或在现有 config 表加一行 schema_version=2。

### 6.4 兼容性

- 老卡 card_key 为 NULL：仍可 recall，只是 lookup 查不到（返回 missing）。这是可接受降级。
- 现有 7550 张卡的正文与 status **一个字节都不改**。

---

## 7. R3 · 写入回执与幂等

### 7.1 接口

```sh
dsh-memory capture <text|-> --source autokill-purge [--key K] [--kind tool] --json
```

```http
POST /api/upsert
{ "card": { "key": "purge.gear.plan_unpack", "kind": "tool",
             "title": "解包计划", "body": "…", "source": "autokill-purge" } }
```

### 7.2 响应

```json
{ "ok": true, "action": "created", "key": "purge.gear.plan_unpack",
  "id": 7551, "state": "pending", "path": "04-Content/解包计划.md",
  "content_hash": "a17b…" }
```

action 只有两个值：created（新建）与 updated（同 key 覆盖）。

### 7.3 状态迁移

```text
created  → pending
updated  → 内容替换 + 状态回到 pending（原来是 approved 也要重审）
审核通过 → approved（人操作）
审核驳回 → rejected + reason（人操作）
```

### 7.4 硬性要求

1. **提交即可查**：capture 返回后立即 lookup 该 key，必须得到 pending（不是 missing）。
2. **幂等**：同 key 二次提交 → action=updated，该 key 的卡数仍为 1。
3. **回执完整**：key / id / state / path / content_hash 缺一不可。
4. **不再有半成品**：不要返回 degraded:true 却没有卡；失败给错误码 + remediation。
5. **不自动批准**：写入永远 pending，approved 只能由人操作。

---

## 8. R4 · 健康与版本

```http
GET /api/health
```

```json
{ "ok": true,
  "vault": "C:/Users/you/.dsh/memory-vault", "db_bytes": 126000000,
  "version": "0.45.0", "port": 7999, "alive": true, "writable": true,
  "cards": 7550, "pending": 3, "quarantine": 22, "schema_version": 2 }
```

| 字段 | 规则 |
| --- | --- |
| version | **只有一个**，取正在服务的那个进程的版本 |
| alive | 以「端口能否服务请求」为准，不看锁文件里的 pid |
| writable | 当前库可否写（只读库或锁被占时为 false） |
| cards / pending / quarantine | 计数，供界面直接显示 |
| schema_version | 见 6.3 |

要修的现状：status --json 里 pkgVersion 0.15.0、watchdog 0.40.1、servedVersion 0.45.0 并存，且 alive:false 而端口在正常返回 200。

---

## 9. 数据契约（我这边会严格遵守）

| 项 | 规则 |
| --- | --- |
| card_key 正则 | ^[a-z0-9][a-z0-9._-]{2,64}$ |
| 我的前缀 | purge.（例 purge.gear.plan_unpack / purge.skill.autokill-purge / purge.flow.gear-install） |
| source | autokill-purge |
| kind | tool / skill / workflow |
| 正文长度 | 单卡 ≤ 32 KB；超出我这边先拆卡 |
| 内容纪律 | 只写方法与结论；**目标身份（真实路径 / sha256 / 客户名 / 账号 / token）不进记忆库** |
| 幂等 | 同 card_key 重复提交 = upsert，不新建 |

示例 frontmatter（我会这样写）：

```yaml
---
key: purge.gear.plan_unpack
kind: tool
title: 解包计划：按格式给出有序工具链
source: autokill-purge
tags: [purge, gear, tool]
---
```

---

## 10. 迁移与回滚

### 10.1 上线步骤

1. 备份：复制 vault 目录（含 db、wal、shm）到 backups/ 并记录时间戳；
2. 停服务（dsh-memory stop --port 7999）或确认无写入；
3. 执行 6.1 迁移 SQL；
4. 运行 6.2 回填（幂等，失败只影响单卡）；
5. 写 schema_version = 2；
6. 起服务，跑第 11 节验收；
7. 若第 6 步失败：恢复备份 + 删除 idx_cards_*（SQLite 不支持 DROP INDEX? 支持），回滚 card_key 列（需重建表，见 10.2）。

### 10.2 回滚策略

SQLite 不支持 DROP COLUMN 的旧版本：回滚时从备份恢复最快。因此 10.1 第 1 步的备份是硬性要求。
如果必须原地回滚：create table cards_old as select <原列> from cards; drop table cards; alter table cards_old rename to cards;

---

## 11. 验收（可直接复制执行）

| # | 命令 | 期望输出 |
| --- | --- | --- |
| 1 | dsh-memory lookup purge.gear.plan_unpack --json | state = missing |
| 2 | dsh-memory capture file-with-key.md --source autokill-purge --json | action=created, state=pending, 有 key/id/path |
| 3 | dsh-memory lookup purge.gear.plan_unpack --json | state = pending（提交即可查） |
| 4 | 重复第 2 步 | action=updated；select count(*) where card_key=… 仍为 1 |
| 5 | 200 个 key 的 POST /api/lookup | 单次往返 ≤100 ms；results 顺序与 keys 一致 |
| 6 | curl -s localhost:7999/api/health | 只有一个 version；alive=true；writable=true |
| 7 | 重启服务后再跑第 3 步 | 不丢（pending 或 approved） |
| 8 | dsh-memory recall <任意词> | 行为与升级前一致（排序、命中数不变） |

回归底线：**第 8 条必须过**——这次改动不许影响 recall 的任何外在行为。

---

## 12. 性能预算

| 操作 | 预算 |
| --- | --- |
| lookup 200 keys（本地 SQLite，索引） | ≤ 100 ms |
| lookup 1 key | ≤ 10 ms |
| upsert 单卡 | ≤ 50 ms（不含审核） |
| 迁移回填 7550 卡 | 一次性，≤ 60 s，可中断可续跑 |

---

## 13. 暂缓项与阈值

| 项 | 说明 |
| --- | --- |
| 多库切换（vaults[] + active_vault） | 破甲知识 ≤50 卡、占 0.26%，purge. 前缀 + source 过滤已够；触发切库的阈值：purge 卡 >300，或需按目标归档（单目标 ≥10 卡），或云端只允许同步破甲知识 |
| sync(keys) 云端比对 | 依赖多库，且冲突策略需人定 |
| mirror 离线快照 | 同上 |

---

## 14. 非目标

1. 不改 recall 的排序与召回逻辑；
2. 不新增第二套记忆库或第二条写入路径；
3. 不为「存在性」引入向量或 FTS，索引即可；
4. 不动现有 7550 张卡的正文与 status；
5. 不做自动批准。

---

## 附录 A · 我这边会怎么调用（接口就绪后一次改完）

```text
启动 → GET /api/health                            库在不在、版本、可写否
     → POST /api/lookup {keys, filter}            四态渲染：已入库/待审核/被驳回/缺失
缺失 → POST /api/upsert {card}                    返回后立刻重查一次确认 pending
```

临时实现（recall + 命中内容匹配 key）在接口就绪后**直接删除**，不留双路径。

## 附录 B · 我的 6 个条目（可直接当测试数据）

| key | kind | 标题 |
| --- | --- | --- |
| purge.gear.scan_packer_markers | tool | 壳识别：扫描加壳标记 |
| purge.gear.rank_check_candidates | tool | 授权判定候选排序 |
| purge.gear.plan_unpack | tool | 解包计划（按格式） |
| purge.gear.audit_claims | tool | 结论审计：证据有无 |
| purge.skill.autokill-purge | skill | autokill-purge 能力卡 |
| purge.flow.gear-install | workflow | 装车流程：编译 → config → plugins_refresh |

