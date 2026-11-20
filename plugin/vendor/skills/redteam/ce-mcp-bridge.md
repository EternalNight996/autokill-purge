---
name: ce-mcp-bridge
description: 把 Cheat Engine 挂成 MCP 工具给智能体用：MCP/JSON-RPC ↔ 命名管道 ↔ CE Lua 桥接架构、接入步骤、可做的事（内存读写/指针扫描/断点）与反作弊风险
whenToUse: 需要让智能体直接操作 CE（游戏内存、进程内存分析），而不是人手点 GUI 时
role: exploit
enabled: true
---

# CE × MCP（智能体直接开内存）

来源：吾爱破解 `thread-2083918`（Cheat Engine MCP AI 辅助逆向桥接）。

## 1. 架构（三层，缺一层就不通）
~~~
AI/智能体  --(MCP JSON-RPC, stdio)-->  ce_mcp_server.js  --(命名管道)-->  ce_mcp_bridge.lua (跑在 CE 里)
                                              ↑ 断线自动重连
~~~
- `ce_mcp_server.js`：MCP server，暴露工具（attach/read/write/scan/pointer/breakpoint…）。
- `ce_mcp_bridge.lua`：CE 侧脚本，用 `createPipe` 收命令、调 CE API 执行、回传结果。
- **必须先启动 CE 并加载 bridge 脚本**，再起 MCP server；顺序反了会连不上。

## 2. 接入 dsh（两条路）
1. **MCP 客户端**：在 profile 里加一条 stdio MCP server 指向 `ce_mcp_server.js`，工具会以 `mcp__*` 出现在工具目录（dsh 侧已有 `@deepseek-ai/dsh-mcp-client`）。
2. **当普通 CLI 用**：不起 MCP，直接用 `node` 调它的脚本做一次性读写（适合脚本化）。

## 3. 智能体能拿到的能力
| 能力 | 对应 CE 操作 | 典型用途 |
| --- | --- | --- |
| 附加进程 | `openProcess` | 选目标，注意位数（x64 目标要 x64 CE） |
| 读/写内存 | `readInteger/readFloat/writeX` | 改数值、读结构体字段 |
| 扫描 | `AOBScan` / 精确值扫描 | 找金币/血量地址 |
| 指针链 | `pointer scan` | 重启后仍有效的多级偏移 |
| 断点 | `debug_setBreakpoint` + 寄存器读取 | "谁改写了这个地址"自动化 |

## 4. 落地顺序（推荐）
1. 手工在 CE 里把目标找出来（数值 → 候选 → 谁改写），确认偏移；
2. 再把同样动作写成 CE Lua 脚本，交给 MCP 调用（稳定、可复盘）；
3. 最后才让智能体自己串流程（智能体擅长"试错+记录"，不擅长一次性猜中）。

## 5. 风险与纪律
- CE 会**挂调试器 + 改内存**，带内核反作弊的游戏（ACE/EAC/BattlEye）会直接判定，只在自己/离线环境做（见技能 `game-cheat`）。
- 命名管道默认本机可访问：别把 MCP server 暴露到局域网。
- 只对自有进程/授权目标 attach；生产机器上不要留常驻 CE。
