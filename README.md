# autokill-purge

AutoKill 的破甲装备：**AutoKill 看，purge 动手**。

| 组成 | 是什么 |
| --- | --- |
| gear/autokill-purge-plugin/ | WASM 组件插件：给 AutoKill 加 4 个纯函数工具（壳识别、候选排序、解包计划、结论审计） |
| break/ | 破甲 CLI：PE 结构、许可字符串与引用点、按字节提案、下刀、逐字节验证、一键还原 |
| web/ | 独立 web 端：记忆库自检、一键安装/打开、云端切换、清单同步（缺失走审核） |

分工：AutoKill 保持干净（只观察与读结构）；改字节这件事只在 purge 里发生，且只改副本。

工作流见 break/WORKFLOW.md，装车见 gear/README.md，web 端见 web/。
