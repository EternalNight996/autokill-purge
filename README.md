<p align="center"><img src="assets/autokill-purge.png" width="96" height="96" alt="autokill-purge icon" /></p>

<h1 align="center">🍊 autokill-purge</h1>

<p align="center"><b>一条命令装好破甲控制台</b><br/>一键注入 · 83 条补丁可视化 · 载荷生成 · 记忆库 · MCP 管理</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/autokill-purge?style=flat" alt="npm" />
  <img src="https://img.shields.io/github/stars/EternalNight996/autokill-purge?style=flat" alt="stars" />
  <img src="https://img.shields.io/badge/dependencies-0-FF7A45" alt="deps" />
  <img src="https://img.shields.io/badge/node-%E2%89%A522-3c873a" alt="node" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
</p>

<p align="center">
  <img src="docs/shots-ux2/theme2-ops.png" width="49%" alt="破甲页" />
  <img src="docs/shots-ux2/memory-full.png" width="49%" alt="记忆库" />
</p>

[English](README.en.md) · **简体中文（默认）**

## ⚡ 一行装好

```bash
npm i -g autokill-purge && autokill-purge
```

装完自动做三件事：起记忆库（7989）→ 起控制台（8792）→ 打开浏览器。**零依赖、无构建、不改系统配置。**

```bash
npx autokill-purge                 # 不装也能跑
autokill-purge                     # 已在跑就跳过，只开页面
node scripts/install-desktop.mjs   # 加桌面图标 + 开机自启（Windows）
```

## 🎯 你能得到什么

| 能力 | 具体 |
|---|---|
| **破甲** | **梦神破甲** 模板（随包版本，当前 1.1.17）+ **83 条宿主补丁中英对照**，绿=已注入 / 红=失败 / 灰=跳过 + **落地并重启宿主**（密封 asar 必须让位才生效） |
| **回滚** | 每次写入前自动快照；一键还原到出厂（官方 asar 原件覆盖），失败自动回滚 |
| **载荷** | 27+ 模型实时识别（可多选→智能匹配）、12 种技术、文本/Base64/ROT13 三变体、二进制 `break` 七动作 |
| **装备** | 6 个装备包可多选、按包分页、挂真实技能名，连「已破甲模型」一起装给 dsh / mengbot / autokill |
| **记忆库** | 内嵌 memory-eternal（独立库 `mem-purge` @ 7989，不碰你的运营库），MEM Pair 配对互传卡 |
| **MCP** | 管理本机 MCP 服务器，**真握手**（initialize → tools/list），导出 Claude / Cursor 可用 JSON |
| **补齐** | dsh-purge 的 5 项宿主内能力做成外部等价物：**reapply**（启动重放 / 官方升级回写）、**restart**（复用上游优雅重启）、**identity**（片段库编译成 prompt-inject.md）、**rewind**（多帧 zstd 会话回溯）、**redteam-pack**（48 技能 + 3 角色落地，58 个 redteam_* 工具体检托管） |
| **主题** | 7 套：军工橙（默认）/ 终端黑 / 工程灰 / 矩阵绿 / 赛博青 / 琥珀 CRT / 默认蓝 |

## 📊 对比同类

| | **autokill-purge** | dsh-purge 原版 | 手改配置文件 |
|---|---|---|---|
| 安装 | `npm i -g autokill-purge` **一行** | 装插件 + 翻文档 | 手动找路径 |
| 界面 | Web 控制台 · 7 主题 · **两层模式** | 命令行 / 配置文件 | 无 |
| 83 条补丁 | **中英对照 + 三色状态** | 只给数字 | 不知道改没改 |
| 回滚 | 快照 + 出厂还原 + **失败自动回滚** | 部分支持 | 自己备份 |
| 载荷生成 | 12 技术 × 3 编码变体 × 多模型 | 无 | 手写 |
| 记忆库 | **内嵌独立 vault**，可一键切库/切端口 | — | — |
| MCP | 真握手测试 + 导出 | — | 手写 JSON |
| 依赖 | **0**（无 npm 依赖、无构建） | — | — |

> 一句话选型：想少踩坑就用这个；只想改两个字节，手改也够。

## 🖥 两种用法，一个开关

- **普通模式**：四步流水线（选模板 → 让破甲生效 → 选模型写任务 → 拿到载荷）
- **技术模式**：同一套流程，参数全开（层 / 技术库 / 采样 / 零宽 / 编码 / 命中率 / 二进制 break）

右上角一键切换，选择记在服务端，刷新不变。

## 🔒 私有部署

```jsonc
// data/deploy.json  —— 设置页可一键切换，失败自动回滚
{ "port": 7989, "dbName": "mem-purge" }
```

固定入口 `http://127.0.0.1:8792/#/memory`；记忆库与运营库（7999）**物理隔离**。
保活由 `scripts/mem-keepalive.mjs` 负责：探活 → 用显式 `--vault` 拉起 → **核对 vault 并纠正误连**。

## ✅ 自测

```bash
npm test    # acceptance 21 · ux2layer 18 · ux2layer-ui 16 · ac-check 19
```

## English

**One command, a full control console for autokill-purge.**

```bash
npm i -g autokill-purge && autokill-purge
```

| Feature | What you get |
|---|---|
| Purge | **梦神破甲** template (follows the package version, currently 1.1.17) + **83 host patches with bilingual labels and tri-state colors** |
| Rollback | Auto snapshot before every write, factory restore from the official asar, auto-rollback on failure |
| Payload | 27+ live models (multi-select → smart match), 12 techniques, text / Base64 / ROT13, 7 binary `break` actions |
| Equipment | 6 multi-selectable packs, paged by pack, real skill names, cracked models included |
| Memory | Embeds memory-eternal in an **isolated vault** (`mem-purge` @ 7989); MEM Pair for card sync |
| MCP | Real handshake test (initialize → tools/list) and export for Claude / Cursor |
| Themes | 7 skins (ops amber default) |
| Dependencies | **0** — no npm deps, no build step |

MIT License · screenshots under `docs/shots-ux2/`
