// 每个能力项 → 「查库关键词 + 该用哪个工具」。
// mcp-server（AutoKill 插件）与 inject-dsh-gear（DSH 预设）共用这一份。
export const STAGE_HINTS = {
  'redteam:recon': ['子域枚举 指纹识别 资产测绘', 'deep 模式读页面源码；triage 对单个样本先看一眼'],
  'redteam:vuln': ['未授权 注入 上传 越权 逻辑漏洞', 'chat 问具体 payload；查出模板后自己拼'],
  'redteam:shell': ['webshell suo5 隧道 冰蝎 哥斯拉', '（靠查库拿命令模板）'],
  'redteam:lateral': ['内网 fscan gogo 提权 域', '（靠查库拿命令模板）'],
  'redteam:report': ['攻击链 证据 报告 复现', 'report 生成 Markdown / HTML'],
  'recon:passive': ['FOFA crt.sh 备案 被动DNS 子域', 'chromium 抓公开页面；tshark 看流量'],
  'recon:fingerprint': ['指纹 框架 中间件 CMS 版本', 'chromium 看响应头与页面特征'],
  'recon:asset-graph': ['资产图谱 C段 证书 关联', '（结果写进 evidence，交给 purge_absorb 沉淀）'],
  'recon:surface': ['边缘资产 未备案 暴露服务 攻击面', '（按清单逐个 triage）'],
  'lateral:tunnel': ['suo5 chisel frp 隧道 出网', '（靠查库拿落地命令）'],
  'lateral:cred': ['凭据 喷洒 PtH hash 复用', '（靠查库拿工具参数）'],
  'lateral:ad-enum': ['域 BloodHound Kerberoast ACL 委派', '（靠查库拿枚举命令）'],
  'lateral:privesc': ['提权 SUID UAC 内核 配置', '（配置类优先，内核最后）'],
  'radio:ble': ['BLE 蓝牙 HCI 抓包 重放', 'tshark 解析；rtl433 看射频侧'],
  'radio:rfid': ['RFID 门禁 读卡 克隆', '（靠查库拿读卡器参数）'],
  'radio:firmware': ['固件 ubifs squashfs 解包 CGI', 'binwalk / unblob 解包；deep 模式读解出的文件'],
  're:static': ['逆向 反汇编 符号 交叉引用', 'rizin / objdump / jadx / ilspy / vineflower'],
  're:dynamic': ['动态调试 断点 hook Frida', 'gdb / lldb / frida / adb'],
  're:unpack': ['脱壳 dump IAT 加壳 识别', 'unblob 先解容器；rizin 看节区'],
  're:protocol': ['协议 C2 加密字段 重放', 'tshark 抓包；mitmdump 看 HTTP(S)'],
};

/** 把预设 + 阶段提示渲染成一段 Markdown（DSH 用） */
export function renderGearMarkdown(presets) {
  const out = [];
  for (const p of presets) {
    const items = p.items || [];
    out.push(`### ${p.name}（${p.id}）— ${items.length} 阶段`);
    if (p.desc) out.push(p.desc);
    for (const it of items) {
      const hint = STAGE_HINTS[p.id + ':' + it.id];
      const q = hint && hint[0] ? hint[0] : it.name;
      out.push(`- ${it.name}：\`purge_search q="${q}"\``);
    }
    out.push('');
  }
  return out.join('\n');
}
