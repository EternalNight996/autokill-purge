# plugin/ —— 宿主内薄插件（为什么需要它）

外部控制台有三件事天生做不到：**注册工具**、**介入 system-prompt 组装**、**拿 session 对象**。
这三件事只能由跑在 DSH 进程里的插件做，接口就是本目录：

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.bundle.patch` 指向 `cordis.patch.yml`；`main` 是插件入口 |
| `cordis.patch.yml` | `insert` 一个插件单元，`inject: [systemPrompt, tools]`，所有开关都在 config |
| `lib/index.js` | `export const name / inject` + `export function apply(ctx, config)` |

## 与 dsh-purge 的分工（关键）

| 能力 | dsh-purge 插件 | 本插件 | 说明 |
|---|---|---|---|
| 58 个 `redteam_*` 工具 | 已提供 | **不提供** | 要工具就用 dsh-purge，别重写 |
| `system-prompt/assemble` 改写 | 已提供 | 可选（默认关） | 两套同时开会叠加，必须二选一 |
| 83 条宿主补丁 / 落地 / 回滚 | 有（宿主内） | 不做 | 归控制台（快照 + 出厂基线更稳） |
| 控制台能力给模型调 | 无 | `autokill_status` / `autokill_ops_*` | 走 HTTP 转调 8792，不在插件里复制业务 |

## 安装（已验证：**别用 npm**）

这个 profile 是 **pnpm** 管的（`pnpm-lock.yaml` + pnpm 布局），而且 `dependencies` 里有 3 个 git/github 依赖。
在它里面跑 `npm i` 会按 package.json 重装整棵树（任一 git 依赖失败就整体回滚），`--no-save` 又不会写 package.json；
更关键的是 **DSH 只认 `dsh.profile.bundles`**，没登记就永不加载。

已验证可用的手动安装（零网络、可逆）：

```powershell
$prof = "C:\Users\Administrator\.dsh\profiles\desktop"
Copy-Item (Join-Path $prof "package.json") (Join-Path $prof "package.json.bak-akp") -Force
Copy-Item "F:\MyApp\eternal\autokill-purge\plugin" (Join-Path $prof "node_modules\autokill-purge-plugin") -Recurse -Force
# 再把 "autokill-purge-plugin" 追加进 $prof/package.json 的 dsh.profile.bundles
```

长期稳定的正规形态与 dsh-purge 相同（本地 tgz + dependencies）：

```powershell
# 已打好：C:\Users\Administrator\.dsh\local-pkgs\autokill-purge-plugin-0.1.0.tgz
cd ~/.dsh/profiles/desktop
node "<DeepSeek Harness>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.mjs" add "file:C:/Users/Administrator/.dsh/local-pkgs/autokill-purge-plugin-0.1.0.tgz"
```

## 安装（三步，需重启宿主）

```powershell
# 0) 备份 profile 配置
Copy-Item ~/.dsh/profiles/desktop/package.json ~/.dsh/profiles/desktop/package.json.bak-$(Get-Date -Format yyyyMMddHHmmss)

# 1) 以本地目录作为依赖装进 profile
cd ~/.dsh/profiles/desktop
npm i --no-save "autokill-purge-plugin@file:F:/MyApp/eternal/autokill-purge/plugin"

# 2) 在 profile package.json 里登记 bundle（dsh.profile.bundles 追加一项）
#    "dsh": { "profile": { "bundles": [ ..., "autokill-purge-plugin" ] } }

# 3) 重启 DeepSeek Harness（当前会话会断）
```

## 验证

- 工具列表出现 `autokill_status` / `autokill_ops_status` / `autokill_ops_plan`（`autokill_ops_run` 默认拒绝）
- 控制台仍正常：`GET http://127.0.0.1:8792/api/ops` → 5 项
- 插件日志（`verbose: true` 时）：`[autokill-purge] loaded · console=... · assemble=false · write=false`

## 回滚

从 `dsh.profile.bundles` 与 `dependencies` 删掉 `autokill-purge-plugin`，重启宿主。

## 当前状态（诚实标注）

- 工具注册、`ctx.effect` 清理、HTTP 转调：**照 dsh-purge 的真实写法**，可信。
- `system-prompt/assemble` 的 `assembled` 结构（`sections[].text/order`）**未在 0.2.2-rc.1 真机验证**，代码里有字符串回退；打开前先在真机 dump 一次结构。
- `ctx.desktopRuntime` 名字未验证（上游走 `desktopRuntimeOf(ctx)`），`restart()` 目前是能力占位。
