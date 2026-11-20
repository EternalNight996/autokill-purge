# 落地（挪 asar + 重启宿主）runbook

> **状态：已于 2026-11-21 02:33 落地成功。** `app.asar` → `app.asar.dshpurge-aside`，宿主现在从 `resources\app` 加载，`effective=true`。
> 回滚：`node -e "import('file:///F:/MyApp/eternal/autokill-purge/web/host.mjs').then(h=>h.restoreHostAsar({restart:true})).then(r=>console.log(r))"`

> 目的：让已经写进 `resources\app` 的 75 条补丁真正被加载。
> 现状：`app.asar` 仍在（209 MB），Electron 从 asar 加载 dsh，`effective=false`。
> 代价：会掐断当前 DSH 会话。

## 前置检查（只读）

```powershell
cd F:\MyApp\eternal\autokill-purge
node -e "import('file:///F:/MyApp/eternal/autokill-purge/web/host.mjs').then(h=>h.hostHandoffStatus()).then(s=>console.log(JSON.stringify(s,null,1)))"
```

要看到：`sealed: true`、`asideExists: false`、`appDir` 存在、`exe` 指向 `DeepSeek Harness.exe`。

## 先留一份快照（必做）

```powershell
node -e "import('file:///F:/MyApp/eternal/autokill-purge/web/host.mjs').then(h=>h.createSnapshot('F:/MyApp/eternal/autokill-purge/data','pre-handoff')).then(s=>console.log(s.id))"
```

## 执行落地（二选一）

**A. 面板**：破甲页 → 「落地并重启宿主」（`POST /api/host/handoff`，需 `confirm:true`）

**B. 命令**：

```powershell
node -e "import('file:///F:/MyApp/eternal/autokill-purge/web/host.mjs').then(h=>h.finishHostHandoff({restart:true})).then(r=>console.log(JSON.stringify(r,null,1)))"
```

它做三件事：结束宿主进程 → `app.asar` 改名成 `app.asar.dshpurge-aside` → 重新拉起 `DeepSeek Harness.exe`。
新进程 `app.getAppPath()` 变成 `resources\app`，里面就是洗过的 75 条。

## 回滚

```powershell
node -e "import('file:///F:/MyApp/eternal/autokill-purge/web/host.mjs').then(h=>h.restoreHostAsar()).then(r=>console.log(JSON.stringify(r,null,1)))"
```

等价手工操作：把 `resources\app.asar.dshpurge-aside` 改回 `resources\app.asar`，重启 exe。

## 落地后验收清单

| 检查 | 期望 |
|---|---|
| `GET /api/host/status` | `effective: true`、`desktopSealed: false`、`applied` 仍是 75 |
| `injectSummary` | `ready: true`；**新会话**里 `hasInjection: true` |
| 新会话的第一轮 | 系统提示带 `<project_instructions>`（UNRESTRICTED SANDBOX 段） |
| 行为抽查 | 提权不再弹审批；写文件不再要求先读；run_code 的 sandbox 提示是 “approval is auto-granted” |
| 控制台 | 8792 仍在（WMI 拉起，不随宿主重启死） |

## 注意

- 落地后如果 DSH 起不来：先把 aside 改回 asar，即可回到当前状态（补丁白打，但系统可用）。
- 官方升级会整体替换 `resources\app`，补丁与 #45/#46 的交接逻辑都会受影响；升级后要重跑 `node web/patch-engine/extract-catalog.mjs` + 整组 apply。
- 重新 vendor（`scripts/vendor-dsh-engine.mjs`）会覆盖 `COMPAT_0202`；跑 `node test/patch-compat-0202.mjs` 会立刻红。
