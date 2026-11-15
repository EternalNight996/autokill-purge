---
name: autokill-purge
description: 给 AutoKill 穿的破甲装备包（WASM 组件插件）：壳识别、判定函数排序、解包计划、结论审计。Use when 用户要给 AutoKill 加破甲工具、要 plugins.wasm 装备、要壳/保护识别或授权判定定位的辅助工具。
whenToUse: 需要把破甲辅助工具装进 AutoKill（而不是在外面跑脚本），或需要一份不猜、只按命中说话的壳识别/排序/计划工具。
---

# autokill-purge（装备包）

## 它是什么

一个 AutoKill WASM 组件插件，装车后 4 个工具进 AutoKill 工具列表：

- `purge_scan_packer_markers`：壳/保护识别（有命中才说话）
- `purge_rank_check_candidates`：授权判定候选排序（列出缺失项）
- `purge_plan_unpack`：按格式给出有序工具链与通过条件
- `purge_audit_claims`：把无证据的结论降级为待办

## 它不是什么

- 不是对话层，不写 prompt，不做阶段编排
- 不是外部进程，不跑任何目标程序
- 不做绕过/伪造，只做定位与排序

## 装车

见 `gear/README.md`：编译组件 → `config.toml` 加 `[[plugins.wasm]]` → 用 `--features wasm-plugins` 构建运行。

## 验收

- `plugins_list` 里该插件 `kind: "wasm"`、`problem` 为空
- `plugins_refresh {id}` 能列出 4 个工具
- 工具输出里没有证据的字段一律标 missing/note，不给结论
