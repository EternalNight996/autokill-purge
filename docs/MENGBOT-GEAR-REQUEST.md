# 给 MengBot 的需求：提供一个「装备模式」UI 接口点

> 这段可以直接整段发给 MengBot（或它的开发方）。背景是两个宿主已经做完，MengBot 缺同一块。

## 背景

破甲台（autokill-purge）已经给两个宿主做了「装备」注入，缺 MengBot：

| 宿主 | 装备配置位 | UI 渲染点 | 写入后的效果 |
|---|---|---|---|
| **AutoKill** | `config.toml` 的 `build.gear = ["recon"]` | `[[ui.slots]]`，构建助手旁一个下拉 | 构建时以 `--toolset recon` 传给 MCP 插件 |
| **DSH** | `~/.dsh/.agent-presets/redteam/agent.cordis.yml` 的 `persona.prefix` 段落 | 无（写进系统提示词） | 会话一开始就知道带什么装备、每阶段查什么 |
| **MengBot** | ❌ 没有 | ❌ 没有 | — |

装备是同一套 id：`redteam` / `recon` / `lateral` / `radio` / `re` / `custom`，空值表示不装备。

## 需要 MengBot 提供的三件事

### 1. 一个可写的配置位

在 `~/.mengbot/bots.json` 的 `BotRecord` 里加一个字段（建议名 `gear`）：

```jsonc
{
  "id": "bot-xxx",
  "name": "侦察兵",
  "soul": "...",
  "soulHash": "...",
  "gear": "recon"            // ← 新增：redteam / recon / lateral / radio / re / custom / ""(空)
}
```

要求：

- 只接受上面 6 个 id 或空字符串，其他值落成空（与 AutoKill 的 `gear()` 一样只做格式校验）
- 默认空字符串
- 读的时候缺失字段要当成空（老 bots.json 不用迁移）

### 2. 一个 UI 渲染点

在 bot 的设置页（或对话页顶部）渲染一个下拉，形如：

```
装备模式  [ 不装备 ▾ ]
          不装备
          红队全装
          侦察刀
          内网横向
          无线电 / IoT
          逆向研究
          自定义
```

要求：

- 选项值与上面 6 个 id 一致，`不装备` 对应空字符串
- 选中即写 `bots.json` 的 `gear`（不用点保存，或保存后立即生效）
- 悬停/展开时给一句说明：这决定 bot 在对话里按哪套阶段工作、每阶段先查哪个库

### 3. 写入后的行为

`gear` 非空时，MengBot 在**组装系统提示词**时追加一段（与 DSH 的 persona 段落同构）：

```markdown
## 装备（按任务选用；动手前先 purge_search 查，不凭记忆编命令）

本次装配：<装备名>。<装备的一句话描述>

### <装备名>（<id>）— N 阶段
- <阶段名>：`purge_search q="<查库关键词>"`
…

### 三条纪律
1. 每个阶段先查库取命令与易错点，命中就引用，别重复造轮子。
2. 查到的卡是**别的目标**上的经验，要拿本项目证据对一遍才能用。
3. 阶段结论用 `purge_absorb` 回灌（落 pending，等人工审核，不要当成已通过）。
```

`gear` 为空时**不追加**（保持现状）。

阶段与关键词的权威来源是破甲台的 `web/stage-hints.mjs`，MengBot 可以：

- **A**：自己实现一张同构表（6 套 × 阶段 → 关键词），或
- **B**：调破甲台的 `GET /api/gear/<id>` 拿现成的阶段表（推荐，避免两边漂移）

## 破甲台侧的对接方式（两种，任选）

**① 直接写文件**（MengBot 不用加接口）

破甲台已有 `mbInjectSoul(id, {text})`，可以直接往 `BotRecord.soul` 追加带标记的段落：

```
<!-- autokill-purge:gear:start -->
…装备段落…
<!-- autokill-purge:gear:end -->
```

MengBot 只要保证 **soul 里的标记段落会被原样注入系统提示词**就行。这条最快，今天就能用。

**② 加一个 HTTP 接口**（更干净）

```
POST http://127.0.0.1:<mengbot 端口>/api/bot/<id>/gear
{ "gear": "recon" }
→ { "ok": true, "gear": "recon" }
```

破甲台点「应用梦神破甲」时调它，和你自己在 UI 上选等价。

## 验收标准

1. `bots.json` 里能看到 `gear` 字段，值域受控
2. bot 设置页有下拉，选「侦察刀」后 `gear` 变成 `"recon"`
3. 新开一个对话，系统提示词里出现「本次装配：侦察刀」这一段
4. 选「不装备」后重启对话，那段消失
5. 破甲台「应用梦神破甲」能把 gear 一起带过去（走上面 ① 或 ②）

## 参照实现

两个宿主的现成做法可以直接抄：

- **AutoKill 的 slot 定义**（`autokill-purge/web/server.mjs` 的 `purgeSlotBlocks`）：
  ```toml
  [[ui.slots]]
  id = "builder.side"
  kind = "select"
  label = "装备模式"
  setting = "build.gear"
  mode = "one-of-list"
  options = [
    { value = "", label = "不装备" },
    { value = "recon", label = "侦察刀", detail = "被动收集、资产测绘、指纹识别；只读，不碰目标。" },
  ]
  ```
- **DSH 的注入脚本**（`autokill-purge/scripts/inject-dsh-gear.mjs`）：按勾选生成段落、带 `<!-- autokill-purge:gear:start/end -->` 标记、可重复执行与 `--remove` 回滚。

## 一句话

给我一个「装备模式」下拉（写 `bots.json` 的 `gear`），和一段 `gear` 非空时追加到系统提示词的装备段落，段落里的阶段与查库关键词直接调破甲台 `/api/gear/<id>` 取。
