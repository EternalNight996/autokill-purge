// 把「红队所需的技能与工作流」写进 memory-eternal，作为可召回的索引卡。
//
// 设计取舍（重要）：
//   技能全文的单一真源仍然是 ~/.dsh/skills/<name>/SKILL.md —— 由 skill 工具按需加载；
//   这里写进记忆的是「索引卡」：名字 + 触发词 + 路径 + 一句话用途 + 纪律红线。
//   这样做的好处是 memory_recall("要脱壳用哪个技能") 能命中，再由卡里的路径去 skill 加载；
//   坏处是一旦 SKILL.md 改了正文，索引卡不会自动跟着变 —— 所以卡里显式写明「正文以路径为准」，
//   并靠幂等重跑（同 title 跳过）来刷新索引，不去复制全文（避免两处漂移）。
//
// 写进去的卡是 pending（memory-eternal 的审核红线），需要用户在审核中心批准后才进正常召回。
//
// 用法：
//   node scripts/seed-redteam-memory.mjs --dry-run     # 只打印要写什么
//   node scripts/seed-redteam-memory.mjs               # 真写（pending，等审核）
//   node scripts/seed-redteam-memory.mjs --refresh     # 已存在的也重写（先删后写不可能，这里只在正文变化时提示）
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// 默认写进本控制台的独立库（mem-purge @ 7989）；要写运营库用 --api http://127.0.0.1:7999/memory-eternal/api
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const API = argOf('--api', 'http://127.0.0.1:7989/memory-eternal/api');
const MATCH = argOf('--match', process.env.MEM_PURGE_MATCH || '');
const SKILLS_DIR = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'skills');
const DRY = process.argv.includes('--dry-run');

/* 红队主流程：每一段都可当成「一个工作流卡」，被召回后按步骤执行 */
/* 红队技能的索引清单（内置）：这些技能由 DSH 的 skill 工具按需加载，本机不一定有 SKILL.md 文件，
   所以索引卡按「名字 + 用途 + 什么时候用」生成，正文真源仍然是 skill 工具加载到的那份。 */
const REDTEAM_SKILLS = [
  { name: 'passive-recon', use: '不接触目标的公开数据源收集', when: '刚拿到域名、还没碰目标时' },
  { name: 'fofa-recon', use: 'FOFA API 批量测绘资产（域名/IP/端口/标题/指纹）', when: '要一次性铺开资产面时' },
  { name: 'recon-pipeline', use: 'subfinder→dnsx→naabu→httpx→katana 一条流水线', when: '域名资产面要自动化铺开时' },
  { name: 'active-scan', use: '主动端口与服务扫描（nmap/masscan）', when: '已知 IP 段、要摸端口与服务时' },
  { name: 'web-fingerprint', use: '框架/中间件/CMS/组件版本识别', when: '要按指纹挑 Nday 之前' },
  { name: 'asset-correlation', use: '域名↔IP↔C 段↔证书↔服务 的图谱', when: '资产多、要判断归属与关联时' },
  { name: 'dir-bruteforce', use: '目录与文件爆破（后台入口、备份、配置泄露）', when: 'Web 站点要找出入口时' },
  { name: 'nuclei-scan', use: '13k+ 模板的模板化漏洞扫描', when: '有指纹、要跑 Nday/1day 时' },
  { name: 'unauth-exploit', use: '未授权访问与信息泄露利用链（Redis/ES/Docker/Mongo 等）', when: '发现暴露的中间件端口时' },
  { name: 'java-deserialization', use: 'Java 反序列化链选择与利用', when: '看到 AC ED 00 05 / rO0AB / H4sI 时' },
  { name: 'webshell-toolkit', use: '冰蝎/哥斯拉/蚁剑 上传与管理 WebShell', when: '拿到文件上传或 RCE、要稳定入口时' },
  { name: 'suo5-tunnel', use: '通过 WebShell/HTTP 建 SOCKS5 隧道', when: '要伸进内网时（首选）' },
  { name: 'chisel-tunnel', use: 'HTTP/WebSocket 多路复用隧道', when: 'suo5 不合适、出网受限时' },
  { name: 'frp-tunnel', use: '自有 VPS + frpc 的稳定隧道', when: '有 VPS、要长期稳定通道时' },
  { name: 'fscan-intranet', use: '内网综合扫描（存活/端口/弱口令/未授权/高危）', when: '进了内网要打点时' },
  { name: 'gogo-intranet', use: '高性能内网扫描与指纹/关键信息提取', when: '进了内网先铺面时（先于 fscan）' },
  { name: 'credential-attack', use: '在线弱口令爆破 + 离线哈希破解', when: '有登录口或拿到 hash 时' },
  { name: 'lateral-movement', use: 'Impacket 套件横向与凭据转储', when: '已有凭据、要横到别的机器时' },
  { name: 'privesc', use: 'Windows/Linux 提权清单（配置优先、内核最后）', when: '拿到普通权限、要提权时' },
  { name: 'ad-attack', use: '域渗透全链（BloodHound/Kerberoast/ADCS/DCSync）', when: '内网存在域环境时' },
  { name: 'av-evasion', use: '免杀工程（隔离实验室）', when: '落地载荷被拦时' },
  { name: 'opsec-hide', use: '行动隐蔽：出口 IP、落地痕迹、日志检测面', when: '每次动手前后都该看' },
  { name: 'intel-sweep', use: '比 NVD 更早的信息差巡检（7 个源）', when: '要找刚披露、还没进 NVD 的洞时' },
  { name: 'vuln-intel', use: 'NVD/CNVD/Exploit-DB/KEV 查询顺序与落库口径', when: '要核实一个洞的编号与在野状态时' },
  { name: 'zero-day-hunting', use: '0day 挖掘与 1day 抢跑（补丁差分/fuzz/审计）', when: '没有现成 EXP、要自己挖时' },
  { name: 're-arsenal', use: '逆向/协议/样本分析的武器库入口与工具链', when: '要做样本或二进制分析时' },
  { name: 'binary-re', use: '二进制静态逆向工作流', when: '要看一个不认识的二进制时' },
  { name: 'unpacking', use: '加壳识别与脱壳（UPX/VMProtect/Themida…）', when: '样本加壳、静态看不到逻辑时' },
  { name: 'mobile-re', use: 'Android/iOS 逆向与移动端攻防', when: '目标有 APP 或小程序时' },
  { name: 'game-cheat', use: '游戏内存修改与外挂原理（本地靶场）', when: '目标是游戏或需要内存注入时' },
];

const WORKFLOWS = [
  {
    title: '红队工作流：信息收集（recon）',
    tags: ['红队', '工作流', 'recon'],
    body: [
      '# 红队工作流 · 信息收集',
      '',
      '触发：给了单位名称或主域名，还没资产清单。',
      '',
      '## 步骤',
      '1. 被动：FOFA / crt.sh / 备案 / 被动 DNS / 搜索引擎，先把主域与证书名收全；',
      '2. 主动：子域枚举（subfinder）→ 存活与指纹（httpx/whatweb）→ 端口（nmap -sV 或 gogo）；',
      '3. 重点看边缘资产与未备案资产：OA、VPN、邮件网关、测试环境、老系统；',
      '4. 每条资产落库（provenance=passive/active + tool + 发现时间）；',
      '5. 收口：资产数、C 段数、暴露服务分布，交给「资产梳理」。',
      '',
      '## 红线',
      '- 只收集不检测；不碰未授权范围；不因为「看起来是自己的」就跳过范围确认。',
      '',
      '## 可用技能',
      '- passive-recon / fofa-recon / recon-pipeline / active-scan / web-fingerprint / asset-correlation',
    ].join('\n'),
  },
  {
    title: '红队工作流：漏洞发现与打点（vuln-scan）',
    tags: ['红队', '工作流', 'vuln-scan'],
    body: [
      '# 红队工作流 · 漏洞发现',
      '',
      '触发：有了资产清单，要找第一个能进去的口子。',
      '',
      '## 步骤',
      '1. 先查现成的：知识库 POC 库（14k+ 条）+ 本机 nuclei 模板，别重复手搓；',
      '2. 按指纹挑 Nday/1day：OA、VPN、中间件、框架版本命中就上模板；',
      '3. 再探未授权与接口：前端 JS 提接口、Swagger/actuator、未鉴权 API；',
      '4. 每条漏洞落库，状态 candidate → confirmed，附原始请求与复现命令；',
      '5. 打点成功立刻转「漏洞利用」，不要在发现阶段做持久化。',
      '',
      '## 红线',
      '- 只验证存在性，不在发现阶段批量拖库；不制造不可逆影响。',
      '',
      '## 可用技能',
      '- nuclei-scan / unauth-exploit / dir-bruteforce / java-deserialization / web-fingerprint / vuln-intel',
    ].join('\n'),
  },
  {
    title: '红队工作流：权限获取与内网突破（exploit → pivot）',
    tags: ['红队', '工作流', 'exploit', '隧道'],
    body: [
      '# 红队工作流 · 权限与突破',
      '',
      '触发：已确认一个可利用漏洞，要拿到服务器权限并伸进内网。',
      '',
      '## 步骤',
      '1. 先拿服务器权限：RCE / 文件上传 / 反序列化；',
      '2. 立刻上加密马（冰蝎 / 哥斯拉）并**实测用户能连上**；',
      '3. 建 suo5 SOCKS5 隧道，并**实测能从隧道访问内网**；',
      '4. 记录：主机、权限、用户、隧道监听地址、可达网段；',
      '5. 交给内网渗透角色：先铺面（gogo），再打点（fscan），每发现新网段再跑一轮。',
      '',
      '## 红线',
      '- 只有凭据不算拿到账号，必须浏览器实测登录成功；',
      '- 自己 VPS 上开的代理不算隧道，必须写清目标侧那一端。',
      '',
      '## 可用技能',
      '- webshell-toolkit / suo5-tunnel / chisel-tunnel / frp-tunnel / fscan-intranet / gogo-intranet / lateral-movement / privesc',
    ].join('\n'),
  },
  {
    title: '红队工作流：战果沉淀与报告（report）',
    tags: ['红队', '工作流', 'report'],
    body: [
      '# 红队工作流 · 战果与报告',
      '',
      '触发：拿到权限或数据，要交付。',
      '',
      '## 步骤',
      '1. 攻击链按步骤写：目标 → 做了什么 → 实际命令 → 实际回显；',
      '2. 每条得分成果都必须可复现（原始请求贴进报告）；',
      '3. 截图归档：登录成功页、命令回显、数据量证明；',
      '4. 复现失败的不进报告；低危与信息级不进报告；',
      '5. 修复建议按资产给，别给通用清单。',
      '',
      '## 红线',
      '- 报告只收录拿到分的成果；区分「已拿到」与「待验证」。',
      '',
      '## 可用技能',
      '- 与本次成果对应的侦察/利用技能 + kb-maintenance（落库口径）',
    ].join('\n'),
  },
];

function frontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    v = v.replace(/^["']|["']$/g, '');
    out[k] = v;
  }
  return out;
}

async function readSkillCards() {
  const cards = [];
  // 1) 内置红队技能清单：不依赖本机有没有 SKILL.md 文件
  for (const s of REDTEAM_SKILLS) {
    cards.push({
      title: `技能索引：${s.name}`,
      tags: ['技能', 'skill', '索引', '红队', s.name],
      body: [
        `# 技能索引 · ${s.name}`,
        '',
        `用途：${s.use}`,
        `什么时候用：${s.when}`,
        '',
        '## 怎么用',
        `- \`memory_recall("${s.name}")\` 会命中本卡；真正执行前用 skill 工具加载 \`${s.name}\`。`,
        '- 正文以 skill 工具加载到的那份为准，本卡只是「什么时候该用哪个技能」的索引。',
      ].join('\n'),
    });
  }
  // 2) 本机 ~/.dsh/skills 下确实有 SKILL.md 的，补一条带路径的索引
  if (existsSync(SKILLS_DIR)) {
    const dirs = await readdir(SKILLS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const file = join(SKILLS_DIR, d.name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const text = await readFile(file, 'utf8');
      const fm = frontmatter(text);
      const desc = (fm.description || '').replace(/\s+/g, ' ').slice(0, 300);
      cards.push({
        title: `技能索引：${fm.name || d.name}`,
        tags: ['技能', 'skill', '索引', d.name],
        body: [
          `# 技能索引 · ${fm.name || d.name}`,
          '',
          desc ? `用途：${desc}` : '用途：（SKILL.md 里没写 description）',
          '',
          `本机正文（唯一真源）：\`~/.dsh/skills/${d.name}/SKILL.md\``,
          '',
          '## 怎么用',
          `- 需要这个能力时先用 skill 工具加载 \`${d.name}\`；`,
          '- 正文改了以 SKILL.md 为准，重跑 `scripts/seed-redteam-memory.mjs` 可刷新索引。',
        ].join('\n'),
      });
    }
  }
  return cards.sort((a, b) => a.title.localeCompare(b.title));
}

async function existingTitles() {
  try {
    const r = await fetch(API + '/cards?limit=1000', { headers: MATCH ? { 'x-memory-match': MATCH } : {} });
    const d = await r.json();
    return new Set((d.cards || []).map((c) => String(c.title || '')));
  } catch {
    return new Set();
  }
}

async function writeCard(card) {
  const r = await fetch(API + '/write', {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, MATCH ? { 'x-memory-match': MATCH } : {}),
    body: JSON.stringify({ title: card.title, body: card.body, kind: 'skill', tags: card.tags }),
  });
  let d = {};
  try { d = await r.json(); } catch { /* 非 JSON 就当失败 */ }
  return { status: r.status, json: d };
}

async function main() {
  const have = await existingTitles();
  const skills = await readSkillCards();
  const plan = WORKFLOWS.concat(skills);
  console.log(`目标库：${API}${MATCH ? '（匹配码已带）' : ''}`);
  console.log(`准备 ${plan.length} 张卡（工作流 ${WORKFLOWS.length} + 技能索引 ${skills.length}）；记忆库现有 ${have.size} 张`);
  let wrote = 0;
  let skipped = 0;
  let failed = 0;
  for (const card of plan) {
    if (have.has(card.title)) {
      skipped++;
      console.log(`  跳过（已存在）：${card.title}`);
      continue;
    }
    if (DRY) {
      console.log(`  [dry-run] 将写：${card.title}（${card.body.length} 字符）`);
      continue;
    }
    const r = await writeCard(card);
    if (r.json && r.json.ok) {
      wrote++;
      console.log(`  已写：${card.title} → ${r.json.path}（${r.json.status}）`);
    } else {
      failed++;
      console.log(`  失败：${card.title}（HTTP ${r.status} ${(r.json && r.json.error) || ''}）`);
    }
  }
  console.log(`\n汇总：写入 ${wrote} · 跳过 ${skipped} · 失败 ${failed}${DRY ? '（dry-run，未真写）' : ''}`);
  if (!DRY && wrote) console.log('这些卡状态是 pending：到 memory-eternal 的「审核中心」批准后才进正常召回。');
}

main().catch((e) => {
  console.error('出错：' + (e && e.message ? e.message : e));
  process.exit(1);
});
