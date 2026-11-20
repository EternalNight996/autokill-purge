---
name: binary-re
description: 二进制逆向静态工作流：识别语言与编译器、剥符号后的函数边界恢复、交叉引用与控制流还原、结构体与调用约定恢复、Go/Rust/.NET 各自特征
whenToUse: 拿到未知二进制/so/dll，需要读懂它做什么（协议、校验、加密、命令分发）时
role: recon
enabled: true
---

# 二进制逆向（静态为主，动态只做验证）

## 1. 五分钟画像
`file`、`strings -n 8`、`readelf -h -S` / `objdump -p` / `rabin2 -I`：
| 线索 | 结论 |
| --- | --- |
| `Go build ID`、`go1.` | Go：pclntab 里还有函数名，用 GoReSym / redress 恢复 |
| `rustc`、`core::` | Rust：panic 字符串与 vtable 可定位 |
| `mscoree`、`.NET` | .NET：直接 dnSpy/ILSpy，别硬逆 |
| 符号表空 + 区段名怪 | 已 strip 或加壳 → 见技能 `unpacking` |
| `GLIBC_2.`、`__libc_start_main` | 动态链接 C/C++，从 main 附近读起 |

## 2. 剥符号后怎么找入口
- main：`__libc_start_main` 的第一个参数（x86-64 在 `rdi`）。
- 字符串交叉引用是最快的路：`r2 -A bin` → `izz~usage` → `axt @ str.xxx` → 追到分发函数。
- 命令分发：多个 `strcmp` 比较同一批字符串 → 就是子命令 `switch`。

## 3. 结构体与调用约定
- `this` 指针：`mov rax,[rdi+0x18]` 这类访问把所有 `[rdi+off]` 收集起来就是结构体布局，按用途命名。
- 参数：Win64 前 4 个走 `rcx/rdx/r8/r9`，System V 走 `rdi/rsi/rdx/rcx/r8/r9`；32 位 `__stdcall` 看 `ret n`。
- 虚表：`mov rax,[obj]` 后紧跟 `call [rax+0x10]` 即虚调用，vtable 顺序给出方法布局。

## 4. 加密与协议
1. 常量表：AES S-box、CRC32 `0xEDB88320`、MD5 `0x67452301` → FindCrypt / `r2 /c` 直接命中。
2. 大整数（RSA）：连续 `mul/adc` 循环 + 素数常量 → 定位校验点。
3. 协议：dump `send/WSASend/write` 的入参结构，反推包头（magic/len/cmd）。

## 5. 动态验证
`x64dbg` / `gdb` 在候选函数下断 → 输入触发 → 看参数与返回值；`frida-trace -f bin -i strcmp` 批量看比较。
动态只能看到走过的路，静态才能给全貌——不要反过来。

## 6. 落库
算法/协议字段/校验点 → `redteam_vuln_add`；可复用脚本（IDAPython / r2）→ `redteam_attack_file_add`（kind=script）。
