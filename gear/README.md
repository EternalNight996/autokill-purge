# 装备包：给 AutoKill 装上破甲工具

`autokill-purge-plugin` 是一个 AutoKill **WASM 组件插件**，不是外部程序、不是对话层。AutoKill 把它当自己的工具加载，加载后这 4 个工具就在工具列表里。

## 四个工具（纯函数，不读文件、不联网、不跑程序 → 调用不需要审批）

| 工具 | 干什么 | 关键点 |
| --- | --- | --- |
| `scan_packer_markers` | 从你已收集的字符串/节区名/hexdump 里认出壳或保护 | **不匹配就明说不匹配**，绝不猜；给出命中行号和文本 |
| `rank_check_candidates` | 给候选函数排序：谁最可能是授权/许可判定 | 分数只是「先看哪里」，并列出缺失项（没 xref、没比较） |
| `plan_unpack` | 按 format/packer 给出有序工具链（便宜的先跑） | 每步都写「通过条件」；需要跑进程的步骤**不进计划** |
| `audit_claims` | 把结论分成「有证据」和「没证据」 | 没证据的降级为待办问题，不允许当结论 |

## 装车（三步，都不需要联网）

```sh
# 1. 编译成组件（需要 wasm 目标：rustup target add wasm32-unknown-unknown）
cd gear/autokill-purge-plugin
cargo build --release

# 2. 在 AutoKill 的 config.toml 里加一段
#    （路径换成编译产物，通常在 target/wasm32-unknown-unknown/release/ 下）

# 3. 用带 WASM 支持的构建启动 AutoKill（wasmtime 较重，默认关闭）
cargo run -p autokill-cli --features wasm-plugins -- tools | grep purge
```

`config.toml`：

```toml
[[plugins.wasm]]
id = "purge"          # 工具会变成 purge_scan_packer_markers 等
name = "Purge gear"
path = "C:/gear/autokill_purge_plugin.wasm"
]
```

## 装完怎么确认

```text
plugins_list           → kind = "wasm"，problem 为空
plugins_refresh {id: "purge"}  → 重新读组件并列出 4 个工具
```

`plugins_refresh` 对 WASM 插件生效这件事，是这次在 AutoKill 代码里补上的（原来只刷新 MCP 插件）。

## 边界

- 插件**不导入任何东西**（无文件、无网络、无环境、无时钟），这是 AutoKill 的插件契约；所以它只能处理你喂给它的文本。
- 不提供绕过、密钥、签名伪造类工具：它做的是**定位与排序**，结论仍要落在 evidence 上。
- 默认构建不带 WASM 主机；没有 `--features wasm-plugins` 时 AutoKill 会记录一条日志并跳过这个插件，不报错。
