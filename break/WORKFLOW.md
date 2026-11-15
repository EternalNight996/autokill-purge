# 破甲工作流（AutoKill 看 + break 动手）

| # | 动作 | 用谁 | 通过条件 |
| --- | --- | --- | --- |
| 1 | 定性：格式、架构、加壳信号 | break info | 有 machine 与各节熵值；可执行节熵 > 7.2 视为压缩/加密 |
| 2 | 找入口：许可类字符串 | break scan | 至少一条字符串带 1 个以上代码引用点 |
| 3 | 读懂：引用点处的比较与分支 | AutoKill native_function_show | 看到「比较 → 条件跳转」 |
| 4 | 提案：切哪几字节 | break plan（或手写 --at） | 每个提案有 offset + 期望字节 + 写入字节 |
| 5 | 下刀并证明 | break patch / invert → break verify | differingBytes 正好等于预期，sha 前后都记录 |
| 6 | 回归或回滚 | 跑目标 / break restore | 行为变了且不再提示授权；或 sha 回到原值 |

## 常见切法

| 目标形态 | 切法 | 命令 |
| --- | --- | --- |
| 读许可字符串后判断 | 把 lea/mov 7 字节填 NOP | break patch f --at OFF --expect 488D15 --nop 7 |
| 比较后 jz 走失败分支 | 翻转跳转（jz 与 jnz） | break invert f --at OFF |
| 整个函数就是校验 | AutoKill 确认后把入口改成 ret | break patch f --at OFF --write C3 |
| .NET 程序集 | 不走字节补丁，改 IL（AutoKill managed_* 读，源码侧修） | — |

## 不做什么

- 不改原文件、不隐藏痕迹、不伪造签名；verify 永远把 sha256 摆出来。
- 第 3 步没过就不许进第 5 步：没读懂分支就下刀，等于赌。
- 不把「能启动」当「绕过了」：验收是行为对比（提示消失／功能解锁），不是文件变小。
