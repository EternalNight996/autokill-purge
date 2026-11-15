# D:\autokill-purge 六页控制台 · 交付与验收证据

当前 HEAD：`f71ea1a feat(M2/M3): six-page console + web API + catalog + plugin logic; fix FR-7 settings persistence`。
所有路径均为 D 盘；F: 旧副本不再读写。

## 改动文件（前端）

- `web/public/index.html`
- `web/public/style.css`
- `web/public/app.js`

未改 `break/**`、`gear/**`、`web/server.mjs`、`web/catalog.json`、`docs/**`、`test/**`。
`web/server.mjs` 的 FR-7 设置持久化由同提交的后端修改提供，本前端只按契约提交 `breakDir` / `pluginPath`。

## 运行

```powershell
cd D:\autokill-purge
node web\server.mjs
# http://127.0.0.1:8792/
```

正式实例由小梦在 8792 启动并维护。测试实例及其 `pixel-ac` 状态已由小梦清理成首启状态；本目录的首启协议截图保留作证据。不要再由其他线程启停 8792 或改写 `data/state.json`。

## 验收结果

| 套件 | 结果 |
|---|---|
| `node test/acceptance.mjs` | **21/21 PASS**（含 M1 12 条 + M2/M3 9 条） |
| `node _ui-test/ac-check.mjs` | **19/19 PASS**（真实 server + break + 本机 memory-eternal） |
| 浏览器运行时 | 六页 `window.__apErrors` 为 0；预期内只有 403（未签署）/409（错 expect）网络失败 |
| 移动端 | 390 / 320 视口六页 `scrollWidth <= innerWidth`；320 导航换行；表格在容器内横向滚动 |

`AC-3.1` 使用 `_smoke/sample-7s.exe`（`test/make-7s-fixture.mjs` 生成，7 节），info 返回 7 节。
`_smoke/sample.exe` 仍是 6 节基线，不被该用例使用。

## AC 对照

| AC | 结果 | 说明 |
|---|---|---|
| 1.1 未签署 API 403 | PASS | acceptance #14 |
| 1.2 签署后 200 | PASS | acceptance #15/#16 |
| 1.3 不勾选按钮 disabled | PASS | `#agreeAccept` disabled |
| 1.4 重签后再弹窗、页面不可点 | PASS | `#app.inert=true`，再签署恢复 |
| 2.1 ≥3 载荷含 Base64/ROT13 | PASS | 3 技术 → 9 条（text/Base64/ROT13） |
| 2.2 空任务不产生载荷 | PASS | 内联提示，无请求 |
| 2.3 保存 pass 后 100% | PASS | 1/1，按模型/按技术均有命中 |
| 2.4 切模型说明变化 | PASS | `refusal` 字段随模型更新 |
| 3.1 info ≥7 节 + 熵 | PASS | 7 节夹具 `sample-7s.exe` |
| 3.2 scan 命中带引用 | PASS | 483 hits，最高 49 引用点 |
| 3.3 错 expect 409 + sha 不变 | PASS | `found 488D0DF0 - nothing written` |
| 3.4 patch 后差异=写入长度 | PASS | 7 = NOP 7 |
| 3.5 restore sha=原始 | PASS | 7 节夹具 sha 回到 `0ef48a62…` |
| 3.6 非 PE 400 + 说明 | PASS | `不是可识别的可执行文件（当前只支持 PE）` |
| 4.1 未选智能体拒绝 | PASS | acceptance #21 |
| 4.2 发放历史、复制一致 | PASS | `equipConfig(item)` 与预览逐字相等 |
| 5.1 2 卡端点 2 节 | PASS | `- path:` 计数 2 |
| 5.2 加 1 卡端点 3 节不重启 | PASS | 3 |
| 5.3 只发技能卡过滤并提示 | PASS | `已过滤 3 张非技能卡`，端点 0 节 |
| 5.4 记忆不可达端点“服务不可用” | PASS | 503 正文 `服务不可用`，非 500 |
| 6.1 stats 与服务端一致 | PASS | 21/21 |
| 6.2 搜索“技能”并打开 | PASS | 1 张，详情正文正常 |
| 6.3 写卡 pending、不调用审核 | PASS | `status: pending`；测试卡已删除 |
| 7.1 测试连接成功/失败 | PASS | 成功 21 张卡；失败有 hint |
| 7.2 令牌不回显 | PASS | 保存后 `settings.memoryToken` 为 `•••`，输入框为空，DOM 不含 token |
| 7.3 breakDir / pluginPath 持久化 | PASS | 保存后 `/api/state` 与刷新后的设置页均返回 D 盘路径 |

## 截图

目录：`_ui-test/shots-d/`

- `agreement.png` 首启协议
- `breach-top.png` 破甲模型目录
- `breach-payloads.png` 3 技术 → 9 条载荷（含 Base64/ROT13）
- `breach-binary-patch.png` 7 节夹具下刀 + 自动 verify（7 字节）
- `breach-binary-restore.png` 还原后 sha 与原始一致、differingBytes=0
- `equipment.png` 装备发放与历史
- `assign.png` 3 卡 → 端点 3 小节
- `memory.png` 统计/检索/详情
- `settings.png` 记忆地址、令牌留空、D 盘 breakDir/pluginPath
- `about.png` 关于
- `mobile-equipment.png` / `mobile-binary.png` 390 宽单列

接口探针日志：`_ui-test/ac-results.txt`（19/19）。
复跑探针：`node _ui-test/ac-check.mjs`（未签署时会自行签署）。

## 环境备注

本会话的 DSH workspace 仍指向旧 F: 副本，因此对 `D:\autokill-purge` 的写操作需要一次全盘访问授权（`danger-full-access`）才能落盘；D 盘 ACL 本身对 Authenticated Users 可写。后续 agent 若只能写 workspace，应先把会话 workspace 切到 `D:\autokill-purge`。
