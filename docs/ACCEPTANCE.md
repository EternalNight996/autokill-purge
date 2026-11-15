# autokill-purge · 验收清单

> 把 `REQUIREMENTS.md` §4（AC）与 §8（测试矩阵）映射成**一条可执行用例**。统一 Node，唯一 run 脚本：`test/acceptance.mjs`。
> 能自动化的都在脚本里；不能的（插件 WASM、需要 GUI/外部服务状态的）写明手测步骤。**任何未跑过的用例不算通过。**

## 运行方式（统一）

```console
node test/acceptance.mjs --break-only   # M1 break 内核（无需服务）
node test/acceptance.mjs                # 全量：break + Web（需先 node web/server.mjs）
```

环境变量：`PORT`（默认 8792）、`PURGE_WEB_BASE`。退出码 `0` = 全部 PASS；`1` = 有 FAIL。

脚本自带：§12 全量断言、§6 计时（info≤2s / scan≤5s / patch≤1s / verify≤3s）、M1 负向核心（expect 不匹配退出 3、非 PE 退出 4、越界、.bak 损坏拒 restore）、协议门 403/200、breach 生成与空任务拒绝、分配 2→3 卡实时端点、未选智能体拒绝。

---

## 一、M1 内核（§8 正向 1–7 + 负向核心）

### 正向（脚本自动化）

| # | 用例 | 对应 AC | 脚本位置 | 判定 |
|---|---|---|---|---|
| 1 | info 返回 ≥7 节 + 熵值 | AC-3.1 | 用例 1 | `ok && sections.length>6 && 每节有熵` |
| 2 | scan 命中 ≥1 条带引用点 | AC-3.2 | 用例 2 | `ok && hits.length>0 && 有 xrefs` |
| 3 | plan 给候选 | §8 | 用例 3 | `ok && candidates[]` |
| 4 | patch 下刀 + sha 前后 | AC-3.4 | 用例 4 | `ok && shaBefore≠shaAfter` |
| 5 | verify differingBytes=写入长度 | AC-3.4 | 用例 5 | `ok && differingBytes==7` |
| 6 | invert 翻转条件跳转 | §8 | 用例 8 | `ok && before≠after` |
| 7 | restore 后 sha 与原始一致 | AC-3.5 | 用例 7 | `ok && sha==原始` |
| — | journal 有完整记录 | AC-8.2 | 用例 6 | `ok && 有 patch 记录` |

### 负向核心（脚本自动化）

| # | 用例 | 对应 AC | 脚本位置 | 判定 |
|---|---|---|---|---|
| N1 | expect 不匹配 → 退出 3 + sha 不变 | AC-8.1 / AC-3.3 | 用例 9 | `exit==3 && sha 不变` |
| N2 | offset 越界 → 非零退出 + sha 不变 | §8 | 用例 11 | `exit≠0 && sha 不变` |
| N3 | 非 PE → 退出 4 | AC-8.4 / AC-3.6 | 用例 10 | `exit==4` |
| N4 | .bak 损坏 → restore 拒绝 | AC-8.3 | 用例 12 | `exit≠0 && 文件不变` |

### 负向·手测

| # | 用例 | 手测步骤 | 判定 |
|---|---|---|---|
| N5 | 文件只读 | `attrib +R <copy.exe>` 后 `patch` | 退出码 5，文件不变 |
| N6 | 路径含空格/中文 | 把 copy 放到 `测试 目录/copy file.exe` 再跑 info/scan | 正常输出，不因路径报错 |
| N7 | 重复 restore | restore 一次成功后立刻再 restore | 幂等或明确报错，不损坏文件 |

---

## 二、M2 控制台（AC-1/2/3/4/6/7）

| # | 用例 | 对应 AC | 自动化 | 判定 |
|---|---|---|---|---|
| W1 | 未签署 `/api/memory/stats` → 403 | AC-1.1 | 用例 13 | `status==403` |
| W2 | 签署后同请求 → 200 | AC-1.2 | 用例 13 | `status==200` |
| W3 | 不勾选时「签署」按钮 disabled | AC-1.3 | 手测（浏览器） | 按钮 `disabled` |
| W4 | 重签后再次弹窗 | AC-1.4 | 手测（设置页重签） | 弹窗重现 |
| W5 | 3 技术 + 任务 → ≥3 载荷含编码变体 | AC-2.1 | 脚本(2 技术≥2) + 手测(3 技术) | `variants≥3` |
| W6 | 空任务 → 明确提示不产载荷 | AC-2.2 | 用例 15 | 非 200 或 0 载荷 |
| W7 | 记录「通过」后命中率 0%→100% | AC-2.3 | 手测（breach/attempt 后 stats） | 通过率变化 |
| W8 | 切模型后「当前模型说明」变化 | AC-2.4 | 手测（破甲页切模型） | 说明随之变化 |
| W9 | info/scan/plan/patch/verify/restore 走 Web 两栏 | AC-3.1–3.6 | 手测（破甲页二进制栏） | 结果区 sha/differingBytes 呈现 |
| W10 | 未选智能体点发放 → 拒绝 | AC-4.1 | 用例 17 | 非 200 / ok:false |
| W11 | 发放后历史 +1，复制一致 | AC-4.2 | 手测（装备页） | 历史出现一条 |
| W12 | 统计与 `/stats` 一致 | AC-6.1 | 手测（记忆中心） | 数字一致 |
| W13 | 搜索「技能」有结果可打开 | AC-6.2 | 手测（记忆中心） | 有结果+详情 |
| W14 | 写卡 → `status:pending` 且未调 approve | AC-6.3 | 手测 + 查 writes.log | pending，日志无 approve |
| W15 | 改地址后「测试连接」成败+原因 | AC-7.1 | 手测（设置页） | 明确成败+原因 |
| W16 | 令牌保存后不回显明文 | AC-7.2 | 手测（设置页） | 输入框 `password`，不回显 |

---

## 三、M3 打通与装车（AC-5/9/10）

| # | 用例 | 对应 AC | 自动化 | 判定 |
|---|---|---|---|---|
| X1 | 勾 2 卡 → 端点 2 节 | AC-5.1 | 用例 16 | 端点含 2 节 |
| X2 | 再加 1 卡 → 端点 3 节（不重启） | AC-5.2 | 用例 16 | 端点含 3 节 |
| X3 | 只发技能卡 → 非 skill 过滤并提示 | AC-5.3 | 手测（记忆分发页） | 过滤数提示 |
| X4 | 记忆服务不可达 → 端点「服务不可用」 | AC-5.4 | 手测（停服务后请求） | 503 语义，不 500 |
| X5 | 插件 4 工具各 1（UPX 命中/无关未命中/无证据待办/排序） | AC-9.1–9.3 | 手测（AutoKill plugins） | 见 AC 判定 |
| X6 | 未启用 `--features wasm-plugins` 只记日志 | AC-9.4 | 手测 | 日志有记录、不报错 |
| X7 | 20 条清单四态 | AC-10.1 | 手测（记忆中心/清单页） | 每条四态之一 |
| X8 | 缺失项草稿 pending | AC-10.2 | 手测 | `status:pending` |
| X9 | 断网清单显示「不可用」 | AC-10.3 | 手测 | 不空白 |

---

## 三补、负向·补充（手测，补齐 §8 负向 15 条）

| # | 用例 | 手测步骤 | 判定 |
|---|---|---|---|
| N8 | 令牌错误 | 设置页填错误 `memoryToken`，写卡 | 服务端返回认证失败，卡不落库 |
| N9 | 并发两次分配 | 同时两次 `POST /api/assign`（同 agent、不同 cards） | state 不损坏；最后一次生效或明确冲突 |
| N10 | state.json 损坏自愈 | 用非法 JSON 覆盖 `state.json` 后重启服务 | 回退默认并重写合法文件，不崩溃 |

---

## 四、回归（§8）

| # | 用例 | 自动化 | 判定 |
|---|---|---|---|
| R1 | 38 MB 样例全流程 | 用例 4–7 | patch→verify→restore 全绿 |
| R2 | restore 后 sha 一致 | 用例 7 | sha==原始 |
| R3 | 协议重签 | 手测 | 重签后弹窗 |
| R4 | 状态文件 BOM 自愈 | 手测（PS 写带 BOM state.json） | 正常解析 |
| R5 | Windows 路径 | 用例（脚本内 work 副本）+ N6 | 空格/中文路径不报错 |

---

## 五、当前实测基线（2026-11-15 23:20）

跑 `node test/acceptance.mjs --break-only`（Lin 的 break 重写进行中，23:19 版）：

- **M1 break 用例 2–12 全 PASS**（scan 483 命中/483 引用、plan 8 候选、patch 386ms、verify differingBytes=7、journal 1 条、restore sha 回原、invert 74→75、负向退出码 3/4/2/5 全对、§6 计时全在预算内）。
- **用例 1（info）FAIL**：`sample.exe` 实测 **6 节**（.text/.rdata/.data/.pdata/.rsrc/.reloc），AC-3.1/§12 要求「7 节以上」。

### ⚠ 待 YG 拍板：AC-3.1「7 节」vs 样例「6 节」

| 项 | 内容 |
|---|---|
| 契约原文 | AC-3.1「返回 7 个以上节与熵值」；§12 `.sections\|length>6` |
| 实测 | `_smoke/sample.exe` 共 6 节，均带熵值、`ok:true` |
| 影响 | 按现行契约，M1 正向 1（info）无法全绿 |
| 可选解法 | (a) 换/加一个 ≥7 节的样例；(b) AC 阈值改为 `>5`（≥6）；(c) 明确「7 节」含头部/叠加层 |

> 在 YG 拍板前，脚本保持契约原样（`>6`），不改阈值；本项记 `FAIL` 并标注原因，不谎报通过。

---

## 六、判定与记录纪律

- `node test/acceptance.mjs` 退出码 0 = 全绿；任何 FAIL 均需指出**具体文件与行为**再修，不手改脚本阈值蒙混。
- 手测用例：跑一次记一次（命令、输出、sha/截图），证据可回读；未跑不记通过。
- 每个里程碑完成后在 CHANGELOG 记一条：做了什么、跑了什么命令、结果、还缺什么。
