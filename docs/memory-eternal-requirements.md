# memory-eternal 需求清单 v1.0

提出方：autokill-purge（web 端 `web/server.mjs` + 装备清单 `web/catalog.json`）
日期：2026-11-14 · 状态：待实现 · 优先级：R1/R2 必须，R3/R4 强烈需要

---

## 0. 一句话

**别给我检索算法，给我「按 key 查状态」和「写回执」。** 存在性是查表问题，不是相关性排序问题。

## 1. 使用场景（为什么需要）

web 端每次启动要对 6–200 个装备条目问一句：

> 「这一条在记忆库里是什么状态？」

必须能区分四态：`approved`（已入库）、`pending`（已登记待审）、`rejected`（被驳回）、`missing`（没有）。缺失的条目由我提交，**只进审核，不自动入库**。

现状做不到：`recall` 是模糊召回（实测 6/6 全命中，零判断力）；待审卡只在文件里，`cards` 表查不到；`capture` 无回执无幂等。

## 2. 数据契约（我这边会严格遵守）

| 字段 | 规则 |
| --- | --- |
| `card_key` | 正则 `^[a-z0-9][a-z0-9._-]{2,64}$`；我统一用 `purge.` 前缀，例 `purge.gear.scan_packer_markers`、`purge.skill.autokill-purge`、`purge.flow.gear-install` |
| 来源字段 | `source = "autokill-purge"` |
| 类型字段 | `kind = tool \| skill \| workflow` |
| 内容纪律 | 卡内只写方法与结论；**目标身份（真实路径 / sha256 / 客户名 / 账号 / token）不进记忆库**，留在项目目录 |
| 幂等 | 同 `card_key` 重复提交 = upsert（更新内容并重置为 `pending`），不新建卡 |

## 3. 需求 R1｜存在性查询（必须）

### 接口

```
CLI:   dsh-memory lookup <key...> --json [--source S] [--kind K] [--prefix P]
HTTP:  POST /api/lookup
       { "keys": ["purge.gear.plan_unpack", ...],
         "filter": { "source": "autokill-purge", "kind": "tool", "prefix": "purge." } }
```

### 返回

```json
{ "ok": true,
  "results": [
    { "key": "purge.gear.plan_unpack", "state": "approved",
      "path": "03-Knowledge/…md", "kind": "tool", "source": "autokill-purge",
      "content_hash": "…", "updated_at": "2026-11-14T10:00:00Z" },
    { "key": "purge.gear.audit_claims", "state": "pending", "path": "04-Content/…md" },
    { "key": "purge.flow.gear-install",  "state": "missing" }
  ] }
```

### 要求

- **四态**必须齐：`approved / pending / rejected / missing`；`pending` 必须能查到（现在只有文件）
- **批量**：一次最多 200 个 key，一次往返
- **性能**：200 keys ≤ 100 ms（索引命中，非全表扫描）
- **确定性**：同 key 连续两次查询结果一致；不受其它卡内容影响
- **顺序**：返回顺序与请求顺序一致（我按下标渲染）

## 4. 需求 R2｜稳定主键 + 索引（必须）

```sql
-- 一次性迁移：只增列 + 只加索引，不改任何既有语义
ALTER TABLE cards ADD COLUMN card_key TEXT;
UPDATE cards SET card_key = <从 frontmatter 的 key: 抽取，缺则用 id:，都缺留 NULL>;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_key    ON cards(card_key) WHERE card_key IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX        IF NOT EXISTS idx_cards_source ON cards(source);
CREATE INDEX        IF NOT EXISTS idx_cards_kind   ON cards(kind);
```

实现要点：

- 新卡在 `capture` 时写入 `card_key`；待审卡**先入库**（`status='pending'`），文件只是投递物
- 回填失败的卡：`card_key IS NULL`，**不阻塞启动**，进 `quarantine` 并记日志
- 需要 `schema_version` 表（或给现有 `config` 加一行 `schema_version=2`），供升级判断

## 5. 需求 R3｜写入回执 + 幂等（强烈需要）

```
CLI:   dsh-memory capture <text|-> --source autokill-purge [--key K] --json
HTTP:  POST /api/upsert  { "card": { "key", "kind", "title", "body", "source" } }
```

返回：

```json
{ "ok": true, "action": "created|updated", "key": "purge.gear.plan_unpack",
  "id": 7551, "state": "pending", "path": "04-Content/…md", "content_hash": "…" }
```

要求：

- **提交即可查**：`capture` 返回后立即 `lookup` 该 key 必须得到 `pending`
- **幂等**：同 key 二次提交 → `action:"updated"`，卡数不变
- 不再返回 `degraded:true` 这种半成品：要么成功，要么返回错误码 + remediation

## 6. 需求 R4｜健康与版本单一来源（强烈需要）

```
GET /api/health   →  { "ok": true, "vault": "C:/…/memory-vault", "db_bytes": 126000000,
                      "version": "0.45.0", "port": 7999, "alive": true, "writable": true,
                      "cards": 7550, "pending": 3, "schema_version": 2 }
```

要求：**版本只有一个**（现在 `status --json` 同时给 0.15.0 / 0.40.1 / 0.45.0，且 `alive:false` 但端口 200 在服务，调用方无法判断）。`alive` 以“端口能否服务请求”为准。

## 7. 暂缓项（这一轮不做，别为其加复杂度）

| 项 | 为什么暂缓 |
| --- | --- |
| 多库切换（`vaults[]` + `active_vault`） | 破甲知识 ≤50 卡，占 0.26%；逻辑隔离（`purge.` 前缀 + `source` 过滤）已够。等 purge 卡 >300 或需要按目标归档再切 |
| `sync(keys)` 云端比对 | 依赖多库；且冲突策略需要人定 |
| `mirror` 离线快照 | 同上 |
| 改 `recall` 算法 / 换向量模型 | **明确不动**。`recall` 继续做模糊召回 |
| 改审批模型（自动批准） | **明确不动**。我的写入永远进 pending |

## 8. 非目标（写清楚，避免误改）

1. 不改 `recall` 的排序与召回逻辑
2. 不新增第二套记忆库/第二条写入路径
3. 不为“存在性”引入向量或 FTS（索引即可）
4. 不动现有 7550 张卡的正文与 `status`

## 9. 验收清单（可直接跑）

| # | 命令 | 期望 |
| --- | --- | --- |
| 1 | `dsh-memory lookup purge.gear.plan_unpack --json` | 返回 `state: "missing"`（未登记的 key） |
| 2 | `dsh-memory capture '...\nkey: purge.test.one\n...' --source autokill-purge --json` | `{action:"created", state:"pending", key:"purge.test.one"}` |
| 3 | 立即 `dsh-memory lookup purge.test.one --json` | `state: "pending"`（证明提交即可查） |
| 4 | 重复第 2 步 | `action:"updated"`，并 `select count(*) from cards where card_key='purge.test.one'` = 1 |
| 5 | 200 个 key 批量 `POST /api/lookup` | 单次往返 ≤100 ms，顺序与请求一致 |
| 6 | `curl -s localhost:7999/api/health` | 只有**一个** `version`，`alive:true`，`writable:true` |
| 7 | 重启服务后再查第 2 步的 key | 仍为 `pending` 或 `approved`（不丢） |

## 10. 我这边的对接方式（接口就绪后一次改完）

```text
启动 → GET /api/health                       （库在不在、版本、可写否）
     → POST /api/lookup {keys:[…], filter:{source:"autokill-purge"}}
     → 列表渲染四态：已入库 / 待审核 / 被驳回 / 缺失
缺失 → POST /api/upsert {card:{key:"purge.…", kind, title, body, source}}
     → 立即重查一次，确认 state=pending
```

当前实现（接口未就绪时的临时态）：`recall` + 命中内容里匹配 key；接口就绪后删掉该分支，不留双路径。
