# break —— 破甲的手

AutoKill 负责**看**（native_* / js_* / android_* 工具面），这里负责**下刀**：定位、切、证明切了什么、能一键还原。

## 命令

```sh
break info   <file>                     PE 布局、每节熵值、加壳信号
break scan   <file> [--keywords a,b]    许可类字符串 + 它们的代码引用点（x64 RIP 相对）
break plan   <file>                     候选排序 + 每个候选的按字节提案
break patch  <file> --at 0xOFF --expect HEX (--write HEX | --nop N)
break invert <file> --at 0xOFF          翻转条件跳转（74/75、7C/7D、0F 84/85…）
break verify <before> <after>           sha256 + 逐字节差异
break restore <file>                    用 <file>.bak 还原
```

## 三条安全线（实测有效）

1. **原始文件永不原地改**：第一次下刀前自动 <file>.bak；restore 回到原 sha256。
2. **--expect 不匹配就不写**：实测传 488D0D 而实际是 488D15，输出 found 488D15 - nothing written，文件 sha 未变。
3. **invert 只认条件跳转**：对 0x48 直接拒绝。

## 实测（38 MB 真实 PE）

```
info    x86-64 · imageBase 0x140000000 · .text 31.5 MB 熵 6.219 · 无 CLR（非 .NET）
scan    200 条命中，其中一条字符串被代码引用 19 次
patch   0xA5638: 488D1509AED701 -> 90909090909090
verify  differingBytes 7，逐字节 48->90、8D->90 …
restore 还原后 sha256 与原文件完全一致
```
