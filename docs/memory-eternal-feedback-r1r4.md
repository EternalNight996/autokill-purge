# R1–R4 复核反馈（autokill-purge → memory-eternal）

| 项 | 内容 |
| --- | --- |
| 复核时间 | 2026-11-14 23:5x |
| 复核对象 | 运行实例 :7999（v0.45.0）+ 仓库 HEAD 3c3df33 起的 :8001 |
| 结论 | 三个接口能用，但发现 1 个阻塞级缺陷、4 个需确认点 |

---

## B1（阻塞）驳回后 lookup 仍返回 pending

复现（全程可重放）：

```sh
# 1) 登记一张测试卡
curl -s -X POST http://127.0.0.1:7999/memory-eternal/api/upsert \
  -H "content-type: application/json" \
  -d '{"card":{"key":"purge.test.one","kind":"tool","title":"t","body":"b","source":"autokill-purge"}}'
#    -> {"action":"created","state":"pending","path":"07-Tools/t.md"}

# 2) 驳回它
dsh-memory audit reject 07-Tools/t.md --reason "测试卡"
#    -> rejected

# 3) 再查
curl -s -X POST http://127.0.0.1:7999/memory-eternal/api/lookup \
  -H "content-type: application/json" -d '{"keys":["purge.test.one"]}'
#    期望：state=rejected, reason=测试卡
#    实际：state=pending
```

实际证据：audit list --status rejected 里已经有这张卡（07-Tools/解包计划v2.md），文件也已从磁盘删除，但 lookup 仍报 pending。

影响：集成方界面上被驳回的条目会永远显示「待审核」，人看不到驳回，也不会去重提。

建议：lookup 映射 quarantine 时读该行的审核状态（rejected 优先于 pending），并回传 reason。

---

## B2（阻塞）audit reject --reason 没被保存

```sh
dsh-memory audit reject 07-Tools/解包计划v2.md --reason "autokill-purge 集成验证测试卡"
dsh-memory audit list --status rejected --json
# 实际：{"path":"07-Tools/解包计划v2.md","reason":""}   <-- 空
```

影响：集成方无法把驳回原因回显给人，只能显示「被驳回」。

---

## B3（需确认）非法 key 不报 400

```sh
POST .../lookup  {"keys":["nope.bad..key","PURGE.LOUD.KEY"]}
# 实际：200 + state=missing
# 期望（需求 5.5）：400 invalid_key，指出第几个 key 非法
```

影响：key 前缀写错（例如漏写 purge.）与「真的没有」表现完全一样，配置错误被吞掉。
（本轮我真踩过：catalog 里 6 个 key 一开始没加 purge. 前缀，全部显示 missing。）

---

## B4（需确认）health.pending 恒为 0 的语义

```
cards: 7580 全部 approved · pending: 0 · quarantined: 46
但 lookup 对同一张卡返回 pending
```

原因：新卡进 quarantine（审核队列），不是 cards.status=pending 的行；lookup 把 quarantine 映射成 pending。

建议二选一：

1. pending 改成「pending 卡 + quarantine」，或 health 里加 pending_review；
2. 或在文档里写明：pending 只数 cards 表，待审条数看 quarantined。

现在这个字段名会误导集成方（我第一次按它判断「没有待审」，判错了）。

---

## B5（需确认）quarantine 只增不减

```
22:19  quarantined 42
23:0x  quarantined 42
23:5x  quarantined 46   （期间只有 1 次 upsert + 1 次 reject + 1 次服务重启）
```

请确认：

1. reject 之后那一行是否仍留在 quarantine（怀疑是它推高了计数）；
2. quarantine 有没有保留策略（时间/条数）与人工清理入口；
3. 本次集成只贡献 1–3 行，其余增量是谁的。

---

## 复核通过的部分

| 项 | 结果 |
| --- | --- |
| schema 迁移 | cards.card_key / quarantine.card_key / idx_*_key / idx_*_source 全在，schema_version=2 |
| lookup 四态 | approved / pending / rejected / missing 均能出现（rejected 见 B1 例外） |
| 顺序与重复 key | 请求 [a, b, a, bad, c] → 下标一一对应，重复 key 各自返回 |
| 200 keys 性能 | 7.9 ms（:7999）/ 同量级（:8001 HEAD 3c3df33） |
| 201 keys | 413 一次最多 200 个 key |
| filter 不匹配 | 返回 missing（符合预期） |
| upsert 幂等 | created → updated，同 key 卡数保持 1 |
| health | version 单值 0.45.0、alive/writable/schema 正确 |

> 提醒：核对库状态要看 WAL。只复制 memory-eternal.db 会看不到迁移（迁移在 6.5 MB 的 -wal 里）。

