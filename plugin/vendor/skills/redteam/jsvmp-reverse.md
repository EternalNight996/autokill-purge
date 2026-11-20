---
name: jsvmp-reverse
description: JS VMP / bogus 参数纯算逆向：定位装载器与解释器、dump 字节码与 opcode 表、hook 解密入口、把 VMP 函数还原成纯 JS 算法（某音 bogus 实战路线）
whenToUse: 遇到某音/某书/某站的请求签名（bogus/X-Bogus/a_bogus 等）由 JSVMP 保护，需要自己算出签名或复现算法时
role: recon
enabled: true
---

# JSVMP 逆向（先分清三段：装载器 / 解释器 / 字节码）

来源：吾爱破解 `thread-2120914`（某音 JSVMP bogus 纯算），下面是把那篇的路线整理成可复用的步骤。

## 1. 结构：VMP 只有三样东西
| 组成 | 特征 | 你要拿到的 |
| --- | --- | --- |
| **装载器** | 形如 `function J(t,r,e,n){ ... Z.length || (初始化)(bytecode); return X(z[t],r,e,n) }` | 入口函数 + 传入的 base64 字节码 |
| **解释器** | 巨大 `switch`/跳转表，取 opcode → 分发 handler | opcode 表与 handler 语义 |
| **字节码** | 开头常见 `atob(t)` + 自定义异或/加减（如 `C(Uint8Array.from(...), _, e % 256)`） | 解码后的指令数组 |

判定要点：`Z.length ||(...)()` 这种"懒初始化 + 缓存"是典型装载器；真正的执行在另一个函数（例子里是 `X`）。

## 2. 五步走（按顺序，别跳）
1. **抓入口**：在签名参数（bogus）生成处下 XHR/fetch 断点，回溯到调用栈最上层的 `J`。
2. **解字节码**：把装载器里的解码函数（`atob` 后的异或/查表）原样抄到 Node，传入同样的 base64 串 → 得到指令数组；校验：数组长度与 `switch` 的 case 数吻合。
3. **dump opcode 表**：解释器里通常是 `switch(op)` 或 `handlers[op]`。把所有 case 的语义标注出来（push/load/store/add/xor/call…），先标 20~30 个高频的，够跑通目标函数。
4. **单步还原**：在解释器循环里打印 `[pc, op, stackTop]`，喂一组固定输入（如 `aid=1&ts=2`），把执行轨迹导出成文本；按痕迹把 VMP 指令翻成等价 JS —— 这就是"纯算"。
5. **纯算复现**：用还原出的 JS 直接算签名，与浏览器结果逐字节比对；不一致就回到第 4 步看分歧点（通常是某个 `Math.imul` 或位运算宽度问题）。

## 3. 三个提速技巧
- **不要硬逆全部指令**：只还原与输入/输出相关的那条依赖链，其余 opcode 记录但跳过。
- **用同一份字节码做差分**：固定输入改一个字符，比较 pc 轨迹差异，快速定位"哪段在算签名"。
- **撞库式验证**：批量跑 1000 组随机输入，比对纯算与页面结果，命中率 100% 才算成功；99% 说明有状态残留（时间戳、随机数、设备指纹）。

## 4. 常见坑
| 坑 | 表现 | 对策 |
| --- | --- | --- |
| 字节码每次会话变化 | 同一函数两次 dump 不同 | 解密密钥常来自 `Date.now()`/随机数，hook 解密函数取"当次密钥"再解 |
| 有环境检测 | Node 里算出结果不一致 | 补 `window/navigator` 假环境（`jsdom` 或手写对象），指纹字段要与真机一致 |
| 解释器带栈混淆 | 栈上出现非预期值 | 打印 `stack` 全量快照，而不是只看栈顶 |
| 时间/随机参与签名 | 结果偶发不一致 | 把 `Date.now`、`Math.random` 换成可控桩，先对齐再放回 |

## 5. 落库
- 还原出的算法与验证数据 → `redteam_vuln_add`（title="<站点> 签名算法 <参数名>"，evidence 写比对结果）；
- 纯算脚本 → `redteam_attack_file_add`（kind=script）或 `redteam_poc_add`（language=js，verified 写"1000 组比对一致"）。
