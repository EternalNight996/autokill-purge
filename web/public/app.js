/* autokill-purge · six-page console. No framework, no build step. */

/* Keep runtime failures inspectable instead of silently breaking a page. */
window.__apErrors = [];
window.addEventListener("error", (event) => {
  window.__apErrors.push({ kind: "error", message: event.message || "script error", source: event.filename || "", line: event.lineno || 0 });
  try { renderRuntimeErrors(); } catch { /* 页面还没就绪 */ }
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  window.__apErrors.push({ kind: "rejection", message: reason && reason.message ? reason.message : String(reason) });
  try { renderRuntimeErrors(); } catch { /* 页面还没就绪 */ }
});


const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cx = (...parts) => parts.filter(Boolean).join(" ");

const TABS = ["inject", "breach", "equip", "memory", "assign", "mcp", "intel", "drill", "settings", "about"];
const TAB_LABEL = { inject: "注入", breach: "破甲", equip: "梦神装甲", memory: "记忆", assign: "分发", mcp: "MCP", intel: "情报", drill: "演练", settings: "设置", about: "关于" };

/* ------------------------------------------------------- 宿主维度（第一步：只切视图标签） */
const HOST_TARGETS = [
  { id: "dsh", name: "DSH" },
  { id: "mengbot", name: "MengBot" },
  { id: "autokill", name: "AutoKill" },
];
function hostTargetName(id) {
  return (HOST_TARGETS.find((h) => h.id === id) || HOST_TARGETS[0]).name;
}

/* ------------------------------------------------------- two-layer UI (contract §2) */
const NAV_BY_MODE = {
  simple: [
    { tab: "breach", label: "破甲" },
    { tab: "memory", label: "记忆" },
    { tab: "intel", label: "情报巡检" },
    { tab: "drill", label: "演练台" },
    { tab: "settings", label: "设置" },
  ],
  // 装备已并入破甲台「一并装备」，不再占导航位（#/equip 仍可直达看发放历史）
  // 记忆分发降级：不再占一个导航位（宿主已能运行时自助检索），但 #/assign 仍可直达
  technical: TABS.filter((t) => t !== "assign" && t !== "equip").map((t) => ({ tab: t, label: TAB_LABEL[t] })),
};
/* pages that only exist in technical mode; direct links fall back to breach */
const TECH_ONLY_TABS = ["inject", "assign", "about"];

const GROUP_ORDER = ["base", "strategy", "sampling", "paths", "diag"];
const GROUP_LABEL = { base: "基础", strategy: "生成策略", sampling: "采样", paths: "路径与文件", diag: "诊断" };
const GROUP_HINT = {
  base: "模型、输入与主操作",
  strategy: "载荷怎么生成",
  sampling: "采样建议与不可见字符",
  paths: "本机路径与文件，改错会影响运行",
  diag: "记录、命中率与错误详情",
};

const LS_UI_MODE = "ap.uiMode";
const LS_UI_MODE_AT = "ap.uiModeAt";
const LS_TECH_HINT = "ap.techHint";
const LS_GROUPS = "ap.groups";

/* default values shown as a badge in technical mode; 空 = 内置默认 */
const FIELD_DEFAULTS = {
  memoryBase: "http://127.0.0.1:7999/memory-eternal/api",
  language: "zh",
  breakDir: "",
  pluginPath: "",
  role: "",
  output: "",
  template: "sauce-1171",
};

/* 普通模式只看名字和一句特点：不显示 family / 拒绝风格字段 */
const SIMPLE_TAGLINE = {
  "gpt-4o": "通用问答稳，长任务不乱",
  o3: "擅长一步步推理",
  claude: "行文自然，适合长文",
  gemini: "多语言、多模态都能用",
  deepseek: "中文表达贴切",
  qwen3: "会跟着格式要求走",
  llama: "本地自托管，自己说了算",
  local: "完全本地运行，内容不出门",
  custom: "按你自己的那一个来",
};

/* 普通模式 DOM 文本里不允许出现的词（契约 §2.6） */
const SIMPLE_FORBIDDEN = [
  ["breakDir", "工作目录"],
  ["pluginPath", "插件路径"],
  ["memoryBase", "记忆服务地址"],
  ["payload", "载荷"],
  ["variant", "变体"],
  ["technique", "技术"],
  ["schema", "格式"],
  ["layer", "层"],
  ["wasm", "内嵌模块"],
  ["token", "令牌"],
  ["API", "服务"],
  ["HTTP", "网络"],
];


const AGENTS = [
  { id: "dsh", name: "DeepSeek Harness", short: "dsh", desc: "本机编码与研究智能体，工具面最全。" },
  { id: "mengbot", name: "MengBot", short: "mengbot", desc: "聊天侧执行体，适合轻量任务与巡检。" },
  { id: "autokill", name: "AutoKill", short: "autokill", desc: "逆向与研究引擎，读原件、出证据。" },
];

const PRESETS = [
  { id: "redteam", name: "梦神攻装", desc: "侦察、打点、横向、权限维持，一条链的默认装备。", agents: ["dsh"], items: [
    { id: "recon", name: "侦察与资产测绘", desc: "被动/主动收集、指纹识别、资产落库", skills: ["passive-recon", "fofa-recon", "recon-pipeline", "active-scan", "web-fingerprint", "asset-correlation"] },
    { id: "vuln", name: "漏洞验证与打点", desc: "Nday/1day、未授权、Web 漏洞链", skills: ["nuclei-scan", "unauth-exploit", "dir-bruteforce", "java-deserialization", "vuln-intel"] },
    { id: "shell", name: "WebShell 与隧道", desc: "冰蝎/哥斯拉马、suo5 socks5", skills: ["webshell-toolkit", "suo5-tunnel", "chisel-tunnel"] },
    { id: "lateral", name: "内网横向", desc: "凭据复用、域内枚举、跳板", skills: ["gogo-intranet", "fscan-intranet", "credential-attack", "lateral-movement", "privesc", "ad-attack"] },
    { id: "report", name: "战果与报告", desc: "攻击链、复现命令、证据截图", skills: ["kb-maintenance", "opsec-hide"] },
  ] },
  { id: "recon", name: "侦察刀", desc: "被动收集、资产测绘、指纹识别；只读，不碰目标。", agents: ["dsh", "autokill"], items: [
    { id: "passive", name: "被动收集", desc: "FOFA / crt.sh / 备案 / 被动 DNS", skills: ["passive-recon", "fofa-recon"] },
    { id: "fingerprint", name: "指纹识别", desc: "框架、中间件、CMS、组件版本", skills: ["web-fingerprint", "asset-correlation"] },
    { id: "asset-graph", name: "资产图谱", desc: "域名↔IP↔C 段↔证书↔服务", skills: ["asset-correlation", "recon-pipeline"] },
    { id: "surface", name: "攻击面清单", desc: "边缘资产、未备案、暴露服务", skills: ["active-scan", "nuclei-scan"] },
  ] },
  { id: "lateral", name: "内网横向", desc: "隧道、凭据、域内枚举；要求受控权限。", agents: ["dsh"], items: [
    { id: "tunnel", name: "隧道代理", desc: "suo5 / chisel / frp 出网", skills: ["suo5-tunnel", "chisel-tunnel", "frp-tunnel"] },
    { id: "cred", name: "凭据获取与复用", desc: "抓取、喷洒、PtH", skills: ["credential-attack", "lateral-movement"] },
    { id: "ad-enum", name: "域内枚举", desc: "BloodHound、Kerberoast、ACL", skills: ["ad-attack", "lateral-movement"] },
    { id: "privesc", name: "提权", desc: "配置类优先，内核最后", skills: ["privesc", "av-evasion"] },
  ] },
  { id: "radio", name: "无线电 / IoT", desc: "BLE、RFID、固件；偏硬件，动作小。", agents: ["mengbot"], items: [
    { id: "ble", name: "BLE 抓包与重放", desc: "HCI 抓包、service/characteristic 还原", skills: ["iot-ble"] },
    { id: "rfid", name: "RFID / 门禁", desc: "读卡、克隆、重放", skills: ["iot-ble"] },
    { id: "firmware", name: "固件解包", desc: "ubifs / squashfs、CGI 审计", skills: ["iot-router"] },
  ] },
  { id: "re", name: "逆向研究", desc: "样本、二进制、协议；本地隔离，只读原件。", agents: ["autokill"], items: [
    { id: "static", name: "静态逆向", desc: "r2 / Ghidra、符号与交叉引用", skills: ["binary-re", "re-arsenal"] },
    { id: "dynamic", name: "动态调试", desc: "x64dbg / Frida、断点与 hook", skills: ["re-arsenal", "mobile-re"] },
    { id: "unpack", name: "脱壳与样本", desc: "加壳识别、dump、IAT 修复", skills: ["unpacking", "unpacking"] },
    { id: "protocol", name: "协议还原", desc: "C2 协议、加密字段、重放", skills: ["binary-re", "jsvmp-reverse"] },
  ] },
  { id: "custom", name: "自定义", desc: "自己选智能体、权限与备注。", agents: [], items: [] },
];

const PERMISSIONS = [
  { id: "read-only", name: "只读", desc: "只收集与分析，不改目标；适合侦察与取证。" },
  { id: "controlled", name: "受控", desc: "可执行验证动作，但每一步都要逐次确认。" },
  { id: "full", name: "全权", desc: "由授权对象承担全部操作后果；只在隔离靶场使用。" },
];

const RESULTS = [
  { id: "pass", name: "通过", tone: "good" },
  { id: "partial", name: "部分", tone: "warn" },
  { id: "refused", name: "拒答", tone: "bad" },
];

const KINDS = ["skill", "knowledge", "project", "mistake", "prompt", "core", "content", "business"];

/* 中英跟随系统：navigator.language 以 en 开头就出英文，其余（含 zh-CN / zh-TW / ja 等）出中文 */
const LANG_ZH = (() => {
  try {
    const l = String(navigator.language || "zh").toLowerCase();
    return !l.startsWith("en");
  } catch {
    return true;
  }
})();
const L = (zh, en) => (LANG_ZH ? zh : en);

/* 还没做好的页面（禁用到开发完成） */
const WIP_PAGES = {
  assign: {
    eyebrow: "SOON",
    zhTitle: "记忆分发 · 开发中",
    enTitle: "Memory distribution · In development",
    zhLead: "把记忆库里的技能与工作流按智能体分发出去。功能还没上，先别用这一页。",
    enLead: "Distributing skills and workflows from the memory library to each agent. Not ready yet.",
  },
  intel: {
    eyebrow: "SOON",
    zhTitle: "情报巡检 · 开发中",
    enTitle: "Intel sweep · In development",
    zhLead: "7 个源的情报巡检正在重做，产物与历史报告暂时不开放。",
    enLead: "The 7-source intel sweep is being rebuilt; reports and history are temporarily unavailable.",
  },
  drill: {
    eyebrow: "SOON",
    zhTitle: "演练台 · 开发中",
    enTitle: "Drill console · In development",
    zhLead: "授权与法律声明流程正在重做。这段时间注入 / 卸载不会再用这页做门禁。",
    enLead: "Authorization and legal flow is being rebuilt. Injection no longer gates on this page.",
  },
};

function renderWipPage(tab) {
  const w = WIP_PAGES[tab] || WIP_PAGES.assign;
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">${esc(w.eyebrow)}</p>
      <h1>${esc(L(w.zhTitle, w.enTitle))}</h1>
      <p class="lead">${esc(L(w.zhLead, w.enLead))}</p>
    </div>
    <div class="head-meta">${badge(L("开发中", "In development"), "warn")}</div></div>
    <section class="section">
      ${emptyState(L("这一页暂时锁着", "This page is locked for now"), L("等做好会在这里直接开放，不需要你重新配置。", "It will open here once it is ready; nothing to reconfigure."))}
    </section>
  `;
}

const BREAK_ACTIONS = [
  { id: "info", name: "定性", cmd: "break info", desc: "格式、架构、节表、熵、加壳信号" },
  { id: "scan", name: "找入口", cmd: "break scan", desc: "许可类字符串与代码引用点" },
  { id: "plan", name: "提案", cmd: "break plan", desc: "offset + 期望字节 + 建议写入" },
  { id: "patch", name: "下刀", cmd: "break patch", desc: "必须带 --expect，先校验再写" },
  { id: "invert", name: "翻转", cmd: "break invert", desc: "条件跳转取反，唯一不带 expect 的写路径" },
  { id: "verify", name: "验证", cmd: "break verify", desc: "两枚 sha256 与逐字节差异" },
  { id: "restore", name: "还原", cmd: "break restore", desc: "用 .bak 覆盖，并复核 sha" },
];

const BREAK_BTN = {
  info: "执行 info",
  scan: "执行 scan",
  plan: "生成提案",
  patch: "执行下刀（校验 expect）",
  invert: "翻转条件跳转",
  verify: "执行 verify",
  restore: "从 .bak 还原",
};

/* ------------------------------------------------------------------ state */
const S = {
  booted: false,
  bootError: null,
  locked: false,
  state: null,
  version: "",
  agreementVersion: "",
  uiMode: "simple",
  techHintOpen: false,
  hostTarget: "dsh",   // dsh / mengbot / autokill（唯一宿主维度）
  hostInfo: { loaded: false, loading: false, touched: false, hosts: [], defaultHost: "dsh" },
  ak: { loaded: false, loading: false, items: [], applied: 0, total: 0, selected: null, error: null },
  models: [],
  layers: [],
  techniques: [],
  prompts: [],
  outputChoices: [],
  taskPresets: [],
  modelsLive: null,
  tab: "breach",
  memoryStatus: "unknown",
  readiness: { data: null, loading: false, tried: false, error: null },
  host: {
    data: null, prompt: null, inventory: null,
    rules: null, skills: null, netScope: null,
    ruleEdit: { name: "", text: "", dirty: false },
    skillView: { name: "", text: "" },
    skillEdit: { name: "", text: "" },
    kb: { stats: null, mode: "poc", q: "", items: [], detail: null, error: null },
    intel: { reports: null, report: null, running: false, days: 7, error: null, last: null },
    drill: { data: null, legal: null, busy: false, signer: "", error: null },
    pendingAction: null,
    progress: null,
    progressTimer: null,
    busyKind: null,
    lastResult: null,
    withPlugin: true,        // 一键注入时同时注入 autokill-purge 插件（与内核补丁同一事务）
    netScopeDraft: null,
    loading: false, tried: false, error: null, busy: false, message: "",
    promptDraft: null, promptDirty: false,
  },
  simple: {
    buildError: "",
    attempted: {},
    absorbed: {},
    attemptBusy: false,
    equipBusy: false,
    equipResult: "",
    equipError: "",
    removed: [],
    modelsOpen: false,   // 破甲台「目标模型」多选弹层（仅 CSS 展开，不重绘）
    opsOpen: true,       // 操作台默认展开
    patchOpen: true,     // 操作台里「本轮补丁」子折叠（默认展开；只渲染前 8 条）
    patchAll: false,     // 补丁清单是否显示全部 83 条
    akOpen: true,        // 梦神破甲清单子折叠（默认展开）
    advOpen: false,      // 高级折叠
    testState: "idle",
    testMessage: "",
    resignArmed: false,
    detailOpen: null,
  },
  breach: {
    model: "",
    models: [],
    layer: "prompt",
    techniques: [],
    task: "",
    role: "",
    output: "",
    template: "sauce-1171",
    scope: "full",
    // 默认就把输出要求全给（5 条拼成一条）；任务类型也默认「全部」。
    outputChoice: "all",
    taskPreset: "all",
    building: false,
    buildError: null,
    built: false,
    variants: [],
    injectArm: null,     // 两次点击确认：第一次点变成「确认注入宿主？」
    injectBusy: false,
    injectResult: null,
    delivery: "host-patch", // 破甲方式：host-patch（默认）/ payload / host-prompt / memory
    deliveryResult: null,
    botIds: [],              // MengBot 多选目标 bot（方案）
    equipPresets: ["redteam"], // 默认选中梦神攻装（可改）
    equipItemsMap: {},       // { presetId: [itemId...] } 每个预设下勾选的能力项
    withEquip: false,        // 生成时一并发放「装备」页当前那份装备（破甲 + 装备一次做完）
    advice: [],
    zero: "",
    resultMeta: null,
  },
  attempt: { model: "", technique: "", result: "pass", note: "", saving: false, error: null, ok: null },
  attempts: [],
  breachStats: null,
  equipment: [],
  equip: {
    preset: "redteam",
    presets: ["redteam"],
    items: [],
    models: [],
    agents: ["dsh"],
    custom: "",
    permissions: "read-only",
    notes: "",
    saving: false,
    error: null,
    ok: null,
  },
  assignments: {},
  assign: {
    initialized: false,
    agent: "dsh",
    custom: "",
    cards: null,
    selected: new Set(),
    mode: { skillsOnly: false, autoSync: true },
    drafts: {},
    loading: false,
    error: null,
    saving: false,
    saveError: null,
    ok: null,
    preview: null,
    previewError: null,
    previewLoading: false,
    filteredOut: 0,
    loadedQuery: { q: "", kind: "" },
  },
  memory: {
    stats: null,
    statsLoaded: false,
    statsLoading: false,
    statsError: null,
    q: "",
    kind: "",
    cards: null,
    cardsLoaded: false,
    cardsLoading: false,
    error: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    source: "",
    claim: { title: "", kind: "skill", tags: "", body: "", saving: false, error: null, ok: null },
  },
  settings: {
    memoryBase: "",
    memoryToken: "",
    language: "zh",
    breakDir: "",
    pluginPath: "",
    dataDir: "",
    draft: {},
    saving: false,
    error: null,
    ok: null,
    test: { state: "idle", message: "", hint: "" },
    resetArmed: false,
    resetError: null,
  },
  bin: {
    file: "_smoke/sample.exe",
    action: "info",
    busy: false,
    error: null,
    found: "",
    formError: null,
    notice: "",
    result: null,
    autoVerify: null,
    autoVerifyError: null,
    evidence: { file: "", shaBefore: "", shaAfter: "", differingBytes: null, lastAction: "", at: "", beforeFile: "", afterFile: "" },
    originalSha: "",
    scanKeywords: "",
    scanMinXrefs: "1",
    planString: "",
    patch: { offset: "", expect: "", mode: "nop", nop: "7", write: "" },
    invert: { offset: "" },
    verify: { before: "", after: "" },
    restoreConfirm: false,
  },
};

/* ------------------------------------------------------------------ utils */
function fmtTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtNum(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : String(value);
}

function rateOf(pass, total) {
  if (!total) return 0;
  return Math.round((1000 * Number(pass || 0)) / Number(total)) / 10;
}

function badge(text, tone = "", extra = "") {
  if (!text) return "";
  return `<span class="badge ${tone} ${extra}">${esc(text)}</span>`;
}

function spinner(label = "读取中…") {
  return `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span></div>`;
}

function emptyState(title, hint = "", extra = "") {
  return `<div class="empty"><strong>${esc(title)}</strong>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}${extra || ""}</div>`;
}

function alertBox(message, hint = "", tone = "bad", pre = "") {
  return `<div class="alert ${tone}" role="alert"><strong>${esc(message)}</strong>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}${pre ? `<pre>${esc(pre)}</pre>` : ""}</div>`;
}

function okBox(message, hint = "") {
  return `<div class="alert good" role="status"><strong>${esc(message)}</strong>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
}

/** 软失败：注入/插件安装/记忆服务这类「第二次就成」的失败，用黄色提示 + 明确让用户再点一次 */
function softFailBox(message, hint) {
  const raw = String(message || "");
  const text = raw.replace(/^[✓✔]\s*/, "");
  const soft = /失败|未完成|unreachable|回滚|超时|not ready/i.test(text);
  if (!soft) return okBox(text);
  return `<div class="alert warn" role="alert"><strong>${esc(text)}</strong><span class="hint">${
    esc(hint || "不是致命错误：第一次常因插件安装或记忆服务还没就绪而失败，再点一次「一键注入」即可。")
  }</span></div>`;
}

function detectSource(base) {
  if (!base) return "unknown";
  try {
    const u = new URL(String(base));
    const host = u.hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]") return "local";
    return "cloud";
  } catch {
    return "unknown";
  }
}

function sourceLabel(source) {
  if (source === "local") return "本地 local";
  if (source === "cloud") return "云端 cloud";
  if (source === "env") return "环境变量 env";
  return "来源未知";
}

function modelName(id) {
  const m = S.models.find((x) => x.id === id);
  return m ? m.name : id || "—";
}

function techniqueName(id) {
  const t = S.techniques.find((x) => x.id === id);
  return t ? t.name : id || "—";
}

function cleanHex(value) {
  return String(value || "").replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function isHex(value) {
  const s = cleanHex(value);
  return s.length > 0 && s.length % 2 === 0;
}

/* ------------------------------------------------------ two-layer helpers */
function lsGet(key, fallback = "") {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode / quota */ }
}

/* 普通模式的自愈文案：把技术名词换成人话，再去掉裸状态码 */
function simpleText(value) {
  let out = String(value == null ? "" : value);
  for (const [from, to] of SIMPLE_FORBIDDEN) {
    try { out = out.replace(new RegExp(from, "gi"), to); } catch { /* bad pattern in a hostile build */ }
  }
  out = out.replace(/\b(400|403|404|500|502|503)\b/g, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}

/* 普通模式的错误提示 = 发生了什么（人话）+ 下一步做什么（一个动作） */
function simpleReason(err) {
  const code = String((err && err.code) || "");
  const status = Number((err && err.status) || 0);
  if (code === "network" || status === 0) return "连不上本机的控制台服务。确认它还开着，再点『重试』。";
  if (code === "agreement" || status === 403) return "协议需要重新签一下。点『重新签署协议』签完再回来。";
  if (status === 503) return "记忆服务没连上。到设置里点『测试连接』看看，再回来重试。";
  if (status === 404) return "这个版本还不支持这一步。先点『重试』，还不行就切到技术模式看详情。";
  if (status >= 500) return "服务端这次没返回结果。等几秒再点『重试』。";
  if (status === 400) return "这次的要求没法处理。把要它做的事写具体一点，再点『重试』。";
  return "这次没成功。等一秒再点『重试』。";
}

/* ---- technical mode: collapsible groups ---- */
function readGroups() {
  const raw = lsGet(LS_GROUPS, "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function groupIsOpen(page, key) {
  const map = readGroups();
  const k = page + ":" + key;
  return Object.prototype.hasOwnProperty.call(map, k) ? !!map[k] : key === "base";
}
function saveGroupState(el) {
  const key = el && el.dataset ? el.dataset.group : "";
  if (!key) return;
  const map = readGroups();
  map[key] = !!el.open;
  lsSet(LS_GROUPS, JSON.stringify(map));
}
function bindGroups() {
  $$("#page details.grp").forEach((el) => el.addEventListener("toggle", () => saveGroupState(el)));
}
/* groups: [{ key, html, hint? }] — 固定顺序 基础 → 生成策略 → 采样 → 路径与文件 → 诊断 */
function groupsHtml(page, groups) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && g.html);
  if (!list.length) return "";
  const sorted = list.slice().sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key));
  return `<div class="groups">${sorted.map((g) => {
    const open = groupIsOpen(page, g.key);
    return `<details class="grp" data-group="${esc(page + ":" + g.key)}"${open ? " open" : ""}>
      <summary><span class="grp-title">${esc(GROUP_LABEL[g.key] || g.key)}</span><span class="grp-hint">${esc(g.hint || GROUP_HINT[g.key] || "")}</span></summary>
      <div class="grp-body">${g.html}</div>
    </details>`;
  }).join("")}</div>`;
}

/* 技术模式的字段脚注：默认值徽标 + 恢复默认 */
function fieldDefault(what, current, defaultValue, opts = {}) {
  const value = String(current == null ? "" : current);
  const fallback = String(defaultValue == null ? "" : defaultValue);
  const shown = fallback ? fallback : "内置默认";
  const isDefault = value === fallback;
  return `<span class="field-default">${badge("默认值：" + shown, isDefault ? "good" : "", "mono")}
    <button type="button" class="small" data-reset-field="${esc(what)}" ${isDefault ? "disabled" : ""}>恢复默认</button></span>`;
}

/* copy buttons keep long payloads out of HTML attributes */
let copyStore = new Map();
let copySeq = 0;
/* 只读快照：浏览器端验收脚本拿不到剪贴板权限时，用它核对「复制」内容 */
try {
  Object.defineProperty(window, "__copyStore", {
    configurable: true,
    get: () => Object.fromEntries(copyStore),
  });
} catch { /* 老浏览器忽略 */ }
function resetCopyStore() {
  copyStore = new Map();
  copySeq = 0;
}
function copyBtn(text, label = "复制", cls = "small") {
  const id = "copy" + ++copySeq;
  copyStore.set(id, String(text ?? ""));
  return `<button type="button" class="${cls}" data-copy-id="${id}" data-copy-msg="${esc(label)}">${esc(label)}</button>`;
}

let toastTimer = null;
const TOAST_MS = { ok: 2200, warn: 3200, bad: 4200 };
/**
 * 短提示条。kind: ok（默认，中性确认）/ warn（琥珀，需留意）/ bad（红色，失败）。
 * 规则：凡是"没做成功 / 被拦住"的提示都走 toastError()，不要再静默成中性色。
 */
function toast(message, kind = "ok") {
  const el = $("#toast");
  const tone = kind === "bad" || kind === "warn" ? kind : "";
  el.textContent = message;
  el.className = "toast" + (tone ? " " + tone : "");
  el.setAttribute("role", tone === "bad" ? "alert" : "status");
  el.setAttribute("aria-live", tone === "bad" ? "assertive" : "polite");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_MS[tone || "ok"]);
}
function toastError(message) { toast(message, "bad"); }

/** 装备/破甲入库结果拼成一句人话（后端 absorbed 字段） */
function equipPluginNote(d) {
  const p = d && d.plugin;
  if (!p) return '';
  if (p.ok === false) return '；插件安装失败：' + (p.summary || p.error || '未知原因');
  if (p.changed) return '；已装「梦神破甲」插件（重启 DSH 后 58 个 redteam_* 工具生效）';
  return '';
}

function absorbNote(absorbed) {
  if (!absorbed) return "";
  if (absorbed.ok) return `；已入库待审：${absorbed.path || absorbed.key}（审核通过后才进检索）`;
  return `；入库未完成：${absorbed.error || "记忆服务异常"}`;
}

async function copyText(text, message = "已复制") {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    toast(message);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = String(text ?? "");
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(message); } catch { toastError("复制失败，请手动选择文本"); }
    ta.remove();
  }
}

/* ------------------------------------------------------------------ errors */
class ApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "ApiError";
    this.code = opts.code || "error";
    this.hint = opts.hint || "";
    this.status = opts.status || 0;
    this.data = opts.data || null;
  }
}

function defaultHint(code, status) {
  if (code === "agreement") return "先签署《安全与法律协议》；签署后会自动继续。";
  if (code === "expect_mismatch" || status === 409) return "expect 与文件当前字节不一致，文件没有被修改。重新跑定性或提案，再填一次字节。";
  if (status === 403) return "确认协议已签署，或检查本机文件权限。";
  if (status === 404) return "确认服务端版本包含这个接口，并检查文件路径。";
  if (status === 400) return "检查输入参数、文件格式与偏移量。";
  if (status === 503) return "记忆服务不可达；先启动 memory-eternal，再到设置里测试连接。";
  if (status >= 500) return "服务端出错了；看服务端日志里的原始错误。";
  return "检查服务是否在运行，以及浏览器网络面板里的原始响应。";
}

function errorFrom(data, status = 0) {
  let code = "http_" + status;
  let message = "";
  let hint = "";
  if (data && typeof data === "object") {
    const raw = data.error;
    if (raw && typeof raw === "object") {
      code = raw.code || data.code || code;
      message = raw.message || data.message || "";
      hint = raw.hint || data.hint || "";
    } else if (typeof raw === "string") {
      code = raw;
      message = data.message || raw;
      hint = data.hint || "";
    } else {
      code = data.code || code;
      message = data.message || "";
      hint = data.hint || "";
    }
    if (!message && typeof data.detail === "string") message = data.detail;
  }
  if (code === "agreement" && !message) message = "请先签署《安全与法律协议》";
  if (!message) message = status ? `请求失败（HTTP ${status}）` : "请求失败";
  return new ApiError(message, { code, hint: hint || defaultHint(code, status), status, data });
}

function isAgreementError(err) {
  if (!err) return false;
  const code = err.code || "";
  const msg = String(err.message || "");
  return code === "agreement" || (err.status === 403 && /协议|agreement/i.test(msg));
}

async function request(path, opts = {}) {
  const { method = "GET", body, headers = {} } = opts;
  const init = { method, headers: { accept: "application/json", ...headers } };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError("无法连接控制台服务", {
      code: "network",
      hint: "确认服务端已启动（默认 http://127.0.0.1:8792），再重试。",
      status: 0,
    });
  }
  const raw = await res.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { raw }; }
  }
  if (!res.ok) {
    const err = errorFrom(data, res.status);
    if (isAgreementError(err)) lockAgreement();
    throw err;
  }
  // 逻辑闭环：任何会改宿主状态的动作成功后，右侧栏按当前宿主重取（350ms 合并连击）
  if (method !== "GET") {
    const p0 = String(path).split("?")[0];
    if (RAIL_MUTATION_RE.test(p0) || RAIL_MUTATION_EXTRA_RE.test(p0)) scheduleRailRefresh();
  }
  return data;
}

/* 会改「注入了什么」的写接口：宿主补丁/卸载/还原、梦神破甲、MengBot 注入与装备、ops run */
const RAIL_MUTATION_RE = /^\/api\/(host|autokill|mengbot)\//;
const RAIL_MUTATION_EXTRA_RE = /^\/api\/ops\/[^/]+\/run$|^\/api\/breach\/(un)?inject-host$/;

async function requestText(path) {
  let res;
  try {
    res = await fetch(path, { headers: { accept: "text/markdown, text/plain, */*" }, cache: "no-store" });
  } catch (e) {
    return { ok: false, status: 0, text: "无法连接控制台服务", contentType: "" };
  }
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, contentType: res.headers.get("content-type") || "" };
}

function payloadError(data, fallback = "接口返回失败") {
  if (data && data.ok === false) return errorFrom(data, 200);
  return new ApiError(fallback, { code: "payload", hint: defaultHint("payload", 0), status: 200, data });
}

/* ------------------------------------------------------------------ agreement */
function setAgreementVersion() {
  const v = S.agreementVersion || (S.state && S.state.agreement && S.state.agreement.version) || "";
  const el = $("#agreeVersion");
  if (el) el.textContent = v ? v : "签署后显示";
}

function showAgreement(reset = true) {
  const overlay = $("#agreement");
  if (!overlay) return;
  S.locked = true;
  overlay.hidden = false;
  document.body.classList.add("modal-open");
  const app = $("#app");
  if (app) app.inert = true;
  $("#agreeForm").hidden = false;
  $("#agreeLocked").hidden = true;
  if (reset) {
    $("#agreeCheck").checked = false;
    $("#agreeAccept").disabled = true;
    $("#agreeError").innerHTML = "";
  }
  setAgreementVersion();
  setTimeout(() => { const c = $("#agreeCheck"); if (c) c.focus(); }, 30);
}

function hideAgreement() {
  const overlay = $("#agreement");
  if (!overlay) return;
  overlay.hidden = true;
  document.body.classList.remove("modal-open");
  const app = $("#app");
  if (app) app.inert = false;
  S.locked = false;
}

function lockAgreement() {
  if (S.locked && !$("#agreement").hidden) return;
  S.locked = true;
  showAgreement(false);
  setStatus("warn", "待签署协议");
  renderPage();
}

async function acceptAgreement() {
  const checked = $("#agreeCheck").checked;
  if (!checked) return;
  const signer = $("#agreeSigner").value.trim();
  const btn = $("#agreeAccept");
  const errBox = $("#agreeError");
  btn.disabled = true;
  btn.textContent = "签署中…";
  errBox.innerHTML = "";
  try {
    const data = await request("/api/agreement", { method: "POST", body: { accepted: true, signer } });
    if (data && data.agreement) {
      S.state = S.state || {};
      S.state.agreement = data.agreement;
      S.agreementVersion = data.agreement.version || S.agreementVersion;
    }
    hideAgreement();
    await boot();
  } catch (e) {
    errBox.innerHTML = alertBox(e.message, e.hint || "检查服务端是否在运行；签署记录需要写本机 state.json。");
    if (isAgreementError(e)) lockAgreement();
  } finally {
    btn.textContent = "签署并进入";
    btn.disabled = !$("#agreeCheck").checked;
  }
}

function trapAgreementFocus(event) {
  if (event.key !== "Tab") return;
  const dialog = $("#agreeDialog");
  const nodes = $$("a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex='0']", dialog)
    .filter((el) => el.getClientRects().length > 0 && !el.hidden);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------ boot / shell */
function setStatus(kind, text, title = "") {
  S.memoryStatus = kind;
  const wrap = $("#status");
  if (!wrap) return;
  const dot = $(".dot", wrap);
  if (dot) dot.className = "dot " + (kind === "loading" ? "loading" : kind);
  $("#statusText").textContent = text;
  wrap.title = title || text;
}

function applyState(data) {
  if (!data) return;
  S.deploy = data.deploy || null;
  S.state = data.state || {};
  S.version = data.version || S.version;
  S.agreementVersion = data.agreementVersion || (S.state.agreement && S.state.agreement.version) || S.agreementVersion || "—";
  S.models = Array.isArray(data.models) ? data.models : [];
  S.layers = Array.isArray(data.layers) ? data.layers : [];
  S.techniques = Array.isArray(data.techniques) ? data.techniques : [];
  S.prompts = Array.isArray(data.prompts) ? data.prompts : [];
  S.outputChoices = Array.isArray(data.outputChoices) ? data.outputChoices : [];
  S.taskPresets = Array.isArray(data.taskPresets) ? data.taskPresets : [];
  S.modelsLive = data.modelsLive || null;
  S.attempts = Array.isArray(S.state.attempts) ? S.state.attempts : [];
  S.equipment = Array.isArray(S.state.equipment) ? S.state.equipment : [];
  S.assignments = S.state.assignments && typeof S.state.assignments === "object" ? S.state.assignments : {};
  const settings = S.state.settings && typeof S.state.settings === "object" ? S.state.settings : {};
  S.settings.memoryBase = settings.memoryBase || S.settings.memoryBase || "";
  S.settings.language = settings.language || S.settings.language || "zh";
  S.settings.breakDir = settings.breakDir || S.settings.breakDir || "";
  S.settings.pluginPath = settings.pluginPath || S.settings.pluginPath || "";
  S.settings.dataDir = settings.dataDir || S.settings.dataDir || "";
  S.settings.memoryToken = settings.memoryToken || "";
  S.memory.source = detectSource(S.settings.memoryBase);
  if (!S.breach.model && S.models.length) S.breach.model = S.models[0].id;
  if (!S.layers.some((l) => l.id === S.breach.layer) && S.layers.length) S.breach.layer = S.layers[0].id;
  if (!S.attempt.model) S.attempt.model = S.breach.model;
  if (!S.attempt.technique && S.techniques.length) S.attempt.technique = S.techniques[0].id;
  if (!S.assign.initialized) initAssignFromState();
  // 任务类型默认「全部」：进页面就把 5 条预设任务填好（用户可改可删）。
  if (!S.breach.task && S.breach.taskPreset && S.breach.taskPreset !== "custom") {
    const presetText = presetTextFor(S.breach.taskPreset);
    if (presetText) S.breach.task = presetText;
  }
  /* 服务端 > localStorage > simple（契约 §2.1） */
  S.uiMode = resolveUiMode(settings.uiMode);
  // 刚在本机点过开关、服务端还没写完的那一刻刷新页面：以本机为准，并回写一次把两边对齐。
  if (settings.uiMode && S.uiMode !== settings.uiMode) {
    request("/api/settings", { method: "POST", body: { uiMode: S.uiMode } }).catch(() => {});
  }
  S.techHintOpen = S.uiMode === "technical" && !lsGet(LS_TECH_HINT, "");
  applyModeRoute();
}

function resolveUiMode(serverValue) {
  const server = serverValue == null
    ? (S.state && S.state.settings ? S.state.settings.uiMode : undefined)
    : serverValue;
  const local = lsGet(LS_UI_MODE, "");
  const localOk = local === "simple" || local === "technical";
  const localAt = Number(lsGet(LS_UI_MODE_AT, "0")) || 0;
  // 点开关 → 写 localStorage → POST 服务端，这三步不是原子的：若用户在这 15 秒内刷新，
  // 服务端可能还是旧值。此时以本机刚点的为准（并回写服务端），否则会出现「刷新后模式反转」。
  if (localOk && localAt && Date.now() - localAt < 15000 && server && server !== local) return local;
  if (server === "simple" || server === "technical") return server;
  if (localOk) return local;
  return "simple";
}

function modeIsTechnical() { return S.uiMode === "technical"; }

function updateModeSwitch() {
  const btn = $("#modeSwitch");
  if (!btn) return;
  const tech = modeIsTechnical();
  const label = tech ? "当前是技术模式，点一下回到普通模式" : "当前是普通模式，点一下进入技术模式";
  btn.setAttribute("aria-checked", tech ? "true" : "false");
  btn.setAttribute("aria-label", label);
  btn.dataset.mode = S.uiMode;
  btn.title = label;
}

/* simple 模式没有 #/assign、#/about：直接访问要落回破甲页 */
function applyModeRoute() {
  if (modeIsTechnical()) return false;
  if (!TECH_ONLY_TABS.includes(S.tab)) return false;
  S.tab = "breach";
  try { history.replaceState(null, "", "#/breach"); } catch { /* file:// */ }
  return true;
}

function setUiMode(mode, opts = {}) {
  const next = mode === "technical" ? "technical" : "simple";
  S.uiMode = next;
  S.state = S.state || {};
  S.state.settings = S.state.settings || {};
  S.state.settings.uiMode = next;
  lsSet(LS_UI_MODE, next);
  lsSet(LS_UI_MODE_AT, String(Date.now()));
  if (next === "technical") S.techHintOpen = !lsGet(LS_TECH_HINT, "");
  else S.techHintOpen = false;
  updateModeSwitch();
  applyModeRoute();
  setNav();
  renderPage();
  if (opts.persist === false) return;
  /* 存服务端失败只 toast：不回滚 UI、不阻断（契约 §2.1） */
  request("/api/settings", { method: "POST", body: { uiMode: next } })
    .then((data) => {
      if (!data || data.ok === false) throw payloadError(data, "保存模式失败");
      if (data.settings && typeof data.settings === "object") mergeSettings(data.settings);
    })
    .catch(() => {
      toast(next === "technical"
        ? "已经切到技术模式了，只是这次没记住；下次打开可能还是普通模式。"
        : "已经切到普通模式了，只是这次没记住；下次打开可能还是技术模式。");
    });
}

function renderTechHint() {
  const box = $("#page");
  if (!box || !S.techHintOpen || !modeIsTechnical() || S.locked) return;
  box.insertAdjacentHTML("afterbegin", `<div class="tech-hint" role="status">
    <span>技术模式会显示全部参数和文件路径。改错可能影响运行，可以随时点『恢复默认』。</span>
    <button type="button" class="small" data-tech-hint>知道了</button>
  </div>`);
}


function cardPath(card) {
  if (typeof card === "string") return card;
  if (card && typeof card === "object") return String(card.path || "");
  return "";
}

function initAssignFromState() {
  const current = S.assignments[S.assign.agent];
  S.assign.selected = new Set((current && Array.isArray(current.cards) ? current.cards : []).map(cardPath).filter(Boolean));
  if (current && current.mode) S.assign.mode = { skillsOnly: !!current.mode.skillsOnly, autoSync: current.mode.autoSync !== false };
  S.assign.initialized = true;
}

/* ---------------------------------------------------------- 主题（黑客风） */
const THEMES = [
  { id: "default", label: "默认蓝", color: "#6EA8FF" },
  { id: "terminal", label: "终端黑（零圆角·全等宽）", color: "#39ff14" },
  { id: "ops", label: "军工橙（角标面板）", color: "#ff7a00" },
  { id: "steel", label: "工程灰（Burp 风）", color: "#7cb7ff" },
  { id: "matrix", label: "矩阵绿（扫描线 · 生化风）", color: "#00ff9c" },
  { id: "cyber", label: "赛博青（霓虹网格）", color: "#00e5ff" },
  { id: "amber", label: "琥珀 CRT", color: "#ffb000" },
];
const THEME_KEY = "ap.theme";
const THEME_VER_KEY = "ap.themeVer";
// 默认主题的「代」：换默认值时 +1，老浏览器里存着的旧选择会被一次性迁到新默认
const THEME_DEFAULT_VER = "3";
const DEFAULT_THEME = "ops"; // 军工橙（默认皮肤）

/* ---------------------------------------------------- 破甲台：宿主探测与方案 */
async function loadHostInfo() {
  if (S.hostInfo.loading || S.hostInfo.loaded) return;
  S.hostInfo.loading = true;
  try {
    const d = await request("/api/hosts");
    if (d && d.ok !== false && Array.isArray(d.hosts) && d.hosts.length) {
      S.hostInfo.hosts = d.hosts;
      S.hostInfo.defaultHost = d.defaultHost || "dsh";
      S.hostInfo.loaded = true;
      // 用户没手动切过宿主时，跟着本机探测结果走（默认 dsh 兜底）
      if (!S.hostInfo.touched) S.hostTarget = S.hostInfo.defaultHost;
      if (railReady) loadInjectSummary(true); // 宿主可能刚被探测结果改过
    }
  } catch { /* 旧后端没有 /api/hosts：按 dsh 兜底 */ }
  finally {
    S.hostInfo.loading = false;
    if (S.tab === "breach") renderPage();
  }
}

function hostOptionLabel(h) {
  if (!h) return "";
  const flag = h.installed ? "✓ 已安装" : "未识别";
  return `${h.name} · ${flag}${h.detail && h.detail !== "已安装" ? "（" + h.detail + "）" : ""}`;
}

/** 方案预设：落到 layer + techniques（按宿主给不同集合） */
function planPresetsFor(hostId, techs) {
  const ids = (Array.isArray(techs) ? techs : []).map((t) => t.id);
  const pick = (n) => ids.slice(0, Math.max(1, Math.min(n, ids.length)));
  if (hostId === "mengbot") return [];
  return [
    { id: "std", name: "标准（3 技术 · 提示词层）", layer: "prompt", techs: pick(3) },
    { id: "strong", name: "强攻（6 技术 · 提示词层）", layer: "prompt", techs: pick(6) },
    { id: "param", name: "只调采样参数", layer: "param", techs: pick(2) },
    { id: "proto", name: "协议层（结构改写）", layer: "protocol", techs: pick(3) },
  ];
}

/** MengBot 目标 bot（多选）：没选过就默认第一个，避免一上来批量改所有 soul */
function currentBotIds() {
  const all = ((S.mb && S.mb.bots) || []).map((x) => x.id);
  const picked = Array.isArray(S.breach.botIds) ? S.breach.botIds.filter((id) => all.includes(id)) : [];
  if (picked.length) return picked;
  return all.length ? [all[0]] : [];
}

function currentPlanId(plans) {
  const b = S.breach;
  const hit = plans.find((p) => p.layer === b.layer && p.techs.join() === (b.techniques || []).join());
  return hit ? hit.id : (plans[0] && plans[0].id) || "";
}

function applyPlanPreset(id) {
  const plans = planPresetsFor(S.hostTarget, S.techniques);
  const p = plans.find((x) => x.id === id);
  if (!p) return;
  S.breach.layer = p.layer;
  S.breach.techniques = p.techs.slice();
  S.breach.planId = p.id;
  renderPage();
}

// 载荷破甲并非必选：生成之后怎么投递由这里决定。默认仍是「载荷破甲」，其余为可选。
const DELIVERY_MODES = [
  { id: "host-patch", short: "补丁层", name: "宿主注入 · 补丁层（默认）", hint: "改宿主程序与配置：47 条代码 + 36 条提示词/工具，字节级替换，需重启 dsh。" },
  { id: "payload", short: "载荷", name: "载荷破甲（复制去用）", hint: "只出文本载荷，不改宿主任何文件。" },
  { id: "host-prompt", short: "提示词注入", name: "宿主注入 · 提示词层", hint: "只写 prompt-inject.md（每次会话注入的最前段），不碰代码；重启 dsh 生效。" },
  { id: "ak-patch", short: "梦神破甲", name: "宿主注入 · 梦神破甲（AutoKill 配置层）", hint: "改 AutoKill 的 config.toml：审批 / 深度 / 运行时 / 预算 / 构建参数，重启 AutoKill 生效。" },
  { id: "memory", short: "入库", name: "只入库（待审）", hint: "只把载荷存进记忆库，宿主不受影响。" },
];
function deliveryMeta(id) {
  return DELIVERY_MODES.find((x) => x.id === id) || DELIVERY_MODES[0];
}
/** 同一个「提示词层」在不同宿主落点不同：DSH/autokill 写各自 prompt-inject.md，MengBot 写 bot 的 SOUL.md */
function deliveryMetaFor(id) {
  const base = deliveryMeta(id);
  if (id !== "host-prompt") return base;
  if (S.hostTarget === "mengbot") {
    return Object.assign({}, base, {
      name: "宿主注入 · bot soul",
      hint: "把首张载荷写进选中 bot 的 SOUL.md（前缀），重启 MengBot 生效；会先备份可还原。",
    });
  }
  if (S.hostTarget === "autokill") {
    return Object.assign({}, base, {
      name: "宿主注入 · 提示词层（AutoKill）",
      hint: "写 %APPDATA%\\autokill\\prompt-inject.md，重启 AutoKill 生效；原文自动备份。",
    });
  }
  return base;
}
function deliverySelectHtml(id, b) {
  const isDsh = S.hostTarget === "dsh";
  const isAk = S.hostTarget === "autokill";
  const isMb = S.hostTarget === "mengbot";
  return `<label class="field"><span>破甲方式</span>
    <select id="${esc(id)}" data-focus="${esc(id)}">${DELIVERY_MODES.map((m) => {
      // 83 补丁只属于 DSH；梦神破甲只属于 AutoKill
      const off = (m.id === "host-patch" && !isDsh) || (m.id === "ak-patch" && !isAk);
      const tag = m.id === "host-patch" && !isDsh ? "（仅 DSH）" : (m.id === "ak-patch" && !isAk ? "（仅 AutoKill）" : "");
      return `<option value="${m.id}"${b.delivery === m.id ? " selected" : ""}${off ? " disabled" : ""}>${esc(deliveryMetaFor(m.id).name)}${tag}</option>`;
    }).join("")}</select>
    <span class="help">${esc(deliveryMetaFor(b.delivery).hint)}</span>
  </label>`;
}

function themeMeta(id) {
  return THEMES.find((x) => x.id === id) || THEMES[0];
}

function currentTheme() {
  const t = document.body.dataset.theme || "default";
  return THEMES.some((x) => x.id === t) ? t : DEFAULT_THEME;
}

function applyTheme(id, persist = true) {
  const t = THEMES.some((x) => x.id === id) ? id : DEFAULT_THEME;
  if (t === "default") document.body.removeAttribute("data-theme");
  else document.body.dataset.theme = t;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, t);
      localStorage.setItem(THEME_VER_KEY, THEME_DEFAULT_VER);
    } catch { /* 隐私模式下忽略 */ }
  }
  syncThemeDots();
}

function syncThemeDots() {
  const cur = currentTheme();
  const meta = themeMeta(cur);
  const btn = document.querySelector(".theme-pick > summary");
  if (btn) {
    btn.setAttribute("aria-label", "界面主题：" + meta.label + "（点击切换）");
    const sw = btn.querySelector(".swatch");
    if (sw) { sw.style.background = meta.color; sw.style.boxShadow = "0 0 8px " + meta.color; }
    const txt = btn.querySelector(".theme-name");
    if (txt) txt.textContent = meta.label.split("（")[0];
  }
  $$(".theme-pick li button[data-theme-set]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.themeSet === cur ? "true" : "false");
  });
}

function mountThemeDots() {
  const host = document.querySelector(".topbar-right");
  if (!host) return;
  if (host.querySelector(".theme-pick")) { syncThemeDots(); return; }
  const box = document.createElement("details");
  box.className = "theme-pick";
  box.innerHTML = [
    '<summary><span class="swatch"></span><span class="theme-name">主题</span></summary>',
    "<ul>",
    THEMES.map((t) => `<li><button type="button" data-theme-set="${t.id}" aria-pressed="false"><i style="background:${t.color};box-shadow:0 0 8px ${t.color}"></i>${t.label}</button></li>`).join(""),
    "</ul>",
  ].join("");
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-set]");
    if (!b) return;
    applyTheme(b.dataset.themeSet);
    box.open = false;
  });
  host.insertBefore(box, host.firstChild);
  syncThemeDots();
}

function initTheme() {
  // 默认已从军工橙换成 matrix（生化风）。老浏览器里存着旧的 ops，靠 themeVer 一次性迁移：
  // 迁移只发生一次，之后用户自己点的主题照常被记住。
  let saved = DEFAULT_THEME;
  try {
    if (localStorage.getItem(THEME_VER_KEY) === THEME_DEFAULT_VER) {
      saved = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    } else {
      localStorage.setItem(THEME_KEY, DEFAULT_THEME);
      localStorage.setItem(THEME_VER_KEY, THEME_DEFAULT_VER);
    }
  } catch { /* 隐私模式：不留痕，直接用默认 */ }
  applyTheme(saved, false);
  mountThemeDots();
  mountHostSwitch();
}

/* 宿主切换器（第一步：只切视图标签并记住选择；数据过滤在第二步做） */
const HOST_KEY = "ap.hostTarget";
function mountHostSwitch() {
  const host = document.querySelector(".topbar-right");
  if (!host) return;
  const existing = host.querySelector("#hostSwitch");
  if (existing) { existing.value = S.hostTarget; return; }
  const box = document.createElement("label");
  box.className = "host-pick";
  box.innerHTML = `<span class="mini">宿主</span><select id="hostSwitch" aria-label="当前宿主">${HOST_TARGETS.map((h) => `<option value="${esc(h.id)}"${S.hostTarget === h.id ? " selected" : ""}>${esc(h.name)}</option>`).join("")}</select>`;
  box.querySelector("select").addEventListener("change", (e) => {
    S.hostTarget = e.target.value;
    S.hostInfo.touched = true;
    try { localStorage.setItem(HOST_KEY, S.hostTarget); } catch { /* 隐私模式 */ }
    // 宿主是唯一维度：切到 MengBot 时把宿主区块的 tab 一起切过去并加载 bot 列表
    const mb = mbState();
    mb.tab = S.hostTarget === "mengbot" ? "mengbot" : "dsh";
    if (mb.tab === "mengbot") {
      // 宿主注入两条（prompt-inject.md / 83 补丁）在 MengBot 下不成立，投递方式回退到载荷
      if (String(S.breach.delivery || "").startsWith("host-")) S.breach.delivery = "payload";
      loadMengbot(false);
    }
    toast("宿主切到 " + hostTargetName(S.hostTarget));
    // 切到 AutoKill 时强制重读梦神破甲与 MCP 插件状态（这两块只属于 AutoKill）
    if (S.hostTarget === "autokill") loadAkPatches(true);
    renderPage();
    // 右侧栏跟宿主同频：立刻清掉旧宿主的数字并拉新宿主的聚合
    loadInjectSummary(true);
  });
  host.insertBefore(box, host.firstChild);
}

async function boot() {
  try {
    const ht = localStorage.getItem(HOST_KEY);
    if (ht && HOST_TARGETS.some((h) => h.id === ht)) {
      S.hostTarget = ht;
      // 用户选过的宿主优先于探测出来的默认值，别再被 defaultHost 覆盖回去
      S.hostInfo.touched = true;
    }
  } catch { /* 隐私模式 */ }
  initTheme();
  setStatus("loading", "连接中…");
  try {
    const ping = await request("/api/ping").catch(() => null);
    if (ping && ping.version) S.version = ping.version;
    // 顶栏版本号：确认浏览器加载的是哪一版（缓存排查时一眼可辨）
    try {
      const verEl = document.getElementById("appVersion");
      if (verEl && S.version) {
        verEl.textContent = "v" + S.version;
        verEl.title = "控制台版本 " + S.version;
      }
    } catch { /* 老页面没有这个节点就跳过 */ }
    const data = await request("/api/state");
    applyState(data);
    // 业主身份是程序内置的（lib/owner.mjs → /api/state.deploy.owner）：页面标题与页头都跟着它走
    const own = (S.deploy && S.deploy.owner) || null;
    if (own && own.display) {
      document.title = "梦神破甲 · " + own.display;
      const sub = document.querySelector(".brand .sub");
      if (sub) sub.textContent = "autokill-purge · 破甲控制台 · " + own.display;
    }
    S.booted = true;
    S.bootError = null;
    // 从「梦神装甲」进来：播一次入场（扫描线 + logo 光晕），让“触发”有存在感
    try {
      if (location.search.indexOf("from=armor") >= 0) {
        document.body.classList.add("armor-enter");
        setTimeout(() => { try { document.body.classList.remove("armor-enter"); } catch { /* ignore */ } }, 1700);
      }
    } catch { /* ignore */ }
    const accepted = S.state && S.state.agreement && S.state.agreement.accepted;
    if (!accepted) {
      S.locked = true;
      showAgreement();
      setStatus("warn", "待签署协议");
      renderPage();
      return;
    }
    hideAgreement();
    // 私有部署固定入口：打开根地址（没有 hash）时直接落到 #/memory
    if (!location.hash && S.deploy && S.deploy.entryHash) {
      location.hash = S.deploy.entryHash;
    }
    renderPage();
    setStatus("loading", "记忆中心检查中…");
    refreshMemoryStatus();
    refreshRail(); // 启动时 localStorage 里的宿主优先于探测值，栏按最终宿主再取一次
  } catch (e) {
    if (isAgreementError(e)) {
      S.locked = true;
      showAgreement();
      setStatus("warn", "待签署协议");
      renderPage();
      return;
    }
    S.booted = false;
    S.bootError = e;
    S.locked = false;
    renderPage();
    setStatus("bad", "控制台离线", e.message);
  }
}

async function refreshMemoryStatus() {
  if (!S.memory.statsLoading) {
    S.memory.statsLoading = true;
    try {
      const data = await request("/api/memory/stats");
      if (data && data.ok === false) throw payloadError(data, "记忆服务不可用");
      S.memory.stats = normalizeStats(data);
      S.memory.statsError = null;
      S.memory.statsLoaded = true;
      S.memory.source = (data && data.source) || detectSource(S.settings.memoryBase);
      setStatus("ok", "记忆中心已连接");
    } catch (e) {
      if (isAgreementError(e)) return;
      S.memory.statsError = e;
      S.memory.statsLoaded = true;
      setStatus("bad", "记忆中心未连接", e.message);
    } finally {
      S.memory.statsLoading = false;
    }
  }
  if (S.tab === "memory") renderPage();
}

function normalizeStats(data) {
  const s = data && data.stats && typeof data.stats === "object" ? data.stats : (data || {});
  return {
    total: s.total ?? s.cards ?? null,
    today: s.today ?? s.todayNew ?? null,
    week: s.week ?? null,
    byKind: s.byKind && typeof s.byKind === "object" ? s.byKind : {},
    raw: s,
  };
}

function defaultTab() {
  // 私有部署：固定入口是 #/memory（服务端 deploy.entryHash 下发）
  const d = S.deploy;
  if (d && d.entryHash) {
    const h = String(d.entryHash).replace(/^#\/?/, "");
    if (TABS.includes(h)) return h;
  }
  return "breach";
}

function tabFromHash() {
  const raw = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return TABS.includes(raw) ? raw : defaultTab();
}

function setNav() {
  const nav = $("#nav");
  if (!nav) return;
  const items = NAV_BY_MODE[modeIsTechnical() ? "technical" : "simple"];
  const sig = S.uiMode + "|" + items.map((i) => i.tab).join(",") + "|" + S.tab;
  if (nav.dataset.sig === sig) return;
  nav.innerHTML = items.map((it) => `<a href="#/${it.tab}" data-tab="${it.tab}"${it.tab === S.tab ? ' aria-current="page"' : ""}>${esc(it.label)}</a>`).join("");
  nav.dataset.sig = sig;
  nav.dataset.mode = S.uiMode;
}

function onRoute() {
  const tab = tabFromHash();
  const changed = tab !== S.tab;
  S.tab = tab;
  if (applyModeRoute()) {
    S.tab = "breach";
    renderPage();
    return;
  }
  if (changed) {
    S.assign.ok = null;
    S.assign.saveError = null;
  }
  renderPage();
  if (changed) window.scrollTo({ top: 0, behavior: "instant" });
}

function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.getAttribute) return null;
  const key = el.getAttribute("data-focus");
  if (!key) return null;
  return { key, start: el.selectionStart, end: el.selectionEnd };
}

function restoreFocus(saved) {
  if (!saved) return;
  let el = null;
  try { el = document.querySelector(`[data-focus="${saved.key.replace(/"/g, '\\"')}"]`); } catch { el = null; }
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (saved.start != null) el.setSelectionRange(saved.start, saved.end); } catch { /* not a text input */ }
}

function renderGlobalAlert() {
  const box = $("#globalAlert");
  if (!box) return;
  if (S.bootError) {
    if (!modeIsTechnical()) {
      box.innerHTML = `<div class="alert bad" role="alert">
        <strong>连不上控制台服务，页面暂时读不到状态。</strong>
        <span class="hint">确认控制台还开着；好了以后点『重试连接』。</span>
        <div class="actions"><button type="button" class="small" data-retry-boot>重试连接</button></div>
      </div>`;
      return;
    }
    box.innerHTML = `<div class="alert bad" role="alert">
      <strong>无法读取控制台状态：${esc(S.bootError.message)}</strong>
      <span class="hint">${esc(S.bootError.hint || "确认服务端已启动（默认 http://127.0.0.1:8792），再重试。")}</span>
      <div class="actions"><button type="button" class="small" data-retry-boot>重试连接</button></div>
    </div>`;
  } else {
    box.innerHTML = "";
  }
}

/** 运行时 JS 错误（window.__apErrors）只在技术模式露出，且必须是红的 */
function renderRuntimeErrors() {
  const box = $("#runtimeErrors");
  if (!box) return;
  const list = Array.isArray(window.__apErrors) ? window.__apErrors : [];
  if (!list.length || !modeIsTechnical()) { box.hidden = true; box.innerHTML = ""; return; }
  const lines = list.map((x) => "[" + x.kind + "] " + x.message + (x.source ? " @ " + x.source + ":" + x.line : ""));
  box.hidden = false;
  box.innerHTML = '<div class="alert bad" role="alert"><strong>页面运行时错误 ' + fmtNum(list.length) + ' 条</strong>'
    + '<span class="hint">这些错误不一定会拦住操作，但会让部分按钮失灵；普通模式不显示。</span>'
    + '<details><summary>查看详情</summary><pre>' + esc(lines.join(String.fromCharCode(10))) + '</pre></details></div>';
}
function renderPage() {
  normalizeDelivery();
  // 记忆库整页铺满的标记：切到别的页面要撤掉，否则 <main> 的限宽会一直失效
  document.body.classList.remove("mem-mode");
  setNav();
  updateModeSwitch();
  renderGlobalAlert();
  renderRuntimeErrors();
  resetCopyStore();
  const saved = captureFocus();
  const page = $("#page");
  if (!page) return;
  if (S.locked) {
    if (!modeIsTechnical()) {
      page.innerHTML = `<div class="page-head"><div><p class="eyebrow">协议</p><h1>签完协议就能用</h1><p class="lead">页面没有关。签署《安全与法律协议》后，四个页面与所有功能一起解锁。</p></div></div>
        ${emptyState("还没签署协议", "签署记录只保存在本机；点上面的『签署并进入』即可继续。")}`;
      return;
    }
    page.innerHTML = `<div class="page-head"><div><p class="eyebrow">LOCKED</p><h1>协议签署后加载控制台</h1><p class="lead">页面当前不可交互。签署《安全与法律协议》后，六页与接口会一起解锁。</p></div></div>
      ${emptyState("尚未签署协议", "签署记录只保存在本机 state.json；未签署时服务端会以 403 拒绝控制台接口。")}`;
    return;
  }
  if (modeIsTechnical()) {
    if (S.tab === "inject") renderInject();
    else if (S.tab === "breach") renderBreach();
    else if (S.tab === "equip") renderEquip();
    else if (S.tab === "assign") renderAssign();
    else if (S.tab === "memory") renderMemory();
    else if (S.tab === "mcp") renderMcpPage();
    else if (S.tab === "intel") renderWipPage("intel");
    else if (S.tab === "drill") renderWipPage("drill");
    else if (S.tab === "settings") renderSettings();
    else renderAbout();
  } else {
    if (S.tab === "breach") renderSimpleBreach();
    else if (S.tab === "equip") renderSimpleEquip();
    else if (S.tab === "memory") renderSimpleMemory();
    else if (S.tab === "intel") renderWipPage("intel");
    else if (S.tab === "drill") renderWipPage("drill");
    else renderSimpleSettings();
  }
  // 记忆库是整页 iframe，再插一条技术模式提示会把面板往下顶 63px、还溢出
  if (modeIsTechnical() && S.tab !== "memory") renderTechHint();
  // 破甲页末尾补「能力补齐」：模块缺失时后端降级成一行不可用，前端照常渲染
  if (S.tab === "breach") appendOpsPanel(page);
  bindGroups();
  $$('#page pre[tabindex="0"]').forEach((pre, index) => {
    if (!pre.getAttribute("aria-label")) pre.setAttribute("aria-label", "可滚动文本内容 " + (index + 1));
    if (!pre.getAttribute("role")) pre.setAttribute("role", "region");
  });
  restoreFocus(saved);
  // 右侧常驻栏：每次换页都重绘一次（数据走缓存，不额外发请求）
  renderInjectRail();
}

/* ------------------------------------------------------ readiness (new endpoint) */
async function loadReadiness(force = false) {
  if (S.readiness.loading) return;
  if (S.readiness.tried && !force) return;
  S.readiness.loading = true;
  try {
    const data = await request("/api/readiness");
    if (!data || data.ok === false || !data.level) throw new Error("readiness unavailable");
    S.readiness.data = data;
    S.readiness.error = null;
  } catch (e) {
    /* 旧后端没有这个接口：状态卡整块隐藏，不报错、不挡主流程 */
    S.readiness.data = null;
    S.readiness.error = e || new Error("readiness unavailable");
    if (isAgreementError(e)) { S.readiness.tried = true; return; }
  } finally {
    S.readiness.loading = false;
    S.readiness.tried = true;
    if (!modeIsTechnical() && S.tab === "breach") renderPage();
  }
}

/* ============================================================ simple mode · 破甲 */
function simpleModelTagline(m) {
  if (!m) return "";
  const custom = m.tagline || m.notes || "";
  if (custom) return simpleText(custom);
  return SIMPLE_TAGLINE[m.id] || "可以直接用";
}

function renderSimpleStatusCard() {
  const rd = S.readiness.data;
  if (!rd || !rd.level) return `<section class="s-status" hidden aria-hidden="true"></section>`;
  const level = rd.level === "green" ? "green" : (rd.level === "red" ? "red" : "yellow");
  const fallbackHeadline = level === "green" ? "可以直接用" : (level === "red" ? "暂时用不了" : "还差一步");
  const headline = simpleText(rd.headline || "") || fallbackHeadline;
  const detail = simpleText(rd.detail || "") || (level === "green" ? "选个模型，写一句话就能生成。" : "");
  const action = rd.action && rd.action.label
    ? `<button type="button" class="ghost" data-readiness-action="${esc(rd.action.target || "#/settings")}">${esc(simpleText(rd.action.label))}</button>`
    : "";
  return `<section class="s-status ${level}" aria-label="现在能不能用">
    <div class="s-status-body"><strong>${esc(headline)}</strong>${detail ? `<span class="s-status-detail">${esc(detail)}</span>` : ""}</div>
    ${action}
  </section>`;
}

function simpleSteps() {
  const b = S.breach;
  const h = S.host.data;
  const hostReady = !!(h && h.counts && (h.counts.applied || 0) > 0 && (h.counts.pending || 0) === 0);
  const hasModel = !!(b.model || S.models.length);
  const hasTask = !!String(b.task || "").trim();
  const done = !!(b.built && b.variants.length);
  // 与技术模式同一条流程：① 选模板 → ② 让破甲生效 → ③ 选模型写任务 → ④ 拿载荷
  const rows = [
    { n: 1, t: "选破甲模板", done: true },
    { n: 2, t: "让破甲生效", done: hostReady },
    { n: 3, t: "选模型，写清任务", done: hasTask && hasModel },
    { n: 4, t: "拿到可复制的载荷", done: done },
  ];
  let current = (rows.find((r) => !r.done) || rows[rows.length - 1]).n;
  if (b.building) current = 4;
  return `<ol class="steps" aria-label="四步拿到载荷">${rows.map((r) => {
    const isCurrent = r.n === current;
    let state = "";
    if (r.n === 4 && b.building) state = "doing";
    else if (r.done) state = "done";
    return `<li aria-current="${isCurrent ? "step" : "false"}"${state ? ` data-state="${state}"` : ""}><span class="step-n" aria-hidden="true">${r.n}</span><span class="step-t">${esc(r.t)}</span></li>`;
  }).join("")}</ol>`;
}

/* 吃豆人式进度：注入/卸载时召唤一只小怪，沿轨道一路吃豆，位置=进度；吃完放大消失。
   2D canvas 实现（零依赖、离线可用、60fps 开销可忽略），不用 three.js。 */
const armorEater = {
  cv: null, ctx: null, raf: 0, t0: 0, pct: 0, done: false, mode: "inject", fin: 0,
  start(mode) {
    try {
      this.stop();
      this.mode = mode === "uninstall" ? "uninstall" : "inject";
      this.pct = 0; this.done = false; this.fin = 0;
      const cv = document.createElement("canvas");
      cv.className = "armor-eater";
      cv.width = window.innerWidth;
      cv.height = window.innerHeight;
      document.body.appendChild(cv);
      this.cv = cv;
      this.ctx = cv.getContext("2d");
      this.t0 = performance.now();
      const loop = (t) => { this.draw(t); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    } catch { /* 特效失败不影响主流程 */ }
  },
  set(pct, done) {
    this.pct = Math.max(this.pct, Math.min(100, Number(pct) || 0));
    if (done) this.done = true;
  },
  draw(t) {
    const ctx = this.ctx, cv = this.cv;
    if (!ctx || !cv) return;
    const W = cv.width, H = cv.height;
    const p = Math.max(0, Math.min(100, this.pct));
    const dark = this.mode === "uninstall";
    ctx.clearRect(0, 0, W, H);
    // 半透明压暗，让怪物跳出来
    ctx.fillStyle = "rgba(6,8,12,.55)";
    ctx.fillRect(0, 0, W, H);
    // 轨道
    // 满屏波浪路径：怪物沿曲线跑（不是固定在底部直线），豆子撒在路径上
    const pathAt = (tt) => ({
      x: W * (0.06 + 0.88 * tt),
      y: H * (0.5 + Math.sin(tt * Math.PI * 3.2) * 0.22),
    });
    ctx.beginPath();
    for (let i = 0; i <= 80; i += 1) {
      const pt = pathAt(i / 80);
      if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
    }
    ctx.strokeStyle = dark ? "rgba(255,120,90,.18)" : "rgba(255,150,40,.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // 豆子 18 颗，按进度被吃
    const beans = 18;
    const eaten = Math.round((p / 100) * beans);
    for (let i = 0; i < beans; i += 1) {
      if (i < eaten) continue;
      const pt = pathAt(i / (beans - 1));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "rgba(255,140,110,.85)" : "rgba(255,190,90,.9)";
      ctx.fill();
    }
    // 怪物位置：注入沿路径正向，卸载反向
    const prog = this.done ? 1 : p / 100;
    const at = dark ? pathAt(1 - prog) : pathAt(prog);
    const ahead = dark ? pathAt(Math.max(0, 1 - prog - 0.01)) : pathAt(Math.min(1, prog + 0.01));
    const dir = (ahead.x - at.x) >= 0 ? 1 : -1;
    const tsec = (t - this.t0) / 1000;
    const mouth = 0.18 + Math.abs(Math.sin(tsec * 9)) * 0.32;
    const scale = this.done ? 1 + Math.min(1, this.fin / 700) * 0.6 : 1;
    const R = 22 * scale;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, mouth * Math.PI, (2 - mouth) * Math.PI);
    ctx.closePath();
    ctx.fillStyle = dark ? "#ff6a3d" : "#ffa01e";
    ctx.fill();
    // 眼睛
    ctx.beginPath();
    ctx.arc(R * 0.22, -R * 0.45, R * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = "#101418";
    ctx.fill();
    ctx.restore();
    // 百分比 + 阶段（固定在底部，不跟路径重叠）
    ctx.font = "600 28px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = dark ? "rgba(255,150,120,.95)" : "rgba(255,180,80,.95)";
    ctx.fillText(Math.round(p) + "%", W / 2, H - 96);
    const note = (S.host && S.host.progress && S.host.progress.note)
      || (dark ? "正在卸载…" : "正在写入补丁…");
    ctx.font = "500 13px system-ui, 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(232,238,246,.62)";
    ctx.fillText(String(note).slice(0, 60), W / 2, H - 64);
    // 完成：放大淡出
    if (this.done) {
      this.fin += 16;
      if (this.fin > 900) this.stop();
    }
  },
  stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.cv) { try { this.cv.remove(); } catch { /* ignore */ } this.cv = null; this.ctx = null; }
  },
};

/* 破甲台「一键注入」的炸裂特效：全屏 canvas，冲击波 + 220 粒子 + 闪光，1.7s 自毁（零依赖，不用 three.js） */
function armorBlast(anchor) {
  try {
    if (typeof document === "undefined" || !document.body) return;
    const rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const cx = rect && rect.width ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect && rect.height ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const cv = document.createElement("canvas");
    cv.className = "armor-blast";
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    if (!ctx) { cv.remove(); return; }
    const parts = [];
    for (let i = 0; i < 220; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 9;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, g: 120 + Math.random() * 70 });
    }
    const t0 = performance.now();
    const DUR = 1700;
    const frame = (t) => {
      const p = Math.min(1, (t - t0) / DUR);
      ctx.clearRect(0, 0, cv.width, cv.height);
      // 冲击波环（两道，错开扩散）
      for (const [k, w] of [[1, 7], [0.62, 3]]) {
        const r = p * Math.max(cv.width, cv.height) * 0.75 * k;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,138,30,${Math.max(0, 0.85 - p)})`;
        ctx.lineWidth = w * (1 - p) + 1;
        ctx.stroke();
      }
      // 粒子
      for (const q of parts) {
        q.x += q.vx; q.y += q.vy; q.vx *= 0.985; q.vy *= 0.985; q.life -= 0.013;
        if (q.life <= 0) continue;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.2 * q.life + 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,${Math.round(q.g)},60,${Math.max(0, q.life)})`;
        ctx.fill();
      }
      // 中心闪光
      if (p < 0.2) {
        ctx.fillStyle = `rgba(255,170,80,${0.35 * (1 - p / 0.2)})`;
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      if (p < 1) requestAnimationFrame(frame);
      else cv.remove();
    };
    requestAnimationFrame(frame);
  } catch { /* 特效失败不影响注入 */ }
}

/* 落地/卸载进度：runner 每步写 data/logs/handoff-progress.json，这里轮询成进度条 */
function stopProgressPolling() {
  if (S.host.progressTimer) { clearTimeout(S.host.progressTimer); S.host.progressTimer = null; }
}
/** 没有真正的进度在跑时，收掉吃豆人和 0% 占位（提前返回/无待注入项时用） */
function stopEaterIfIdle() {
  try {
    if (!S.host || !S.host.progressTimer) {
      armorEater.stop();
      if (S.host) S.host.progress = null;
    }
  } catch { /* ignore */ }
}

function startProgressPolling(mode) {
  stopProgressPolling();
  // 点击时就已经 start 过：这里复用，别把怪物重置回 0%
  if (!armorEater.cv) armorEater.start(mode);
  else armorEater.mode = mode === "uninstall" ? "uninstall" : "inject";
  const started = Date.now();
  S.host.progress = { percent: 0, step: "queued", note: "已下发，等待落地进程接手…", done: false };
  const tick = async () => {
    let p = null;
    try { const d = await request("/api/host/progress"); p = d && d.progress; } catch { /* 控制台可能正被重启 */ }
    if (p) { S.host.progress = p; armorEater.set(p.percent, p.done); }
    if (S.tab === "breach") renderPage();
    const expired = Date.now() - started > 120000;
    if (!(p && p.done) && !expired) S.host.progressTimer = setTimeout(tick, 500);
    else {
      S.host.progressTimer = null;
      if (expired) armorEater.stop();
    }
  };
  tick();
}

async function simpleHostAction(kind) {
  const h = S.host;
  if (h.busy) return;
  // 一键 = 点一次就执行。不再有「再点一次确认」这一段：
  // 落地已改成独立 runner（先回响应、约 3 秒后再杀宿主），所以不需要靠二次点击来防误触。
  h.pendingAction = null;
  // 点击瞬间就召唤小怪（此时请求还没回来，别让用户干等）
  if (kind !== "handoff") {
    armorEater.start(kind === "uninstall" ? "uninstall" : "inject");
    S.host.progress = { percent: 0, step: "writing", note: kind === "uninstall" ? "正在卸载…" : "正在写入补丁…", done: false };
  }
  if (kind === "apply") armorBlast(document.querySelector('[data-simple-host="apply"]'));
  h.busy = true;
  h.busyKind = kind;
  h.message = "";
  h.error = null;
  renderPage();
  try {
    let data;
    if (kind === "apply") {
      // 兜底：注入前把 DSH 预设对齐到当前勾选的装备（勾了没同步也不会错位）
      await syncEquipPresets(true);
      const plugins = h.withPlugin ? ["autokill-purge-plugin"] : [];
      // 唯一一份补丁清单：勾了就只注入勾的；一个都不勾 = 只补还没写入的（与技术模式同一语义）
      let picked = $$("#page [data-patch-pick]").filter((el) => el.checked).map((el) => el.dataset.patchPick);
      if (!picked.length) {
        const st = await request("/api/host/status").catch(() => null);
        picked = ((st && st.patches) || []).filter((p) => p.status === "pending").map((p) => p.id);
      }
      data = await request("/api/host/apply", { method: "POST", body: { confirm: true, mode: "apply", plugins, patches: picked } });
      if (!data || data.ok === false) throw payloadError(data, "注入失败");
      const added = (data.result && data.result.applied) || 0;
      const already = (data.result && data.result.already) || 0;
      const pluginNote = (data.pluginResult && data.pluginResult.summary)
        ? "插件：" + data.pluginResult.summary + "。"
        : "";
      const needHandoff = !!(data.result && data.result.pendingHandoff) && !data.scheduled;
      const when = Math.round((data.restartInMs || 2500) / 1000);
      h.message = pluginNote + (added
        ? `注入完成：新增 ${fmtNum(added)} 处，${fmtNum(already)} 处本来就是最新。`
        : `注入完成：宿主本来就是最新（${fmtNum(already)} 处无需再改，0 处新增）。`)
        + (data.scheduled
          ? `已下发：约 ${when} 秒后结束并重启宿主，补丁随即生效。页面会断开一下，宿主重启后自动回来。`
          : needHandoff
            ? "落地没下发成功（" + ((data.handoff && (data.handoff.note || data.handoff.error)) || "原因未知") + "）：补丁已写入，但桌面壳仍读 app.asar。"
            : "补丁已在当前加载的宿主里，重启 dsh 即生效。");
    } else if (kind === "handoff") {
      // 落地：独立 runner 先回响应，再结束宿主 → asar 让位 → 重新拉起
      data = await request("/api/host/handoff", { method: "POST", body: { confirm: true } });
      const hd = (data && data.handoff) || {};
      if (!data || data.ok === false || (hd.ok === false)) throw payloadError(data, hd.note || hd.error || "落地失败");
      h.message = data.note || "已下发：约 3 秒后结束并重启宿主，补丁随即生效。";
    } else {
      data = await request("/api/host/uninstall", { method: "POST", body: { confirm: true } });
      if (!data || data.ok === false) throw payloadError(data, "卸载失败");
      const u = data.uninstall || {};
      const freed = u.freedMB ? `已清 ${u.freedMB} MB 残留，` : "";
      const bad = (u.errors || []).length;
      h.message = `卸载完成：${freed}${u.applied ? "宿主已按 asar 原件还原，" : ""}${(u.stripped || []).length} 个步骤已走${bad ? "，有 " + bad + " 条警告" : ""}。${u.restarted ? "已下发：约 3 秒后重新拉起宿主。" : "宿主若在运行，重启后确认。"}`;
    }
    if ((kind === "apply" && data && data.scheduled)
      || (kind === "handoff" && data && data.scheduled)
      || (kind === "uninstall" && data && data.uninstall && data.uninstall.scheduled)) {
      startProgressPolling(kind === "uninstall" ? "uninstall" : "inject");
    }
    toast(kind === "apply" ? "注入完成" : kind === "handoff" ? "已落地并重启宿主" : "卸载完成");
    h.lastResult = { kind: kind, ok: true, at: Date.now() };
    setTimeout(() => {
      if (S.host.lastResult && S.host.lastResult.kind === kind) {
        S.host.lastResult = null;
        if (S.tab === "breach") renderPage();
      }
    }, 5200);
    S.host.tried = false;
    // 落地会把桌面宿主结束再拉起：这时候读状态必然失败，别当成错误抛给用户
    if (kind !== "handoff") {
      try { await loadHostStatus(true); } catch { /* 宿主正在重启，稍后再读 */ }
    }
  } catch (e) {
    h.error = e;
    h.message = simpleReason(e);
    h.lastResult = { kind: kind, ok: false, at: Date.now() };
    setTimeout(() => {
      if (S.host.lastResult && S.host.lastResult.kind === kind) {
        S.host.lastResult = null;
        if (S.tab === "breach") renderPage();
      }
    }, 5200);
    toastError("失败：" + simpleReason(e));
  } finally {
    h.busy = false;
    h.busyKind = null;
    stopEaterIfIdle();
    renderPage();
  }
}

/* 普通模式的推荐位：跟实时识别同步
   优先级：当前默认模型 > dsh-purge 口径（default/supported）> 与默认模型同 provider 的实时模型 > 其它实时模型。
   语音/图像/音乐类模型不进普通模式（它们不是拿来跑破甲的）。 */
const NON_CHAT_MODEL = /(asr|tts|voiceclone|voicedesign|^image-|^music-|^speech-|embed|harness)/i;
/* provider 归一：deepseek-account / deepseek-official / deepseek 视为同一族 */
const normProvider = (p) => String(p || "").toLowerCase().replace(/-(account|official|cn|plan)$/, "");

function recommendedModels() {
  const list = (Array.isArray(S.models) ? S.models : []).filter((m) => m && m.id && !NON_CHAT_MODEL.test(m.id));
  const live = S.modelsLive || null;
  const defId = live && live.default ? live.default.model : null;
  const defProvider = normProvider(live && live.default ? live.default.provider : null);
  const rank = (m) => {
    if ((defId && m.id === defId) || m.dshDefault) return 0;
    if (m.dshPurge === "default") return 1;
    if (m.dshPurge === "supported" && m.live) return 2;
    if (m.dshPurge === "supported") return 3;
    if (m.live && defProvider && normProvider(m.liveProvider) === defProvider) return 4;
    if (m.live) return 5;
    return 9;
  };
  return list
    .map((m, i) => ({ m, r: rank(m), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.m);
}

function optionHtml(list, value) {
  const items = Array.isArray(list) ? list : [];
  return items.map((o) => `<option value="${esc(o.id)}"${o.id === value ? " selected" : ""}>${esc(o.name || o.id)}</option>`).join("");
}

/* 第 1 步：选破甲模板（与技术模式同一流程的第一步） */
function renderSimpleTemplateStep() {
  const b = S.breach;
  if (!S.prompts.length) return "";
  return `<section class="section" aria-labelledby="s-tpl-h">
    <h2 id="s-tpl-h"><span class="num">1</span>选破甲模板<span class="count">${S.prompts.length} 套</span></h2>
    <div class="card">
      <label class="field"><span>用哪一套</span>
        <select id="sTemplate" data-focus="sTemplate">${optionHtml(S.prompts, b.template)}</select>
        <span class="help">默认就是 dsh-purge 1.1.71 那套；换模板只影响生成的载荷，不影响宿主。</span>
      </label>
    </div>
  </section>`;
}

/* 任务框下面的选择项：任务类型 / 输出要求 */
function renderSimpleChoices() {
  const b = S.breach;
  const pre = S.taskPresets.length ? optionHtml(S.taskPresets, b.taskPreset) : "";
  const out = S.outputChoices.length ? optionHtml(S.outputChoices, b.outputChoice) : "";
  if (!pre && !out) return "";
  return `<div class="s-choices">
    ${pre ? `<label class="field"><span>任务类型</span><select id="sPreset" data-focus="sPreset">${pre}</select></label>` : ""}
    ${out ? `<label class="field"><span>输出要求</span><select id="sOutput" data-focus="sOutput">${out}</select></label>` : ""}
  </div>`;
}

/* 任务类型 / 输出要求的选择：'all' = 把每一项都写上（前端拼，服务端只给清单） */
function presetTextFor(id) {
  const list = Array.isArray(S.taskPresets) ? S.taskPresets : [];
  if (id === "all") {
    return list
      .filter((p) => p && p.id !== "all" && p.id !== "custom" && p.text)
      .map((p, i) => `${i + 1}) ${p.text}`)
      .join("\n");
  }
  const hit = list.find((x) => x && x.id === id);
  return (hit && hit.text) || "";
}

function outputTextFor(id) {
  const list = Array.isArray(S.outputChoices) ? S.outputChoices : [];
  if (id === "all") {
    return list
      .filter((o) => o && o.id !== "all" && o.text)
      .map((o) => o.text)
      .join("；");
  }
  const hit = list.find((x) => x && x.id === id);
  return (hit && hit.text) || "请直接给出结果";
}

/** 操作台顶部：破甲模板（多模型时统一选一套） */
function renderTemplatePicker() {
  const b = S.breach;
  if (!S.prompts.length) return "";
  const chosen = breachModels();
  const nameOf = (id) => (S.models.find((m) => m.id === id) || {}).name || id;
  const scope = chosen.length
    ? `统一应用到选中 ${chosen.length} 个模型（${chosen.slice(0, 3).map(nameOf).join("、")}${chosen.length > 3 ? "…" : ""}）`
    : "还没选模型";
  const opts = S.prompts.map((p) => `<option value="${esc(p.id)}"${b.template === p.id ? " selected" : ""}>${esc(simpleText(p.name))}${p.id === "sauce-1171" ? " · 国模优先" : " · 通用"}</option>`).join("");
  return `<label class="field" style="margin-bottom:10px"><span>破甲模板</span>
    <select id="sTemplate" data-focus="sTemplate">${opts}</select>
    <span class="help">${esc(scope)}；换模板只影响载荷，不动宿主。</span>
  </label>`;
}

/* ---------------------------------------------------- 梦神破甲（AutoKill 配置层） */
async function loadAkPatches(force) {
  const a = S.ak;
  if (a.loading) return;
  if (a.loaded && !force) return;
  a.loading = true;
  try {
    const [d, m, sl, mb] = await Promise.all([
      request("/api/autokill/patches"),
      request("/api/autokill/mcp").catch(() => null),
      request("/api/autokill/slots").catch(() => null),
      request("/api/mengbot/bots").catch(() => null),
    ]);
    if (d && d.ok !== false) {
      a.items = d.items || [];
      a.applied = d.applied || 0;
      a.total = d.total || 0;
      a.running = !!d.running;
      a.version = d.version || "";
      a.loaded = true;
      a.error = null;
      // 默认勾选「尚未生效」的项
      if (!a.selected) a.selected = new Set(a.items.filter((x) => !x.applied).map((x) => x.id));
    }
    if (m && m.ok !== false) a.mcp = m;
    if (sl && sl.ok !== false) a.slots = sl;
    if (mb && mb.ok !== false) a.mengbotBots = (mb.bots || []).filter((b) => b && b.id);
  } catch (e) {
    a.error = e;
  } finally {
    a.loading = false;
    if (S.tab === "breach") renderPage();
  }
}

function akSelected() {
  const a = S.ak;
  if (!a.selected) a.selected = new Set();
  return a.selected;
}

function renderAkPatchList() {
  const a = S.ak;
  if (!a.loaded && !a.loading) loadAkPatches();
  if (a.loading && !a.items.length) return spinner("读取 AutoKill 配置…");
  if (a.error) return alertBox("读不到 AutoKill 配置", simpleReason(a.error));
  if (!a.items.length) return `<p class="hint">AutoKill 没装或读不到配置项。</p>`;
  const sel = akSelected();
  const rows = a.items.map((x) => `<label class="m-pick" data-status="${x.applied ? "applied" : "pending"}">
    <input type="checkbox" data-ak-pick="${esc(x.id)}"${sel.has(x.id) ? " checked" : ""}>
    <span class="mp-main">
      <span class="t">${esc(x.label)} ${badge(x.applied ? "✓ 已生效" : "未生效", x.applied ? "good" : "warn")}</span>
      <span class="s">${esc(x.key || "ai · " + x.name)} · 当前 ${esc(String(x.current))} → 目标 ${esc(String(x.target))}${x.risk ? " — " + esc(x.risk) : ""}</span>
    </span>
  </label>`).join("");
  const warn = a.running
    ? `<div class="alert warn" role="alert"><strong>AutoKill 正在运行</strong><span class="hint">它持有内存里的旧配置，改文件后可能被覆盖。建议先退出 AutoKill 再应用，改完再启动。</span></div>`
    : "";
  const mcp = a.mcp || {};
  // MCP 插件与 UI 插槽都由「应用梦神破甲」一键控制，这里只显示状态
  const mcpBar = `<div class="s-hostsupport" style="margin:8px 0">
    <span class="mini">MCP 插件</span>
    <b>autokill-purge</b>
    ${badge(mcp.mounted ? "已挂载" : "未挂载", mcp.mounted ? "good" : "")}
    <span class="mini">随「应用梦神破甲」一并挂载 / 卸载</span>
  </div>`;
  const sl = a.slots || {};
  const slotBar = `<div class="s-hostsupport" style="margin:8px 0">
    <span class="mini">UI 插槽</span>
    <b>装备模式下拉</b>
    ${badge(sl.injected ? "已注入" : "未注入", sl.injected ? "good" : "")}
    <span class="mini">随「应用梦神破甲」一并注入 / 移除（构建助手旁，写 build.gear）</span>
  </div>`;
  // MengBot：挑一个 bot，应用时把勾选的装备写进它的 BotRecord.gear
  const mbBots = ((S.mb && Array.isArray(S.mb.bots) && S.mb.bots.length) ? S.mb.bots : (a.mengbotBots || []));
  if (!mbBots.length && S.mb && !S.mb.tried && !S.mb.loading && typeof loadMengbot === "function") loadMengbot(false);
  const mbSel = a.mengbotId || "";
  const mbCurrent = mbBots.find((x) => x.id === mbSel);
  const mengbotBar = mbBots.length
    ? `<div class="s-hostsupport" style="margin:8px 0">
    <span class="mini">MengBot</span>
    <select id="akMengbot" class="small" style="max-width:220px">
      <option value="">不写 MengBot</option>
      ${mbBots.map((b) => `<option value="${esc(b.id)}"${b.id === mbSel ? " selected" : ""}>${esc(b.name || b.id.slice(0, 8))}${b.gear ? "（现 " + esc(b.gear) + "）" : ""}</option>`).join("")}
    </select>
    <span class="mini">${mbCurrent ? (mbCurrent.gear ? "当前 " + esc(mbCurrent.gear) : "当前未装备") + "；应用后写入第一套勾选的装备，重启 MengBot 生效" : "选一个 bot，应用时把勾选的装备写进它的 gear"}</span>
  </div>`
    : `<div class="s-hostsupport" style="margin:8px 0"><span class="mini">MengBot</span><span class="mini">没读到 bot（~/.mengbot/bots.json）</span><button type="button" class="small" data-bot-reload="1">重新读取</button></div>`;
  return `<details class="ops-sub"${S.simple.akOpen ? " open" : ""}><summary>梦神破甲 · ${a.applied}/${a.total} 已生效（可自选）</summary>
    ${mcpBar}
    ${slotBar}
    ${mengbotBar}
    ${warn}
    <div class="actions" style="margin:8px 0">
      <button type="button" class="small" data-ak-all="1">全选</button>
      <button type="button" class="small" data-ak-all="0">取消全选</button>
      <button type="button" class="small" data-ak-revert="1">卸载（恢复原值）</button>
      <span class="hint">走 autokill-cli settings_set / ai on|off；改前自动备份 config.toml。</span>
    </div>
    ${`<div class="s-multi-list static">${rows}</div>`}
  </details>`;
}

/** 提示词层卸载：只摘 autokill-purge 的标记块，宿主原文不动 */
async function uninjectPrompt() {
  try {
    const d = await request("/api/breach/uninject-host", { method: "POST", body: { host: S.hostTarget } });
    if (!d || d.ok === false) throw payloadError(d, "撤销失败");
    toast(d.removed ? `已摘掉注入块（文件 ${d.bytes} B，重启宿主生效）` : "没找到注入块，目标文件没被改过");
  } catch (e) { toastError(simpleReason(e)); }
}

/** 补丁层卸载：走完整卸载（还原宿主 + 清解包残留 + 移除插件 + 独立 runner 重启）。
 *  以前这里只调 /api/host/restore{factory}：只还文件、不删插件、没有进度、也没有重启 ——
 *  用户看到的就是「点了没反应，重启 DSH 插件还在」。 */
async function revertHostPatches() {
  if (typeof window !== "undefined" && !window.confirm("一键卸载：按官方 app.asar 原件还原宿主文件，清掉解包残留，并把 autokill-purge 插件从 profile 移除，然后重启宿主。当前状态会先另存一份快照。继续？")) return;
  const btn = document.getElementById("sUninstall");
  const oldLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "卸载中…"; }
  armorEater.start("uninstall");
  S.host.progress = { percent: 0, step: "writing", note: "正在卸载…", done: false };
  try {
    const d = await request("/api/host/uninstall", { method: "POST", body: { confirm: true } });
    if (!d || d.ok === false) throw payloadError(d, "卸载失败");
    startProgressPolling("uninstall");
    const u = d.uninstall || {};
    toast(`已下发：约 3 秒后结束宿主并完成卸载（${(u.steps || []).length} 个步骤，进度见下方进度条）`);
    loadHostStatus();
  } catch (e) { toastError(simpleReason(e)); }
  finally { if (btn) { btn.disabled = false; btn.textContent = oldLabel; } renderPage(); }
}

/** 当前破甲方式的「一键卸载」动作；不改宿主的方式（载荷/入库）返回 null */
function uninstallAction(mode) {
  const m = DELIVERY_MODES.find((x) => x.id === mode) || {};
  // 补丁层与「一键注入」成对：就叫「一键卸载」，不挂后缀；其它方式保留后缀区分
  const label = mode === "host-patch" ? "一键卸载" : ("一键卸载" + (m.short || "注入"));
  if (mode === "ak-patch") return { label, run: revertDreamBreak };
  if (mode === "host-patch") return { label, run: revertHostPatches };
  if (mode === "host-prompt") return { label, run: uninjectPrompt };
  return null;
}

/** 一键卸载梦神破甲：按 AUTOKILL_PATCHES.was 把每项恢复原值（服务端逐项写回 + 读回核对） */
async function revertDreamBreak() {
  if (typeof window !== "undefined" && !window.confirm("把梦神破甲改过的项恢复成原值？会先备份 config.toml。")) return;
  if (S.ak.running && typeof window !== "undefined" && !window.confirm("AutoKill 正在运行，它可能用内存里的旧配置再覆盖一次。仍要卸载吗？（建议先退出 AutoKill）")) return;
  try {
    const d = await request("/api/autokill/revert", { method: "POST", body: { confirm: true } });
    if (!d || d.ok === false) throw payloadError(d, "卸载失败");
    const killed = (d.side && d.side.killed) || [];
    const msg = `已卸载梦神破甲：恢复 ${d.restored}/${d.total} 项，MCP 插件与装备下拉一并移除${killed.length ? "，清掉残留进程 " + killed.length + " 个" : ""}${d.running ? "（AutoKill 在运行，建议退出后重跑）" : ""}；重启 AutoKill 生效`;
    toast(msg, d.running ? "warn" : "ok");
    S.breach.deliveryResult = { message: msg };
    S.ak.items = []; S.ak.loaded = false; S.ak.selected = null; S.ak.error = null;
    loadAkPatches(true);
  } catch (e) {
    S.breach.deliveryResult = { error: "卸载失败：" + simpleReason(e) };
    toastError(simpleReason(e));
  }
}

/** 操作台：内容随「破甲方式」变化，默认展开；模板置顶，装备垫底 */
function renderOpsFold() {
  const b = S.breach;
  const mode = b.delivery || "host-patch";
  const meta = deliveryMetaFor(mode);
  let body = "";
  if (mode === "host-patch") {
    // 补丁层不展示载荷卡，但仍然要给出「上一次生成」的反馈，否则点了没感觉
    const note = b.deliveryResult
      ? (b.deliveryResult.error ? alertBox("破甲方式没成功", b.deliveryResult.error) : softFailBox(b.deliveryResult.message))
      : "";
    const vsum = Array.isArray(b.variants) && b.variants.length
      ? `<p class="hint">最近一次已生成 ${b.variants.length} 条载荷；想查看载荷把破甲方式切到「载荷破甲」。</p>`
      : "";
    body = note + vsum;
  } else if (mode === "ak-patch") {
    const note = b.deliveryResult
      ? (b.deliveryResult.error ? alertBox("梦神破甲没成功", b.deliveryResult.error) : softFailBox(b.deliveryResult.message))
      : "";
    body = note + `<p class="hint">梦神破甲 = 改 AutoKill 的 <code>config.toml</code>（审批 / 深度 / 运行时 / 预算 / 构建参数）+ 后端开关；改前自动备份，重启 AutoKill 生效。</p>` + renderAkPatchList();
  } else if (mode === "host-prompt") {
    const unBtn = `<div class="actions" style="margin:0 0 10px"><button type="button" class="small" data-uninject="1">撤掉注入块</button>
      <span class="hint">只删 autokill-purge 的标记块，宿主原有内容不动。</span></div>`;
    body = S.hostTarget === "mengbot"
      ? `<p class="hint">生成后把首张载荷写进<b>选中 bot 的 SOUL.md</b>（前缀），重启 MengBot 生效；会先备份可还原。</p>${renderSimpleResults()}`
      : (S.hostTarget === "autokill"
        ? `${unBtn}<p class="hint">生成后把首张载荷写进 <code>%APPDATA%\\autokill\\prompt-inject.md</code>（带标记块、幂等；重启 AutoKill 生效）。</p>${renderSimpleResults()}`
        : `${unBtn}<p class="hint">生成后把第一张载荷写进宿主 <code>prompt-inject.md</code>（带标记块、幂等；重启 dsh 生效）。</p>${renderSimpleResults()}`);
  } else if (mode === "memory") {
    body = `<p class="hint">生成后写入隔离库 <b>mem-purge</b>（待审，审核通过才进检索）。</p>${renderSimpleResults()}`;
  } else {
    body = renderSimpleResults();
  }
  return `<details class="adv-fold ops"${S.simple.opsOpen ? " open" : ""}><summary>操作台 · ${esc(meta.name)}</summary>
    ${S.simple.opsOpen ? body : ""}
  </details>`;
}

/** 操作台里的补丁勾选（破甲方式=补丁层时按这些应用；不勾 = 只补还没应用的） */
function renderSimplePatchPicker() {
  const d = S.host.data;
  if (!d || d.available === false) {
    return `<p class="hint">宿主补丁不可用：${esc((d && d.reason) || "补丁引擎缺失（web/patch-engine/vendor/core.js）")}</p>`;
  }
  const list = Array.isArray(d.patches) ? d.patches : [];
  const applied = list.filter((p) => p.status === "applied").length;
  const unapplied = list.length - applied;
  // 状态：颜色 + 一句原因/建议（用户不用去猜 na / missing_file 是什么）
  const STATUS = {
    applied: { text: "✓ 已补", tone: "good", advice: "无需处理" },
    pending: { text: "待补", tone: "warn", advice: "可以直接应用" },
    na: { text: "不适用", tone: "", advice: "此宿主/版本没有对应位置，忽略即可" },
    missing_file: { text: "缺文件", tone: "warn", advice: "目标文件缺失（版本差异）；升级 dsh-purge 或忽略" },
    skipped: { text: "跳过", tone: "", advice: "被保护跳过，属于正常" },
  };
  const metaOf = (s) => STATUS[s] || { text: String(s || "未知"), tone: "", advice: "" };
  // 排序：待补(0) > 未补的其他(1) > 已补(2)
  const ordered = list.slice().sort((a, b) => {
    const rank = (x) => (x.status === "pending" ? 0 : (x.status === "applied" ? 2 : 1));
    return rank(a) - rank(b) || Number(a.id) - Number(b.id);
  });
  const shown = S.simple.patchAll ? ordered : ordered.slice(0, 8);
  const rows = shown.map((p) => {
    const zh = p.nameZh || p.name || "";
    const m = metaOf(p.status);
    return `<label class="m-pick" data-status="${esc(p.status)}" title="${esc(p.name || "")}">
      <input type="checkbox" data-patch-pick="${esc(String(p.id))}"${p.status === "applied" ? "" : " checked"}>
      <span class="mp-main">
        <span class="t">#${esc(String(p.id))} ${esc(zh)} ${badge(m.text, m.tone)}</span>
        <span class="s">${esc(p.layer || "")} · ${esc(p.name || "")}${m.advice ? " — " + esc(m.advice) : ""}</span>
      </span>
    </label>`;
  }).join("");
  const more = !S.simple.patchAll && ordered.length > 8
    ? `<button type="button" class="small" data-patch-more="1">显示全部 ${ordered.length} 条</button>`
    : "";
  return `<details class="ops-sub"${S.simple.patchOpen ? " open" : ""}><summary>本轮补丁 · 已补 ${applied}/${list.length}，未补 <b>${unapplied}</b>（未补的默认全选）</summary>
    <div class="actions" style="margin:8px 0">
      <button type="button" class="small" data-patch-all="1">全选</button>
      <button type="button" class="small" data-patch-all="0">取消全选</button>
      ${more}
      <span class="hint">已补的不会重复改文件（报 already）；一个都不勾 = 只补未补的。</span>
    </div>
    ${S.simple.patchOpen ? `<div class="s-multi-list static">${rows}</div>` : ""}
  </details>`;
}

/** 生成按钮文案：跟着破甲方式 + 宿主走 */
function buildButtonLabel(mode) {
  if (mode === "payload") return "一键生成";
  if (mode === "memory") return "生成并入库";
  if (mode === "ak-patch") return "应用梦神破甲";
  if (mode === "host-prompt") {
    if (S.hostTarget === "mengbot") return "生成并注入 bot soul";
    if (S.hostTarget === "autokill") return "生成并注入 AutoKill";
    return "生成并注入宿主";
  }
  // 普通模式与技术模式的按钮口径对齐：补丁层就是「一键注入」，不再叫「应用补丁」
  return "一键注入";
}

/** 破甲方式与宿主对齐：宿主不支持当前方式时回退到载荷（补丁层只属于 DSH，梦神破甲只属于 AutoKill） */
function normalizeDelivery() {
  const d = S.breach.delivery || "host-patch";
  const ok = (d === "host-patch" && S.hostTarget === "dsh")
    || (d === "ak-patch" && S.hostTarget === "autokill")
    || d === "payload" || d === "host-prompt" || d === "memory";
  if (!ok) S.breach.delivery = "payload";
}

/** 当前宿主的版本与「已支持版本」信息（来自 /api/hosts） */
function currentHostMeta() {
  const hit = (S.hostInfo.hosts || []).find((h) => h.id === S.hostTarget);
  return hit || { id: S.hostTarget, name: hostTargetName(S.hostTarget), version: "", support: null };
}
function supportBadge(support) {
  if (!support) return "";
  const map = {
    exact: ["已验证", "good"],
    compatible: ["同小版本", "warn"],
    unknown: ["未验证", "warn"],
    unversioned: ["不绑版本", ""],
  };
  const hit = map[support.status] || ["未验证", "warn"];
  return badge(hit[0], hit[1]);
}
/** 破甲台顶部：宿主 + 已支持版本 + 版本是否对得上 */
function renderHostSupportBar() {
  const m = currentHostMeta();
  const sup = m.support || {};
  const ver = m.version || "";
  const verified = sup.verified || "";
  const line = `<div class="s-hostsupport">
    <span class="mini">宿主</span>
    <b>${esc(hostTargetName(S.hostTarget))}${ver ? " " + esc(ver) : ""}</b>
    <span class="sep">·</span>
    <span class="mini">已支持版本</span>
    <b>${esc(verified || "不绑版本")}</b>
    ${supportBadge(sup)}
    ${sup.label ? `<span class="mini">${esc(sup.label)}</span>` : ""}
  </div>`;
  if (sup.status === "unknown" && ver) {
    return line + `<div class="alert warn" role="alert" style="margin:6px 0 10px"><strong>版本对不上</strong>
      <span class="hint">检测到 ${esc(hostTargetName(S.hostTarget))} ${esc(ver)}，而${esc(sup.label || "这套能力")}是按 ${esc(verified)} 验证的。未验证的项可能无效或缺失，建议先在一台测试机上跑一遍。</span></div>`;
  }
  return line;
}

/** 简单模式的装备选择（破甲台「一并装备」多选） */
function simpleEquipSelection() {
  const b = S.breach;
  const presets = Array.isArray(b.equipPresets) ? b.equipPresets : [];
  const map = b.equipItemsMap || {};
  const items = [];
  for (const id of presets) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) continue;
    const chosen = Array.isArray(map[id]) ? map[id] : p.items.map((i) => i.id);
    for (const it of chosen) items.push(id + ":" + it);
  }
  return { presets, items };
}

/** 「一并装备」下拉的摘要文案（勾选时局部更新，不重绘整页） */
function equipSummaryText() {
  const picked = Array.isArray(S.breach.equipPresets) ? S.breach.equipPresets : [];
  const nameOf = (id) => (PRESETS.find((p) => p.id === id) || {}).name || id;
  return picked.length ? `已选 ${picked.length}：${picked.map(nameOf).join("、")}` : "不装备（只破甲）";
}

/** 勾选装备即同步 DSH 预设：勾几个就在 ~/.dsh/.agent-presets 下装几个（防抖，避免连点刷盘） */
let presetSyncTimer = null;
function syncEquipPresets(immediate) {
  const presets = Array.isArray(S.breach.equipPresets) ? S.breach.equipPresets.filter(Boolean) : [];
  if (!presets.length) return Promise.resolve(null);
  const run = () => request("/api/gear/sync-presets", { method: "POST", body: { presets } }).catch(() => null);
  if (immediate) return run();
  clearTimeout(presetSyncTimer);
  return new Promise((resolve) => { presetSyncTimer = setTimeout(() => resolve(run()), 800); });
}

/** 勾/取消预设、逐项、全选清空的绑定；局部刷新后会重新调用 */
function bindEquipControls() {
  $$("#page [data-eq-preset]").forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("change", () => {
      const id = el.dataset.eqPreset;
      let list = Array.isArray(S.breach.equipPresets) ? S.breach.equipPresets.slice() : [];
      if (el.checked) {
        if (!list.includes(id)) list.push(id);
        if (!Array.isArray(S.breach.equipItemsMap[id])) {
          const p = PRESETS.find((x) => x.id === id);
          S.breach.equipItemsMap[id] = p ? p.items.map((i) => i.id) : [];
        }
      } else {
        list = list.filter((x) => x !== id);
      }
      S.breach.equipPresets = list;
      S.breach.withEquip = list.length > 0;
      // 勾几个就装几个：立即把 DSH 预设对齐到当前选择
      syncEquipPresets();
      // 不重绘整页：下拉保持展开，可以连续勾多个预设
      refreshEquipUI();
    });
  });
  $$("#page [data-eq-item]").forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("change", () => {
      const [pid, iid] = String(el.dataset.eqItem || "").split(":");
      const p = PRESETS.find((x) => x.id === pid);
      if (!p) return;
      const cur = Array.isArray(S.breach.equipItemsMap[pid]) ? S.breach.equipItemsMap[pid].slice() : p.items.map((i) => i.id);
      const next = el.checked ? Array.from(new Set([...cur, iid])) : cur.filter((x) => x !== iid);
      S.breach.equipItemsMap[pid] = next;
      const preset = el.closest(".eq-preset");
      const head = preset && preset.querySelector(".eq-head .mini");
      if (head) head.textContent = next.length + "/" + p.items.length + " 项";
    });
  });
  $$("#page [data-eq-all]").forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = "1";
    el.addEventListener("click", () => {
      const [pid, on] = String(el.dataset.eqAll || "").split("|");
      const p = PRESETS.find((x) => x.id === pid);
      if (!p) return;
      S.breach.equipItemsMap[pid] = on === "1" ? p.items.map((i) => i.id) : [];
      refreshEquipUI();
    });
  });
}

/** 局部刷新：下拉摘要 + 操作台里的「装备明细」 */
function refreshEquipUI() {
  const sum = document.querySelector("#sEquipWrap .cnt");
  if (sum) sum.textContent = equipSummaryText();
  const ops = document.querySelector("#page details.ops");
  const cur = document.querySelector("#page #eqDetail");
  const html = renderEquipDetail();
  if (!ops) return;
  if (html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const node = tmp.firstElementChild;
    if (cur) cur.replaceWith(node);
    else {
      const s = ops.querySelector("summary");
      ops.insertBefore(node, s ? s.nextSibling : ops.firstChild);
    }
  } else if (cur) {
    cur.remove();
  }
  bindEquipControls();
}

/** 破甲台「一并装备」：只选预设（紧凑）；明细到操作台里逐项配置 */
function renderEquipPicker() {
  const b = S.breach;
  const picked = Array.isArray(b.equipPresets) ? b.equipPresets : [];
  const nameOf = (id) => (PRESETS.find((p) => p.id === id) || {}).name || id;
  const sum = equipSummaryText();
  const rows = PRESETS.map((p) => {
    const on = picked.includes(p.id);
    return `<label class="m-pick" data-status="${on ? "pending" : ""}">
      <input type="checkbox" data-eq-preset="${esc(p.id)}"${on ? " checked" : ""}>
      <span class="mp-main">
        <span class="t">${esc(p.name)} ${badge((p.agents || []).join(" / ") || "任意", "")}</span>
        <span class="s">${esc(p.desc || "")} · ${p.items.length} 项</span>
      </span>
    </label>`;
  }).join("");
  return `<details class="s-multi" id="sEquipWrap">
    <summary><span class="cnt">${esc(sum)}</span></summary>
    <div class="s-multi-list eq-list">
      ${rows}
      <p class="hint">选好预设后，逐项明细在「操作台 → 装备明细」里配。</p>
    </div>
  </details>`;
}

/** 操作台：装备明细（对每个已选预设逐项多选） */
function renderEquipDetail() {
  const b = S.breach;
  const picked = Array.isArray(b.equipPresets) ? b.equipPresets : [];
  if (!picked.length) return "";
  const map = b.equipItemsMap || {};
  const itemsOf = (p) => (Array.isArray(map[p.id]) ? map[p.id] : p.items.map((i) => i.id));
  let total = 0;
  const blocks = picked.map((id) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return "";
    const chosen = itemsOf(p);
    total += chosen.length;
    const rows = p.items.map((it) => `<label class="m-pick" data-status="${chosen.includes(it.id) ? "pending" : ""}">
      <input type="checkbox" data-eq-item="${esc(p.id + ":" + it.id)}"${chosen.includes(it.id) ? " checked" : ""}>
      <span class="mp-main">
        <span class="t">${esc(it.name)}</span>
        <span class="s">${esc(it.desc || "")}${it.skills && it.skills.length ? " · " + esc(it.skills.join(", ")) : ""}</span>
      </span>
    </label>`).join("");
    return `<div class="eq-preset">
      <div class="eq-head">
        <b>${esc(p.name)}</b>
        <span class="mini">${chosen.length}/${p.items.length} 项</span>
        <button type="button" class="small" data-eq-all="${esc(p.id)}|1">全选</button>
        <button type="button" class="small" data-eq-all="${esc(p.id)}|0">清空</button>
      </div>
      <div class="eq-items">${rows}</div>
    </div>`;
  }).join("");
  return `<details class="ops-sub" open id="eqDetail"><summary>装备明细 · ${picked.length} 包 / ${total} 项（逐项可配）</summary>
    <div class="eq-wrap">${blocks}</div>
    <p class="hint" style="padding:0 10px 8px">未勾的项不会写进装备记录；生成时按这里的勾选发放。</p>
  </details>`;
}

function renderSimpleOperation() {
  const b = S.breach;
  const err = S.simple.buildError;
  // 补丁层 / 梦神破甲都不生成载荷：模型、方案、模板、任务句全用不上
  const mode = b.delivery || "host-patch";
  const needsPayload = mode !== "host-patch" && mode !== "ak-patch";
  const rec = recommendedModels();
  const chosen = breachModels();
  if (!chosen.length && rec.length) { b.models = [rec[0].id]; b.model = rec[0].id; }
  const chosen2 = breachModels();
  const shown = rec.slice(0, 8);
  const modelRows = shown.map((m) => `<label class="m-pick"><input type="checkbox" data-smodel="${esc(m.id)}"${chosen2.includes(m.id) ? " checked" : ""}><span>${esc(simpleText(m.name || m.id))}</span></label>`).join("");
  const nameOf = (id) => (S.models.find((m) => m.id === id) || {}).name || id;
  const modelSum = chosen2.length
    ? `已选 ${chosen2.length}：${chosen2.slice(0, 2).map(nameOf).join("、")}${chosen2.length > 2 ? "…" : ""}`
    : "未选";
  let planHtml;
  if (S.hostTarget === "mengbot") {
    // 进到破甲台就把 MengBot 的 bot 拉一次：不再依赖「先切到宿主切换器」
    const mb = S.mb || {};
    if (!mb.tried && !mb.loading && typeof loadMengbot === "function") loadMengbot(false);
    const bots = mb.bots || [];
    const picked = currentBotIds();
    const nameOfBot = (id) => {
      const hit = bots.find((x) => x.id === id) || {};
      return hit.name || id;
    };
    const sum = picked.length ? `已选 ${picked.length}：${picked.slice(0, 2).map(nameOfBot).join("、")}${picked.length > 2 ? "…" : ""}` : "未选 bot";
    // 空列表要说清为什么空：正在读 / 读失败（带原因）/ 读到 0 个
    const why = mb.loading
      ? "正在读取 ~/.mengbot/bots.json…"
      : (mb.error
        ? "读不到 MengBot 数据：" + simpleReason(mb.error)
        : (mb.tried ? "读到 0 个 bot（~/.mengbot/bots.json 里没有 bot 记录）" : "还没读取"));
    const rows = bots.length
      ? bots.map((x) => `<label class="m-pick"><input type="checkbox" data-sbot="${esc(x.id)}"${picked.includes(x.id) ? " checked" : ""}><span class="mp-main"><span class="t">${esc(x.name || x.id)}</span><span class="s">${x.soulBytes ? fmtNum(x.soulBytes) + " B" : "—"}${x.title ? " · " + esc(String(x.title).slice(0, 24)) : ""}${x.gear ? " · 装备 " + esc(x.gear) : ""}</span></span></label>`).join("")
      : `<p class="hint">${esc(why)}　<button type="button" class="small" data-bot-reload="1">重新读取</button></p>`;
    planHtml = `<label class="field"><span>方案 · 目标 bot</span>
      <details class="s-multi" id="sBotsWrap">
        <summary><span class="cnt">${esc(sum)}</span></summary>
        <div class="s-multi-list">
          ${bots.length ? `<div class="actions" style="margin-bottom:4px"><button type="button" class="small" data-bot-all="1">全选</button><button type="button" class="small" data-bot-all="0">清空</button><button type="button" class="small" data-bot-reload="1">重新读取</button></div>` : ""}
          ${rows}
        </div>
      </details>
      <span class="help">多选；注入会对每个选中的 bot 各写一次 soul。${bots.length ? `（当前读到 ${bots.length} 个 bot）` : ""}</span>
    </label>`;
  } else {
    const plans = planPresetsFor(S.hostTarget, S.techniques);
    const cur = b.planId || currentPlanId(plans);
    planHtml = `<label class="field"><span>方案</span><select id="sPlan" data-focus="sPlan">${plans.map((p) => `<option value="${p.id}"${cur === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <span class="help">影响：突破层 + 技术组合（模板在操作台顶部选）。</span></label>`;
  }

  const tplName = simpleText((S.prompts.find((p) => p.id === b.template) || {}).name || "破甲模板");
  const titleTag = needsPayload ? tplName : (mode === "ak-patch" ? "梦神破甲 · AutoKill 配置层" : "补丁层 · 不需要模板");
  return `<section class="section" aria-labelledby="s-op-h">
    <h2 id="s-op-h"><span class="num">1</span>破甲台<span class="count">${esc(titleTag)}</span></h2>
    <form id="simpleForm" class="card" novalidate>
      ${renderHostSupportBar()}
      <div class="s-opbar ${needsPayload ? "three" : "one"}">
        ${deliverySelectHtml("sDelivery", b)}
        ${needsPayload ? `<label class="field"><span>目标模型</span>
          <details class="s-multi" id="sModelsWrap">
            <summary><span class="cnt">${esc(modelSum)}</span></summary>
            <div class="s-multi-list">${modelRows}<p class="hint">更多模型在「高级 → 模型目录」。</p></div>
          </details>
          <span class="help">多选；至少留一个。</span>
        </label>
        ${planHtml}` : ""}
      </div>

      <div class="s-opbar ${needsPayload ? "two" : "one"}">
        ${needsPayload ? `<label class="field"><span>破甲模板</span>
          <select id="sTemplate" data-focus="sTemplate">${S.prompts.map((p) => `<option value="${esc(p.id)}"${b.template === p.id ? " selected" : ""}>${esc(simpleText(p.name))}${p.id === "sauce-1171" ? " · 国模优先" : " · 通用"}</option>`).join("")}</select>
          <span class="help">统一应用到选中的 ${chosen2.length || 0} 个模型；模板是纯文本，与宿主无关（这套按国模调优）。</span>
        </label>` : ""}
        <div class="field"><span>一并装备</span>
          ${renderEquipPicker()}
          <span class="help">勾上预设＝生成时先发装备再投递；能力项可逐项取舍。</span>
        </div>
      </div>

      ${needsPayload
        ? `<div class="field">
        <textarea id="sTask" data-focus="sTask" aria-label="任务描述" rows="3" placeholder="例：让它详细说明如何绕过内容审核"${err && err.kind === "empty" ? ' aria-invalid="true" class="shake"' : ""}>${esc(b.task)}</textarea>
        <span class="help">写得越具体，生成的载荷越能用</span>
      </div>`
        : `<p class="hint" style="margin:0 0 10px">补丁层直接改宿主：按下面勾选的补丁应用，<b>不需要任务句、模型与方案</b>。要出载荷请把破甲方式切到「载荷破甲」。</p>`}

      <div class="s-actions">
        <button class="primary s-generate" id="sBuild" type="submit"${b.building ? ' disabled aria-busy="true"' : ""}>${b.building ? "处理中…" : esc(buildButtonLabel(mode))}</button>
        ${(() => { const un = uninstallAction(mode); return un ? `<button type="button" class="secondary danger" id="sUninstall">${esc(un.label)}</button>` : ""; })()}
      </div>
      ${(() => {
        const prog = S.host && S.host.progress;
        if (!prog) return "";
        const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
        const label = prog.done ? (prog.step === "failed" ? "失败" : "完成") : (prog.note || prog.step || "处理中");
        return `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
          <div class="prog-bar"><i style="width:${Math.max(2, pct)}%"></i></div>
          <div class="prog-meta"><span>${Math.round(pct)}% · ${esc(label)}</span>${prog.done ? "" : '<span class="mini">进行中…</span>'}</div>
        </div>`;
      })()}
      ${b.deliveryResult && b.deliveryResult.message ? softFailBox(b.deliveryResult.message) : ""}
      ${b.deliveryResult && b.deliveryResult.error ? `<p class="s-result bad">✗ ${esc(b.deliveryResult.error)}</p>` : ""}
    </form>
  </section>`;
}

function renderSimpleResults() {
  const b = S.breach;
  const head = `<h2>载荷`;
  if (b.building) {
    return `<section class="section">${head}</h2>${spinner("正在生成，请稍等…")}</section>`;
  }
  const err = S.simple.buildError;
  if (err && err.kind === "failed") {
    return `<section class="section">${head}</h2>
      <div class="alert bad" role="alert"><strong>没生成出来</strong><span class="hint">${esc(err.message)}</span>
        <div class="actions"><button type="button" class="small" data-simple-retry>重试</button></div>
      </div></section>`;
  }
  const list = Array.isArray(b.variants) ? b.variants : [];
  if (!list.length) {
    return `<section class="section">${head}</h2>${emptyState("还没有载荷。上面写一句话，点『一键生成』。", "")}</section>`;
  }
  const all = list.map((v, i) => `【${i + 1}】${v.name || "载荷"}\n${v.text || ""}`).join("\n\n");
  const meta = b.templateMeta;
  const tplName = meta && meta.id && meta.id !== "none" ? (S.prompts.find((x) => x.id === meta.id) || {}).name : "";
  const tplLine = tplName
    ? `<p class="s-tip">已套模板：${esc(simpleText(tplName))}${meta.chars ? `（${fmtNum(meta.chars)} 字）` : ""}；编码变体只带任务句，复制过去按需拼接。</p>`
    : `<p class="s-tip">这次没套模板，载荷只有技术模板 + 任务句。</p>`;
  const dv = b.deliveryResult;
  const dvBox = dv ? (dv.error ? alertBox("破甲方式没成功", dv.error) : okBox(dv.message)) : "";
  const cards = list.map((v, i) => {
    const key = String(v.id || v.technique || i);
    const recorded = S.simple.attempted[key];
    const absorbed = S.simple.absorbed[key];
    return `<article class="payload">
      <div class="payload-head">
        <div><h3>${i + 1}. ${esc(simpleText(v.name || "载荷"))}</h3>
          ${v.desc ? `<div class="payload-desc">${esc(simpleText(v.desc))}</div>` : ""}</div>
        ${copyBtn(v.text || "", "复制")}
      </div>
      <details class="s-fold"><summary>展开看全文</summary><pre tabindex="0">${esc(v.text || "")}</pre></details>
      <div class="s-record">
        ${recorded ? `<span class="s-record-done">已记录：${esc(recorded === "pass" ? "这次成功了" : "被拒绝了")}</span>` : ""}
        ${absorbed ? `<span class="s-record-done">已入库待审</span>` : ""}
        <button type="button" class="small" data-simple-attempt="pass" data-simple-key="${esc(key)}"${recorded ? " disabled" : ""}>这次成功了</button>
        <button type="button" class="small" data-simple-attempt="refused" data-simple-key="${esc(key)}"${recorded ? " disabled" : ""}>被拒绝了</button>
        <button type="button" class="small" data-inject-host="${esc(key)}">${S.breach.injectArm === key ? "确认注入宿主？" : "注入宿主"}</button>
        <button type="button" class="small" data-inject-agents="${esc(key)}">${S.breach.agentsArm === key ? "确认写 AGENTS.md？" : "写 AGENTS.md（免重启）"}</button>
        <button type="button" class="small" data-inject-agents-off>撤销指令层</button>
        <button type="button" class="small" data-absorb="${esc(key)}"${absorbed ? " disabled" : ""}>${absorbed ? "已入库" : "入库"}</button>
      </div>
    </article>`;
  }).join("");
  return `<section class="section">
    <div class="s-results-head">${head}<span class="count">${list.length} 条</span></h2>${copyBtn(all, "复制全部")}</div>
    ${tplLine}
    ${dvBox}
    <div class="payload-list">${cards}</div>
    <p class="s-tip">想调层、技术、采样？切到技术模式。</p>
  </section>`;
}

function renderSimpleBreach() {
  if (!S.readiness.tried && !S.readiness.loading) loadReadiness();
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  if (!S.hostInfo.loaded && !S.hostInfo.loading) loadHostInfo();
  // 不再加大标题块：破甲台自带标题，重复的「破甲 / 破甲」只会占地方
  $("#page").innerHTML = `
    ${renderSimpleOperation()}
    ${renderFlowPatchList()}
    ${renderOpsFold()}
    <details class="adv-fold"${S.simple.advOpen ? " open" : ""}><summary>高级：模型目录 / 任务类型与输出 / 就绪与二进制</summary>
      ${S.simple.advOpen
        ? renderFlowModelStep("simple") + renderSimpleChoices() + renderSimpleStatusCard() + renderFlowExtraPanels()
        : ""}
    </details>
  `;
  bindSimpleBreach();
  bindFlowControls();
  // 三个折叠都懒渲染（不展开不建 DOM），toggle 时才重绘
  const ops = $("#page details.ops");
  if (ops) ops.addEventListener("toggle", () => { if (S.simple.opsOpen !== ops.open) { S.simple.opsOpen = ops.open; renderPage(); } });
  const sub = $("#page details.ops-sub");
  if (sub) sub.addEventListener("toggle", () => { if (S.simple.patchOpen !== sub.open) { S.simple.patchOpen = sub.open; renderPage(); } });
  const adv = $("#page details.adv-fold:not(.ops)");
  if (adv) adv.addEventListener("toggle", () => { if (S.simple.advOpen !== adv.open) { S.simple.advOpen = adv.open; renderPage(); } });
}

/* 原版另外三栏的动作：规则集 / 白名单 / 技能 */
async function reloadHostExtras() {
  S.host.rules = await request("/api/host/rules").catch(() => S.host.rules);
  S.host.skills = await request("/api/host/skills").catch(() => S.host.skills);
  S.host.netScope = await request("/api/host/net-scope").catch(() => S.host.netScope);
  if (S.tab === "breach") renderPage();
}

async function openRule(name) {
  try {
    const d = await request("/api/host/rule?name=" + encodeURIComponent(name));
    S.host.ruleEdit = { name: d.name || name, text: d.text || "" };
    renderPage();
  } catch (e) { toastError(simpleReason(e)); }
}

async function saveRule() {
  const e = S.host.ruleEdit || {};
  const name = String(e.name || "").trim();
  if (!name) { toastError("先写文件名，例如 strict.md"); return; }
  try {
    const d = await request("/api/host/rule", { method: "POST", body: { confirm: true, name: name, text: String(e.text || "") } });
    if (!d || d.ok === false) throw payloadError(d, "保存规则失败");
    toast("规则已保存");
    S.host.ruleEdit = { name: d.name, text: e.text };
    await reloadHostExtras();
  } catch (err) { toastError(simpleReason(err)); }
}

async function deleteRuleFile(name) {
  if (!window.confirm("删除规则 " + name + "？会先自动备份。")) return;
  try {
    const d = await request("/api/host/rule/delete", { method: "POST", body: { confirm: true, name: name } });
    if (!d || d.ok === false) throw payloadError(d, "删除规则失败");
    toast("已删除");
    if ((S.host.ruleEdit || {}).name === name) S.host.ruleEdit = { name: "", text: "" };
    await reloadHostExtras();
  } catch (e) { toastError(simpleReason(e)); }
}

async function saveNetScope() {
  try {
    const text = S.host.netScopeDraft != null ? S.host.netScopeDraft : ((S.host.netScope || {}).text || "");
    const d = await request("/api/host/net-scope", { method: "POST", body: { confirm: true, text: text } });
    if (!d || d.ok === false) throw payloadError(d, "保存白名单失败");
    toast("白名单已保存");
    S.host.netScopeDraft = null;
    await reloadHostExtras();
  } catch (e) { toastError(simpleReason(e)); }
}

async function openSkill(name) {
  try {
    const d = await request("/api/host/skill?name=" + encodeURIComponent(name));
    S.host.skillView = { name: d.name || name, text: d.text || "" };
    renderPage();
  } catch (e) { toastError(simpleReason(e)); }
}

async function deleteSkillFile(name) {
  if (!window.confirm("删除技能 " + name + "？会先自动备份。")) return;
  try {
    const d = await request("/api/host/skill/delete", { method: "POST", body: { confirm: true, name: name } });
    if (!d || d.ok === false) throw payloadError(d, "删除技能失败");
    toast("已删除");
    if ((S.host.skillView || {}).name === name) S.host.skillView = { name: "", text: "" };
    await reloadHostExtras();
  } catch (e) { toastError(simpleReason(e)); }
}

async function saveSkill() {
  const e = S.host.skillEdit || {};
  const name = String(e.name || "").trim();
  if (!name) { toastError("先写技能目录名，例如 my-skill"); return; }
  if (!String(e.text || "").trim()) { toastError("SKILL.md 正文不能为空"); return; }
  try {
    const d = await request("/api/host/skill", { method: "POST", body: { confirm: true, name: name, text: String(e.text || "") } });
    if (!d || d.ok === false) throw payloadError(d, "保存技能失败");
    toast("技能已保存");
    S.host.skillView = { name: d.name, text: String(e.text || "") };
    await reloadHostExtras();
  } catch (err) { toastError(simpleReason(err)); }
}

/* 知识库：只读搜索 + 查看详情 */
async function searchKb(q, mode) {
  const kb = S.host.kb = Object.assign({}, S.host.kb);
  kb.q = q;
  kb.mode = mode || kb.mode || "poc";
  kb.error = null;
  try {
    const base = kb.mode === "note" ? "/api/kb/notes" : "/api/kb/poc";
    const d = await request(base + "?q=" + encodeURIComponent(kb.q) + "&limit=30");
    kb.items = (d && d.items) || [];
    kb.detail = null;
    if (!kb.stats) kb.stats = await request("/api/kb/stats").catch(() => null);
  } catch (e) {
    kb.error = e;
    kb.items = [];
  }
  if (S.tab === "breach") renderPage();
}

async function openKbItem(id) {
  const kb = S.host.kb;
  if (!kb) return;
  try {
    const base = kb.mode === "note" ? "/api/kb/notes" : "/api/kb/poc";
    const d = await request(base + "?id=" + encodeURIComponent(id));
    kb.detail = (d && d.item) || null;
    renderPage();
  } catch (e) { toastError(simpleReason(e)); }
}

/* 情报巡检：跑一次（真实出网，最长 3 分钟）+ 读历史报告 */
async function runIntel() {
  const it = S.host.intel = Object.assign({}, S.host.intel);
  if (it.running) return;
  const days = Number(($("#intelDays") || {}).value || it.days || 7);
  it.days = days;
  if (!window.confirm(`跑一次巡检（近 ${days} 天）？会真实出网抓 7 个源，最长约 3 分钟。`)) return;
  it.running = true;
  it.error = null;
  it.last = "";
  renderPage();
  try {
    const d = await request("/api/intel/sweep", { method: "POST", body: { confirm: true, days: days } });
    if (!d) throw new Error("没有响应");
    if (d.ok === false) {
      it.error = new Error(d.error === "timeout" ? "巡检超时（3 分钟没跑完）" : (d.detail || d.error || "巡检失败"));
      if (d.stdoutTail) it.last = "部分输出：\n" + d.stdoutTail.slice(-1500);
    } else {
      it.last = `巡检完成：近 ${d.days} 天 · 耗时 ${(d.elapsedMs / 1000).toFixed(1)}s` + (d.reportName ? ` · 产物 ${d.reportName}` : "");
      it.reports = await request("/api/intel/reports").catch(() => it.reports);
      if (d.reportName) {
        const rep = await request("/api/intel/report?name=" + encodeURIComponent(d.reportName)).catch(() => null);
        it.report = rep && rep.ok ? rep : it.report;
      }
    }
  } catch (e) {
    it.error = e;
  } finally {
    it.running = false;
    renderPage();
  }
}

async function openIntelReport(name) {
  const it = S.host.intel;
  if (!it) return;
  try {
    const d = await request("/api/intel/report?name=" + encodeURIComponent(name));
    it.report = d && d.ok ? d : null;
    renderPage();
  } catch (e) { toastError(simpleReason(e)); }
}

/* 演练台授权：确认 / 撤销（门禁数据源） */
async function drillAction(kind) {
  const dr = S.host.drill = Object.assign({}, S.host.drill);
  if (dr.busy) return;
  const ask = kind === "grant"
    ? "确认已阅读并同意演练台法律声明，并写入授权文件？"
    : "撤销授权？撤销后注入 / 卸载 / 巡检会被门禁挡住。";
  if (!window.confirm(ask)) return;
  dr.busy = true;
  dr.error = null;
  renderPage();
  try {
    const d = kind === "grant"
      ? await request("/api/drill/grant", { method: "POST", body: { confirm: true, signer: dr.signer || "" } })
      : await request("/api/drill/revoke", { method: "POST", body: { confirm: true } });
    if (!d || d.ok === false) throw payloadError(d, kind === "grant" ? "授权失败" : "撤销失败");
    toast(kind === "grant" ? "已确认授权" : "已撤销授权");
    S.host.tried = false;
    await loadHostStatus(true);
  } catch (e) {
    dr.error = e;
    renderPage();
  } finally {
    dr.busy = false;
    renderPage();
  }
}

/* 统一流程里的公共控件（两模式共用）：注入/卸载/还原、重新识别、注入正文编辑 */
function bindFlowControls() {
  $$("#page [data-simple-host]").forEach((el) => {
    el.addEventListener("click", () => simpleHostAction(el.dataset.simpleHost));
  });
  $$("#page [data-host-plugin-toggle]").forEach((el) => {
    el.addEventListener("change", () => { S.host.withPlugin = el.checked; });
  });
  $$("#page [data-live-refresh]").forEach((el) => {
    el.addEventListener("click", () => refreshLiveModels());
  });
  $$("#page [data-prompt-action]").forEach((el) => {
    el.addEventListener("click", () => promptAction(el.dataset.promptAction));
  });
  // 规则集
  $$("#page [data-rule-open]").forEach((el) => el.addEventListener("click", () => openRule(el.dataset.ruleOpen)));
  $$("#page [data-rule-del]").forEach((el) => el.addEventListener("click", () => deleteRuleFile(el.dataset.ruleDel)));
  $$("#page [data-rule-new]").forEach((el) => el.addEventListener("click", () => { S.host.ruleEdit = { name: "", text: "" }; renderPage(); }));
  $$("#page [data-rule-save]").forEach((el) => el.addEventListener("click", () => saveRule()));
  const ruleNameEl = $("#ruleName");
  if (ruleNameEl) ruleNameEl.addEventListener("input", () => { S.host.ruleEdit = Object.assign({}, S.host.ruleEdit, { name: ruleNameEl.value }); });
  const ruleTextEl = $("#ruleText");
  if (ruleTextEl) ruleTextEl.addEventListener("input", () => { S.host.ruleEdit = Object.assign({}, S.host.ruleEdit, { text: ruleTextEl.value }); });
  // 出口白名单
  const nsEl = $("#netScopeText");
  if (nsEl) nsEl.addEventListener("input", () => { S.host.netScopeDraft = nsEl.value; });
  $$("#page [data-netscope-save]").forEach((el) => el.addEventListener("click", () => saveNetScope()));
  // 技能
  $$("#page [data-skill-open]").forEach((el) => el.addEventListener("click", () => openSkill(el.dataset.skillOpen)));
  $$("#page [data-skill-del]").forEach((el) => el.addEventListener("click", () => deleteSkillFile(el.dataset.skillDel)));
  $$("#page [data-skill-save]").forEach((el) => el.addEventListener("click", () => saveSkill()));
  const skillNameEl = $("#skillName");
  if (skillNameEl) skillNameEl.addEventListener("input", () => { S.host.skillEdit = Object.assign({}, S.host.skillEdit, { name: skillNameEl.value }); });
  const skillTextEl = $("#skillText");
  if (skillTextEl) skillTextEl.addEventListener("input", () => { S.host.skillEdit = Object.assign({}, S.host.skillEdit, { text: skillTextEl.value }); });
  // 知识库
  $$("#page [data-kb-search]").forEach((el) => el.addEventListener("click", () => {
    const q = ($("#kbQuery") || {}).value || "";
    const mode = ($("#kbMode") || {}).value || "poc";
    searchKb(q, mode);
  }));
  const kbQueryEl = $("#kbQuery");
  if (kbQueryEl) kbQueryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchKb(kbQueryEl.value, ($("#kbMode") || {}).value || "poc"); }
  });
  $$("#page [data-kb-open]").forEach((el) => el.addEventListener("click", () => openKbItem(el.dataset.kbOpen)));
  // 情报巡检
  $$("#page [data-intel-run]").forEach((el) => el.addEventListener("click", () => runIntel()));
  $$("#page [data-intel-open]").forEach((el) => el.addEventListener("click", () => openIntelReport(el.dataset.intelOpen)));
  // 演练台
  $$("#page [data-drill]").forEach((el) => el.addEventListener("click", () => drillAction(el.dataset.drill)));
  const drSigner = $("#drillSigner");
  if (drSigner) drSigner.addEventListener("input", () => { S.host.drill = Object.assign({}, S.host.drill, { signer: drSigner.value }); });
  const intelDaysEl = $("#intelDays");
  if (intelDaysEl) intelDaysEl.addEventListener("change", () => { S.host.intel = Object.assign({}, S.host.intel, { days: Number(intelDaysEl.value) || 7 }); });
  const hp = $("#hostPrompt");
  if (hp) {
    hp.addEventListener("input", () => {
      S.host.promptDraft = hp.value;
      S.host.promptDirty = true;
      const save = document.querySelector('#page [data-prompt-action="save"]');
      if (save) save.disabled = false;
    });
  }
  bindGroups();
}

function bindSimpleBreach() {
  $$("#page [data-model]").forEach((el) => {
    el.addEventListener("click", () => toggleModel(el.dataset.model));
  });
  const task = $("#sTask");
  if (task) {
    task.addEventListener("input", () => { S.breach.task = task.value; });
    task.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); simpleBuild(); }
    });
  }
  const form = $("#simpleForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); simpleBuild(); });
  const tplSel = $("#sTemplate");
  if (tplSel) tplSel.addEventListener("change", () => { S.breach.template = tplSel.value; });
  const presetSel = $("#sPreset");
  if (presetSel) presetSel.addEventListener("change", () => {
    S.breach.taskPreset = presetSel.value;
    const text = presetTextFor(presetSel.value);
    if (text) S.breach.task = text;
    renderPage();
  });
  const outSel = $("#sOutput");
  if (outSel) outSel.addEventListener("change", () => { S.breach.outputChoice = outSel.value; });
  const dvSel = $("#sDelivery");
  if (dvSel) dvSel.addEventListener("change", () => {
    S.breach.delivery = dvSel.value;
    S.breach.deliveryResult = null;
    renderPage();
  });
  const sWithEquip = $("#sWithEquip");
  if (sWithEquip) sWithEquip.addEventListener("change", () => { S.breach.withEquip = sWithEquip.checked; });
  // 破甲台的宿主选择：与顶部切换器同一份状态
  const sHost = null; // 宿主只由顶部导航栏控制（破甲台的 #sHost 已移除）
  if (sHost) sHost.addEventListener("change", () => {
    S.hostTarget = sHost.value;
    S.hostInfo.touched = true;
    try { localStorage.setItem(HOST_KEY, S.hostTarget); } catch { /* 隐私模式 */ }
    const mb = mbState();
    mb.tab = S.hostTarget === "mengbot" ? "mengbot" : "dsh";
    if (mb.tab === "mengbot") {
      if (String(S.breach.delivery || "").startsWith("host-")) S.breach.delivery = "payload";
      loadMengbot(false);
    }
    renderPage();
  });
  // 目标模型：多选（勾选即生效，不整页重绘，避免下拉被收起）
  $$("#page [data-smodel]").forEach((el) => el.addEventListener("change", () => {
    const id = el.dataset.smodel;
    let list = breachModels();
    if (el.checked) {
      if (!list.includes(id)) list.push(id);
    } else {
      if (list.length <= 1) { el.checked = true; toastError("至少留一个目标模型"); return; }
      list = list.filter((x) => x !== id);
    }
    S.breach.models = list;
    S.breach.model = list[0] || "";
    S.attempt.model = S.breach.model;
    const sum = document.querySelector("#sModelsWrap .cnt");
    if (sum) sum.textContent = "已选 " + list.length;
  }));
  // 模型多选弹层：常驻 DOM、纯 CSS 展开，勾选/展开都不重绘页面
  const sPlan = $("#sPlan");
  if (sPlan) sPlan.addEventListener("change", () => applyPlanPreset(sPlan.value));
  const sBot = $("#sBot");
  if (sBot) sBot.addEventListener("change", () => { S.breach.botId = sBot.value; });
  // MengBot 目标 bot：多选 + 全选/清空（不重绘，只同步摘要）
  $$("#page [data-sbot]").forEach((el) => el.addEventListener("change", () => {
    const id = el.dataset.sbot;
    const all = ((S.mb && S.mb.bots) || []).map((x) => x.id);
    let list = currentBotIds();
    if (el.checked) {
      if (!list.includes(id)) list.push(id);
    } else {
      if (list.length <= 1) { el.checked = true; toastError("至少留一个 bot"); return; }
      list = list.filter((x) => x !== id);
    }
    S.breach.botIds = list.filter((x) => all.includes(x));
    const sum = document.querySelector("#sBotsWrap .cnt");
    if (sum) sum.textContent = "已选 " + S.breach.botIds.length;
  }));
  $$("#page [data-bot-all]").forEach((el) => el.addEventListener("click", () => {
    const on = el.dataset.botAll === "1";
    const all = ((S.mb && S.mb.bots) || []).map((x) => x.id);
    S.breach.botIds = on ? all.slice() : (all.length ? [all[0]] : []);
    $$("#page [data-sbot]").forEach((cb) => { cb.checked = on ? true : cb.dataset.sbot === (all[0] || ""); });
    const sum = document.querySelector("#sBotsWrap .cnt");
    if (sum) sum.textContent = "已选 " + S.breach.botIds.length;
  }));
  // 读不到 bot 时的「重新读取」：强制重拉 /api/mengbot/{status,bots,payload}
  $$("#page [data-bot-reload]").forEach((el) => el.addEventListener("click", () => {
    if (typeof loadMengbot === "function") loadMengbot(true);
    else { S.mb = null; renderPage(); }
  }));
  $$("#page [data-ak-pick]").forEach((el) => el.addEventListener("change", () => {
    const sel = akSelected();
    const id = el.dataset.akPick;
    if (el.checked) sel.add(id); else sel.delete(id);
  }));
  $$("#page [data-ak-all]").forEach((el) => el.addEventListener("click", () => {
    const on = el.dataset.akAll === "1";
    const sel = akSelected();
    sel.clear();
    if (on) (S.ak.items || []).forEach((x) => sel.add(x.id));
    $$("#page [data-ak-pick]").forEach((cb) => { cb.checked = on; });
  }));
  // MengBot bot 选择：应用时把勾选的装备写进它的 BotRecord.gear
  const mbSelEl = $("#akMengbot");
  if (mbSelEl) {
    mbSelEl.addEventListener("change", () => {
      S.ak.mengbotId = mbSelEl.value || "";
      S.ak.mengbotBots = S.ak.mengbotBots || [];
      S.ak.mengbotPick = true; // 记住用户选过，重渲染时保留
      renderPage();
    });
  }
  // UI 插槽注入 / 移除
  $$("#page [data-ak-slot]").forEach((el) => el.addEventListener("click", async () => {
    const action = el.dataset.akSlot === "unmount" ? "unmount" : "mount";
    try {
      const d = await request("/api/autokill/slots", { method: "POST", body: { confirm: true, action } });
      if (!d || d.ok === false) throw payloadError(d, "UI 插槽设置失败");
      S.ak.slots = d.state || {};
      const res = d.residue || {};
      toast(action === "unmount"
        ? (res.traces && res.traces.any ? "插槽已移除，但配置里还有残留：重启 AutoKill 后核对" : "插槽已从配置移除（重启 AutoKill 控件消失）")
        : (d.state && d.state.supported ? "已注入：重启 AutoKill 后构建助手旁与标题栏各有一个装备下拉" : "已写入配置（当前 AutoKill 版本不渲染，需新版）"));
      renderPage();
    } catch (e) { toastError(simpleReason(e)); }
  }));
  // MCP 插件挂载 / 卸下（装备在 AutoKill GUI 的可见面）
  $$("#page [data-ak-mcp]").forEach((el) => el.addEventListener("click", async () => {
    const action = el.dataset.akMcp === "unmount" ? "unmount" : "mount";
    if (typeof window !== "undefined" && S.ak.running && !window.confirm("AutoKill 正在运行，它可能用内存里的配置覆盖插件列表。仍要" + (action === "unmount" ? "卸下" : "挂载") + "吗？")) return;
    try {
      const d = await request("/api/autokill/mcp", { method: "POST", body: { confirm: true, action } });
      if (!d || d.ok === false) throw payloadError(d, "MCP 设置失败");
      S.ak.mcp = d.state || {};
      const res = d.residue || {};
      toast(action === "unmount"
        ? (res.clean ? "已卸干净（配置无残留、无 mcp-server 进程）" : `已卸载，但仍有残留：${res.traces && res.traces.any ? "配置" : ""}${res.processes && res.processes.length ? " 进程 " + res.processes.length + " 个" : ""} —— 重启 AutoKill 才真正断开`)
        : "已挂载 autokill-purge：重启 AutoKill 后在「设置 → 插件」能看到");
      renderPage();
    } catch (e) { toastError(simpleReason(e)); }
  }));
  // 卸载入口：主按钮旁边一个（按破甲方式动态）+ 清单里各一个
  $$("#page [data-ak-revert]").forEach((el) => el.addEventListener("click", () => revertDreamBreak()));
  const sUninstall = $("#sUninstall");
  if (sUninstall) {
    const mode = S.breach.delivery || "host-patch";
    const un = uninstallAction(mode);
    if (un) sUninstall.addEventListener("click", () => un.run());
  }
  // 提示词层 · 撤掉注入块（与主按钮旁的「一键卸载提示词注入」同一动作）
  $$("#page [data-uninject]").forEach((el) => el.addEventListener("click", () => uninjectPrompt()));
  // 一并装备：多选预设 → 展开逐项配置（勾选不重绘整页，下拉保持展开可连续多选）
  bindEquipControls();
  // 补丁清单：全选 / 取消全选 / 显示全部
  $$("#page [data-patch-all]").forEach((el) => el.addEventListener("click", () => {
    const on = el.dataset.patchAll === "1";
    $$("#page [data-patch-pick]").forEach((cb) => { cb.checked = on; });
  }));
  $$("#page [data-patch-more]").forEach((el) => el.addEventListener("click", () => {
    S.simple.patchAll = true;
    renderPage();
  }));
  $$("#page [data-simple-retry]").forEach((el) => el.addEventListener("click", () => simpleBuild()));
  $$("#page [data-simple-attempt]").forEach((el) => el.addEventListener("click", () => simpleAttempt(el.dataset.simpleKey, el.dataset.simpleAttempt)));
  $$("#page [data-readiness-action]").forEach((el) => el.addEventListener("click", () => {
    const target = el.dataset.readinessAction || "#/settings";
    if (target === "#/sign") { showAgreement(true); return; }
    if (/^#\//.test(target)) { location.hash = target; return; }
    location.hash = "#/settings";
  }));
}

/* 一键全自动：模型 → prompt 层 + 前 3 项技术 → 生成载荷（用户不选） */
async function simpleBuild() {
  const b = S.breach;
  if (b.building) return;
  S.simple.buildError = null;
  const mode = b.delivery || "host-patch";
  const needsPayload = mode !== "host-patch" && mode !== "ak-patch";
  const task = String(b.task || "").trim();
  if (needsPayload && !task) {
    // 不弹文案：直接把光标放回输入框并给一次轻微抖动（1 秒后自动消失），点了就知道要写东西。
    S.simple.buildError = { kind: "empty", message: "" };
    renderPage();
    const el = $("#sTask");
    if (el) {
      el.focus();
      setTimeout(() => {
        if (S.simple.buildError && S.simple.buildError.kind === "empty") {
          S.simple.buildError = null;
          const box = $("#sTask");
          if (box) { box.classList.remove("shake"); box.removeAttribute("aria-invalid"); }
        }
      }, 1000);
    }
    return;
  }
  const model = b.model || (S.models[0] && S.models[0].id) || "";
  if (needsPayload && !model) {
    S.simple.buildError = { kind: "failed", message: "还没读到可用的模型。等几秒再点『重试』。" };
    renderPage();
    return;
  }
  const techniques = S.techniques.slice(0, 3).map((t) => t.id);
  b.building = true;
  renderPage();
  try {
    // 补丁层不生成载荷：直接应用补丁（可顺带发装备），不调 /api/breach/build、不需要任务与模型
    if (!needsPayload) {
      b.variants = [];
      b.built = false;
      b.deliveryResult = await runPostBuildActions([]);
      return;
    }
    const data = await request("/api/breach/build", {
      method: "POST",
      body: {
        model, models: breachModels(), layer: "prompt", techniques, task,
        role: "安全研究员",
        output: outputTextFor(b.outputChoice),
        template: b.template || "none",
        scope: b.scope || "full",
      },
    });
    if (!data || data.ok === false) throw payloadError(data, "生成失败");
    const result = data.result || data;
    b.variants = (Array.isArray(result.variants) ? result.variants : []).map(normalizeVariant);
    b.advice = (Array.isArray(result.advice) ? result.advice : []).map(adviceText).filter(Boolean);
    b.zero = result.zero_wide_sample || "";
    b.resultMeta = { model: result.model || model, layer: result.layer || "prompt", at: new Date().toISOString() };
    b.templateMeta = { id: result.template || b.template || "none", chars: result.templateChars || 0, scope: result.scope || "full" };
    b.built = true;
    S.attempt.model = model;
    const first = b.variants[0] ? String(b.variants[0].technique || b.variants[0].id || "").replace(/-(rot13|base64)$/i, "") : "";
    if (first && S.techniques.some((t) => t.id === first)) S.attempt.technique = first;
    if (!b.variants.length) S.simple.buildError = { kind: "failed", message: "服务端这次没给出内容。点『重试』再生成一次。" };
    // 按「破甲方式」投递：payload 什么都不做；其余在这里补一次动作（可选先发装备）
    b.deliveryResult = null;
    if (b.variants.length) b.deliveryResult = await runPostBuildActions(b.variants);
  } catch (e) {
    if (isAgreementError(e)) return;
    S.simple.buildError = { kind: "failed", message: simpleReason(e) };
  } finally {
    b.building = false;
    stopEaterIfIdle();
    if (!modeIsTechnical() && S.tab === "breach") renderPage();
  }
}

/** 破甲载荷 → 宿主提示词层（prompt-inject.md）。两次点击确认，第一次只进入确认态。 */
async function injectHostPayload(key) {
  const b = S.breach;
  const list = Array.isArray(b.variants) ? b.variants : [];
  const variant = list.find((v, i) => String(v.id || v.technique || i) === String(key)) || list[0] || null;
  if (!variant) { toastError("先点一次「一键生成」再注入宿主。"); return; }
  if (b.injectArm !== key) {
    b.injectArm = key;
    renderPage();
    toast("再点一次确认：这段载荷会写进宿主 prompt-inject.md（重启 dsh 生效）", "warn");
    return;
  }
  b.injectArm = null;
  if (b.injectBusy) return;
  b.injectBusy = true;
  try {
    const data = await request("/api/breach/inject-host", {
      method: "POST",
      body: { confirm: true, mode: "append", text: String(variant.text || "") },
    });
    if (!data || data.ok === false) throw payloadError(data, "注入失败");
    b.injectResult = data;
    toast("已写入宿主提示词层（重启 dsh 生效）");
  } catch (e) {
    if (isAgreementError(e)) return;
    toastError(simpleReason(e));
  } finally {
    b.injectBusy = false;
    renderPage();
  }
}
/** 破甲载荷 → 指令层（AGENTS.md · 免重启）：DSH 每个 agent step 前读 <dshHome>/AGENTS.md 并注入 */
async function injectAgentsMd(key) {
  const b = S.breach;
  if (b.agentsArm !== key) {
    b.agentsArm = key;
    renderPage();
    toast("再点一次确认：写 ~/.dsh/AGENTS.md（下一步生效，不重启 dsh）", "warn");
    return;
  }
  b.agentsArm = null;
  if (b.agentsBusy) return;
  b.agentsBusy = true;
  try {
    const data = await request("/api/ops/instruction-inject/run", { method: "POST", body: { confirm: true, mode: "append" } });
    if (!data || data.ok === false) throw payloadError(data, "写入失败");
    b.agentsResult = data;
    toast("已写 AGENTS.md 指令层：下一步生效，无需重启");
    scheduleRailRefresh();
  } catch (e) {
    if (isAgreementError(e)) return;
    toastError(simpleReason(e));
  } finally {
    b.agentsBusy = false;
    renderPage();
  }
}

async function removeAgentsMd() {
  const b = S.breach;
  try {
    const data = await request("/api/ops/instruction-inject/run", { method: "POST", body: { confirm: true, action: "remove" } });
    if (!data || data.ok === false) throw payloadError(data, "撤销失败");
    b.agentsResult = data;
    toast(data.changed ? "已移除指令层注入块" : "本来就没有注入块");
    scheduleRailRefresh();
  } catch (e) {
    toastError(simpleReason(e));
  } finally {
    renderPage();
  }
}

/** 破甲页「一并装备」用：按当前界面模式读同一份装备选择（简单 / 技术各有一套状态） */
function currentEquipItems() {
  return modeIsTechnical() ? equipChosenItems() : simpleChosenItems();
}
function currentEquipPresets() {
  const ids = modeIsTechnical() ? equipPresets() : simpleEquipPresetObjs().map((p) => p.id);
  return ids.length ? ids : ["redteam"];
}
function currentEquipModels() {
  const tech = equipModels();
  if (tech.length) return tech;
  return Array.isArray(S.simple.equipModels) ? S.simple.equipModels : [];
}
function equipInlineSummary() {
  return `${currentEquipPresets().length} 包 / ${currentEquipItems().length} 项 / 模型 ${currentEquipModels().length}`;
}
function equipInlineBlock(idPrefix) {
  const b = S.breach;
  // 跟着实际选择走：没选装备就不勾、且禁用；选了才允许勾（默认随选择打开）
  const hasEquip = currentEquipPresets().length > 0;
  const checked = !!b.withEquip && hasEquip;
  return `<details class="s-fold"><summary>一并装备（当前 ${esc(equipInlineSummary())} → ${esc(hostTargetName(S.hostTarget))}）</summary>
    <label class="pick-row" style="padding:6px 0">
      <input type="checkbox" id="${esc(idPrefix)}WithEquip"${checked ? " checked" : ""}${hasEquip ? "" : " disabled"} aria-label="生成时一并发放装备">
      <span class="grow"><span class="t">生成时一并发放这份装备</span>
        <span class="s">${hasEquip
          ? "往「梦神装甲」记录追加一条，并把装备卡入库（待审）；装备包 / 能力项 / 模型在「梦神装甲」页勾选，这里跟着变。"
          : "还没选装备：先在「梦神装甲」页勾选装备包，这里才会打开。"}</span></span>
    </label>
  </details>`;
}

/** 生成之后：先发装备（可选），再按「破甲方式」投递载荷 */
async function runPostBuildActions(variants) {
  const b = S.breach;
  const parts = [];
  // 装备只在「真的选了」时才发：技术模式看 withEquip，普通模式看是否勾了预设；两者都要求非空
  const hasEquip = currentEquipPresets().length > 0;
  const wantEquip = hasEquip && (modeIsTechnical() ? b.withEquip : true);
  if (wantEquip) {
    try {
      const note = await sendEquipmentIfNeeded();
      parts.push("装备已发放" + (note || ""));
    } catch (e) {
      if (isAgreementError(e)) return null;
      parts.push("装备发放失败：" + simpleReason(e));
    }
  }
  if (b.delivery && b.delivery !== "payload") {
    try {
      const r = await applyDelivery(variants);
      if (r && r.message) parts.push(r.message);
      else if (r && r.error) parts.push("投递：" + r.error);
    } catch (e) {
      if (isAgreementError(e)) return null;
      parts.push("投递失败：" + simpleReason(e));
    }
  }
  return parts.length ? { message: parts.join(" ｜ ") } : null;
}

async function sendEquipmentIfNeeded() {
  const b = S.breach;
  const sel = modeIsTechnical()
    ? { presets: currentEquipPresets(), items: currentEquipItems() }
    : simpleEquipSelection();
  if (!sel.presets.length) return "";
  const models = currentEquipModels().length ? currentEquipModels() : (b.model ? [b.model] : []);
  const body = {
    preset: sel.presets[0] || "redteam",
    presets: sel.presets,
    agents: [S.hostTarget],
    permissions: S.equip.permissions || "read-only",
    items: sel.items,
    models,
    notes: "破甲页一并发放" + (b.task ? "：" + String(b.task).slice(0, 60) : ""),
  };
  const d = await request("/api/equipment", { method: "POST", body });
  if (!d || d.ok === false) throw payloadError(d, "装备发放失败");
  if (Array.isArray(d.equipment)) S.equipment = d.equipment;
  else if (d.equipment && typeof d.equipment === "object") S.equipment = [...S.equipment, d.equipment];
  return absorbNote(d.absorbed) + equipPluginNote(d);
}

/** 生成之后的投递动作：按「破甲方式」把载荷送出去（payload = 什么都不做） */
async function applyDelivery(variants) {
  const b = S.breach;
  const mode = b.delivery || "payload";
  if (mode === "payload") return null;
  const list = Array.isArray(variants) ? variants : [];
  const first = list.find((v) => (v.kind || "text") === "text") || list[0] || null;
  const model = b.model || (S.models[0] && S.models[0].id) || "";
  const rawTech = first ? String(first.technique || first.id || "").replace(/-(rot13|base64)$/i, "") : "";
  const technique = S.techniques.some((t) => t.id === rawTech) ? rawTech : ((S.techniques[0] && S.techniques[0].id) || "");

  if (mode === "ak-patch") {
    const ids = Array.from(akSelected());
    if (!ids.length) return { error: "梦神破甲一项都没勾" };
    if (S.ak.running && typeof window !== "undefined" && !window.confirm("AutoKill 正在运行，它可能用内存里的旧配置覆盖这次改动。仍要应用吗？（建议先退出 AutoKill）")) {
      return { error: "已取消（AutoKill 在运行）" };
    }
    const d = await request("/api/autokill/apply", { method: "POST", body: { confirm: true, ids, mengbotId: S.ak.mengbotId || "" } });
    if (!d || d.ok === false) throw payloadError(d, "应用梦神破甲失败");
    const after = S.ak;
    after.items = []; after.loaded = false; after.selected = null; // 下次进来自动重读当前值
    const bad = (d.results || []).filter((x) => !x.ok);
    const s = d.side || {};
    const parts = [];
    parts.push(s.mcp && s.mcp.ok !== false ? "MCP 插件" : "MCP 失败");
    parts.push(s.slots && s.slots.ok !== false ? "装备下拉" : "插槽失败");
    if (s.memory) parts.push(s.memory.ok ? "[memory]" : "memory 未写");
    if (s.dsh) parts.push(s.dsh.ok ? "DSH 预设(" + (s.dsh.presets || []).length + " 套)" : "DSH 失败");
    if (s.mengbot) parts.push(s.mengbot.ok ? "MengBot·" + (s.mengbot.name || "bot") + "→" + s.mengbot.gear + (s.mengbot.restartRequired ? "(待重启)" : "") : "MengBot 失败");
    const msg = `梦神破甲：应用 ${d.applied}/${d.total} 项${bad.length ? "，失败 " + bad.length + " 项" : ""}；已同步 ${parts.join(" + ")}；重启 AutoKill 生效`;
    toast(msg, bad.length ? "warn" : "ok");
    return { message: msg };
  }
  if (mode === "memory") {
    if (!first) return { error: "没有可入库的载荷" };
    const d = await request("/api/breach/absorb", {
      method: "POST",
      body: { model, technique, task: String(b.task || ""), variant: first.kind || "text", text: String(first.text || ""), result: "pass", template: b.template || "none" },
    });
    if (!d || d.ok === false) throw payloadError(d, "入库失败");
    return { message: "已入库待审：" + ((d.card && d.card.path) || "") };
  }
  if (mode === "host-prompt") {
    if (!first) return { error: "没有可注入的载荷" };
    const text = String(first.text || "");
    // MengBot 的「提示词层」= 写 bot 的 SOUL.md；多选就逐个写
    if (S.hostTarget === "mengbot") {
      const ids = currentBotIds();
      if (!ids.length) return { error: "先到「方案 · 目标 bot」勾选要注入的 bot" };
      if (ids.length > 1 && typeof window !== "undefined" && !window.confirm(`要把这段载荷写进 ${ids.length} 个 bot 的 soul？会先备份，可还原。`)) {
        return { error: "已取消（多选注入需要确认）" };
      }
      const done = [];
      const failed = [];
      for (const id of ids) {
        try {
          const d = await request("/api/mengbot/inject", { method: "POST", body: { confirm: true, id, text, mode: "prefix" } });
          if (d && d.ok !== false) done.push(id); else failed.push(id);
        } catch { failed.push(id); }
      }
      return { message: `已写入 ${done.length}/${ids.length} 个 bot 的 soul（重启 MengBot 生效）${failed.length ? "，失败 " + failed.length + " 个" : ""}` };
    }
    const d = await request("/api/breach/inject-host", { method: "POST", body: { confirm: true, mode: "append", text, host: S.hostTarget } });
    if (!d || d.ok === false) throw payloadError(d, "注入失败");
    return { message: S.hostTarget === "autokill"
      ? "已写入 AutoKill 的 prompt-inject.md，重启 AutoKill 生效（原文已备份）"
      : "已写入宿主提示词层（prompt-inject.md），重启 dsh 生效" };
  }
  if (mode === "host-patch") {
    armorBlast(document.getElementById("sBuild"));
    armorEater.start("inject");
    S.host.progress = { percent: 0, step: "writing", note: "正在写入补丁…", done: false };
    const picked = $$("#page [data-patch-pick]").filter((el) => el.checked).map((el) => el.dataset.patchPick);
    // 默认方式：没勾选就只补「还没应用」的那些（已应用的自动跳过，不会重写文件）
    let patches = picked;
    if (!patches.length) {
      const st = await request("/api/host/status").catch(() => null);
      const pending = ((st && st.patches) || []).filter((p) => p.status === "pending").map((p) => p.id);
      if (!pending.length) {
        return { message: "宿主补丁已是最新（没有待应用项），这次只生成载荷；要重打可在「注入」页勾选后应用" };
      }
      patches = pending;
    }
    const d = await request("/api/host/apply", { method: "POST", body: { confirm: true, mode: "apply", patches } });
    if (!d || d.ok === false) throw payloadError(d, "注入失败");
    const r = d.result || {};
    const base = `已注入宿主补丁 ${r.selected || 0}/${r.total || 0} 条（新增 ${r.applied || 0}，已是新版 ${r.already || 0}）`;
    // 落地已派发：立即起进度条，宿主约 3 秒后重启
    if (d.scheduled) {
      startProgressPolling("inject");
      return { message: `${base}；已下发：约 ${Math.round((d.restartInMs || 2500) / 1000)} 秒后结束并重启宿主，补丁随即生效（进度见下方进度条）` };
    }
    if (d.landed) return { message: `${base}，asar 已让位、宿主已重启：补丁已生效` };
    if (d.handoff && d.handoff.ok === false) {
      return { message: `${base}，但落地失败（${d.handoff.note || d.handoff.error || "原因未知"}）：补丁写在 resources/app，桌面壳仍读 app.asar` };
    }
    if (d.handoffRequired) return { message: `${base}，但还没落地：桌面壳读的是 app.asar，点「落地并重启宿主」后才生效` };
    return { message: `${base}，补丁已在当前加载的宿主里，重启 dsh 即生效` };
  }
  return null;
}

async function absorbVariant(key) {
  if (!key || S.simple.absorbBusy) return;
  const b = S.breach;
  const list = Array.isArray(b.variants) ? b.variants : [];
  const variant = list.find((v, i) => String(v.id || v.technique || i) === String(key)) || list[0] || null;
  if (!variant) { toastError("先点一次『一键生成』再入库。"); return; }
  const model = b.model || (S.models[0] && S.models[0].id) || "";
  const rawTech = String(variant.technique || variant.id || "").replace(/-(rot13|base64)$/i, "");
  const technique = S.techniques.some((t) => t.id === rawTech) ? rawTech : ((S.techniques[0] && S.techniques[0].id) || "");
  if (!model || !technique) { toastError("缺少模型或技术，先重新生成一次。"); return; }
  S.simple.absorbBusy = true;
  try {
    const data = await request("/api/breach/absorb", {
      method: "POST",
      body: {
        model, technique,
        task: String(b.task || ""),
        variant: variant.kind || "text",
        text: String(variant.text || ""),
        result: S.simple.attempted[key] === "refused" ? "refused" : "pass",
        template: b.template || "none",
      },
    });
    if (!data || data.ok === false) throw payloadError(data, "入库失败");
    S.simple.absorbed[key] = (data.card && (data.card.path || data.card.key)) || "pending";
    toast("已入库待审：" + ((data.card && data.card.path) || ""));
  } catch (e) {
    if (isAgreementError(e)) return;
    toastError(simpleReason(e));
  } finally {
    S.simple.absorbBusy = false;
    renderPage();
  }
}

async function simpleAttempt(key, result) {  if (!key || !result || S.simple.attemptBusy) return;
  const b = S.breach;
  const list = Array.isArray(b.variants) ? b.variants : [];
  const variant = list.find((v, i) => String(v.id || v.technique || i) === String(key)) || list[0] || null;
  const model = b.model || (S.models[0] && S.models[0].id) || "";
  const rawTech = variant ? String(variant.technique || variant.id || "").replace(/-(rot13|base64)$/i, "") : "";
  const technique = S.techniques.some((t) => t.id === rawTech) ? rawTech : ((S.techniques[0] && S.techniques[0].id) || "");
  if (!model || !technique) { toastError("这次没能记录：先点一次『一键生成』。"); return; }
  S.simple.attemptBusy = true;
  try {
    const data = await request("/api/breach/attempt", { method: "POST", body: { model, technique, result, note: "简单模式记录" } });
    if (!data || data.ok === false) throw payloadError(data, "记录失败");
    const attempt = data.attempt || { model, technique, result, note: "", at: new Date().toISOString() };
    S.attempts.push(attempt);
    S.breachStats = normalizeBreachStats(data.stats, S.attempts);
    S.simple.attempted[String(key)] = result;
    toast("已记录");
  } catch (e) {
    if (isAgreementError(e)) return;
    toastError(simpleReason(e));
  } finally {
    S.simple.attemptBusy = false;
    if (!modeIsTechnical() && S.tab === "breach") renderPage();
  }
}

/* ============================================================ simple mode · 装备 */
function agentDisplayName(id) {
  const a = AGENTS.find((x) => x.id === id);
  return a ? a.name : id;
}
function agentDisplayDesc(id) {
  const a = AGENTS.find((x) => x.id === id);
  return a ? a.desc : "自定义智能体";
}

function simpleEquippedItems() {
  // 点击「一键装备」到请求回来之间有个空窗：此时按本次要装的组合先算出来，
  // 别把状态卡渲染成「已装备 0 件」——用户会以为没装上。
  const pending = S.simple.equipBusy ? { preset: "redteam", agents: ["dsh"] } : null;
  const latest = S.equipment.length ? S.equipment[S.equipment.length - 1] : pending;
  if (!latest) return [];
  const items = [];
  const preset = PRESETS.find((p) => p.id === latest.preset);
  items.push({ key: "preset:" + (latest.id || latest.preset || "redteam"), name: preset ? preset.name : presetName(latest.preset), desc: preset ? preset.desc : "推荐组合" });
  for (const a of (Array.isArray(latest.agents) ? latest.agents : [])) {
    items.push({ key: "agent:" + a, name: agentDisplayName(a), desc: agentDisplayDesc(a) });
  }
  const removed = new Set(S.simple.removed || []);
  return items.filter((it) => !removed.has(it.key));
}

function renderSimpleEquip() {
  const items = simpleEquippedItems();
  const activeP = simpleEquipPresetObjs();
  const chosen = simpleChosenItems();
  const allKeys = simpleAllItemKeys();
  const presetCards = PRESETS.map((p) => {
    const idx = activeP.findIndex((x) => x.id === p.id);
    const on = idx >= 0;
    return `<button type="button" class="pick" data-simple-preset="${esc(p.id)}" data-focus="spreset-${esc(p.id)}" aria-pressed="${on}">
        <span class="pick-top"><span class="pick-name">${esc(p.name)}</span>${on ? badge(activeP.length > 1 ? String(idx + 1) : "已选", "accent") : ""}</span>
        <span class="pick-note">${esc(p.desc)}</span>
      </button>`;
  }).join("");
  // 每个选中的包一页
  const groups = activeP.map((p) => {
    const its = p.items || [];
    const picked = its.filter((it) => chosen.includes(p.id + ":" + it.id));
    return {
      preset: p, total: its.length, picked: picked.length,
      cards: its.map((it) => {
        const key = p.id + ":" + it.id;
        const on = chosen.includes(key);
        return `<button type="button" class="pick" data-simple-item="${esc(key)}" data-focus="sitem-${esc(key)}" aria-pressed="${on}">
          <span class="pick-top"><span class="pick-name">${esc(it.name)}</span>${on ? badge("装", "accent") : ""}</span>
          <span class="pick-note">${esc(it.desc)}</span>
        </button>`;
      }).join(""),
    };
  });
  const modelCands = equipModelCandidates();
  const pickedModels = Array.isArray(S.simple.equipModels) ? S.simple.equipModels : [];
  const rows = items.length
    ? `<div class="card">${items.map((it) => `<div class="s-row">
        <div class="s-row-main"><strong>${esc(simpleText(it.name))}</strong><span>${esc(simpleText(it.desc))}</span></div>
        <button type="button" class="small" data-simple-unequip="${esc(it.key)}">卸下</button>
      </div>`).join("")}</div>`
    : emptyState("还没装备。选好包和能力后点下面的按钮。", "");
  const out = S.simple.equipError
    ? alertBox(S.simple.equipError, "再点一次下面的按钮试试。")
    : (S.simple.equipResult ? okBox(S.simple.equipResult) : "");
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">梦神装甲</p><h1>梦神装甲</h1>
      <p class="lead">把现成能力装到你的智能体上，装完就能用。可以同时选多个装备包。</p>
    </div></div>
    <section class="s-status ${items.length ? "green" : "yellow"}" aria-label="当前装备">
      <div class="s-status-body">
        <strong>当前已装备 ${items.length} 件</strong>
        <span class="s-status-detail">${items.length ? "这些能力都装好了，可以直接用。" : "还没有装能力，选好下面的能力再装。"}</span>
      </div>
    </section>
    <section class="section" aria-labelledby="s-eq-pack">
      <h2 id="s-eq-pack"><span class="num">1</span>选装备包<span class="count">已选 ${activeP.length} / ${PRESETS.length} 个</span></h2>
      <p class="hint">可多选；每选一个包，下面就会多一页它的能力。</p>
      <div class="grid models">${presetCards}</div>
    </section>
    <section class="section" aria-labelledby="s-eq-pick">
      <h2 id="s-eq-pick"><span class="num">2</span>装哪些能力<span class="count">${chosen.length} / ${allKeys.length} 项 · ${groups.length} 页</span></h2>
      ${groups.length
        ? `<p class="hint">先勾再装：不勾的这项不会出现在配置里。</p>
          ${groups.filter((g) => g.total).map((g) => `<div class="equip-page">
            <div class="equip-page-head"><strong>${esc(g.preset.name)}</strong><span class="mono small">${g.picked} / ${g.total} 项</span>
              <span class="spacer"></span>
              <button type="button" class="small" data-simple-page-all="${esc(g.preset.id)}">本页全选</button>
              <button type="button" class="small" data-simple-page-none="${esc(g.preset.id)}">本页清空</button>
            </div>
            <div class="grid models">${g.cards}</div>
          </div>`).join("")}
          <div class="actions" style="margin-top:8px">
            <button type="button" class="ghost" data-simple-all>全部全选</button>
            <button type="button" class="ghost" data-simple-none>全部清空</button>
          </div>`
        : `<p class="hint">选中的包没有预置能力项（自定义包在备注里写清楚要装什么）。</p>`}
      ${simplePlanSkills().length ? `<div class="card soft" style="margin-top:10px">
        <div class="s-row"><div class="s-row-main"><strong>这套会加载 ${simplePlanSkills().length} 个技能</strong>
          <span class="mono small">${esc(simplePlanSkills().join(" · "))}</span></div></div>
        ${simplePlanWorkflows().length ? `<div class="s-row"><div class="s-row-main"><strong>跟这 ${simplePlanWorkflows().length} 条工作流</strong>
          <span class="mono small">${esc(simplePlanWorkflows().join(" · "))}</span></div></div>` : ""}
        ${pickedModels.length ? `<div class="s-row"><div class="s-row-main"><strong>带这 ${pickedModels.length} 个模型</strong>
          <span class="mono small">${esc(pickedModels.join(" · "))}</span></div></div>` : ""}
      </div>` : ""}
    </section>
    <section class="section" aria-labelledby="s-eq-models">
      <h2 id="s-eq-models"><span class="num">3</span>带哪些模型<span class="count">${pickedModels.length} / ${modelCands.length} 个</span></h2>
      <p class="hint">标了「已破甲」的就是已经适配过破甲的模型，可以直接带进去。</p>
      <div class="grid models">${modelCands.map((m) => {
        const on = pickedModels.includes(m.id);
        return `<button type="button" class="pick" data-simple-model="${esc(m.id)}" data-focus="smodel-${esc(m.id)}" aria-pressed="${on}">
          <span class="pick-top"><span class="pick-name">${esc(m.name)}</span>${on ? badge("带", "accent") : ""}${m.cracked ? badge("已破甲", "good") : ""}</span>
          <span class="pick-note">${esc(m.meta || m.id)}</span>
        </button>`;
      }).join("")}</div>
      <div class="actions" style="margin-top:8px">
        <button type="button" class="ghost" data-simple-model-cracked>只选已破甲的</button>
        <button type="button" class="ghost" data-simple-model-none>全不选</button>
      </div>
    </section>
    <section class="section">
      <button type="button" class="primary s-generate" id="sEquipAll"${S.simple.equipBusy || !chosen.length ? ' disabled aria-busy="true"' : ""}>${S.simple.equipBusy ? "装备中…" : (chosen.length ? `装备选中的 ${chosen.length} 项` : "先勾至少一项")}</button>
      <div id="sEquipOut" style="margin-top:10px">${out}</div>
    </section>
    <section class="section" aria-labelledby="s-eq-h">
      <h2 id="s-eq-h"><span class="num">4</span>已装的<span class="count">${items.length} 件</span></h2>
      ${rows}
    </section>
  `;
  bindSimpleEquip();
}

/* 普通模式当前选的装备包（可多选，默认梦神攻装） */
function simpleEquipPresetObjs() {
  const ids = Array.isArray(S.simple.equipPresets) && S.simple.equipPresets.length
    ? S.simple.equipPresets
    : (S.simple.equipPreset ? [S.simple.equipPreset] : ["redteam"]);
  const objs = PRESETS.filter((p) => ids.includes(p.id));
  return objs.length ? objs : [PRESETS[0]];
}

function simpleEquipPresetObj() {
  return simpleEquipPresetObjs()[0];
}

function simpleAllItemKeys() {
  const out = [];
  for (const p of simpleEquipPresetObjs()) for (const it of p.items || []) out.push(p.id + ":" + it.id);
  return out;
}

function simpleTogglePreset(id) {
  const cur = simpleEquipPresetObjs().map((p) => p.id);
  let next;
  if (cur.includes(id)) {
    if (cur.length === 1) { toastError(L("至少留一个装备包", "Keep at least one pack")); return; }
    next = cur.filter((x) => x !== id);
  } else {
    next = cur.concat([id]);
  }
  S.simple.equipPresets = next;
  S.simple.equipPreset = next[0];
  S.simple.equipItems = null;
  S.simple.equipError = "";
  S.simple.equipResult = "";
  renderPage();
}

function simpleChosenItems() {
  const all = simpleAllItemKeys();
  if (!Array.isArray(S.simple.equipItems)) return all;
  return S.simple.equipItems.filter((k) => all.includes(k));
}

/* 普通模式这套会加载哪些技能 / 跟哪几条工作流 */
function simplePlanSkills() {
  const chosen = new Set(simpleChosenItems());
  const out = [];
  for (const p of simpleEquipPresetObjs()) {
    for (const it of p.items || []) {
      if (!chosen.has(p.id + ":" + it.id)) continue;
      for (const s of it.skills || []) if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

function simplePlanWorkflows() {
  const out = [];
  for (const p of simpleEquipPresetObjs()) for (const w of PRESET_WORKFLOWS[p.id] || []) if (!out.includes(w)) out.push(w);
  return out;
}

function bindSimpleEquip() {
  $$("#page [data-simple-preset]").forEach((el) => {
    el.addEventListener("click", () => simpleTogglePreset(el.dataset.simplePreset));
  });
  $$("#page [data-simple-model]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.simpleModel;
      const cur = Array.isArray(S.simple.equipModels) ? S.simple.equipModels : [];
      S.simple.equipModels = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat([id]);
      renderPage();
    });
  });
  $$("#page [data-simple-model-cracked]").forEach((el) => el.addEventListener("click", () => {
    S.simple.equipModels = equipModelCandidates().filter((m) => m.cracked).map((m) => m.id);
    renderPage();
  }));
  $$("#page [data-simple-model-none]").forEach((el) => el.addEventListener("click", () => {
    S.simple.equipModels = [];
    renderPage();
  }));
  $$("#page [data-simple-page-all]").forEach((el) => el.addEventListener("click", () => {
    const p = PRESETS.find((x) => x.id === el.dataset.simplePageAll);
    if (!p) return;
    const cur = new Set(simpleChosenItems());
    for (const it of p.items || []) cur.add(p.id + ":" + it.id);
    S.simple.equipItems = Array.from(cur);
    renderPage();
  }));
  $$("#page [data-simple-page-none]").forEach((el) => el.addEventListener("click", () => {
    const p = PRESETS.find((x) => x.id === el.dataset.simplePageNone);
    if (!p) return;
    const drop = new Set((p.items || []).map((it) => p.id + ":" + it.id));
    S.simple.equipItems = simpleChosenItems().filter((k) => !drop.has(k));
    renderPage();
  }));
  $$("#page [data-simple-all]").forEach((el) => el.addEventListener("click", () => {
    S.simple.equipItems = null;
    renderPage();
  }));
  $$("#page [data-simple-none]").forEach((el) => el.addEventListener("click", () => {
    S.simple.equipItems = [];
    renderPage();
  }));
  $$("#page [data-simple-item]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.simpleItem;
      const cur = simpleChosenItems();
      S.simple.equipItems = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      S.simple.equipError = "";
      S.simple.equipResult = "";
      renderPage();
    });
  });
  const all = $("#sEquipAll");
  if (all) all.addEventListener("click", () => simpleEquipPreset());
  $$("#page [data-simple-unequip]").forEach((el) => el.addEventListener("click", () => {
    const key = el.dataset.simpleUnequip;
    if (!key) return;
    if (!S.simple.removed.includes(key)) S.simple.removed.push(key);
    toast("已卸下");
    renderPage();
  }));
}

async function simpleEquipPreset() {
  if (S.simple.equipBusy) return;
  S.simple.equipBusy = true;
  S.simple.equipError = "";
  S.simple.equipResult = "";
  renderPage();
      const p = simpleEquipPresetObj();
    const presets = simpleEquipPresetObjs().map((x) => x.id);
    const body = { preset: p.id, presets: presets, agents: p.agents.length ? p.agents : ["dsh"], permissions: "read-only", notes: "", items: simpleChosenItems(), models: Array.isArray(S.simple.equipModels) ? S.simple.equipModels : [] };
  try {
    const data = await request("/api/equipment", { method: "POST", body });
    if (!data || data.ok === false) throw payloadError(data, "装备失败");
    if (Array.isArray(data.equipment)) S.equipment = data.equipment;
    else if (data.equipment && typeof data.equipment === "object") S.equipment = [...S.equipment, data.equipment];
    else S.equipment = [...S.equipment, Object.assign({}, body, { at: new Date().toISOString() })];
    if (data.plugin && data.plugin.changed) toast('已同时安装「梦神破甲」插件；重启 DSH 后工具生效', 'warn');
    else if (data.plugin && data.plugin.ok === false) toastError('插件安装失败：' + (data.plugin.summary || data.plugin.error || ''));
    S.simple.removed = [];
    const items = simpleEquippedItems();
    const chosen = simpleChosenItems();
    S.simple.equipResult = (chosen.length
      ? `已装 ${chosen.length} 项能力：${chosen.map((k) => {
        const cut = k.indexOf(":");
        const pid = cut > 0 ? k.slice(0, cut) : "";
        const iid = cut > 0 ? k.slice(cut + 1) : k;
        const p = PRESETS.find((x) => x.id === pid);
        const it = ((p && p.items) || []).find((x) => x.id === iid);
        return it ? it.name : k;
      }).join("、")}`
      : "这次一项都没勾，没有装任何能力。") + absorbNote(data.absorbed);
  } catch (e) {
    if (isAgreementError(e)) return;
    S.simple.equipError = simpleReason(e);
  } finally {
    S.simple.equipBusy = false;
    if (!modeIsTechnical() && S.tab === "equip") renderPage();
  }
}

/* ============================================================ simple mode · 记忆 */
function memoryCardTime(card) {
  if (!card || typeof card !== "object") return "";
  const raw = card.updated || card.updatedAt || card.updated_at || card.created || card.createdAt || card.created_at || card.at || card.date || card.mtime || "";
  return raw ? fmtTime(raw) : "";
}

/* 内嵌 memory-eternal 面板（同源代理 /embed/memory/，见 server.mjs 的 proxyMemoryUi） */
function memoryFullPage() {
  document.body.classList.add("mem-mode");
  // 独立库标识：端口 7989 / 库名 mem-purge，避免和运营库（7999）混看
  document.title = "记忆库 · mem-purge@" + (S.settings && S.settings.memoryBase ? (S.settings.memoryBase.match(/:(\d+)/) || [])[1] || "7989" : "7989");
  $("#page").innerHTML = `<div class="mem-full">
    <iframe src="/embed/memory/" title="记忆库 mem-purge" loading="eager" referrerpolicy="no-referrer"></iframe>
  </div>`;
}

function memoryEmbedBlock(open) {
  return `<section class="section" aria-labelledby="s-mem-embed">
      <details class="grp" data-group="memory:embed"${open ? " open" : ""}>
        <summary><span class="grp-title">记忆面板（内嵌 7999）</span><span class="grp-hint">同源代理 /embed/memory/ · 整块就是 memory-eternal 的 Web UI</span></summary>
        <div class="grp-body">
          <div class="actions" style="margin-bottom:8px">
            <a class="ghost" href="/embed/memory/" target="_blank" rel="noopener">新窗口打开</a>
            <span class="hint">面板直接作用于本机记忆库。首次打开会遇到 memory-eternal 的两步引导（「首次使用」与「Star 提示」），各点一次「稍后」/「跳过」即可，之后不再弹（记在本站 localStorage）。</span>
          </div>
          <iframe src="/embed/memory/" title="memory-eternal 记忆面板"
            style="width:100%;height:760px;border:1px solid var(--line,#2b3242);border-radius:12px;background:#0b0f18"
            loading="lazy" referrerpolicy="no-referrer"></iframe>
        </div>
      </details>
    </section>`;
}

function renderSimpleMemory() {
  memoryFullPage();
}

function bindSimpleMemory() {
  const q = $("#sMemQ");
  if (q) q.addEventListener("input", () => { S.memory.q = q.value; });
  const form = $("#simpleMemorySearch");
  if (form) form.addEventListener("submit", (e) => {
    e.preventDefault();
    S.memory.q = $("#sMemQ") ? $("#sMemQ").value.trim() : "";
    S.memory.kind = "";
    S.memory.cards = null;
    S.memory.cardsLoaded = false;
    S.memory.error = null;
    S.memory.detail = null;
    S.memory.detailError = null;
    S.simple.detailIndex = null;
    renderPage();
  });
  $$("#page [data-simple-card]").forEach((el) => el.addEventListener("click", () => {
    const index = Number(el.dataset.simpleCard);
    S.simple.detailIndex = index;
    openMemoryCard(index);
  }));
}

/* ============================================================ simple mode · 设置 */
function renderSimpleSettings() {
  const agreement = (S.state && S.state.agreement) || { accepted: false, version: "", at: "", signer: "" };
  const connected = !!S.memory.statsLoaded && !S.memory.statsError;
  const testing = S.simple.testState === "loading";
  const testOut = S.simple.testState === "ok"
    ? okBox(S.simple.testMessage)
    : S.simple.testState === "bad"
      ? alertBox(S.simple.testMessage, "再试一次就点『测试连接』。")
      : "";
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">设置</p><h1>设置</h1>
      <p class="lead">只有这几项。要改参数和文件路径，切到技术模式。</p>
    </div></div>
    <section class="card settings-list" aria-label="设置项">
      <div class="s-row">
        <div class="s-row-main"><strong>连接状态</strong><span>${connected ? "记忆服务已连接" : "记忆服务未连接"}</span></div>
        <button type="button" class="small" id="sSimpleTest"${testing ? " disabled" : ""}>${testing ? "测试中…" : "测试连接"}</button>
      </div>
      <div id="sSimpleTestOut">${testOut}</div>
      <div class="s-row">
        <div class="s-row-main"><strong>语言</strong><span>简体中文（当前版本只提供简体中文）</span></div>
        ${badge("已选", "accent")}
      </div>
      <div class="s-row">
        <div class="s-row-main"><strong>想改更多参数</strong><span>技术模式会显示全部参数与文件路径，也能逐项恢复默认。</span></div>
        <button type="button" class="ghost" id="sSimpleTech">切换到技术模式</button>
      </div>
      <div class="s-row">
        <div class="s-row-main"><strong>重新签署协议</strong><span>${agreement.accepted ? "当前已签署。" : "当前还没签署。"}${S.simple.resignArmed ? "再点一次就会清空签署并重新弹窗。" : ""}</span></div>
        <button type="button" class="${S.simple.resignArmed ? "danger" : "ghost"}" id="sSimpleResign">${S.simple.resignArmed ? "确认重签" : "重新签署协议"}</button>
      </div>
    </section>
    <section class="section">
      <details class="lib"><summary>版本与关于</summary><div class="lib-body">
        <dl class="kv compact">
          <dt>名称</dt><dd>autokill-purge</dd>
          <dt>版本</dt><dd class="mono">${esc(S.version || "—")}</dd>
          <dt>作者</dt><dd>EternalNight996（YG）</dd>
          <dt>许可</dt><dd>MIT</dd>
        </dl>
        <p class="small muted" style="margin-top:8px">本工具只用于本人拥有或获得书面授权的系统、模型与数据的安全研究、红队演练与教学演示。使用者对自己的一切操作与后果负全部责任。</p>
      </div></details>
    </section>
  `;
  bindSimpleSettings();
}

function bindSimpleSettings() {
  const test = $("#sSimpleTest");
  if (test) test.addEventListener("click", () => simpleTestConnection());
  const tech = $("#sSimpleTech");
  if (tech) tech.addEventListener("click", () => setUiMode("technical"));
  const resign = $("#sSimpleResign");
  if (resign) resign.addEventListener("click", () => {
    if (!S.simple.resignArmed) { S.simple.resignArmed = true; renderPage(); return; }
    S.simple.resignArmed = false;
    resetAgreement();
  });
}

async function simpleTestConnection() {
  if (S.simple.testState === "loading") return;
  S.simple.testState = "loading";
  S.simple.testMessage = "";
  renderPage();
  loadReadiness(true);
  try {
    const data = await request("/api/memory/stats");
    if (!data || data.ok === false) throw payloadError(data, "记忆服务不可用");
    S.memory.stats = normalizeStats(data);
    S.memory.statsLoaded = true;
    S.memory.statsError = null;
    S.simple.testState = "ok";
    S.simple.testMessage = "连上了，记忆服务可以用。";
    setStatus("ok", "记忆中心已连接");
  } catch (e) {
    if (isAgreementError(e)) { S.simple.testState = "idle"; return; }
    S.memory.statsError = e;
    S.memory.statsLoaded = true;
    S.simple.testState = "bad";
    S.simple.testMessage = simpleReason(e);
    setStatus("bad", "记忆中心未连接", e.message);
  } finally {
    if (!modeIsTechnical() && S.tab === "settings") renderPage();
  }
}

/* ------------------------------------------------------------------ breach · model side */
function computeStats(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const total = list.length;
  const pass = list.filter((a) => a.result === "pass").length;
  const partial = list.filter((a) => a.result === "partial").length;
  const byModel = {};
  const byTech = {};
  for (const a of list) {
    const m = a.model || "custom";
    const t = a.technique || "?";
    byModel[m] = byModel[m] || { total: 0, pass: 0, partial: 0 };
    byTech[t] = byTech[t] || { total: 0, pass: 0, partial: 0 };
    byModel[m].total += 1;
    byTech[t].total += 1;
    if (a.result === "pass") { byModel[m].pass += 1; byTech[t].pass += 1; }
    if (a.result === "partial") { byModel[m].partial += 1; byTech[t].partial += 1; }
  }
  return { total, pass, partial, rate: rateOf(pass, total), byModel, byTech };
}

function normalizeBreachStats(raw, attempts) {
  const fallback = computeStats(attempts);
  if (!raw || typeof raw !== "object") return fallback;
  const total = Number(raw.total ?? fallback.total);
  const pass = Number(raw.pass ?? fallback.pass);
  const partial = Number(raw.partial ?? fallback.partial);
  const rate = Number(raw.rate ?? raw.passRate ?? (total ? Math.round((1000 * pass) / total) / 10 : 0));
  return {
    total,
    pass,
    partial,
    rate,
    byModel: raw.byModel && typeof raw.byModel === "object" ? raw.byModel : fallback.byModel,
    byTech: (raw.byTech || raw.byTechnique) && typeof (raw.byTech || raw.byTechnique) === "object" ? (raw.byTech || raw.byTechnique) : fallback.byTech,
  };
}

function adviceText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    const parts = [];
    if (value.temperature != null) parts.push("temperature " + value.temperature);
    if (value.top_p != null) parts.push("top_p " + value.top_p);
    if (value.retry) parts.push("重试：" + value.retry);
    if (value.max_tokens != null) parts.push("max_tokens " + value.max_tokens);
    for (const [k, v] of Object.entries(value)) {
      if (["text", "temperature", "top_p", "retry", "max_tokens"].includes(k)) continue;
      if (typeof v === "string" || typeof v === "number") parts.push(k + " " + v);
    }
    return parts.join(" · ");
  }
  return String(value);
}

function normalizeVariant(v) {
  const id = String(v.id || v.technique || "");
  const kind = String(v.kind || v.encoding || (id.includes("rot13") ? "rot13" : (id.toLowerCase().includes("base64") ? "base64" : "text"))).toLowerCase();
  const techId = String(v.technique || id.replace(/-(rot13|base64)$/i, ""));
  const techLabel = techniqueName(techId);
  const kindLabel = kind === "base64" ? "Base64" : (kind === "rot13" ? "ROT13" : (kind === "text" ? "文本" : kind));
  const name = v.name || (techId ? `${techLabel} · ${kindLabel}` : "载荷");
  const desc = v.desc || (techId ? `技术：${techLabel}（${kindLabel}）` : "");
  return {
    ...v,
    id: id || `${techId}-${kind}`,
    technique: techId,
    name,
    desc,
    layer: v.layer || S.breach.layer,
    encoding: v.encoding || (kind === "base64" ? "Base64" : (kind === "rot13" ? "ROT13" : "")),
  };
}

function statEntries(map) {
  return Object.entries(map || {}).map(([key, value]) => {
    if (typeof value === "number") return { key, total: value, pass: 0, partial: 0 };
    return { key, total: Number(value.total || 0), pass: Number(value.pass || 0), partial: Number(value.partial || 0) };
  }).sort((a, b) => b.total - a.total);
}

function resultTone(id) {
  const r = RESULTS.find((x) => x.id === id);
  return r ? r.tone : "";
}

function resultName(id) {
  const r = RESULTS.find((x) => x.id === id);
  return r ? r.name : id || "—";
}

/* ============================================================ 宿主破甲（照搬 dsh-purge 1.1.71） */
/* ============================================================ 统一破甲流程（两模式同一套顺序）
   ① 选模型（实时优先，没识别到就展开获取）→ ② 选方案 → ③ 一键注入/卸载/还原 → ④ 补丁清单（可收缩）→ ⑤ 生成载荷 */
function flowToneBadge(p) {
  const tone = p.tone || (p.status === "applied" ? "ok" : p.status === "pending" ? "wait" : p.status === "missing_file" ? "fail" : "skip");
  const sealed = !!(S.host.data && S.host.data.desktopSealed);
  let label = p.statusZh || (tone === "ok" ? "已注入" : tone === "wait" ? "待注入" : tone === "fail" ? "失败" : "已跳过");
  // 文件写了 ≠ 宿主在用：app.asar 还在时桌面壳读的是 asar，这些字节一个都不会被加载。
  // 只在 sealed 时改口径，落地后照旧说「已注入」。
  if (sealed && tone === "ok") label = "已写入 · 未生效";
  else if (sealed && tone === "wait") label = "待写入";
  return `<span class="patch-state tone-${esc(tone)}">${esc(label)}</span>`;
}

/* 当前选中的模型列表（单选也走同一个数组；至少保留一个） */
function breachModels() {
  const b = S.breach;
  const list = Array.isArray(b.models) && b.models.length ? b.models.slice() : (b.model ? [b.model] : []);
  return list;
}

/* 点模型：多选 toggle；取消到空就不动（至少留一个） */
function toggleModel(id) {
  if (!id) return;
  const b = S.breach;
  let list = breachModels();
  const i = list.indexOf(id);
  if (i >= 0) {
    if (list.length === 1) {
      toastError(L("至少留一个模型", "Keep at least one model"));
      return;
    }
    list.splice(i, 1);
  } else {
    list.push(id);
  }
  b.models = list;
  b.model = list[0] || "";
  S.attempt.model = b.model;
  renderPage();
}

function renderFlowModelStep(mode) {
  const tech = mode === "technical";
  const live = S.modelsLive;
  const liveCount = (live && live.count) || 0;
  const all = (S.models || []).filter((m) => m && m.id && !NON_CHAT_MODEL.test(m.id));
  const rec = recommendedModels();
  // 不再折叠：把要选的模型直接平铺出来（普通模式最多 6 个，技术模式全量）
  const picked = tech ? all : (() => {
    const out = rec.slice();
    for (const m of all) {
      if (out.length >= 6) break;
      if (!out.some((x) => x.id === m.id) && m.live) out.push(m);
    }
    return out;
  })();
  const pickedModels = breachModels();
  const card = (m) => {
    const idx = pickedModels.indexOf(m.id);
    const on = idx >= 0;
    return `<button type="button" class="pick" data-model="${esc(m.id)}" data-focus="model-${esc(m.id)}" aria-pressed="${on}">
      <span class="pick-top"><span class="pick-name">${esc(simpleText(m.name))}</span>${on ? (pickedModels.length > 1 ? badge(String(idx + 1), "accent") : badge("已选", "accent")) : ""}</span>
      <span class="pick-note">${esc(simpleText(m.tagline || m.notes || m.family || ""))}</span>
      ${m.liveProvider ? `<span class="pick-meta">${esc(m.liveProvider)}</span>` : ""}
    </button>`;
  };
  return `<section class="section" aria-labelledby="f-model-h">
    <h2 id="f-model-h"><span class="num">1</span>选模型<span class="count">${liveCount ? `实时识别 ${liveCount} 个 · 这里 ${picked.length} 个` : "还没识别到，显示目录"}</span></h2>
    <div class="grid models">${picked.map(card).join("")}</div>
    ${liveCount ? "" : `<div class="actions" style="margin-top:8px"><button type="button" class="ghost" data-live-refresh>重新识别</button><span class="hint">读 ~/.dsh 的配置、用量账本与 Ollama。</span></div>`}
  </section>`;
}

function renderFlowPlanStep(mode) {
  const tech = mode === "technical";
  const b = S.breach;
  const pr = S.host.prompt;
  const tplCount = (S.prompts || []).length;
  const promptInfo = pr ? `${fmtNum((pr.text || "").length)} 字符` : "";
  const picked = breachModels();
  const multi = picked.length > 1;
  const firstMeta = (S.models || []).find((m) => m.id === picked[0]) || {};
  const firstSupports = firstMeta.dshPurge === "default" || firstMeta.dshPurge === "supported";
  // 多选模型时不给单一模板：显示「智能匹配」，单选时把该模型的适配情况标在选项上
  const tplField = multi
    ? `<label class="field"><span>破甲模板</span>
        <input type="text" readonly value="智能匹配（${picked.length} 个模型）" data-focus="sTemplateAuto">
        <span class="help">已选 ${picked.length} 个模型：各自按自己的适配出载荷，这里不再指定单一模板。</span>
      </label>`
    : `<label class="field"><span>破甲模板</span>
        ${tplCount
          ? `<select id="sTemplate" data-focus="sTemplate">${S.prompts.map((p) => `<option value="${esc(p.id)}"${p.id === b.template ? " selected" : ""}>${esc(p.name)}${p.id === "sauce-1171" && firstSupports ? "（该模型已支持）" : ""}</option>`).join("")}</select>`
          : `<input type="text" value="none" readonly>`}
        <span class="help">${pr && pr.isBuiltin ? "当前注入的就是这套（与内置默认一致）" : "换模板只影响生成的载荷；宿主里注入的那份在下面第 3 步旁边可以改。"}${promptInfo ? " · 注入正文 " + promptInfo : ""}</span>
      </label>`;
  const rows = [
    tplField,
    `<label class="field"><span>任务类型</span><select id="sPreset" data-focus="sPreset">${optionHtml(S.taskPresets, b.taskPreset)}</select></label>`,
    `<label class="field"><span>输出要求</span><select id="sOutput" data-focus="sOutput">${optionHtml(S.outputChoices, b.outputChoice)}</select></label>`,
  ];
  const extra = "";
  return `<section class="section" aria-labelledby="f-plan-h">
    <h2 id="f-plan-h"><span class="num">2</span>选方案<span class="count">${multi ? "智能匹配" : tplCount + " 套模板"} · ${(S.taskPresets || []).length} 种任务</span></h2>
    <div class="s-choices">${rows.join("")}</div>
    ${extra}
  </section>`;
}

/** 提示词正文编辑器：低频，放在设置页（技术模式主流程不再出现） */
function renderPromptEditor() {
  const h = S.host;
  const pr = h.prompt;
  if (!pr) return "";
  const draft = h.promptDraft != null ? h.promptDraft : (pr.text || "");
  return `<details class="grp" data-group="flow:prompt">
      <summary><span class="grp-title">注入正文（可直接改）</span><span class="grp-hint">${pr.isBuiltin ? "与内置默认一致" : "已被改动"} · ${fmtNum(draft.length)} 字符</span></summary>
      <div class="grp-body">
        <textarea id="hostPrompt" rows="12" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px;width:100%">${esc(draft)}</textarea>
        <div class="actions" style="margin-top:8px">
          <button type="button" class="primary" data-prompt-action="save"${h.promptDirty ? "" : " disabled"}>保存正文</button>
          <button type="button" class="ghost" data-prompt-action="reset">恢复默认正文</button>
          <span class="hint">保存前自动备份；重启 dsh 生效。</span>
        </div>
      </div>
    </details>`;
}

function renderFlowApplyStep() {
  const h = S.host;
  const d = h.data;
  if (!d) return `<section class="section"><h2><span class="num">3</span>注入 / 卸载 / 还原</h2>${spinner("检查宿主状态…")}</section>`;
  if (d.available === false) {
    return `<section class="section"><h2><span class="num">3</span>注入 / 卸载 / 还原</h2>${alertBox("这台机器的宿主侧用不了", (d && d.reason) || "补丁引擎缺失：跑 node scripts/vendor-dsh-engine.mjs 把引擎 vendor 到 web/patch-engine/vendor（本仓库自带，不依赖外部 dsh-purge）。破甲内容仍能生成。")}</section>`;
  }
  const c = d.counts || {};
  const snaps = Array.isArray(d.snapshots) ? d.snapshots : [];
  const busy = h.busy;
  const msg = h.message ? (h.error ? alertBox(h.message, "") : softFailBox(h.message)) : "";
  const pr = h.prompt;
  const draft = h.promptDraft != null ? h.promptDraft : (pr && pr.text) || "";
  // 门禁：演练台没确认授权时只提示、不再禁用按钮。
  // 2026-11-21 实测：dsh-purge 插件没装时 /api/drill 必然返回 granted:false（degraded），
  // 于是「一键注入 / 一键卸载 / 落地」全被 disabled —— 用户点了没反应，看起来就是「安装补丁无效」。
  // 本仓自己做的是宿主补丁引擎（web/patch-engine），不依赖 dsh-purge 的授权文件；门禁留在提示层即可。
  const authorized = !!(h.drill && h.drill.data && h.drill.data.granted);
  const gate = authorized ? "" : `<div class="alert warn" role="alert"><strong>还没在「演练台」确认授权</strong><span class="hint">按钮不会因此变灰；请在演练台确认一次，或自行确认你已获得对这台机器的测试授权。</span></div>`;
  const pend = (kind) => !!(h.pendingAction && h.pendingAction.kind === kind && Date.now() - h.pendingAction.at < 6000);
  // 按钮状态色：空闲(蓝) → 待确认(橙) → 执行中(灰) → 成功(绿)/失败(红，5 秒后回正)
  const btnTone = (kind) => {
    if (h.busy && h.busyKind === kind) return "busy";
    if (pend(kind)) return "warn";
    const r = h.lastResult;
    if (r && r.kind === kind && Date.now() - r.at < 5000) return r.ok ? "success" : "fail";
    return "";
  };
  const busyText = { apply: "注入中…", uninstall: "卸载中…", handoff: "落地中（宿主会重启）…" };
  const warnText = { apply: "再点一次确认注入", uninstall: "再点一次确认卸载", handoff: "再点一次确认落地重启" };
  const toneText = (kind, idle) => {
    const t = btnTone(kind);
    if (t === "busy") return busyText[kind] || "处理中…";
    if (t === "warn") return warnText[kind] || "再点一次确认";
    if (t === "success") return "✓ 已完成";
    if (t === "fail") return "✗ 失败，看下面";
    return idle;
  };
  return `<section class="section" aria-labelledby="f-apply-h">
    <h2 id="f-apply-h"><span class="num">3</span>注入 / 卸载 / 还原
      <span class="count">${d.desktopSealed
        ? `${fmtNum(c.applied || 0)}/${fmtNum(c.total || 0)} 已写入 · ${fmtNum(c.pending || 0)} 待写入 · 未生效（宿主读 app.asar）${c.failed ? ` · ${c.failed} 失败` : ""}${c.na ? ` · ${c.na} 跳过` : ""}`
        : `${fmtNum(c.applied || 0)}/${fmtNum(c.total || 0)} 已注入并生效${c.failed ? ` · ${c.failed} 失败` : ""}`} · 备份 ${snaps.length}</span></h2>
    <div class="actions">
      <button type="button" class="primary ${btnTone("apply")}" data-simple-host="apply" title="点一次就执行：写补丁 → 自动落地（挪走 app.asar）→ 重启宿主。约 3 秒后宿主重启，页面会断开一下"${busy ? " disabled" : ""}>${toneText("apply", "一键注入")}</button>
      <button type="button" class="ghost ${btnTone("uninstall")}" data-simple-host="uninstall" title="点一次就执行：按 app.asar 原件还原宿主 + 清掉解包残留与插件 + 重启宿主"${busy ? " disabled" : ""}>${toneText("uninstall", "一键卸载")}</button>
      <label class="mini" style="display:inline-flex;align-items:center;gap:6px;margin-left:4px">
        <input type="checkbox" data-host-plugin-toggle${h.withPlugin ? " checked" : ""}>
        <span>同时注入 autokill-purge 插件</span>
      </label>
      <span class="hint">点一次就执行：注入 = 写补丁 + 自动落地 + 重启；卸载 = 还原 + 清残留 + 移除插件 + 重启。</span>
    </div>
    ${d.desktopSealed ? `<div class="alert warn" role="alert"><strong>补丁已写入，但宿主还在读 app.asar</strong><span class="hint">点「一键注入」会自动落地（结束宿主 → asar 让位 → 重新拉起），之后才真正生效。</span></div>` : ""}
    ${gate}
    ${msg}
    ${(() => {
      const prog = h.progress;
      if (!prog) return "";
      const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
      const label = prog.done ? (prog.step === "failed" ? "失败" : "完成") : (prog.note || prog.step || "处理中");
      return `<div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <div class="prog-bar"><i style="width:${Math.max(2, pct)}%"></i></div>
        <div class="prog-meta"><span>${Math.round(pct)}% · ${esc(label)}</span>${prog.done ? "" : '<span class="mini">进行中…</span>'}</div>
      </div>`;
    })()}
  </section>`;
}


/* ============================================================ 能力补齐（ops）
   补齐 dsh-purge 的 reapply / rewind / identity / redteam-pack / restart。
   后端走 /api/ops（注册表）+ /api/ops/:id/{status,plan,run}，模块缺失时后端自动降级成一行不可用。 */
function opsState() {
  if (!S.ops) S.ops = { loading: false, loaded: false, error: null, data: null, busy: "", message: {}, lastRun: {} };
  return S.ops;
}

async function loadOps(force = false) {
  const o = opsState();
  if (o.loading) return;
  if (o.loaded && !force) return;
  o.loading = true;
  try {
    const data = await request("/api/ops");
    if (!data || data.ok === false) throw new Error((data && data.error) || "ops 不可用");
    o.data = data;
    o.error = null;
    o.loaded = true;
  } catch (e) {
    o.error = e;
    o.data = null;
  } finally {
    o.loading = false;
    if (S.tab === "breach") renderPage();
  }
}

async function opsAction(id, action) {
  const o = opsState();
  if (o.busy) return;
  const op = ((o.data && o.data.ops) || []).find((x) => x.id === id) || { zh: id };
  if ((action === "run" || action === "run-auto") && typeof window !== "undefined") {
    const label = op.zh || id;
    const heavy = action === "run-auto";
    const text = heavy
      ? "执行「" + label + "」的 auto 步骤？会解包 resources/app 并落地（挪走 app.asar + 重启宿主），当前会话会断。写前自动快照。"
      : "执行「" + label + "」？会按该能力的纪律改盘（写前自动备份/快照），可能重启宿主。";
    if (!window.confirm(text)) return;
  }
  o.busy = id + ":" + action;
  o.message[id] = "";
  renderPage();
  try {
    const body = action === "plan" ? {} : { confirm: true };
    if (action === "run") {
      if (id === "rewind") {
        const pick = (o.pick && o.pick.rewind) || "auto";
        body.sessionId = pick;
        if (pick !== "auto" && o.pickProject && o.pickProject.rewind) body.project = o.pickProject.rewind;
      }
      if (id === "redteam-pack") body.action = (o.pick && o.pick["redteam-pack"]) || "install";
      if (id === "identity") body.apply = true;
      if (id === "reapply") body.auto = action === "run-auto";
    }
    const r = await request("/api/ops/" + id + (action === "plan" ? "/plan" : "/run"), { method: "POST", body });
    if (!r || r.ok === false) throw new Error((r && (r.error || r.summary)) || "调用失败");
    if (action === "plan") {
      const plan = (r.plan && planText(r.plan)) || JSON.stringify(r.plan);
      o.message[id] = "预览：" + plan;
    } else {
      o.message[id] = (r.summary || "完成") + (r.changed ? "（已改动）" : "（无改动）");
      o.lastRun[id] = { at: Date.now(), ok: r.ok !== false };
    }
    toast(action === "plan" ? "预览已生成" : "已执行");
  } catch (e) {
    o.message[id] = simpleReason(e);
    toastError("失败：" + simpleReason(e));
  } finally {
    o.busy = "";
    try { await loadOps(true); } catch { /* 状态刷新失败不影响结果展示 */ }
    renderPage();
  }
}

function planText(plan) {
  if (!plan) return "";
  if (Array.isArray(plan.steps)) return plan.steps.join(" → ");
  if (typeof plan === "string") return plan;
  // 各能力的 plan 结构不同：抓最能说明问题的那几项，别把 JSON 糊到界面上
  const bits = [];
  if (plan.mode) bits.push("模式 " + plan.mode);
  if (plan.sessionId) bits.push("会话 " + String(plan.sessionId).slice(0, 18));
  if (plan.text) bits.push("目标轮：" + (plan.dropTurns ? "退 " + plan.dropTurns + " 轮" : "") + (plan.text ? "「" + String(plan.text).slice(0, 28) + "」" : ""));
  if (plan.dropCount) bits.push("截 " + fmtNum(plan.dropCount) + " 事件");
  if (plan.linesBefore && plan.linesAfter) bits.push(plan.linesBefore + " → " + plan.linesAfter + " 行");
  if (plan.compiled) bits.push("编译 " + fmtNum(plan.compiled.lines) + " 行 / " + fmtNum(plan.compiled.bytes) + "B / sha " + String(plan.compiled.sha256 || "").slice(0, 8));
  if (plan.diff) bits.push("diff +" + fmtNum(plan.diff.added || 0) + " -" + fmtNum(plan.diff.removed || 0));
  if (plan.wouldChange !== undefined) bits.push(plan.wouldChange ? "会变化" : "与当前一致");
  if (plan.pendingWrites !== undefined) bits.push("待写 " + fmtNum(plan.pendingWrites) + " 项");
  if (Array.isArray(plan.todo) && plan.todo.length) bits.push("步骤：" + plan.todo.map((s) => (typeof s === "string" ? s : s.id || s.step || "")).filter(Boolean).join(" → "));
  if (Array.isArray(plan.steps)) bits.push(plan.steps.map((s) => (typeof s === "string" ? s : s.id || "")).filter(Boolean).join(" → "));
  if (bits.filter(Boolean).length) return bits.filter(Boolean).join(" · ");
  try { return JSON.stringify(plan).slice(0, 240); } catch { return ""; }
}

function renderOpsPanel() {
  const o = opsState();
  if (!o.loaded && !o.loading) loadOps();
  const rows = (o.data && o.data.ops) || [];
  const ready = rows.filter((r) => r.available).length;
  // 宿主漂移提示：官方升级 / asar 又回来了 / 补丁被还原（reapply 的判定，别在前端重算）
  const reap = rows.find((r) => r.id === "reapply");
  const rd = (reap && reap.detail) || {};
  const drift = !!(rd.needsReapply || rd.needsRepack || rd.needsHandoff);
  const driftText = drift
    ? [rd.needsHandoff ? "asar 又回来了（补丁不会生效）" : "", rd.needsRepack ? "官方升级过：需要重新解包" : "", rd.needsReapply ? "有补丁待重放" : ""].filter(Boolean).join(" · ")
    : "";
  const total = rows.length || 5;
  const pickSel = (id, value) => ((o.pick && o.pick[id]) || value);
  const body = rows.length
    ? rows.map((r) => {
        const busy = o.busy && o.busy.indexOf(r.id + ":") === 0;
        const msg = o.message[r.id] || "";
        const state = r.available
          ? '<span class="badge ok">可用</span>'
          : '<span class="badge">未就绪</span>';
        // 需要入参的能力：在行内给选择器，避免"点了执行却因为缺参数失败"
        let picker = "";
        const d = r.detail || {};
        if (r.id === "rewind" && Array.isArray(d.sessions) && d.sessions.length) {
          const cur = pickSel("rewind", "auto");
          const opts = d.sessions.filter((s) => s && s.id && (s.rewindable > 0 || s.active))
            .slice(0, 8)
            .map((s) => `<option value="${esc(s.id)}"${s.id === cur ? " selected" : ""}>${esc((s.project || s.id).slice(0, 22))} · ${esc(String(s.title || "").slice(0, 18))}（${s.rewindable || 0} 轮${s.active ? " · 活跃" : ""}）</option>`).join("");
          picker = `<div class="mini" style="margin-top:4px"><select data-ops-pick="rewind" aria-label="选择要回退的会话">
            <option value="auto"${cur === "auto" ? " selected" : ""}>自动（最近可回退）</option>${opts}
          </select></div>`;
        }
        if (r.id === "redteam-pack") {
          const cur = pickSel("redteamPack", "install");
          picker = `<div class="mini" style="margin-top:4px"><select data-ops-pick="redteam-pack" aria-label="选择安装动作">
            <option value="install"${cur === "install" ? " selected" : ""}>安装 / 修复</option>
            <option value="verify"${cur === "verify" ? " selected" : ""}>只校验不写</option>
            <option value="uninstall"${cur === "uninstall" ? " selected" : ""}>卸载</option>
          </select></div>`;
        }
        return `<tr>
          <td><strong>${esc(r.zh || r.id)}</strong><div class="mono small muted">${esc(r.id)}</div></td>
          <td>${state}${r.kind === "read" ? ' <span class="mini">只读</span>' : ""}</td>
          <td class="small">${esc(r.reason || r.summary || "")}${picker}${msg ? `<div class="hint">${esc(msg)}</div>` : ""}</td>
          <td class="actions">
            <button type="button" class="ghost" data-ops-act="plan" data-ops-id="${esc(r.id)}"${busy || !r.available ? " disabled" : ""}>预览</button>
            <button type="button" class="ghost" data-ops-act="run" data-ops-id="${esc(r.id)}"${busy || !r.available || r.kind === "read" ? " disabled" : ""}>${busy ? "执行中…" : "执行"}</button>
            ${r.id === "reapply" ? `<button type="button" class="ghost" data-ops-act="run-auto" data-ops-id="reapply"${busy || !r.available || !(d.needsRepack || d.needsHandoff || d.needsReapply) ? " disabled" : ""} title="解包 + 重放 + 落地（会重启宿主）">解包+落地</button>` : ""}
          </td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">${o.loading ? "探测中…" : (o.error ? esc(simpleReason(o.error)) : "暂无能力模块")}</td></tr>`;
  return `<section class="section" aria-labelledby="f-ops-h">
    <h2 id="f-ops-h"><span class="num">5</span>能力补齐
      <span class="count">${ready}/${total} 就绪 · 对齐 dsh-purge</span></h2>
    <div class="actions">
      <button type="button" class="ghost" data-ops-reload${o.loading ? " disabled" : ""}>${o.loading ? "探测中…" : "重新探测"}</button>
      <span class="hint">reapply 启动重放 · restart 优雅重启 · identity 提示词片段管线 · rewind 会话回溯 · redteam-pack 技能/角色。执行前都有预览，写盘前自动快照。</span>
    </div>
    ${drift ? `<div class="alert warn" role="alert"><strong>宿主需要重放</strong><span class="hint">${esc(driftText)}。安全步骤点「执行」；要解包+落地并重启宿主点「解包+落地」。</span></div>` : ""}
    <div class="table-wrap" tabindex="0" role="region" aria-label="能力补齐清单">
      <table class="min"><thead><tr><th>能力</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>${body}</tbody></table>
    </div>
  </section>`;
}

function appendOpsPanel(page) {
  if (!page) return;
  if (page.querySelector("#f-ops-h")) return;
  const holder = document.createElement("div");
  holder.innerHTML = renderOpsPanel();
  const section = holder.firstElementChild;
  if (!section) return;
  page.appendChild(section);
  bindOpsPanel(section);
}

function bindOpsPanel(root) {
  if (!root) return;
  const reload = root.querySelector("[data-ops-reload]");
  if (reload) reload.addEventListener("click", () => { S.ops && (S.ops.loaded = false); renderPage(); });
  root.querySelectorAll("[data-ops-act]").forEach((el) => {
    el.addEventListener("click", () => opsAction(el.dataset.opsId, el.dataset.opsAct));
  });
  root.querySelectorAll("[data-ops-pick]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const o = opsState();
      o.pick = o.pick || {};
      o.pick[sel.dataset.opsPick] = sel.value;
      if (sel.dataset.opsPick === "rewind") {
        const row = ((o.data && o.data.ops) || []).find((x) => x.id === "rewind");
        const s = ((row && row.detail && row.detail.sessions) || []).find((x) => x.id === sel.value);
        o.pickProject = o.pickProject || {};
        o.pickProject.rewind = (s && s.project) || "";
      }
    });
  });
}

function renderFlowPatchList() {
  const d = S.host.data;
  if (!d || d.available === false) return "";
  const c = d.counts || {};
  // 唯一一份补丁清单（普通模式与技术模式共用）：带勾选，一键注入按这里的选择走。
  // 已写入的不默认勾（重复写没意义），未写入的默认勾上；一个都不勾 = 只补未应用的。
  const rows = (d.patches || []).map((p) => {
    const checked = p.tone === "ok" ? "" : " checked";
    return `<tr>
      <td><input type="checkbox" data-patch-pick="${esc(String(p.id))}"${checked} aria-label="选择补丁 ${esc(String(p.id))}"></td>
      <td>${esc(p.nameZh || "（未收录中文）")}</td>
      <td class="mono small muted">${esc(p.name)}</td>
      <td class="muted small">${esc(p.layer || "")}</td>
      <td>${flowToneBadge(p)}</td>
    </tr>`;
  }).join("");
  return `<section class="section">
    <details class="grp" data-group="flow:patches">
      <summary><span class="grp-title">补丁清单</span>
        <span class="grp-hint">${d.desktopSealed
          ? `${fmtNum(c.applied || 0)} 已写入 · ${fmtNum(c.pending || 0)} 待写入 · 未生效（宿主读 app.asar）${c.failed ? ` · ${c.failed} 失败` : ""}`
          : `${fmtNum(c.applied || 0)} 已注入${c.failed ? ` · ${c.failed} 失败` : ""}${c.na ? ` · ${c.na} 跳过` : ""}`} · 共 ${fmtNum(c.total || 0)} 处</span></summary>
      <div class="grp-body">
        <div class="table-wrap" tabindex="0" role="region" aria-label="补丁清单">
          <table class="min"><thead><tr><th>选</th><th>补丁</th><th>原文</th><th>层</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>
    </details>
  </section>`;
}

/* 原版面板另外三栏：规则集 / 出口白名单 / 技能（都落在 ~/.dsh 下，写前自动备份） */
/* ============================================================ MCP 服务器管理 */
function mcpState() {
  if (!S.mcp) {
    S.mcp = {
      loading: false, loaded: false, error: null, path: "",
      servers: [], test: {}, editor: { open: false, name: "", command: "", args: "", env: "", url: "", note: "" },
      busy: "", message: "",
    };
  }
  return S.mcp;
}

async function loadMcp(force = false) {
  const m = mcpState();
  if (m.loading || (m.loaded && !force)) return;
  m.loading = true;
  m.error = null;
  try {
    const d = await request("/api/mcp");
    if (d && d.ok === false) throw payloadError(d, "读取失败");
    m.servers = (d && d.servers) || [];
    m.path = (d && d.path) || "";
    m.loaded = true;
  } catch (e) {
    m.error = e;
  } finally {
    m.loading = false;
    if (S.tab === "mcp") renderPage();
  }
}

function mcpServers() {
  return mcpState().servers || [];
}

async function mcpSave() {
  const m = mcpState();
  const ed = m.editor;
  if (!String(ed.name || "").trim()) { toastError(L("先写个名字", "Name is required")); return; }
  if (!String(ed.command || "").trim() && !String(ed.url || "").trim()) {
    toastError(L("要么填命令（stdio），要么填 URL（http）", "Provide a command or a URL"));
    return;
  }
  m.busy = "save";
  m.message = "";
  renderPage();
  try {
    const d = await request("/api/mcp/save", {
      method: "POST",
      body: {
        confirm: true, name: ed.name, command: ed.command, args: ed.args, env: ed.env,
        url: ed.url, note: ed.note, enabled: true,
      },
    });
    if (!d || d.ok === false) throw payloadError(d, "保存失败");
    toast(L("已保存", "Saved"));
    m.editor = { open: false, name: "", command: "", args: "", env: "", url: "", note: "" };
    await loadMcp(true);
  } catch (e) {
    m.error = e;
  } finally {
    m.busy = "";
    renderPage();
  }
}

async function mcpTest(name) {
  const m = mcpState();
  m.busy = "test:" + name;
  m.test = Object.assign({}, m.test);
  renderPage();
  try {
    const d = await request("/api/mcp/test", { method: "POST", body: { name: name } });
    m.test[name] = d || { ok: false, error: "empty" };
  } catch (e) {
    m.test[name] = { ok: false, error: simpleReason(e) };
  } finally {
    m.busy = "";
    renderPage();
  }
}

async function mcpDelete(name) {
  const m = mcpState();
  if (!window.confirm(L("删除 " + name + "？（会先备份配置文件）", "Delete " + name + "? (config is backed up first)"))) return;
  m.busy = "del:" + name;
  renderPage();
  try {
    const d = await request("/api/mcp/delete", { method: "POST", body: { confirm: true, name: name } });
    if (!d || d.ok === false) throw payloadError(d, "删除失败");
    delete m.test[name];
    await loadMcp(true);
  } catch (e) {
    m.error = e;
  } finally {
    m.busy = "";
    renderPage();
  }
}

async function mcpCopyExport() {
  try {
    const d = await request("/api/mcp/export");
    if (!d || !d.ok) throw new Error("导出失败");
    await copyText(d.json);
    toast(L("已复制 " + d.count + " 个 server 的 JSON（可粘进 Claude Desktop / Cursor）", "Copied " + d.count + " servers as JSON"));
  } catch (e) { toastError(simpleReason(e)); }
}

function renderMcpPage() {
  const m = mcpState();
  if (!m.loaded && !m.loading) loadMcp();
  const ed = m.editor;
  const rows = mcpServers().map((s) => {
    const t = m.test[s.name];
    const tone = t ? (t.ok ? "good" : "bad") : "";
    const toneText = t
      ? (t.ok ? `${t.toolCount != null ? t.toolCount + " 个工具" : "握手通过"}${t.protocolVersion ? " · " + t.protocolVersion : ""}` : (t.error || "失败"))
      : "未测试";
    return `<div class="s-row">
      <div class="s-row-main">
        <span class="mcp-line"><strong>${esc(s.name)}</strong>${badge(s.transport, "")}${badge(toneText, tone)}${s.enabled ? "" : badge(L("已停用", "disabled"), "warn")}</span>
        <span class="mono small">${esc(s.transport === "http" ? s.url : [s.command].concat(s.args || []).join(" "))}</span>
        ${t && t.ok && (t.tools || []).length ? `<span class="mono small muted">${esc(t.tools.join(" · "))}</span>` : ""}
      </div>
      <div class="actions">
        <button type="button" class="small" data-mcp-test="${esc(s.name)}"${m.busy === "test:" + s.name ? " disabled" : ""}>${m.busy === "test:" + s.name ? "测…" : "测试"}</button>
        <button type="button" class="small" data-mcp-edit="${esc(s.name)}">编辑</button>
        <button type="button" class="small" data-mcp-del="${esc(s.name)}">删除</button>
      </div>
    </div>`;
  }).join("");

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 05</p>
        <h1>MCP</h1>
        <p class="lead">${L(
          "管理本机 MCP 服务器：stdio 命令或 HTTP 端点，保存后可真握手测试（initialize → tools/list），并导出成 Claude Desktop / Cursor 能直接吃的 JSON。",
          "Manage local MCP servers (stdio command or HTTP endpoint). Test does a real handshake (initialize → tools/list) and you can export JSON for Claude Desktop / Cursor.",
        )}</p>
      </div>
      <div class="head-meta">${badge(mcpServers().length + " 个", "")}${badge("配置文件", "accent")}</div>
    </div>

    <section class="section">
      <h2><span class="num">1</span>服务器<span class="count">${esc(m.path || "~/.dsh/mcp-servers.json")}</span></h2>
      ${m.error ? alertBox(L("读取失败", "Failed to read"), simpleReason(m.error)) : ""}
      ${m.loading && !m.loaded ? spinner(L("读取配置…", "Loading…")) : (rows || emptyState(L("还没有 MCP 服务器", "No MCP servers yet"), L("点下面新建一个。", "Create one below.")))}
      <div class="actions" style="margin-top:10px">
        <button type="button" class="primary" data-mcp-new>${ed.open ? L("收起表单", "Hide form") : L("新建 / 编辑", "New / edit")}</button>
        <button type="button" class="ghost" data-mcp-export>${L("复制导出 JSON", "Copy export JSON")}</button>
        <span class="hint">${L("改完要重启 dsh，DSH 侧的 MCP 客户端才会重新读配置。", "Restart dsh afterwards so the MCP client reloads this file.")}</span>
      </div>
    </section>

    ${ed.open ? `<section class="section">
      <h2><span class="num">2</span>${L("新增 / 覆盖", "Create / overwrite")}<span class="count">${esc(ed.name || "未命名")}</span></h2>
      <div class="s-choices">
        <label class="field"><span>${L("名字", "Name")}</span><input id="mcpName" type="text" value="${esc(ed.name)}" placeholder="filesystem"></label>
        <label class="field"><span>${L("stdio 命令", "stdio command")}</span><input id="mcpCommand" type="text" value="${esc(ed.command)}" placeholder="npx"></label>
      </div>
      <label class="field"><span>${L("参数（逗号或换行分隔）", "Args (comma or newline separated)")}</span>
        <textarea id="mcpArgs" rows="3" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(ed.args)}</textarea></label>
      <label class="field"><span>${L("环境变量（每行 K=V）", "Env (K=V per line)")}</span>
        <textarea id="mcpEnv" rows="2" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(ed.env)}</textarea></label>
      <label class="field"><span>${L("或者 HTTP 端点（填了就按 http 传输）", "Or HTTP endpoint (takes precedence)")}</span>
        <input id="mcpUrl" type="text" value="${esc(ed.url)}" placeholder="http://127.0.0.1:3000/mcp"></label>
      <label class="field"><span>${L("备注", "Note")}</span><input id="mcpNote" type="text" value="${esc(ed.note)}" placeholder="${L("给谁用、干什么", "what it is for")}"></label>
      <div class="actions">
        <button type="button" class="primary" data-mcp-save${m.busy === "save" ? " disabled" : ""}>${m.busy === "save" ? L("保存中…", "Saving…") : L("保存", "Save")}</button>
        <button type="button" class="ghost" data-mcp-pretest>${L("先测一下（不保存）", "Test without saving")}</button>
      </div>
      <div id="mcpPreOut">${m.test["__form__"] ? `<p class="mono small">${esc(JSON.stringify(m.test["__form__"]).slice(0, 400))}</p>` : ""}</div>
    </section>` : ""}
  `;
  bindMcp();
}

function bindMcp() {
  const m = mcpState();
  const bindField = (sel, key) => {
    const el = $(sel);
    if (el) el.addEventListener("input", () => { m.editor = Object.assign({}, m.editor, { [key]: el.value }); });
  };
  bindField("#mcpName", "name");
  bindField("#mcpCommand", "command");
  bindField("#mcpArgs", "args");
  bindField("#mcpEnv", "env");
  bindField("#mcpUrl", "url");
  bindField("#mcpNote", "note");
  $$("#page [data-mcp-new]").forEach((el) => el.addEventListener("click", () => {
    m.editor = Object.assign({}, m.editor, { open: !m.editor.open });
    renderPage();
  }));
  $$("#page [data-mcp-save]").forEach((el) => el.addEventListener("click", () => mcpSave()));
  $$("#page [data-mcp-export]").forEach((el) => el.addEventListener("click", () => mcpCopyExport()));
  $$("#page [data-mcp-test]").forEach((el) => el.addEventListener("click", () => mcpTest(el.dataset.mcpTest)));
  $$("#page [data-mcp-del]").forEach((el) => el.addEventListener("click", () => mcpDelete(el.dataset.mcpDel)));
  $$("#page [data-mcp-edit]").forEach((el) => el.addEventListener("click", () => {
    const s = mcpServers().find((x) => x.name === el.dataset.mcpEdit);
    if (!s) return;
    m.editor = {
      open: true, name: s.name, command: s.command,
      args: (s.args || []).join(", "),
      env: Object.entries(s.env || {}).map(([k, v]) => k + "=" + v).join("\n"),
      url: s.url || "", note: s.note || "",
    };
    renderPage();
  }));
  $$("#page [data-mcp-pretest]").forEach((el) => el.addEventListener("click", async () => {
    const ed = m.editor;
    el.disabled = true;
    el.textContent = L("测试中…", "Testing…");
    try {
      const d = await request("/api/mcp/test", {
        method: "POST",
        body: { command: ed.command, args: ed.args, env: ed.env, url: ed.url },
      });
      m.test["__form__"] = d;
    } catch (e) {
      m.test["__form__"] = { ok: false, error: simpleReason(e) };
    } finally {
      renderPage();
    }
  }));
}

/* ============================================================ 独立页：情报巡检 / 演练台 */
function renderIntelPage() {
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  const h = S.host;
  const intel = h.intel || { reports: null, report: null, running: false, days: 7, error: null, last: null };
  const reports = (intel.reports && intel.reports.reports) || [];
  const rows = reports.map((r) => `<div class="s-row">
      <div class="s-row-main"><strong>${esc(r.name)}</strong><span class="mono small">${esc(r.kind || "")} · ${fmtNum(r.bytes)} 字节 · ${esc(r.mtime ? fmtTime(r.mtime) : "")}</span></div>
      <div class="actions"><button type="button" class="small" data-intel-open="${esc(r.name)}">查看</button></div>
    </div>`).join("");
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">INTEL</p>
      <h1>情报巡检</h1>
      <p class="lead">驱动本机 dsh-purge 1.1.71 的巡检：7 个源（Exploit-DB / 吾爱破解 / 看雪 / oss-sec / 先知 / FreeBuf / GitHub Advisory），真实出网，产物落 ~/.dsh/redteam/。</p>
    </div>
    <div class="head-meta">${badge(intel.running ? "巡检中" : "空闲", intel.running ? "" : "accent")}${badge("历史 " + reports.length + " 份", "")}</div></div>

    <section class="section">
      <h2><span class="num">1</span>跑一次巡检</h2>
      <div class="s-choices" style="grid-template-columns:1fr 1fr;align-items:end">
        <label class="field"><span>看近几天</span><select id="intelDays">
          <option value="1"${intel.days === 1 ? " selected" : ""}>近 1 天</option>
          <option value="3"${intel.days === 3 ? " selected" : ""}>近 3 天</option>
          <option value="7"${intel.days === 7 ? " selected" : ""}>近 7 天</option>
        </select></label>
        <div class="actions"><button type="button" class="primary" data-intel-run${intel.running || !(h.drill && h.drill.data && h.drill.data.granted) ? " disabled" : ""}>${intel.running ? "巡检中…" : "跑一次巡检"}</button></div>
      </div>
      <p class="hint">最坏约 3 分钟；未在演练台确认授权时按钮是灰的。</p>
      ${intel.error ? alertBox("巡检失败", simpleReason(intel.error)) : ""}
      ${intel.last ? okBox(intel.last) : ""}
    </section>

    <section class="section">
      <h2><span class="num">2</span>历史报告<span class="count">${reports.length} 份</span></h2>
      ${rows || `<p class="small muted">还没有巡检报告，先跑一次。</p>`}
    </section>

    ${intel.report ? `<section class="section">
      <h2><span class="num">3</span>${esc(intel.report.name)}<span class="count">${fmtNum(intel.report.bytes)} 字节${intel.report.truncated ? " · 已截断" : ""}</span></h2>
      <textarea rows="20" readonly spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px;width:100%">${esc(intel.report.text || "")}</textarea>
    </section>` : ""}
  `;
  bindFlowControls();
}

function renderDrillPage() {
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  const h = S.host;
  const drill = h.drill || { data: null, legal: null, signer: "", busy: false, error: null };
  const dd = drill.data;
  const authorized = !!(dd && dd.granted);
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">DRILL</p>
      <h1>演练台</h1>
      <p class="lead">进入前必须读完声明并确认授权；授权文件与 dsh-purge 1.1.71 是同一个（&lt;DSH_HOME&gt;/dsh-purge/drill-grant.json）。未授权时注入 / 卸载 / 巡检都会被门禁挡住。</p>
    </div>
    <div class="head-meta">${authorized ? badge("已授权", "good") : badge("未授权", "")}${dd && dd.at ? badge(fmtTime(dd.at), "") : ""}</div></div>

    <section class="section">
      <h2><span class="num">1</span>授权状态</h2>
      <div class="s-status ${authorized ? "green" : "yellow"}">
        <div class="s-status-body">
          <strong>${authorized ? "已确认授权" : "还没确认授权"}</strong>
          <span class="s-status-detail">${esc(dd && dd.path ? dd.path : "读取中…")}${authorized && dd.at ? " · 签署于 " + esc(fmtTime(dd.at)) : ""}</span>
        </div>
      </div>
      <label class="field" style="margin-top:10px"><span>签署人（可选，写到旁注文件）</span>
        <input id="drillSigner" type="text" maxlength="80" value="${esc(drill.signer || "")}" placeholder="姓名 / 代号"></label>
      <div class="actions">
        <button type="button" class="primary" data-drill="grant"${drill.busy || authorized ? " disabled" : ""}>确认授权</button>
        <button type="button" class="ghost" data-drill="revoke"${drill.busy || !authorized ? " disabled" : ""}>撤销授权</button>
        <span class="hint">撤销后注入 / 卸载 / 巡检立即变灰。</span>
      </div>
      ${drill.error ? alertBox("授权操作失败", simpleReason(drill.error)) : ""}
    </section>

    <section class="section">
      <h2><span class="num">2</span>法律声明<span class="count">${drill.legal && drill.legal.text ? drill.legal.text.length + " 字符" : "读取中…"}</span></h2>
      <textarea rows="22" readonly spellcheck="false" style="font-family:inherit;font-size:12px;width:100%">${esc((drill.legal && drill.legal.text) || "")}</textarea>
      <p class="hint">原文来自 dsh-purge 1.1.71 的 docs/drill-auth-legal.html（已剥标签）。</p>
    </section>
  `;
  bindFlowControls();
}

function renderFlowExtraPanels() {
  const h = S.host;
  if (!h.data || h.data.available === false) return "";
  const rules = h.rules || { files: [] };
  const ns = h.netScope || { exists: false, text: "", lines: 0 };
  const re = h.ruleEdit || { name: "", text: "" };
  const nsDraft = h.netScopeDraft != null ? h.netScopeDraft : (ns.text || "");

  const ruleRows = (rules.files || []).map((f) => `<div class="s-row">
      <div class="s-row-main"><strong>${esc(f.name)}</strong><span class="mono small">${fmtNum(f.bytes)} 字节 · ${esc(f.mtime ? fmtTime(f.mtime) : "")}</span></div>
      <div class="actions"><button type="button" class="small" data-rule-open="${esc(f.name)}">编辑</button>
        <button type="button" class="small" data-rule-del="${esc(f.name)}">删除</button></div>
    </div>`).join("");

  return `<section class="section">
    <h2><span class="num">3+</span>其他<span class="count">规则 ${(rules.files || []).length} · 白名单 ${ns.lines || 0} 行</span></h2>

    <details class="grp" data-group="extra:rules">
      <summary><span class="grp-title">规则集</span><span class="grp-hint">~/.dsh/rules/*.md · ${(rules.files || []).length} 个${rules.exists ? "" : "（目录还没建，保存时自动建）"}</span></summary>
      <div class="grp-body">
        ${ruleRows || `<p class="small muted">还没有规则文件。</p>`}
        <div class="actions" style="margin:8px 0"><button type="button" class="ghost" data-rule-new>新建规则</button></div>
        <label class="field"><span>文件名</span><input id="ruleName" type="text" value="${esc(re.name)}" placeholder="例：strict.md"></label>
        <label class="field"><span>正文</span><textarea id="ruleText" rows="8" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(re.text)}</textarea></label>
        <div class="actions"><button type="button" class="primary" data-rule-save>保存规则</button><span class="hint">保存前自动备份到 data/host-snapshots/rule-*。</span></div>
      </div>
    </details>

    <details class="grp" data-group="extra:netscope">
      <summary><span class="grp-title">出口白名单</span><span class="grp-hint">~/.dsh/net-scope-allow.txt · ${ns.lines || 0} 行${ns.exists ? "" : "（未设置）"}</span></summary>
      <div class="grp-body">
        <label class="field"><span>每行一个主机 / 网段（原版「自己的服务器」那栏）</span>
          <textarea id="netScopeText" rows="8" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(nsDraft)}</textarea>
        </label>
        <div class="actions"><button type="button" class="primary" data-netscope-save>保存白名单</button><span class="hint">保存前自动备份。</span></div>
      </div>
    </details>
  </section>`;
}

function hostStatusBadge(status) {
  if (status === "written") return badge("已写入 · 未生效", "");
  if (status === "applied") return badge("已应用", "accent");
  if (status === "pending") return badge("待应用", "");
  if (status === "na") return badge("不适用", "");
  if (status === "missing_file") return badge("文件缺失", "");
  return badge(status || "未知", "");
}

function hostCountsLine(d) {
  const c = d.counts || {};
  // 密封包：文件写了但宿主读的是 asar，说「已应用」会让人以为生效了
  if (d.desktopSealed) return `${c.applied || 0}/${c.total || 0} 已写入 · ${c.pending || 0} 待写入 · ${c.na || 0} 不适用 · 未生效（宿主读 app.asar）`;
  return `${c.applied || 0}/${c.total || 0} 已应用 · ${c.pending || 0} 待应用 · ${c.na || 0} 不适用`;
}

function hostBadge() {
  const d = S.host.data;
  if (!d) return badge("宿主破甲 · 检查中", "");
  if (d.available === false) return badge("宿主破甲 · 不可用", "");
  const c = d.counts || {};
  if (d.desktopSealed) return badge(`宿主破甲 ${c.applied || 0}/${c.total || 0} · 未生效`, "");
  return badge(`宿主破甲 ${c.applied || 0}/${c.total || 0}`, c.pending ? "" : "accent");
}

/* ============================================================ 目标宿主：DSH / MengBot */
function mbState() {
  if (!S.mb) S.mb = { tab: "dsh", loading: false, tried: false, status: null, bots: [], payload: null, error: null, message: "", pending: null, busy: null };
  if (!S.mb.tab) S.mb.tab = "dsh";
  return S.mb;
}

async function loadMengbot(force) {
  const mb = mbState();
  if (mb.loading) return;
  if (mb.tried && !force) return;
  mb.loading = true;
  mb.error = null;
  renderPage();
  try {
    const [st, bots, pay] = await Promise.all([
      request("/api/mengbot/status").catch((e) => ({ ok: false, error: e })),
      request("/api/mengbot/bots").catch((e) => ({ ok: false, error: e, bots: [] })),
      request("/api/mengbot/payload").catch(() => ({ ok: false, text: "" })),
    ]);
    mb.status = st;
    mb.bots = Array.isArray(bots.bots) ? bots.bots : [];
    mb.payload = pay && pay.text ? pay.text : "";
    mb.tried = true;
  } catch (e) {
    mb.error = e;
  } finally {
    mb.loading = false;
    renderPage();
  }
}

function renderHostSwitch() {
  const mb = mbState();
  // 宿主唯一入口是顶部切换器（dsh / mengbot / autokill）；这里不再出第二套 tab。
  // autokill 与 dsh 共用同一套宿主机制（同源 DSH 系），只有 mengbot 走 bots.json。
  const target = S.hostTarget === "mengbot" ? "mengbot" : "dsh";
  if (mb.tab !== target) mb.tab = target;
  const onMb = target === "mengbot";
  if (onMb && !mb.tried && !mb.loading) loadMengbot(false);
  const tabs = "";

  if (!onMb) {
    return `<section class="section host-switch" aria-labelledby="h-hostswitch"><h2 id="h-hostswitch" class="sr-only">目标宿主</h2>${tabs}
      <p class="hint">当前宿主：<b>${esc(hostTargetName(S.hostTarget))}</b>（注入 prompt-inject.md + 83 条补丁）。要改 MengBot 的 soul，把顶部宿主切到 MengBot。</p></section>`;
  }

  const st = mb.status || {};
  const running = st.processRunning === true;
  const rows = mb.bots.map((b) => {
    const busy = mb.busy === b.id;
    const pend = mb.pending && mb.pending.id === b.id ? mb.pending.action : null;
    const sizeTone = b.soulBytes > 16000 ? "warn" : (b.soulBytes ? "" : "muted");
    const lock = running ? " disabled" : "";
    return `<tr>
      <td><strong>${esc(b.name || "(无名)")}</strong>${b.title ? `<span class="mini"> ${esc(b.title)}</span>` : ""}</td>
      <td class="num mono ${sizeTone}">${fmtNum(b.soulBytes)} B</td>
      <td>${b.hashOk ? badge("hash 自洽", "good") : badge("hash 不符", "warn")}${b.snapshotCount ? badge("快照 " + b.snapshotCount, "") : ""}</td>
      <td class="mono small">${esc((b.modelSelection && b.modelSelection.model) || "—")}</td>
      <td class="small">${esc(b.approvalMode || (b.autoApprove ? "auto" : "—"))}</td>
      <td class="num">
        ${pend === "inject" ? `<button type="button" class="danger" data-mb-confirm="inject" data-id="${esc(b.id)}"${busy || lock ? " disabled" : ""}>确认改写</button>` : `<button type="button" data-mb-act="inject" data-id="${esc(b.id)}"${busy || lock ? " disabled" : ""}>破甲</button>`}
        ${pend === "restore" ? `<button type="button" class="danger" data-mb-confirm="restore" data-id="${esc(b.id)}"${busy || lock ? " disabled" : ""}>确认还原</button>` : `<button type="button" data-mb-act="restore" data-id="${esc(b.id)}"${busy || lock || !b.snapshotCount ? " disabled" : ""}>还原</button>`}
      </td>
    </tr>`;
  }).join("");

  const runNotice = running
    ? `<div class="card" style="border-color:var(--warn,#d97706);margin-bottom:10px">
        <div class="s-row"><div class="s-row-main">
          <strong>MengBot 正在运行（pid ${esc(String(st.processPid || "在跑"))}）。</strong>
          <span class="hint">它把 bots.json 缓存在内存里，运行中改文件会让进程直接退出（本项目实测过一次：进程消失、8799/8800 断掉）。<b>破甲/还原前先停它，改完再启动。</b></span>
        </div>
        <div class="actions">${mb.pending && mb.pending.id === "svc-stop"
          ? `<button type="button" class="danger" data-mb-svc="stop"${mb.busy ? " disabled" : ""}>确认停止 MengBot</button>`
          : `<button type="button" data-mb-svc="stop"${mb.busy ? " disabled" : ""}>停止 MengBot</button>`}</div></div>
      </div>`
    : `<div class="card" style="border-color:var(--good,#16a34a);margin-bottom:10px">
        <div class="s-row"><div class="s-row-main">
          <strong>MengBot 未运行 —— 可以安全破甲。</strong>
          <span class="hint">改完 soul 后点右边「启动 MengBot」，等 15–25 秒服务就绪即生效。</span>
        </div>
        <div class="actions"><button type="button" data-mb-svc="start"${mb.busy ? " disabled" : ""}>启动 MengBot</button></div></div>
      </div>`;

  return `<section class="section host-switch" aria-labelledby="h-hostswitch">
    <h2 id="h-hostswitch" class="sr-only">目标宿主</h2>${tabs}
    ${runNotice}
    <div class="card soft">
      <div class="s-row"><div class="s-row-main">
        <span class="mcp-line"><strong>MengBot</strong>${st.botsCount ? badge(st.botsCount + " bot", "accent") : ""}${running ? badge("客户端在跑", "warn") : badge("客户端未运行", "good")}${badge("写文件模式", "")}</span>
        <span class="mono small muted">${esc(st.botsFile || "~/.mengbot/bots.json")}</span>
        <span class="hint">${esc(st.whyFile || "写操作走 bots.json + SOUL.md 镜像，重启 MengBot 生效。")}</span>
      </div></div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="MengBot bot 列表" style="margin-top:10px">
        <table class="min"><thead><tr><th>Bot</th><th class="num">soul</th><th>状态</th><th>模型</th><th>权限</th><th class="num">操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">${mb.loading ? "读取中…" : "没有读到 bot"}</td></tr>`}</tbody></table>
      </div>
      <p class="hint">破甲 = 把「执行纪律」拼在原 soul 前面（当前 ${fmtNum(new Blob([mb.payload || ""]).size)} B，上限 24000 B）；每次写入前整份 bots.json 先存快照，可一键还原。<b>改完需重启 MengBot 才生效</b>。</p>
    </div>
    ${mb.error ? alertBox("MengBot 读取失败", simpleReason(mb.error)) : ""}
    ${mb.message ? okBox(mb.message) : ""}
  </section>`;
}

async function mbAct(id, action) {
  const mb = mbState();
  const bot = mb.bots.find((b) => b.id === id);
  if (!bot) return;
  if (!mb.pending || mb.pending.id !== id || mb.pending.action !== action) {
    mb.pending = { id: id, action: action };
    mb.message = "";
    renderPage();
    return;
  }
  mb.pending = null;
  mb.busy = id;
  mb.error = null;
  mb.message = "";
  renderPage();
  try {
    if (action === "inject") {
      const r = await request("/api/mengbot/inject", { method: "POST", body: { confirm: true, id: id, text: mb.payload, mode: "prefix" } });
      if (!r || r.ok === false) throw payloadError(r, "破甲失败");
      mb.message = `${bot.name || id}：soul ${r.before.bytes}B → ${r.after.bytes}B（+${r.addedBytes}B），快照已存。重启 MengBot 生效。`;
    } else {
      const r = await request("/api/mengbot/restore", { method: "POST", body: { confirm: true, id: id } });
      if (!r || r.ok === false) throw payloadError(r, "还原失败");
      mb.message = `${bot.name || id}：已还原 ${fmtNum(r.restoredBytes)}B，hash 一致=${r.hashMatches ? "是" : "否"}。重启 MengBot 生效。`;
    }
    await loadMengbot(true);
  } catch (e) {
    mb.error = e;
  } finally {
    mb.busy = null;
    renderPage();
  }
}

async function mbService(action) {
  const mb = mbState();
  const key = "svc-" + action;
  if (action === "stop" && (!mb.pending || mb.pending.id !== key)) {
    mb.pending = { id: key, action: action };
    mb.message = "";
    renderPage();
    return;
  }
  mb.pending = null;
  mb.busy = key;
  mb.error = null;
  mb.message = "";
  renderPage();
  try {
    const r = await request("/api/mengbot/service", { method: "POST", body: { action: action, confirm: true } });
    if (!r || r.ok === false) throw payloadError(r, action === "stop" ? "停止失败" : "启动失败");
    mb.message = action === "stop"
      ? `MengBot 已停止${r.wasPid ? "（原 pid " + r.wasPid + "）" : ""}，现在可以破甲/还原了。`
      : "已提交启动。若 30 秒仍未就绪，请手动双击桌面 MengBot 图标 —— 从服务进程派生的 Electron 有时会被回收。";
    if (action === "start") setTimeout(() => loadMengbot(true).catch(() => null), 20000);
    else setTimeout(() => loadMengbot(true).catch(() => null), 800);
  } catch (e) {
    mb.error = e;
  } finally {
    mb.busy = null;
    renderPage();
  }
}

function bindHostSwitch() {
  const mb = mbState();
  $$("#page [data-host]").forEach((el) => {
    el.addEventListener("click", () => {
      mb.tab = el.dataset.host === "mengbot" ? "mengbot" : "dsh";
      mb.pending = null;
      renderPage();
    });
  });
  $$("#page [data-mb-act]").forEach((el) => {
    el.addEventListener("click", () => mbAct(el.dataset.id, el.dataset.mbAct));
  });
  $$("#page [data-mb-confirm]").forEach((el) => {
    el.addEventListener("click", () => mbAct(el.dataset.id, el.dataset.mbConfirm));
  });
  $$("#page [data-mb-svc]").forEach((el) => {
    el.addEventListener("click", () => mbService(el.dataset.mbSvc));
  });
}

/* 第一步骨架：注入区 = 现有的宿主区块（补丁自选 + 提示词层 + 快照/还原/恢复出厂）。
   内容一行没搬，只是从「设置」页单独提出来成一区；旧 #/settings 里那块仍然在。 */
function renderInject() {
  const h = S.host;
  if (!h.tried && !h.loading) loadHostStatus();
  const isMb = S.hostTarget === "mengbot";
  const head = `<div class="page-head"><div><p class="eyebrow">INJECT · ${esc(hostTargetName(S.hostTarget))}</p><h1>注入</h1>
    <p class="lead">${isMb
      ? "改 MengBot 的 soul：写 bots.json + SOUL.md 镜像，重启 MengBot 才生效；运行中会先拦你停服务。"
      : "改宿主本身：补丁层（可勾选）+ 提示词层。改完都要重启 dsh 才生效；写入前自动备份，可整份还原。"}</p></div></div>`;
  return head + (isMb ? renderHostSwitch() : renderHostSection());
}

function renderHostSection() {
  const h = S.host;
  if (!h.tried && !h.loading) loadHostStatus();
  const head = `<h2 id="h-host"><span class="num">1</span>清洗 · 宿主破甲（dsh-purge 1.1.71）`;
  if (h.loading && !h.data) return `<section class="section">${head}</h2>${spinner("检查宿主状态…")}</section>`;
  const d = h.data;
  if (h.error && !d) return `<section class="section">${head}</h2>${alertBox("读不到宿主状态", simpleReason(h.error))}</section>`;
  if (!d || (d.available === false && !(d.inventoryAvailable && Array.isArray(d.patches) && d.patches.length))) {
    return `<section class="section">${head}</h2>${alertBox("宿主破甲不可用", (d && d.reason) || "既没有补丁引擎目录，也没有独立补丁清单 catalog.json")}</section>`;
  }
  // 引擎缺席、清单在：只读展示（清单已脱离引擎，这是「不装 dsh-purge 也能看清单」这条）
  if (d.available === false) {
    const cat = d.catalog || {};
    const onlyRows = d.patches.map((p) => `<tr>
        <td class="mono">#${esc(String(p.id))}</td>
        <td>${esc(p.name)}${p.nameZh ? ` <span class="muted">${esc(p.nameZh)}</span>` : ""}</td>
        <td class="muted">${esc(p.layer || "")}</td>
        <td class="muted mono small">${esc(p.files || "")}</td>
        <td class="muted">${esc(p.desc || "")}</td>
        <td>${esc(String(p.replacements || 0))}</td>
      </tr>`).join("");
    return `<section class="section">${head}<span class="count">清单 ${d.patches.length} 条 · 只读</span></h2>
      <div class="card">${alertBox("补丁引擎不在，只能看清单（落盘注入需要引擎目录）", d.reason || "")}</div>
      <div class="card">
        <div class="s-row"><div class="s-row-main"><strong>清单来源</strong><span class="mono">${esc(cat.path || "")}</span></div></div>
        <div class="s-row"><div class="s-row-main"><strong>版本 / 摘要</strong><span>${esc((cat.upstream && cat.upstream.package) || "dsh-purge")} ${esc((cat.upstream && cat.upstream.version) || "")} · ${esc(String(cat.count || d.patches.length))} 条 · <span class="mono">${esc(String(cat.digest || "").slice(0, 16))}…</span></span></div></div>
        <div class="s-row"><div class="s-row-main"><strong>怎么恢复注入</strong><span>引擎缺失时跑 <span class="mono">node scripts/vendor-dsh-engine.mjs</span> 重新 vendor 到 <span class="mono">web/patch-engine/vendor</span>（本仓库自带，不依赖外部 dsh-purge）</span></div></div>
      </div>
      <details open class="s-fold" style="margin-top:10px"><summary>补丁清单 ${d.patches.length} 条（状态未知：没有引擎读不到已注入状态）</summary>
        <div class="table-wrap" tabindex="0" role="region" aria-label="宿主补丁清单（只读）">
          <table class="min"><thead><tr><th>#</th><th>补丁</th><th>层</th><th>目标文件</th><th>说明</th><th>替换对</th></tr></thead><tbody>${onlyRows}</tbody></table>
        </div>
      </details>
    </section>`;
  }
  const b = d.baseline || {};
  const snaps = Array.isArray(d.snapshots) ? d.snapshots : [];
  const patchList = Array.isArray(d.patches) ? d.patches : [];
  const appliedCount = patchList.filter((p) => p.status === "applied").length;
  const rows = patchList.map((p) => `<tr>
      <td><input type="checkbox" data-patch-pick="${esc(String(p.id))}" ${p.status === "applied" ? "" : "checked"} aria-label="选择补丁 #${esc(String(p.id))} ${esc(p.name)}"></td>
      <td class="mono">#${esc(String(p.id))}</td>
      <td>${esc(p.name)}</td>
      <td class="muted">${esc(p.layer || "")}</td>
      <td>${hostStatusBadge(d.desktopSealed && p.status === "applied" ? "written" : p.status)}</td>
    </tr>`).join("");
  const msg = h.message ? (h.error ? alertBox(h.message, "") : softFailBox(h.message)) : "";

  // 原版面板第一栏：注入提示词（可直接改，改完点保存）
  const pr = h.prompt;
  const draft = h.promptDraft != null ? h.promptDraft : (pr && pr.text) || "";
  const promptBlock = pr ? `<div class="card" style="margin-top:10px">
      <div class="s-row"><div class="s-row-main"><strong>注入提示词</strong><span class="mono small">${esc(pr.path)}</span></div>
        ${pr.isBuiltin ? badge("与内置默认一致", "good") : badge("已被改动", "accent")}${badge(fmtNum(draft.length) + " 字符", "")}</div>
      <label class="field"><span class="small muted">正文（这就是注入到系统提示词最前面的那段；改完保存即可）</span>
        <textarea id="hostPrompt" rows="12" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px">${esc(draft)}</textarea>
      </label>
      <div class="actions">
        <button type="button" class="primary" data-prompt-action="save"${h.promptDirty ? "" : " disabled"}>保存提示词</button>
        <button type="button" class="ghost" data-prompt-action="reset">恢复默认提示词</button>
        <span class="hint">保存前自动备份到 data/host-snapshots/prompt-*；重启 dsh 生效。</span>
      </div>
    </div>` : `<p class="small muted" style="margin-top:10px">读不到 prompt-inject.md</p>`;

  // 原版面板其余几栏的现状
  const inv = h.inventory;
  const invRows = inv ? [
    ["技能 skills", inv.skills ? `${inv.skills.files} 篇 · ${inv.skills.path}` : "目录不存在"],
    ["工具库 / 知识库", inv.redteam ? `${fmtNum(inv.redteam.files)} 个文件 · ${inv.redteam.path}` : "目录不存在"],
    ["规则集 rules", inv.rules ? `${inv.rules.files} 个文件` : "目录不存在（原版可新建）"],
    ["出口白名单", inv.netScope ? `${inv.netScope.lines} 行` : "未设置"],
  ].map(([k, v]) => `<div class="s-row"><div class="s-row-main"><strong>${esc(k)}</strong><span class="mono small">${esc(v)}</span></div></div>`).join("") : "";

  return `<section class="section">${head}<span class="count">${esc(hostCountsLine(d))}</span></h2>
    <div class="card">
      <div class="s-row"><div class="s-row-main"><strong>宿主</strong><span>${esc(d.surface || "?")} · ${esc(d.dshHome || "")}</span></div></div>
      <div class="s-row"><div class="s-row-main"><strong>备份基线</strong><span>官方 app.asar ${b.readable ? "可读" : "读不到"} · 已备份快照 ${snaps.length} 份</span></div></div>
      <div class="s-row"><div class="s-row-main"><strong>注入文件</strong><span class="mono">${esc(d.overridePath || "")}（${esc(d.overrideStatus || "")}）</span></div></div>
      ${(() => {
        const cat = d.catalog || {};
        const dr = d.catalogDrift || {};
        const head2 = cat.ok ? `梦神破甲 · 独立 catalog.json · ${fmtNum(cat.count)} 条 · ${String(cat.digest || "").slice(0, 12)}…` : ("清单不可用：" + (cat.reason || "未找到"));
        const tail = dr.comparable ? (dr.same ? "与引擎逐条一致" : `⚠ 与引擎不同源（引擎 ${dr.engineCount} 条 / 清单 ${dr.catalogCount} 条，重跑 patches/extract-catalog.mjs）`) : "";
        return `<div class="s-row"><div class="s-row-main"><strong>补丁清单</strong><span>${esc(head2)}${tail ? " · " + esc(tail) : ""}</span></div></div>`;
      })()}
    </div>
    ${promptBlock}
    <div class="actions" style="margin-top:10px">
      <button type="button" class="primary" data-host-action="snapshot">备份现在</button>
      <button type="button" class="ghost" data-host-action="restore"${snaps.length ? "" : " disabled"}>撤销上一次</button>
      <button type="button" class="ghost" data-host-action="factory">恢复出厂</button>
      <button type="button" class="ghost" data-host-action="apply">应用选中补丁</button>
      <span class="hint">改宿主都要重启 dsh 才生效；若桌面壳仍读 app.asar（顶部有提示），要先「落地并重启宿主」——单重启没用。每次写入前会先自动备份一份。</span>
    </div>
    ${msg}
    ${invRows ? `<div class="card" style="margin-top:10px">${invRows}</div>` : ""}
    <p class="small muted" style="margin-top:8px">「恢复出厂」用官方 app.asar 原件覆盖被改文件（不依赖 .bak，本机实测 .bak 为 0）；「撤销上一次」用最近一份快照覆盖。</p>
    <details class="s-fold" style="margin-top:10px"><summary>补丁清单 ${patchList.length} 条（${d.desktopSealed ? "已写入" : "已应用"} ${appliedCount}${d.desktopSealed ? " · 未生效" : ""}）· 勾选后可只应用选中的</summary>
      <div class="table-wrap" tabindex="0" role="region" aria-label="宿主补丁清单">
        <table class="min"><thead><tr><th>选</th><th>#</th><th>补丁</th><th>层</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </details>
    ${snaps.length ? `<h3 style="margin-top:14px">快照</h3><div class="table-wrap" tabindex="0"><table class="min"><thead><tr><th>快照</th><th>时间</th><th>文件</th><th>字节</th></tr></thead><tbody>${snaps.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(fmtTime(s.at))}</td><td>${fmtNum(s.files)}</td><td>${fmtNum(s.bytes)}</td></tr>`).join("")}</tbody></table></div>` : ""}
  </section>`;
}

async function promptAction(kind) {
  const h = S.host;
  if (h.busy) return;
  const ask = kind === "save"
    ? "把当前编辑的提示词写进宿主的 prompt-inject.md？会先自动备份，改完要重启 dsh 才生效。"
    : "用内置默认（dsh-purge 1.1.71）覆盖宿主提示词？会先自动备份，改完要重启 dsh 才生效。";
  if (!window.confirm(ask)) return;
  h.busy = true;
  h.message = "";
  h.error = null;
  renderPage();
  try {
    const body = { confirm: true };
    if (kind === "save") body.text = h.promptDraft != null ? h.promptDraft : (h.prompt && h.prompt.text) || "";
    const data = await request(kind === "save" ? "/api/host/prompt" : "/api/host/prompt/reset", { method: "POST", body });
    if (!data || data.ok === false) throw payloadError(data, "写提示词失败");
    h.message = (kind === "save" ? "已保存提示词" : "已恢复默认提示词")
      + `（${fmtNum(data.bytes)} 字符）`
      + (data.backup ? "，改前备份：" + data.backup : "")
      + "。重启 dsh 生效。";
    h.promptDraft = null;
    h.promptDirty = false;
    toast("完成");
    S.host.tried = false;
    await loadHostStatus(true);
  } catch (e) {
    h.error = e;
    h.message = simpleReason(e);
  } finally {
    h.busy = false;
    renderPage();
  }
}

async function loadHostStatus(force = false) {
  if (S.host.loading) return S.host.loadPromise || null;
  if (S.host.tried && !force && S.host.data && S.host.prompt) return null;
  S.host.loading = true;
  S.host.loadPromise = (async () => {
    try {
      // 并行取：status 最慢（要扫宿主），其余一起发，别串成 6 次等待
      const [status, prompt0, inventory0, rules0, skills0, netScope0, kbStats0] = await Promise.all([
        request("/api/host/status"),
        request("/api/host/prompt").catch(() => null),
        request("/api/host/inventory").catch(() => null),
        request("/api/host/rules").catch(() => null),
        request("/api/host/skills").catch(() => null),
        request("/api/host/net-scope").catch(() => null),
        request("/api/kb/stats").catch(() => null),
      ]);
      S.host.data = status;
      S.host.error = null;
      S.host.prompt = prompt0 || await request("/api/host/prompt").catch(() => null);
      S.host.inventory = inventory0;
      S.host.rules = rules0;
      S.host.skills = skills0;
      S.host.netScope = netScope0;
      S.host.kb = Object.assign({}, S.host.kb, { stats: kbStats0 || null });
      S.host.intel = Object.assign({}, S.host.intel, { reports: await request("/api/intel/reports").catch(() => null) });
      const [drill0, legal0] = await Promise.all([
        request("/api/drill").catch(() => null),
        S.host.drill && S.host.drill.legal ? Promise.resolve(S.host.drill.legal) : request("/api/drill/legal").catch(() => null),
      ]);
      S.host.drill = Object.assign({}, S.host.drill, { data: drill0 || null, legal: legal0 || null });
    } catch (e) {
      S.host.error = e;
    } finally {
      S.host.loading = false;
      S.host.tried = true;
      // 两种模式都要重绘：首次渲染时宿主状态还没回来，这里是空状态。
      // 但要避开用户正在输入 / 正在生成载荷的瞬间，否则重建 DOM 会打断点击与输入。
      if (S.tab === "breach") {
        const act = document.activeElement;
        const typing = act && /INPUT|TEXTAREA|SELECT/.test(act.tagName);
        setTimeout(() => {
          if (S.tab !== "breach" || S.breach.building || S.host.busy) return;
          renderPage();
        }, typing ? 1000 : 400);
      }
    }
  })();
  return S.host.loadPromise;
}

async function hostAction(kind) {
  if (S.host.busy) return;
  const h = S.host;
  // 补丁自选：勾了哪些就只应用哪些；一条没勾 = 全部（确认文案里写明，避免误操作）
  const pickedPatches = kind === "apply"
    ? $$("#page [data-patch-pick]").filter((el) => el.checked).map((el) => el.dataset.patchPick)
    : [];
  const confirmText = {
    snapshot: "",
    restore: "用最近一份快照覆盖宿主文件？覆盖前会自动再备份一份。改完要重启 dsh 才生效。",
    factory: "用官方 app.asar 原件覆盖被改的宿主文件？覆盖前会自动备份现在。改完要重启 dsh 才生效。",
    apply: pickedPatches.length
      ? `只应用勾选的 ${pickedPatches.length} 条补丁？会改宿主文件；桌面壳仍读 app.asar 时，要落地并重启宿主才生效（单重启没用）。还原只能整份还原（补丁共用 .bak）。`
      : "一条都没勾 → 会应用全部 83 条补丁？会改宿主文件；桌面壳仍读 app.asar 时，要落地并重启宿主才生效（单重启没用）。",
  }[kind];
  if (confirmText && !window.confirm(confirmText)) return;
  h.busy = true;
  h.message = "";
  h.error = null;
  renderPage();
  try {
    let data;
    if (kind === "snapshot") {
      data = await request("/api/host/snapshot", { method: "POST", body: { tag: "manual" } });
      if (!data || data.ok === false) throw payloadError(data, "备份失败");
      h.message = `已备份：${data.snapshot.id}（${fmtNum(data.snapshot.files)} 个文件 / ${fmtNum(data.snapshot.bytes)} 字节）`;
    } else if (kind === "restore") {
      data = await request("/api/host/restore", { method: "POST", body: { confirm: true, mode: "snapshot" } });
      if (!data || data.ok === false) throw payloadError(data, "恢复失败");
      h.message = `已按快照 ${data.restored.id} 覆盖 ${fmtNum(data.restored.restored)} 个文件；覆盖前的状态另存为 ${data.guardSnapshot}。${S.host.data && S.host.data.desktopSealed
        ? "宿主仍从 app.asar 加载：需「落地并重启宿主」才会用上这份内容。"
        : "重启 dsh 生效。"}`;
    } else if (kind === "factory") {
      data = await request("/api/host/factory", { method: "POST", body: { confirm: true } });
      if (!data || data.ok === false) throw payloadError(data, "恢复出厂失败");
      h.message = `已用 asar 原件覆盖 ${fmtNum(data.factory.restored)} 个文件（跳过 ${fmtNum(data.factory.skipped)}）；覆盖前状态另存为 ${data.guardSnapshot}。${data.factory.note ? " " + data.factory.note : ""}`;
    } else if (kind === "apply") {
      data = await request("/api/host/apply", { method: "POST", body: { confirm: true, mode: "apply", patches: pickedPatches } });
      if (!data || data.ok === false) throw payloadError(data, "应用失败");
      const r = data.result || {};
      h.message = `已应用选中 ${fmtNum(r.selected || 0)}/${fmtNum(r.total || 0)} 条：新增 ${fmtNum(r.applied)} 个（${fmtNum(r.already)} 个本来就是最新）。${data.landed
        ? "asar 已让位、宿主已重启，补丁已生效。"
        : (data.handoffRequired
          ? "已写入 resources/app，但桌面壳仍读 app.asar —— 需点「落地并重启宿主」才生效（重启 dsh 没用）。"
          : "补丁已在当前加载的宿主里，重启 dsh 即生效。")}`;
    }
    toast("完成");
    await loadHostStatus(true);
  } catch (e) {
    h.error = e;
    h.message = simpleReason(e);
  } finally {
    h.busy = false;
    renderPage();
  }
}

/* 实时模型识别：来源、当前默认模型、重新识别 */
function renderLiveModelsSection() {
  const lv = S.modelsLive;
  if (!lv) return "";
  const srcRows = (lv.sources || []).map((s) => `<tr>
      <td>${esc(s.kind)}</td>
      <td class="mono small">${esc(s.path || "")}</td>
      <td>${fmtNum(s.models || 0)}</td>
      <td class="muted small">${s.error ? esc(s.error) : (s.mtime ? esc(fmtTime(s.mtime)) : "")}</td>
    </tr>`).join("");
  return `<section class="section"><h2 id="h-live"><span class="num">13</span>实时模型识别<span class="count">${fmtNum(lv.count || 0)} 个 · ${lv.detectedAt ? esc(fmtTime(lv.detectedAt)) : "未识别"}</span></h2>
    <div class="card">
      <div class="s-row"><div class="s-row-main"><strong>当前默认模型</strong><span>${lv.default ? esc((lv.default.provider || "?") + " / " + lv.default.model) : "未识别到"}</span></div></div>
      <div class="s-row"><div class="s-row-main"><strong>识别到的模型</strong><span>${fmtNum(lv.count || 0)} 个（标「实时」的条目就来自这里；静态目录里没有的会追加到模型矩阵）</span></div></div>
    </div>
    <div class="actions" style="margin-top:10px">
      <button type="button" class="ghost" data-live-refresh>重新识别</button>
      <span class="hint">读 ~/.dsh 的 cordis.patch.yml、用量账本与 Ollama（30 秒缓存，点这里强制重扫）。</span>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="实时模型来源">
      <table class="min"><thead><tr><th>来源类型</th><th>路径</th><th>模型数</th><th>时间 / 错误</th></tr></thead><tbody>${srcRows || `<tr><td colspan="4" class="muted">没有可读来源</td></tr>`}</tbody></table>
    </div>
  </section>`;
}

async function refreshLiveModels() {
  try {
    await request("/api/models/live?refresh=1");
    const data = await request("/api/state");
    applyState(data);
    renderPage();
    toast("已重新识别");
  } catch (e) {
    toastError(simpleReason(e));
  }
}

function renderBreach() {
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  const b = S.breach;
  const model = S.models.find((m) => m.id === b.model) || S.models[0] || null;
  const techCount = b.techniques.length;
  const stats = normalizeBreachStats(S.breachStats, S.attempts);
  const pickedModels = breachModels();
  const modelsHtml = S.models.length
    ? `<div class="grid models">${S.models.map((m) => {
      const midx = pickedModels.indexOf(m.id);
      const on = midx >= 0;
      return `<button type="button" class="pick" data-model="${esc(m.id)}" data-focus="model-${esc(m.id)}" aria-pressed="${on}">
        <span class="pick-top"><span class="pick-name">${esc(m.name)}</span>${m.live ? badge("实时", "") : ""}${m.dshDefault ? badge("当前默认", "good") : ""}${m.dshPurge === "default" ? badge("dsh-purge 默认", "accent") : (m.dshPurge === "supported" ? badge("dsh-purge 支持", "") : "")}${on ? (pickedModels.length > 1 ? badge(String(midx + 1), "accent") : badge("已选", "accent")) : ""}</span>
        <span class="pick-note">${esc(m.notes || m.refusal || m.desc || "—")}</span>
        ${m.family ? `<span class="pick-meta">${esc(m.family)}</span>` : ""}
        ${m.live ? `<span class="pick-meta">${esc(m.liveProvider || m.liveSourceType || "")}${m.liveSource ? " · " + esc(m.liveSource) : ""}</span>` : ""}
      </button>`;
    }).join("")}</div>`
    : emptyState("模型目录为空", "服务端 /api/state 没有返回 models[]；确认后端版本与协议契约。");

  const layerHtml = S.layers.length
    ? `<div class="grid three">${S.layers.map((l) => {
      const on = l.id === b.layer;
      return `<button type="button" class="pick layer" data-layer="${esc(l.id)}" data-focus="layer-${esc(l.id)}" aria-pressed="${on}">
        <span class="pick-top"><span class="pick-name">${esc(l.name)}</span>${on ? badge("已选", "accent") : ""}</span>
        <span class="pick-note">${esc(l.desc || "")}</span>
      </button>`;
    }).join("")}</div>`
    : emptyState("突破层为空", "服务端没有返回 layers[]。");

  const techHtml = S.techniques.length
    ? `<div class="tech-bar"><span class="tech-count">可多选 · 已选 <b>${techCount}</b> 项</span><span class="hint">层决定生成策略；参数层只出采样建议。</span></div>
      <div class="chips">${S.techniques.map((t) => {
        const on = b.techniques.includes(t.id);
        return `<button type="button" class="chip" data-tech="${esc(t.id)}" data-focus="tech-${esc(t.id)}" aria-pressed="${on}" title="${esc(t.desc || "")}">
          ${on ? '<span class="tick" aria-hidden="true">✓</span>' : ""}${esc(t.name)}${t.layer ? `<span class="mini">${esc(t.layer)}</span>` : ""}
        </button>`;
      }).join("")}</div>
      <details class="lib"><summary>技术库说明（desc / 适用模型 / 模板）</summary><div class="lib-body">
        ${S.techniques.map((t) => `<article class="tech-item">
          <h3>${esc(t.name)} ${badge(t.layer || "", "")}</h3>
          <p>${esc(t.desc || "—")}</p>
          <p class="small muted">适用模型：${(t.models || []).length ? t.models.map(modelName).map(esc).join("、") : "未限定"}</p>
          ${t.template ? `<pre tabindex="0">${esc(t.template)}</pre>` : ""}
          ${Array.isArray(t.steps) ? `<pre tabindex="0">${esc(t.steps.join("\n\n"))}</pre>` : ""}
        </article>`).join("")}
      </div></details>`
    : emptyState("技术库为空", "服务端没有返回 techniques[]；至少需要 12 项。");

  const modelNote = model
    ? `<div class="inline-note"><strong>当前模型：${esc(model.name)}</strong> —— ${esc(model.notes || model.refusal || model.desc || "服务端没有给拒绝风格说明")}</div>`
    : "";

  const dv = b.deliveryResult;
  const dvBox = dv ? (dv.error ? alertBox("破甲方式没成功", dv.error) : okBox(dv.message)) : "";
  const variantsHtml = b.variants.length
    ? `<div class="payload-list">${b.variants.map((v) => {
      const id = String(v.id || "");
      const encoding = v.encoding || (id.includes("rot13") ? "ROT13" : (id.toLowerCase().includes("base64") ? "Base64" : ""));
      return `<article class="payload">
        <div class="payload-head">
          <div><h3>${esc(v.name || id || "载荷")}</h3><div class="payload-desc">${esc(v.desc || "")}</div></div>
          <div class="badge-row">${v.layer ? badge(v.layer, "") : ""}${encoding ? badge(encoding, "accent") : ""}</div>
        </div>
        <pre tabindex="0">${esc(v.text || "")}</pre>
        <div class="payload-foot"><span class="faint small">${String(v.text || "").length} 字符</span>
          <button type="button" class="small" data-inject-host="${esc(id)}">${S.breach.injectArm === id ? "确认注入宿主？" : "注入宿主"}</button>
          <button type="button" class="small" data-inject-agents="${esc(id)}">${S.breach.agentsArm === id ? "确认写 AGENTS.md？" : "写 AGENTS.md（免重启）"}</button>
          <button type="button" class="small" data-inject-agents-off>撤销指令层</button>
          <button type="button" class="small" data-absorb="${esc(id)}"${S.simple.absorbed[id] ? " disabled" : ""}>${S.simple.absorbed[id] ? "已入库" : "入库"}</button>
          ${copyBtn(v.text || "", "复制载荷")}</div>
      </article>`;
    }).join("")}</div>`
    : b.built
      ? emptyState("服务端没有返回载荷", "生成请求成功，但 variants[] 为空。检查技术选择与后端生成策略；页面不会自己编造载荷。")
      : emptyState("尚未生成载荷", "选择模型、层与技术，写好任务后点「生成载荷」。生成的每条载荷都可以直接复制去测。");

  const adviceHtml = b.built
    ? `<div class="card">
        <h3>采样建议</h3>
        ${b.advice.length ? `<ul>${b.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : `<p class="muted small">服务端没有返回 advice[]。</p>`}
        <div class="inline-note">建议里的 temperature / top_p / 重试次数来自服务端针对当前模型返回的配置；按建议调采样，再对比命中率。</div>
      </div>`
    : emptyState("生成后给出采样建议", "建议来自服务端针对当前模型返回的 advice[]；重试次数与采样参数都在这里。");

  const zeroHtml = b.built
    ? `<div class="card">
        <div class="card-head"><h3>零宽变体样本</h3>${b.zero ? copyBtn(b.zero, "复制样本") : ""}</div>
        ${b.zero ? `<pre class="zero" tabindex="0">${esc(b.zero)}</pre>` : `<p class="muted small">服务端没有返回 zero_wide_sample；不显示本地伪造样本。</p>`}
        <p class="hint" style="margin-top:6px">零宽字符可能不可见，粘贴前确认目标环境是否保留它们。</p>
      </div>`
    : emptyState("生成后给出零宽样本", "零宽变体用来测试目标是否过滤不可见字符；生成一次后出现在这里。");

  const modelOptions = S.models.length
    ? S.models.map((m) => `<option value="${esc(m.id)}" ${m.id === S.attempt.model ? "selected" : ""}>${esc(m.name)}</option>`).join("")
    : `<option value="">没有模型</option>`;
  const techOptions = S.techniques.length
    ? S.techniques.map((t) => `<option value="${esc(t.id)}" ${t.id === S.attempt.technique ? "selected" : ""}>${esc(t.name)}</option>`).join("")
    : `<option value="">没有技术</option>`;
  const resultOptions = RESULTS.map((r) => `<option value="${esc(r.id)}" ${r.id === S.attempt.result ? "selected" : ""}>${esc(r.name)}</option>`).join("");

  const statsHtml = stats.total
    ? `<div class="stat-row">
        <div class="stat"><span class="stat-label">尝试次数</span><strong class="stat-num">${fmtNum(stats.total)}</strong><span class="stat-sub">pass ${fmtNum(stats.pass)} · partial ${fmtNum(stats.partial)}</span></div>
        <div class="stat"><span class="stat-label">通过率</span><strong class="stat-num">${stats.rate}%</strong><span class="stat-sub">通过 / 总次数</span></div>
        <div class="stat"><span class="stat-label">拒答</span><strong class="stat-num">${fmtNum(stats.total - stats.pass - stats.partial)}</strong><span class="stat-sub">result = refused</span></div>
      </div>
      <div class="card-grid-2">
        <div><h3>按模型</h3><div class="table-wrap" tabindex="0" role="region" aria-label="按模型命中"><table class="min"><thead><tr><th>模型</th><th class="num">次数</th><th class="num">通过</th><th class="num">通过率</th></tr></thead><tbody>
          ${statEntries(stats.byModel).map((r) => `<tr><td>${esc(modelName(r.key))}</td><td class="num">${fmtNum(r.total)}</td><td class="num">${fmtNum(r.pass)}</td><td class="num">${rateOf(r.pass, r.total)}%</td></tr>`).join("")}
        </tbody></table></div></div>
        <div><h3>按技术</h3><div class="table-wrap" tabindex="0" role="region" aria-label="按技术命中"><table class="min"><thead><tr><th>技术</th><th class="num">次数</th><th class="num">通过</th><th class="num">通过率</th></tr></thead><tbody>
          ${statEntries(stats.byTech).map((r) => `<tr><td>${esc(techniqueName(r.key))}</td><td class="num">${fmtNum(r.total)}</td><td class="num">${fmtNum(r.pass)}</td><td class="num">${rateOf(r.pass, r.total)}%</td></tr>`).join("")}
        </tbody></table></div></div>
      </div>`
    : emptyState("还没有尝试记录", "每次测完记一条，命中率才有意义。通过率 = pass / 总尝试。");

  const attemptRows = S.attempts.slice(-20).reverse().map((a) => `<tr>
      <td class="mono">${esc(fmtTime(a.at))}</td>
      <td>${esc(modelName(a.model))}</td>
      <td>${esc(techniqueName(a.technique))}</td>
      <td>${badge(resultName(a.result), resultTone(a.result))}</td>
      <td>${esc(a.note || "")}</td>
    </tr>`).join("");

  /* 技术模式：零删减，全部原有块按固定顺序装进 5 组折叠 */
  const baseGroup = `
    <section class="section" aria-labelledby="h-task">
      <h2 id="h-task"><span class="num">4</span>写任务，生成载荷</h2>
      <form id="buildForm" class="card" novalidate>
        <label class="field"><span>任务（必填，要能验收）</span>
          <textarea id="bTask" data-focus="bTask" rows="3" placeholder="例：写一段在授权靶场里验证 SSH 弱口令的步骤，包含命令与验收条件">${esc(b.task)}</textarea>
        </label>
        <div id="buildError">${b.buildError ? alertBox(b.buildError.message, b.buildError.hint) : ""}</div>
        <div style="margin-bottom:10px">${deliverySelectHtml("bDelivery", b)}</div>
        <div class="actions">
          <button class="primary" id="bBuild" type="submit"${b.delivery === "host-patch" ? ' title="写完补丁会顺带落地（挪走 app.asar）并重启桌面宿主——这步会断当前会话"' : ""} ${b.building ? 'disabled aria-busy="true"' : ""}>${b.building ? "生成中…" : (b.delivery === "payload" ? "生成载荷" : "生成并" + (b.delivery === "memory" ? "入库" : (b.delivery === "host-prompt" ? "注入宿主" : "一键注入")))}</button>
          <span class="muted">不调用任何模型；只产出可复制载荷与建议。任务为空时不会发请求。角色与输出要求在「生成策略」里。</span>
        </div>
      </form>
    </section>

    <section class="section" aria-labelledby="h-payload">
      <h2 id="h-payload">载荷<span class="count">${b.variants.length} 条</span></h2>
      ${dvBox}
      ${variantsHtml}
    </section>`;

  const strategyGroup = `
    <section class="section" aria-labelledby="h-layer">
      <h2 id="h-layer"><span class="num">4</span>突破层<span class="count">${S.layers.length} 层</span></h2>
      ${layerHtml}
    </section>

    <section class="section" aria-labelledby="h-tech">
      <h2 id="h-tech"><span class="num">5</span>技术组合<span class="count">${S.techniques.length} 项</span></h2>
      ${techHtml}
    </section>

    <section class="section" aria-labelledby="h-frame">
      <h2 id="h-frame"><span class="num">6</span>角色与输出要求</h2>
      <div class="card">
        <div class="form-grid">
          <label class="field"><span>角色（可选）</span>
            <input id="bRole" data-focus="bRole" type="text" value="${esc(b.role)}" placeholder="在授权靶场里工作的攻防研究员">
            ${fieldDefault("role", b.role, FIELD_DEFAULTS.role)}
            <span class="help">留空则用内置默认角色；写清身份与授权范围更稳。</span>
          </label>
          <label class="field"><span>输出要求（可选）</span>
            <input id="bOutput" data-focus="bOutput" type="text" value="${esc(b.output)}" placeholder="编号步骤 + 每步验收条件">
            ${fieldDefault("output", b.output, FIELD_DEFAULTS.output)}
            <span class="help">留空则用内置默认输出要求（编号步骤）。</span>
          </label>
          <label class="field"><span>破甲模板（可选）</span>
            ${S.prompts.length
              ? `<select id="bTemplate" data-focus="bTemplate">${optionHtml(S.prompts, b.template)}</select>`
              : `<input id="bTemplate" type="text" value="none" readonly>`}
            ${fieldDefault("template", b.template === "sauce-1171" ? "" : b.template, "sauce-1171")}
            <span class="help">默认套「梦神破甲」整段；选「不套模板」只出技术模板。</span>
          </label>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="h-encoding">
      <h2 id="h-encoding"><span class="num">7</span>编码变体</h2>
      <div class="card">
        <p class="muted small">生成时服务端会按技术给出文本 / Base64 / ROT13 等编码变体，每条载荷卡片右上角的徽标就是它的编码方式；零宽变体见「采样」组。</p>
        <div class="badge-row">${b.variants.length ? b.variants.map((v) => badge(v.encoding || "文本", v.encoding ? "accent" : "")).join("") : badge("尚未生成", "")}</div>
      </div>
    </section>`;

  const samplingGroup = `
    <section class="section" aria-labelledby="h-advice">
      <h2 id="h-advice"><span class="num">8</span>采样建议</h2>
      ${adviceHtml}
    </section>
    <section class="section" aria-labelledby="h-zero">
      <h2 id="h-zero"><span class="num">9</span>零宽变体样本</h2>
      ${zeroHtml}
    </section>`;

  const diagGroup = `
    <section class="section" aria-labelledby="h-attempt">
      <h2 id="h-attempt"><span class="num">11</span>尝试记录与命中率<span class="count">${stats.total} 次</span></h2>
      <form id="attemptForm" class="card" novalidate>
        <div class="grid three">
          <label class="field"><span>模型</span><select id="aModel" data-focus="aModel">${modelOptions}</select></label>
          <label class="field"><span>技术</span><select id="aTech" data-focus="aTech">${techOptions}</select></label>
          <label class="field"><span>结果</span><select id="aResult" data-focus="aResult">${resultOptions}</select></label>
        </div>
        <label class="field"><span>备注（版本、轮次、触发点；只写自己的观察）</span>
          <input id="aNote" data-focus="aNote" type="text" maxlength="400" value="${esc(S.attempt.note)}" placeholder="例：v2026-11，第三轮格式约束后给出步骤">
        </label>
        <div id="attemptError">${S.attempt.error ? alertBox(S.attempt.error.message, S.attempt.error.hint) : ""}</div>
        ${S.attempt.ok ? okBox(S.attempt.ok) : ""}
        <div class="actions">
          <button class="primary" type="submit" ${S.attempt.saving ? "disabled" : ""}>${S.attempt.saving ? "保存中…" : "保存记录"}</button>
          <span class="hint">只记录你写的备注，不保存被测模型输出原文。</span>
        </div>
      </form>
      ${statsHtml}
      ${attemptRows ? `<h3 style="margin-top:16px">最近记录</h3><div class="table-wrap" tabindex="0" role="region" aria-label="尝试记录"><table class="min"><thead><tr><th>时间</th><th>模型</th><th>技术</th><th>结果</th><th>备注</th></tr></thead><tbody>${attemptRows}</tbody></table></div>` : ""}
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 01</p>
        <h1>破甲</h1>
        <p class="lead">和技术模式同一条流程：选模型 → 选方案 → 一键注入 → 看补丁清单 → 生成载荷。这里参数全开。</p>
      </div>
      <div class="head-meta">${badge("不调用模型 API", "accent")}${badge("只改副本", "")}${badge("expect 前置校验", "good")}${hostBadge()}</div>
    </div>

    ${renderHostSwitch()}

    ${renderFlowModelStep("technical")}
    ${renderFlowPlanStep("technical")}
    ${renderFlowApplyStep()}
    ${baseGroup}
    ${renderFlowPatchList()}

    ${groupsHtml("breach", [
      { key: "strategy", html: strategyGroup },
      { key: "sampling", html: samplingGroup },
      { key: "paths", html: renderBinarySection() },
      { key: "diag", html: diagGroup },
    ])}
  `;
  bindBreach();
  bindBinary();
  bindHostSwitch();
}

function bindBreach() {
  $$("#page [data-model]").forEach((el) => {
    el.addEventListener("click", () => toggleModel(el.dataset.model));
  });
  $$("#page [data-layer]").forEach((el) => {
    el.addEventListener("click", () => {
      S.breach.layer = el.dataset.layer;
      renderPage();
    });
  });
  $$("#page [data-tech]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.tech;
      S.breach.techniques = S.breach.techniques.includes(id)
        ? S.breach.techniques.filter((x) => x !== id)
        : [...S.breach.techniques, id];
      if (!S.attempt.technique) S.attempt.technique = id;
      renderPage();
    });
  });

  const bdv = $("#bDelivery");
  if (bdv) bdv.addEventListener("change", () => {
    S.breach.delivery = bdv.value;
    S.breach.deliveryResult = null;
    renderPage();
  });
  const bWithEquip = $("#bWithEquip");
  if (bWithEquip) bWithEquip.addEventListener("change", () => { S.breach.withEquip = bWithEquip.checked; });

  const task = $("#bTask");
  if (task) {
    task.addEventListener("input", () => { S.breach.task = task.value; });
    task.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); $("#buildForm").requestSubmit(); }    });
  }
  const role = $("#bRole");
  if (role) role.addEventListener("input", () => { S.breach.role = role.value; });
  const output = $("#bOutput");
  if (output) output.addEventListener("input", () => { S.breach.output = output.value; });
  const tplField = $("#bTemplate");
  bindFlowControls();
  if (tplField) {
    const ev = tplField.tagName === "SELECT" ? "change" : "input";
    tplField.addEventListener(ev, () => { S.breach.template = tplField.value || "none"; });
  }

  const form = $("#buildForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); buildPayload(); });

  const aModel = $("#aModel");
  if (aModel) aModel.addEventListener("change", () => { S.attempt.model = aModel.value; });
  const aTech = $("#aTech");
  if (aTech) aTech.addEventListener("change", () => { S.attempt.technique = aTech.value; });
  const aResult = $("#aResult");
  if (aResult) aResult.addEventListener("change", () => { S.attempt.result = aResult.value; });
  const aNote = $("#aNote");
  if (aNote) aNote.addEventListener("input", () => { S.attempt.note = aNote.value; });

  const aForm = $("#attemptForm");
  if (aForm) aForm.addEventListener("submit", (e) => { e.preventDefault(); saveAttempt(); });
}

async function buildPayload() {
  const b = S.breach;
  b.buildError = null;
  if (!b.task.trim()) {
    b.buildError = { message: "先写任务，再生成载荷。", hint: "任务描述要能验收：做什么、在什么环境、输出什么；空任务不会发请求。" };
    renderPage();
    const task = $("#bTask");
    if (task) task.focus();
    return;
  }
  if (!b.model) {
    b.buildError = { message: "先选一个目标模型。", hint: "模型决定拒绝风格说明与采样建议。" };
    renderPage();
    return;
  }
  if (!b.techniques.length) {
    b.buildError = { message: "至少选 1 项技术。", hint: "技术组合决定载荷的生成策略；可以多选。" };
    renderPage();
    return;
  }
  if (b.building) return;
  b.building = true;
  const btn = $("#bBuild");
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "生成中…"; }
  try {
    const data = await request("/api/breach/build", {
      method: "POST",
      body: {
        model: b.model,
        models: breachModels(),
        layer: b.layer,
        techniques: b.techniques,
        task: b.task.trim(),
        role: b.role.trim(),
        output: b.output.trim(),
        template: b.template || "none",
        scope: b.scope || "full",
      },
    });
    if (!data || data.ok === false) throw payloadError(data, "生成失败");
    const result = data.result || data;
    b.variants = (Array.isArray(result.variants) ? result.variants : []).map(normalizeVariant);
    b.advice = (Array.isArray(result.advice) ? result.advice : []).map(adviceText).filter(Boolean);
    b.zero = result.zero_wide_sample || "";
    b.resultMeta = { model: result.model || b.model, layer: result.layer || b.layer, at: new Date().toISOString() };
    b.built = true;
    if (b.variants.length) {
      S.attempt.model = b.model;
      const first = String(b.variants[0].technique || b.variants[0].id || "").replace(/-(rot13|base64)$/i, "");
      if (first && S.techniques.some((t) => t.id === first)) S.attempt.technique = first;
    }
    // 按「破甲方式」投递（可选先发装备）
    b.deliveryResult = null;
    if (b.variants.length) b.deliveryResult = await runPostBuildActions(b.variants);
  } catch (e) {
    b.buildError = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
  } finally {
    b.building = false;
    renderPage();
  }
}

async function saveAttempt() {
  const a = S.attempt;
  a.error = null;
  a.ok = null;
  if (!a.model) {
    a.error = { message: "先选模型。", hint: "记录必须带 model。" };
    renderPage();
    return;
  }
  if (!a.technique) {
    a.error = { message: "先选技术。", hint: "记录必须带 technique。" };
    renderPage();
    return;
  }
  if (a.saving) return;
  a.saving = true;
  renderPage();
  try {
    const data = await request("/api/breach/attempt", {
      method: "POST",
      body: { model: a.model, technique: a.technique, result: a.result, note: a.note.trim() },
    });
    if (!data || data.ok === false) throw payloadError(data, "保存记录失败");
    const attempt = data.attempt || { model: a.model, technique: a.technique, result: a.result, note: a.note, at: new Date().toISOString() };
    S.attempts.push(attempt);
    S.breachStats = normalizeBreachStats(data.stats, S.attempts);
    a.note = "";
    a.ok = "已记录这次尝试；统计已更新。";
  } catch (e) {
    a.error = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
  } finally {
    a.saving = false;
    renderPage();
  }
}

/* ------------------------------------------------------------------ breach · binary side */
function renderBinarySection() {
  const action = BREAK_ACTIONS.find((a) => a.id === S.bin.action) || BREAK_ACTIONS[0];
  return `<section class="section" aria-labelledby="h-binary">
    <h2 id="h-binary"><span class="num">8</span>二进制侧 · 文件与动作<span class="count">break</span></h2>
    <p class="section-lead">左边选文件与动作，右边给结果与证据。break 只在副本上动手；下刀必须带 <span class="mono">--expect</span>，或走 <span class="mono">invert</span>。页面不提供「任意偏移无校验写入」的入口。</p>
    <div class="split">
      <div class="card">
        <div class="card-head"><h3>输入</h3>${badge("只改副本", "good")}${badge("自动 .bak", "")}</div>
        <div class="field">
          <span>文件路径（服务端本机路径）</span>
          <div class="copy-row">
            <input id="binFile" data-focus="binFile" type="text" value="${esc(S.bin.file)}" spellcheck="false" autocomplete="off" aria-label="break 目标文件路径">
            <button type="button" class="small" id="binSample">填入样例</button>
          </div>
          <span class="help">Web 不上传文件；break 在服务端读取这个路径。相对路径按服务端工作目录解析，样例是 <span class="mono">_smoke/sample.exe</span>。</span>
        </div>

        <div class="field" style="margin-bottom:5px"><span>动作</span></div>
        <div class="action-list" role="group" aria-label="break 动作">
          ${BREAK_ACTIONS.map((a) => `<button type="button" class="action" data-baction="${esc(a.id)}" data-focus="baction-${esc(a.id)}" aria-pressed="${a.id === action.id}" title="${esc(a.desc)}">
            <strong>${esc(a.name)}</strong><span>${esc(a.cmd)}</span>
          </button>`).join("")}
        </div>

        <form id="binActionForm" novalidate>
          ${renderBinForm()}
          <div id="binFormError">${S.bin.formError ? alertBox(S.bin.formError.message, S.bin.formError.hint) : ""}</div>
          <div class="actions">
            <button class="primary" id="binSubmit" type="submit" ${S.bin.busy ? 'disabled aria-busy="true"' : ""} ${action.id === "restore" && !S.bin.restoreConfirm ? "disabled" : ""}>
              ${S.bin.busy ? "执行中…" : BREAK_BTN[action.id]}
            </button>
            <span class="hint">${esc(action.desc)}</span>
          </div>
        </form>
      </div>

      <aside class="card evidence" aria-label="结果与证据">
        <div class="card-head"><h3>结果与证据</h3><span class="badge-row">${S.bin.error ? badge("本次失败", "bad") : (S.bin.evidence.lastAction ? badge("最近 · " + (BREAK_ACTIONS.find((a) => a.id === S.bin.evidence.lastAction) || {}).name, "accent") : badge("尚未执行", ""))}</span></div>
        <div id="binResult">${renderBinResult()}</div>
        <dl class="ev-grid">
          <dt>文件</dt><dd class="mono">${esc(S.bin.evidence.file || S.bin.file || "—")}</dd>
          <dt>sha256 前</dt><dd class="ev-sha">${S.bin.evidence.shaBefore ? `${esc(S.bin.evidence.shaBefore)} <br>${copyBtn(S.bin.evidence.shaBefore, "复制前 sha")}` : "—"}</dd>
          <dt>sha256 后</dt><dd class="ev-sha">${S.bin.evidence.shaAfter ? `${esc(S.bin.evidence.shaAfter)} <br>${copyBtn(S.bin.evidence.shaAfter, "复制后 sha")}` : "—"}</dd>
          <dt>differingBytes</dt><dd>${S.bin.evidence.differingBytes == null ? "—（未验证）" : `<strong>${esc(S.bin.evidence.differingBytes)}</strong> 字节`}</dd>
          <dt>原始 sha</dt><dd class="ev-sha">${S.bin.originalSha ? esc(S.bin.originalSha) : "—（首次 info 后记录）"}</dd>
          <dt>时间</dt><dd>${esc(fmtTime(S.bin.evidence.at))}</dd>
        </dl>
        <div class="ev-actions">
          <button type="button" class="small" data-ev="write">写入字节…</button>
          <button type="button" class="small" data-ev="restore">还原 .bak…</button>
          <button type="button" class="small" data-ev="verify">验证当前差异</button>
        </div>
        <p class="hint">写入与还原都走 break；服务器在写前核对 expect，并维护 <span class="mono">.bak</span> 与 journal。</p>
      </aside>
    </div>
  </section>`;
}

function renderBinForm() {
  const action = S.bin.action;
  const file = S.bin.file || "";
  if (action === "info") {
    return `<div class="inline-note">读取 PE 结构：格式、架构、节表熵、加壳信号与 imageBase。不改文件。</div>`;
  }
  if (action === "scan") {
    return `<div class="form-grid">
      <label class="field span-2"><span>关键词（可选，逗号分隔）</span>
        <input id="binKeywords" data-focus="binKeywords" type="text" value="${esc(S.bin.scanKeywords)}" placeholder="留空使用默认许可词表：licen, serial, activat, trial, verif …">
      </label>
      <label class="field"><span>最少引用次数</span>
        <input id="binMinXrefs" data-focus="binMinXrefs" type="number" min="0" step="1" value="${esc(S.bin.scanMinXrefs)}">
      </label>
    </div>
    <p class="hint">引用点只说明代码读取了该字符串，不证明它就是许可检查。默认词表由 break 提供。</p>`;
  }
  if (action === "plan") {
    return `<label class="field"><span>字符串（可选）</span>
      <input id="binPlanString" data-focus="binPlanString" type="text" value="${esc(S.bin.planString)}" placeholder="只对某条命中做提案；留空处理排名靠前的命中">
    </label>
    <p class="hint">提案只读：给出 offset、期望字节、建议写入与理由。填入下刀前请先复核。</p>`;
  }
  if (action === "patch") {
    const p = S.bin.patch;
    return `${S.bin.notice ? `<div class="alert info" role="status"><strong>${esc(S.bin.notice)}</strong></div>` : ""}
      <div class="form-grid">
        <label class="field"><span>偏移 offset <span class="req">*</span></span>
          <input id="binPatchOffset" data-focus="binPatchOffset" type="text" value="${esc(p.offset)}" placeholder="0xA5638" spellcheck="false">
        </label>
        <label class="field"><span>期望字节 --expect <span class="req">*</span></span>
          <input id="binPatchExpect" data-focus="binPatchExpect" type="text" value="${esc(p.expect)}" placeholder="488D1509AED701" spellcheck="false">
        </label>
      </div>
      <div class="field"><span>写入方式</span>
        <div class="radio-row">
          <label><input type="radio" name="binPatchMode" value="nop" ${p.mode === "nop" ? "checked" : ""}> NOP 填充</label>
          <label><input type="radio" name="binPatchMode" value="write" ${p.mode === "write" ? "checked" : ""}> 指定字节</label>
        </div>
      </div>
      ${p.mode === "nop"
        ? `<label class="field"><span>NOP 长度 <span class="req">*</span></span><input id="binPatchNop" data-focus="binPatchNop" type="number" min="1" step="1" value="${esc(p.nop)}"></label>`
        : `<label class="field"><span>写入字节 <span class="req">*</span></span><input id="binPatchWrite" data-focus="binPatchWrite" type="text" value="${esc(p.write)}" placeholder="90909090909090" spellcheck="false"></label>`}
      <div class="inline-note"><strong>写入前校验：</strong>break 读取 offset 处的实际字节，与 expect 不一致就直接拒绝并返回 <span class="mono">found &lt;HEX&gt; - nothing written</span>；文件 sha 不变。</div>`;
  }
  if (action === "invert") {
    return `<label class="field"><span>偏移 offset <span class="req">*</span></span>
        <input id="binInvertOffset" data-focus="binInvertOffset" type="text" value="${esc(S.bin.invert.offset)}" placeholder="0x1234" spellcheck="false">
      </label>
      <div class="inline-note"><strong>翻转条件跳转：</strong>只接受 74/75、7C/7D、0F 84/85 等条件跳转字节。它是唯一不带 <span class="mono">--expect</span> 的写入路径，但仍然只改副本并保留 .bak。</div>`;
  }
  if (action === "verify") {
    const before = S.bin.verify.before || (file ? file + ".bak" : "");
    const after = S.bin.verify.after || file;
    return `<div class="form-grid">
      <label class="field"><span>原文件（before）<span class="req">*</span></span>
        <input id="binVerifyBefore" data-focus="binVerifyBefore" type="text" value="${esc(before)}" spellcheck="false">
      </label>
      <label class="field"><span>现文件（after）<span class="req">*</span></span>
        <input id="binVerifyAfter" data-focus="binVerifyAfter" type="text" value="${esc(after)}" spellcheck="false">
      </label>
    </div><p class="hint">verify 只读：返回两枚 sha256 与逐字节差异，不改任何文件。</p>`;
  }
  if (action === "restore") {
    return `<div class="inline-note"><strong>还原：</strong>用 <span class="mono">${esc(file + ".bak" || ".bak")}</span> 覆盖当前文件，再复核 sha 是否回到原始值。</div>
      <label class="check"><input type="checkbox" id="binRestoreConfirm" ${S.bin.restoreConfirm ? "checked" : ""}><span>我确认要用 <span class="mono">.bak</span> 覆盖当前文件</span></label>`;
  }
  return "";
}

function renderBinResult() {
  let error = "";
  if (S.bin.error) {
    const e = S.bin.error;
    const mismatch = e.status === 409 || e.code === 3 || e.code === "expect_mismatch" || /nothing written/i.test(String(e.message || ""));
    if (mismatch) {
      const found = S.bin.found || (String(e.message || "").match(/found\s+([0-9a-fA-F]+)/i) || [])[1] || "";
      error = alertBox(
        "expect 与 offset 处的实际字节不一致，写入被拒绝。",
        "文件 sha 未改变。重新跑定性/提案，按服务端读到的字节重填 expect，再下刀。",
        "bad",
        found ? `found ${found.toUpperCase()} - nothing written` : ""
      );
    } else if (e.code === 4 || /not a PE|not PE|MZ signature|DOS header/i.test(String(e.message || ""))) {
      error = alertBox(
        "不是可识别的可执行文件（当前只支持 PE）。",
        e.hint || "换一个 PE 文件；ELF / Mach-O / APK 还没有排期。",
        "bad",
        e.message ? `break: ${e.message}` : ""
      );
    } else {
      error = alertBox(e.message, e.hint, "bad", "");
    }
  }
  if (S.bin.busy) return error + spinner("break 执行中…");
  if (!S.bin.result) return error + (S.bin.error ? "" : emptyState("尚未执行动作", "选文件、选动作，然后执行。结果、sha256 前后、differingBytes 会留在这里。"));
  const r = S.bin.result;
  const d = r.data || {};
  let body = "";
  if (r.kind === "info") body = renderInfoResult(d);
  else if (r.kind === "scan") body = renderScanResult(d);
  else if (r.kind === "plan") body = renderPlanResult(d);
  else if (r.kind === "patch") body = renderPatchResult(d);
  else if (r.kind === "invert") body = renderInvertResult(d);
  else if (r.kind === "verify") body = renderVerifyResult(d);
  else if (r.kind === "restore") body = renderRestoreResult(d);
  return error + body;
}

function renderInfoResult(d) {
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const packers = Array.isArray(d.packerHints) ? d.packerHints.map((x) => typeof x === "string" ? x : (x.name || x.marker || JSON.stringify(x))) : [];
  return `<div class="result-head"><span class="result-title">定性 · info</span><span class="badge-row">${badge(d.format || "格式未提供", d.format ? "accent" : "warn")}${badge(d.machine || "架构未知", "")}${d.dotnet ? badge("CLR / .NET", "warn") : badge("无 CLR", "")}</span></div>
    <dl class="kv compact">
      <dt>imageBase</dt><dd class="mono">${esc(d.imageBase || "—")}</dd>
      <dt>entryRva</dt><dd class="mono">${esc(d.entryRva || "—")}</dd>
      <dt>文件大小</dt><dd>${d.bytes == null ? "服务端未返回" : fmtNum(d.bytes) + " 字节"}</dd>
      <dt>sha256</dt><dd class="ev-sha">${esc(d.sha256 || "—")}</dd>
      <dt>加壳信号</dt><dd>${packers.length ? packers.map((p) => badge(p, "warn")).join(" ") : badge("未命中已知信号", "good")}</dd>
    </dl>
    ${sections.length ? `<div class="table-wrap" tabindex="0" role="region" aria-label="PE 节表"><table class="min"><caption class="sr-only">PE 节表</caption><thead><tr><th>节</th><th class="mono">vaddr</th><th class="mono">rawPtr</th><th class="num">rawSize</th><th class="num">vsize</th><th class="num">熵</th><th>可执行</th></tr></thead><tbody>
      ${sections.map((s) => `<tr><td class="mono">${esc(s.name)}</td><td class="mono">${esc(s.vaddr || "—")}</td><td class="mono">${esc(s.rawPtr || "—")}</td><td class="num">${fmtNum(s.rawSize ?? s.size)}</td><td class="num">${fmtNum(s.vsize)}</td><td class="num">${s.entropy == null ? "—" : esc(s.entropy)}</td><td>${s.executable ? badge("是", "good") : badge("否", "")}</td></tr>`).join("")}
    </tbody></table></div><p class="table-note">共 ${sections.length} 个节。熵越接近 8 越像压缩/加密数据，但不单独证明加壳。</p>` : `<p class="muted small">服务端没有返回 sections[]。</p>`}`;
}

function renderScanResult(d) {
  const hits = Array.isArray(d.hits) ? d.hits : [];
  if (!hits.length) return `<div class="result-head"><span class="result-title">找入口 · scan</span>${badge("0 条命中", "warn")}</div>${emptyState("默认词表没有命中", "换关键词，或把最少引用次数降到 0。命中为空时不代表没有许可逻辑，只代表这组词没有找到字符串。")}`;
  const shown = hits.slice(0, 50);
  return `<div class="result-head"><span class="result-title">找入口 · scan</span><span class="badge-row">${badge(hits.length + " 条命中", "accent")}${badge("按引用次数排序", "")}</span></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="scan 命中"><table class="min"><caption class="sr-only">许可类字符串与代码引用</caption><thead><tr><th>字符串</th><th class="mono">offset</th><th class="num">引用</th><th>引用点</th></tr></thead><tbody>
    ${shown.map((h) => {
      const sites = Array.isArray(h.sites) ? h.sites : [];
      const siteText = sites.slice(0, 4).map(esc).join("<br>") + (sites.length > 4 ? `<br><span class="faint">+${sites.length - 4} 个引用点</span>` : "");
      return `<tr>
      <td class="mono">${esc(h.string || "")}</td>
      <td class="mono">${esc(h.offset || "—")}</td>
      <td class="num">${h.refs ? badge(String(h.refs), "good") : badge("0", "")}</td>
      <td class="mono small">${siteText || "—"}</td>
    </tr>`;
    }).join("")}
    </tbody></table></div>
    ${hits.length > shown.length ? `<p class="table-note">只显示前 ${shown.length} 条，避免一次渲染过大；完整结果在服务端原始响应里。</p>` : ""}
    <p class="table-note">引用点只说明代码读取了该字符串，不证明它就是许可检查；下一步用 proposal 或 AutoKill 确认比较点。</p>`;
}

function confidenceInfo(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const pct = Math.round(value * 100);
    return { label: pct + "%", tone: value >= 0.7 ? "good" : (value >= 0.4 ? "warn" : "bad") };
  }
  const text = String(value ?? "").trim();
  const num = Number(text);
  if (text && Number.isFinite(num) && num <= 1) return confidenceInfo(num);
  return { label: text, tone: /high|高/i.test(text) ? "good" : (/low|低/i.test(text) ? "bad" : "warn") };
}

function renderPlanResult(d) {
  const candidates = Array.isArray(d.candidates) ? d.candidates : [];
  if (!candidates.length) return `<div class="result-head"><span class="result-title">提案 · plan</span>${badge("0 个候选", "warn")}</div>${emptyState("没有可下刀的候选", "先跑 scan；如果命中没有代码引用，break 不会凭空给 offset。")}`;
  return `<div class="result-head"><span class="result-title">提案 · plan</span><span class="badge-row">${badge(candidates.length + " 个候选", "accent")}${badge("只读", "good")}</span></div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="plan 候选"><table class="min"><caption class="sr-only">下刀候选</caption><thead><tr><th class="mono">offset</th><th class="mono">expect</th><th class="mono">建议写入</th><th>理由</th><th>信心</th><th>动作</th></tr></thead><tbody>
    ${candidates.map((c, i) => {
      const conf = confidenceInfo(c.confidence);
      return `<tr>
      <td class="mono">${esc(c.offset || "—")}</td>
      <td class="mono">${c.expect ? esc(c.expect) : badge("缺 expect", "warn")}</td>
      <td class="mono">${esc(c.suggest || "—")}</td>
      <td class="small">${esc(c.reason || "")}</td>
      <td>${conf.label ? badge(conf.label, conf.tone) : "—"}</td>
      <td><button type="button" class="small" data-plan="${i}" ${c.offset ? "" : "disabled"}>填入下刀</button></td>
    </tr>`;
    }).join("")}
    </tbody></table></div>
    <p class="table-note">填入只改表单，不会写入；下刀前仍要复核 expect，并确认 offset 落在副本上。</p>`;
}

function renderPatchResult(d) {
  return `<div class="result-head"><span class="result-title">下刀 · patch</span>${badge("已写入", "good")}</div>
    <dl class="kv compact">
      <dt>offset</dt><dd class="mono">${esc(d.offset || "—")}</dd>
      <dt>服务端读到的字节</dt><dd class="mono">${esc(d.before || "—")}</dd>
      <dt>写入后</dt><dd class="mono">${esc(d.after || "—")}</dd>
      <dt>备份</dt><dd class="mono">${esc(d.backup || "—")}</dd>
      <dt>sha256 前</dt><dd class="ev-sha">${esc(d.shaBefore || "—")}</dd>
      <dt>sha256 后</dt><dd class="ev-sha">${esc(d.shaAfter || "—")}</dd>
    </dl>
    ${renderAutoVerify()}`;
}

function renderInvertResult(d) {
  const semantics = invertSemantics(d.from, d.to);
  return `<div class="result-head"><span class="result-title">翻转 · invert</span>${badge("已写入", "good")}</div>
    <dl class="kv compact">
      <dt>offset</dt><dd class="mono">${esc(d.offset || "—")}</dd>
      <dt>原始字节</dt><dd class="mono">${esc(d.before || d.from || "—")}</dd>
      <dt>翻转后</dt><dd class="mono">${esc(d.after || d.to || "—")}</dd>
      <dt>语义</dt><dd>${semantics ? badge(semantics, "accent") : "—"}</dd>
      <dt>sha256 前</dt><dd class="ev-sha">${esc(d.shaBefore || "—")}</dd>
      <dt>sha256 后</dt><dd class="ev-sha">${esc(d.shaAfter || "—")}</dd>
    </dl>
    ${renderAutoVerify()}`;
}

function renderAutoVerify() {
  if (S.bin.autoVerify) {
    const v = S.bin.autoVerify;
    return `<div class="card soft"><div class="row-between"><h3>自动 verify</h3>${badge(v.differingBytes + " 字节差异", v.differingBytes === 0 ? "good" : "accent")}</div>
      ${renderDiffTable(v.diffs)}</div>`;
  }
  if (S.bin.autoVerifyError) {
    return alertBox("自动 verify 未完成：" + S.bin.autoVerifyError.message, S.bin.autoVerifyError.hint || "确认 .bak 存在，或手动用 verify 动作检查。", "warn");
  }
  return `<p class="hint">写入完成后会自动跑 verify（${esc(S.bin.file)}.bak ↔ ${esc(S.bin.file)}），把 differingBytes 填到证据区。</p>`;
}

function renderVerifyResult(d) {
  const same = d.differingBytes === 0;
  return `<div class="result-head"><span class="result-title">验证 · verify</span>${badge(same ? "文件一致" : d.differingBytes + " 字节差异", same ? "good" : "accent")}</div>
    <dl class="kv compact">
      <dt>before 文件</dt><dd class="mono">${esc(d.beforeFile || "—")}</dd>
      <dt>after 文件</dt><dd class="mono">${esc(d.afterFile || "—")}</dd>
      <dt>sha256 before</dt><dd class="ev-sha">${esc(d.shaBefore || "—")}</dd>
      <dt>sha256 after</dt><dd class="ev-sha">${esc(d.shaAfter || "—")}</dd>
      <dt>differingBytes</dt><dd><strong>${fmtNum(d.differingBytes)}</strong></dd>
    </dl>
    ${renderDiffTable(d.diffs)}`;
}

function renderRestoreResult(d) {
  const matches = S.bin.originalSha && d.sha && d.sha === S.bin.originalSha;
  return `<div class="result-head"><span class="result-title">还原 · restore</span>${matches ? badge("与原始 sha 一致", "good") : badge("已还原，待比对", "warn")}</div>
    <dl class="kv compact">
      <dt>恢复自</dt><dd class="mono">${esc(d.restoredFrom || "—")}</dd>
      <dt>还原后 sha256</dt><dd class="ev-sha">${esc(d.sha || "—")}</dd>
      <dt>原始 sha256</dt><dd class="ev-sha">${esc(S.bin.originalSha || "—（本次会话未记录）")}</dd>
    </dl>
    <p class="hint">还原只覆盖当前文件，不删除 .bak 与 journal；原始 sha 来自本次会话第一次 info 或下刀前的记录。</p>`;
}

function renderDiffTable(diffs) {
  if (!Array.isArray(diffs) || !diffs.length) return `<p class="muted small">没有逐字节差异。</p>`;
  const shown = diffs.slice(0, 120);
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="逐字节差异"><table class="min"><caption class="sr-only">逐字节差异</caption><thead><tr><th class="mono">offset</th><th class="mono">before</th><th class="mono">after</th></tr></thead><tbody>
    ${shown.map((x) => `<tr><td class="mono">${esc(x.offset ?? x.at ?? "—")}</td><td class="mono">${esc(x.before ?? "—")}</td><td class="mono">${esc(x.after ?? "—")}</td></tr>`).join("")}
  </tbody></table></div>${diffs.length > shown.length ? `<p class="table-note">只显示前 ${shown.length} 条差异。</p>` : ""}`;
}

function invertSemantics(from, to) {
  const rawFrom = String(from ?? "").trim();
  const rawTo = String(to ?? "").trim();
  if (!rawFrom && !rawTo) return "";
  if (/[a-z]/i.test(rawFrom) && /[a-z]/i.test(rawTo)) return `${rawFrom.toUpperCase()} → ${rawTo.toUpperCase()}`;
  const names = { "74": "JZ", "75": "JNZ", "7C": "JL", "7D": "JGE", "7E": "JLE", "7F": "JG", "72": "JB", "73": "JAE", "76": "JBE", "77": "JA", "78": "JS", "79": "JNS" };
  const hx = (v) => v.replace(/^0x/i, "").toUpperCase().padStart(2, "0");
  const a = names[hx(rawFrom)];
  const b = names[hx(rawTo)];
  if (a && b) return `${a} → ${b}`;
  return `${rawFrom || "—"} → ${rawTo || "—"}`;
}

function bindBinary() {
  const fileEl = $("#binFile");
  if (fileEl) {
    fileEl.addEventListener("input", () => { S.bin.file = fileEl.value; });
    fileEl.addEventListener("change", () => {
      const next = fileEl.value.trim();
      if (S.bin.evidence.file && next && S.bin.evidence.file !== next) {
        resetBinForFile(next);
        renderPage();
      }
    });
  }
  const sample = $("#binSample");
  if (sample) sample.addEventListener("click", () => {
    S.bin.file = "_smoke/sample.exe";
    resetBinForFile(S.bin.file);
    renderPage();
  });

  $$("#page [data-baction]").forEach((el) => {
    el.addEventListener("click", () => {
      const next = el.dataset.baction;
      if (next === S.bin.action) return;
      S.bin.action = next;
      S.bin.formError = null;
      S.bin.error = null;
      S.bin.found = "";
      S.bin.notice = "";
      if (next === "restore") S.bin.restoreConfirm = false;
      if (next === "verify") {
        S.bin.verify.before = S.bin.verify.before || (S.bin.file ? S.bin.file + ".bak" : "");
        S.bin.verify.after = S.bin.verify.after || S.bin.file;
      }
      renderPage();
    });
  });

  const keywords = $("#binKeywords");
  if (keywords) keywords.addEventListener("input", () => { S.bin.scanKeywords = keywords.value; });
  const minXrefs = $("#binMinXrefs");
  if (minXrefs) minXrefs.addEventListener("input", () => { S.bin.scanMinXrefs = minXrefs.value; });
  const planString = $("#binPlanString");
  if (planString) planString.addEventListener("input", () => { S.bin.planString = planString.value; });

  const pOffset = $("#binPatchOffset");
  if (pOffset) pOffset.addEventListener("input", () => { S.bin.patch.offset = pOffset.value; });
  const pExpect = $("#binPatchExpect");
  if (pExpect) pExpect.addEventListener("input", () => { S.bin.patch.expect = pExpect.value; });
  const pNop = $("#binPatchNop");
  if (pNop) pNop.addEventListener("input", () => { S.bin.patch.nop = pNop.value; });
  const pWrite = $("#binPatchWrite");
  if (pWrite) pWrite.addEventListener("input", () => { S.bin.patch.write = pWrite.value; });
  $$('input[name="binPatchMode"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) { S.bin.patch.mode = el.value; renderPage(); }
    });
  });

  const iOffset = $("#binInvertOffset");
  if (iOffset) iOffset.addEventListener("input", () => { S.bin.invert.offset = iOffset.value; });

  const vBefore = $("#binVerifyBefore");
  if (vBefore) vBefore.addEventListener("input", () => { S.bin.verify.before = vBefore.value; });
  const vAfter = $("#binVerifyAfter");
  if (vAfter) vAfter.addEventListener("input", () => { S.bin.verify.after = vAfter.value; });

  const rc = $("#binRestoreConfirm");
  if (rc) rc.addEventListener("change", () => {
    S.bin.restoreConfirm = rc.checked;
    const btn = $("#binSubmit");
    if (btn) btn.disabled = !rc.checked || S.bin.busy;
  });

  const form = $("#binActionForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); doBreak(); });

  $$("#page [data-plan]").forEach((el) => {
    el.addEventListener("click", () => fillPlan(Number(el.dataset.plan)));
  });

  $$("#page [data-ev]").forEach((el) => {
    el.addEventListener("click", () => {
      const what = el.dataset.ev;
      if (what === "write") {
        S.bin.action = "patch";
        S.bin.formError = null;
        renderPage();
        const target = $("#binPatchOffset");
        if (target) target.focus();
      } else if (what === "restore") {
        S.bin.action = "restore";
        S.bin.restoreConfirm = false;
        S.bin.formError = null;
        renderPage();
        const target = $("#binRestoreConfirm");
        if (target) target.focus();
      } else if (what === "verify") {
        verifyNow();
      }
    });
  });
}

function resetBinForFile(file) {
  S.bin.result = null;
  S.bin.error = null;
  S.bin.found = "";
  S.bin.formError = null;
  S.bin.notice = "";
  S.bin.autoVerify = null;
  S.bin.autoVerifyError = null;
  S.bin.originalSha = "";
  S.bin.evidence = { file, shaBefore: "", shaAfter: "", differingBytes: null, lastAction: "", at: "", beforeFile: "", afterFile: "" };
  S.bin.verify.before = file ? file + ".bak" : "";
  S.bin.verify.after = file;
  S.bin.restoreConfirm = false;
}

function validOffset(value) {
  return /^(0x)?[0-9a-fA-F]+$/.test(String(value || "").trim());
}

function validHexInput(value) {
  const raw = String(value || "").trim();
  if (!raw || !/^[0-9a-fA-F\s]+$/.test(raw)) return false;
  const h = cleanHex(raw);
  return h.length > 0 && h.length % 2 === 0;
}

function validateBin() {
  const action = S.bin.action;
  const file = (S.bin.file || "").trim();
  if (!file) return { message: "先填文件路径。", hint: "服务端按本机路径读取文件；Web 不会上传文件。" };
  if (action === "patch") {
    const p = S.bin.patch;
    if (!validOffset(p.offset)) return { message: "offset 不合法。", hint: "用 0xA5638 或十进制；必须是文件偏移。" };
    if (!validHexInput(p.expect)) return { message: "必须填写合法的 --expect 字节。", hint: "十六进制、偶数长度，例如 488D1509AED701。没有 expect 不允许下刀。" };
    if (p.mode === "nop") {
      const n = Number(p.nop);
      if (!Number.isInteger(n) || n <= 0) return { message: "NOP 长度必须是正整数。", hint: "例如 7，表示写入 7 个 0x90。" };
    } else if (!validHexInput(p.write)) {
      return { message: "写入字节不合法。", hint: "十六进制、偶数长度，例如 90909090909090。也可以切回 NOP 填充。" };
    }
  }
  if (action === "invert" && !validOffset(S.bin.invert.offset)) {
    return { message: "翻转的 offset 不合法。", hint: "用 0x1234 或十进制；必须是条件跳转字节所在的文件偏移。" };
  }
  if (action === "verify") {
    const before = (S.bin.verify.before || (file ? file + ".bak" : "")).trim();
    const after = (S.bin.verify.after || file).trim();
    if (!before || !after) return { message: "verify 需要原文件与现文件两个路径。", hint: "默认是 <file>.bak 与 <file>。" };
    if (before === after) return { message: "before 与 after 不能是同一个文件。", hint: "原文件通常是 .bak，现文件是被 break 改过的副本。" };
  }
  if (action === "restore" && !S.bin.restoreConfirm) {
    return { message: "先勾选还原确认。", hint: "还原会用 .bak 覆盖当前文件；确认后再点按钮。" };
  }
  return null;
}

function binArgs() {
  const action = S.bin.action;
  if (action === "scan") {
    const args = [];
    const kw = S.bin.scanKeywords.trim();
    if (kw) args.push("--keywords", kw);
    const min = String(S.bin.scanMinXrefs || "").trim();
    if (min) args.push("--min-xrefs", min);
    return args;
  }
  if (action === "plan") {
    const s = S.bin.planString.trim();
    return s ? ["--string", s] : [];
  }
  if (action === "patch") {
    const p = S.bin.patch;
    const args = ["--at", p.offset.trim(), "--expect", cleanHex(p.expect)];
    if (p.mode === "nop") args.push("--nop", String(Number(p.nop)));
    else args.push("--write", cleanHex(p.write));
    return args;
  }
  if (action === "invert") return ["--at", S.bin.invert.offset.trim()];
  if (action === "verify") {
    const before = (S.bin.verify.before || (S.bin.file ? S.bin.file + ".bak" : "")).trim();
    const after = (S.bin.verify.after || S.bin.file || "").trim();
    return [after];
  }
  return [];
}

async function doBreak() {
  if (S.bin.busy) return;
  const invalid = validateBin();
  if (invalid) {
    S.bin.formError = invalid;
    S.bin.error = null;
    renderPage();
    return;
  }
  const action = S.bin.action;
  const file = S.bin.file.trim();
  const before = action === "verify" ? (S.bin.verify.before || (file + ".bak")).trim() : file;
  S.bin.formError = null;
  S.bin.error = null;
  S.bin.found = "";
  S.bin.notice = "";
  S.bin.busy = true;
  const btn = $("#binSubmit");
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "执行中…"; }
  const out = $("#binResult");
  if (out) out.innerHTML = spinner("break " + action + " 执行中…");
  try {
    const args = binArgs();
    const { result } = await runBreak(action, before, args);
    const norm = normalizeBreak(action, result, before);
    S.bin.result = { kind: action, data: norm, raw: result, at: new Date().toISOString() };
    applyEvidence(action, norm);
    if (action === "scan" || action === "plan") await ensureFileSha(file);
    if (action === "patch" || action === "invert") await autoVerify(file);
  } catch (e) {
    S.bin.error = e;
    const m = String(e.message || "");
    const found = m.match(/found\s+([0-9a-fA-F]+)/i);
    S.bin.found = found ? found[1].toUpperCase() : "";
    if (isAgreementError(e)) return;
  } finally {
    S.bin.busy = false;
    if (S.tab === "breach") renderPage();
  }
}

async function runBreak(command, file, args = []) {
  let res;
  try {
    res = await fetch("/api/break/run", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ command, file, args }),
    });
  } catch {
    throw new ApiError("无法连接控制台服务", { code: "network", hint: "确认服务端已启动，再重试。", status: 0 });
  }
  const rawText = await res.text();
  let data = null;
  if (rawText) {
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }
  }
  if (!res.ok) {
    const err = errorFrom(data, res.status);
    if (isAgreementError(err)) lockAgreement();
    throw err;
  }
  let result = data && data.result && typeof data.result === "object" && !Array.isArray(data.result) ? data.result : data;
  if ((!result || typeof result !== "object") && data && typeof data.stdout === "string") {
    try { result = JSON.parse(data.stdout); } catch { /* keep */ }
  }
  if (result && result.ok === false) {
    throw errorFrom({ error: result.error || "break_failed", message: result.message || (result.error && result.error.message), hint: result.hint || (result.error && result.error.hint) }, 200);
  }
  if (!result || typeof result !== "object") {
    throw new ApiError("break 返回了无法解析的结果", { code: "bad_response", hint: "看服务端日志与 /api/break/run 的原始响应。", status: 200, data });
  }
  return { data, result };
}

function normalizeBreak(action, r, file) {
  if (action === "info") {
    return {
      file: r.file || file,
      bytes: r.bytes ?? null,
      sha256: r.sha256 || r.sha || "",
      format: r.format || "",
      machine: r.machine || "",
      imageBase: r.imageBase || r.image_base || "",
      entryRva: r.entryRva || r.entry_rva || "",
      dotnet: !!r.dotnet,
      sections: Array.isArray(r.sections) ? r.sections : [],
      packerHints: Array.isArray(r.packerHints) ? r.packerHints : (Array.isArray(r.packingSignals) ? r.packingSignals : (r.packerHints ? ["服务端标记：检测到加壳信号"] : [])),
    };
  }
  if (action === "scan") {
    const raw = Array.isArray(r.hits) ? r.hits : (Array.isArray(r.candidates) ? r.candidates : []);
    const hits = raw.map((h) => {
      const xrefs = Array.isArray(h.xrefs) ? h.xrefs : [];
      const fallbackSites = Array.isArray(h.refSites) ? h.refSites : [];
      const sites = xrefs.length
        ? xrefs.map((x) => typeof x === "string" ? x : [x.fileOffset, x.instruction].filter(Boolean).join(" · "))
        : fallbackSites.map(String);
      const refs = xrefs.length ? xrefs.length : (typeof h.xrefs === "number" ? h.xrefs : Number(h.refs || fallbackSites.length || 0));
      return {
        string: h.string ?? h.text ?? "",
        offset: h.offset ?? h.fileOffset ?? "",
        refs,
        sites,
      };
    });
    return { file: r.file || file, hits, total: r.total ?? hits.length };
  }
  if (action === "plan") {
    const candidates = Array.isArray(r.candidates) ? r.candidates.map((c) => ({
      offset: c.offset ?? c.at ?? "",
      expect: c.expect ?? c.expected ?? "",
      suggest: c.suggest ?? c.write ?? c.suggested ?? "",
      reason: c.reason ?? c.what ?? "",
      confidence: c.confidence ?? "",
    })) : [];
    return { file: r.file || file, candidates };
  }
  if (action === "patch") {
    return {
      file: r.file || file,
      offset: r.offset ?? r.at ?? "",
      before: String(r.before ?? r.from ?? "").toUpperCase(),
      after: String(r.after ?? r.to ?? "").toUpperCase(),
      shaBefore: r.shaBefore || r.sha_before || "",
      shaAfter: r.shaAfter || r.sha_after || "",
      backup: r.backup || "",
    };
  }
  if (action === "invert") {
    return {
      file: r.file || file,
      offset: r.offset ?? r.at ?? "",
      before: String(r.before ?? r.was ?? "").toUpperCase(),
      after: String(r.after ?? r.now ?? "").toUpperCase(),
      from: r.from ?? r.was ?? "",
      to: r.to ?? r.now ?? "",
      shaBefore: r.shaBefore || r.sha_before || "",
      shaAfter: r.shaAfter || r.sha_after || "",
    };
  }
  if (action === "verify") {
    const diffsRaw = Array.isArray(r.diffs) ? r.diffs : [];
    const shaBefore = r.shaBefore || (r.before && r.before.sha256) || "";
    const shaAfter = r.shaAfter || (r.after && r.after.sha256) || "";
    return {
      beforeFile: r.beforeFile || (r.before && r.before.file) || file || "",
      afterFile: r.afterFile || (r.after && r.after.file) || "",
      shaBefore,
      shaAfter,
      differingBytes: r.differingBytes ?? diffsRaw.length ?? 0,
      diffs: diffsRaw.map((x) => ({ offset: x.offset ?? x.at ?? "", before: x.before ?? "", after: x.after ?? "" })),
    };
  }
  if (action === "restore") {
    return { restoredFrom: r.restoredFrom || r.from || "", sha: r.sha || r.sha256 || "", shaBefore: r.shaBefore || r.sha_before || "" };
  }
  return r;
}

function applyEvidence(action, d) {
  const ev = S.bin.evidence || {};
  const file = S.bin.file.trim();
  if (action === "info") {
    ev.file = d.file || file;
    ev.shaBefore = d.sha256 || "";
    ev.shaAfter = "";
    ev.differingBytes = null;
    ev.beforeFile = "";
    ev.afterFile = "";
    if (!S.bin.originalSha && d.sha256) S.bin.originalSha = d.sha256;
  } else if (action === "patch" || action === "invert") {
    ev.file = d.file || file;
    ev.shaBefore = d.shaBefore || ev.shaBefore || "";
    ev.shaAfter = d.shaAfter || "";
    ev.differingBytes = null;
    if (!S.bin.originalSha && d.shaBefore) S.bin.originalSha = d.shaBefore;
  } else if (action === "verify") {
    ev.file = d.afterFile || file;
    ev.shaBefore = d.shaBefore || "";
    ev.shaAfter = d.shaAfter || "";
    ev.differingBytes = d.differingBytes ?? null;
    ev.beforeFile = d.beforeFile || "";
    ev.afterFile = d.afterFile || "";
  } else if (action === "restore") {
    ev.file = file;
    if (d.shaBefore) ev.shaBefore = d.shaBefore;
    ev.shaAfter = d.sha || "";
    ev.differingBytes = S.bin.originalSha && d.sha === S.bin.originalSha ? 0 : null;
  } else {
    ev.file = file;
  }
  ev.lastAction = action;
  ev.at = new Date().toISOString();
  S.bin.evidence = ev;
}

async function ensureFileSha(file) {
  if (S.bin.evidence.file === file && S.bin.evidence.shaBefore) return;
  try {
    const { result } = await runBreak("info", file, []);
    const d = normalizeBreak("info", result, file);
    S.bin.evidence.file = d.file || file;
    S.bin.evidence.shaBefore = d.sha256 || "";
    if (!S.bin.originalSha && d.sha256) S.bin.originalSha = d.sha256;
  } catch {
    /* 证据区保留 —；不把辅助调用失败当成主动作失败 */
  }
}

async function autoVerify(file) {
  S.bin.autoVerify = null;
  S.bin.autoVerifyError = null;
  try {
    const { result } = await runBreak("verify", file + ".bak", [file]);
    const d = normalizeBreak("verify", result, file);
    S.bin.autoVerify = d;
    S.bin.evidence.differingBytes = d.differingBytes;
    S.bin.evidence.shaBefore = d.shaBefore || S.bin.evidence.shaBefore;
    S.bin.evidence.shaAfter = d.shaAfter || S.bin.evidence.shaAfter;
  } catch (e) {
    S.bin.autoVerifyError = e;
  }
}

async function verifyNow() {
  const file = S.bin.file.trim();
  const before = (S.bin.verify.before || (file ? file + ".bak" : "")).trim();
  const after = (S.bin.verify.after || file).trim();
  if (!before || !after || before === after) {
    S.bin.formError = { message: "验证需要两个不同的文件路径。", hint: "默认 before = <file>.bak，after = <file>。" };
    S.bin.action = "verify";
    renderPage();
    return;
  }
  S.bin.busy = true;
  S.bin.error = null;
  const out = $("#binResult");
  if (out) out.innerHTML = spinner("verify 执行中…");
  try {
    const { result } = await runBreak("verify", before, [after]);
    const d = normalizeBreak("verify", result, before);
    S.bin.result = { kind: "verify", data: d, raw: result, at: new Date().toISOString() };
    applyEvidence("verify", d);
  } catch (e) {
    S.bin.error = e;
  } finally {
    S.bin.busy = false;
    if (S.tab === "breach") renderPage();
  }
}

function fillPlan(index) {
  const r = S.bin.result;
  const c = r && r.data && Array.isArray(r.data.candidates) ? r.data.candidates[index] : null;
  if (!c) return;
  S.bin.patch.offset = c.offset || "";
  S.bin.patch.expect = c.expect || "";
  if (c.suggest && /^[0-9a-fA-F\s]+$/.test(String(c.suggest)) && cleanHex(c.suggest).length % 2 === 0) {
    S.bin.patch.mode = "write";
    S.bin.patch.write = cleanHex(c.suggest);
  } else {
    S.bin.patch.mode = "nop";
    S.bin.patch.nop = "7";
  }
  S.bin.action = "patch";
  S.bin.formError = null;
  S.bin.notice = c.expect
    ? "已从提案填入 offset 与 expect；请复核后再下刀。"
    : "已填入 offset，但提案没有 expect；请先补上服务端读到的字节再下刀。";
  renderPage();
  const target = c.expect ? $("#binSubmit") : $("#binPatchExpect");
  if (target) target.focus();
}

/* ------------------------------------------------------------------ equipment */
function equipAgents(forPreview = false) {
  const out = [];
  for (const id of S.equip.agents) {
    if (id === "custom") {
      const name = S.equip.custom.trim();
      if (name) out.push(name);
      else if (forPreview) out.push("custom");
    } else out.push(id);
  }
  return out;
}

/* 选中的装备包（多选，至少一个） */
function equipPresets() {
  const e = S.equip;
  const list = Array.isArray(e.presets) && e.presets.length ? e.presets : (e.preset ? [e.preset] : ["redteam"]);
  return list.filter((id) => PRESETS.some((p) => p.id === id));
}

function equipPresetObjs() {
  const ids = equipPresets();
  return PRESETS.filter((p) => ids.includes(p.id));
}

/* 点装备包：多选 toggle，至少留一个 */
function equipTogglePreset(id) {
  const e = S.equip;
  const cur = equipPresets();
  let next;
  if (cur.includes(id)) {
    if (cur.length === 1) { toastError(L("至少留一个装备包", "Keep at least one pack")); return; }
    next = cur.filter((x) => x !== id);
  } else {
    next = cur.concat([id]);
  }
  e.presets = next;
  e.preset = next[0];
  // 去掉已不存在的包的能力项
  const allowed = new Set();
  for (const p of PRESETS) if (next.includes(p.id)) for (const it of p.items || []) allowed.add(p.id + ":" + it.id);
  e.items = (Array.isArray(e.items) ? e.items : []).filter((k) => allowed.has(k));
  if (!e.items.length) e.items = null; // null = 全选新组合
  e.error = null;
  e.ok = null;
  renderPage();
}

/* 能力项 key = 包id:项id，避免不同包同名项互相覆盖 */
function equipItemKey(presetId, itemId) {
  return presetId + ":" + itemId;
}

function equipAllItemKeys() {
  const out = [];
  for (const p of equipPresetObjs()) for (const it of p.items || []) out.push(equipItemKey(p.id, it.id));
  return out;
}

/* 当前要装的能力项（不勾的不进配置）；items 为 null 时= 全选 */
function equipChosenItems() {
  const all = equipAllItemKeys();
  const e = S.equip;
  if (!Array.isArray(e.items)) return all;
  return e.items.filter((k) => all.includes(k));
}

function equipToggleItem(key) {
  const e = S.equip;
  const cur = equipChosenItems();
  e.items = cur.includes(key) ? cur.filter((x) => x !== key) : cur.concat([key]);
  e.error = null;
  e.ok = null;
  renderPage();
}

/* 装备里的模型（已破甲的模型可以直接带进去） */
function equipModels() {
  return Array.isArray(S.equip.models) ? S.equip.models : [];
}

function equipToggleModel(id) {
  const e = S.equip;
  const cur = equipModels();
  e.models = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat([id]);
  e.error = null;
  e.ok = null;
  renderPage();
}

/* 可选的模型：本机识别到的 + 静态目录，去重；标记破甲支持状态 */
function equipModelCandidates() {
  const all = (S.models || []).filter((m) => m && m.id && !NON_CHAT_MODEL.test(m.id));
  const seen = new Set();
  const out = [];
  for (const m of all) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      id: m.id,
      name: simpleText(m.name || m.id),
      meta: [m.live ? "本机识别" : "", m.dshDefault ? "当前默认" : "",
        m.dshPurge === "default" ? "破甲默认" : (m.dshPurge === "supported" ? "破甲支持" : "")].filter(Boolean).join(" · "),
      cracked: m.dshPurge === "default" || m.dshPurge === "supported",
    });
  }
  return out;
}

/* 预设该带哪几条红队工作流（记忆里的索引卡标题，见 scripts/seed-redteam-memory.mjs） */
const PRESET_WORKFLOWS = {
  redteam: [
    "红队工作流：信息收集（recon）",
    "红队工作流：漏洞发现与打点（vuln-scan）",
    "红队工作流：权限获取与内网突破（exploit → pivot）",
    "红队工作流：战果沉淀与报告（report）",
  ],
  recon: ["红队工作流：信息收集（recon）"],
  lateral: ["红队工作流：权限获取与内网突破（exploit → pivot）"],
  radio: [],
  re: [],
  custom: [],
};

/* 当前装备会加载的技能 + 跟的工作流（跨所有选中包汇总） */
function equipPlan() {
  const chosen = new Set(equipChosenItems());
  const skills = [];
  const workflows = [];
  const items = [];
  for (const p of equipPresetObjs()) {
    for (const it of p.items || []) {
      if (!chosen.has(equipItemKey(p.id, it.id))) continue;
      items.push(equipItemKey(p.id, it.id));
      for (const s of it.skills || []) if (!skills.includes(s)) skills.push(s);
    }
    for (const w of PRESET_WORKFLOWS[p.id] || []) if (!workflows.includes(w)) workflows.push(w);
  }
  return { presets: equipPresets(), items: items, skills: skills, workflows: workflows, models: equipModels() };
}

function equipConfig(item) {
  if (item) {
    const presets = Array.isArray(item.presets) && item.presets.length ? item.presets : (item.preset ? [item.preset] : ["redteam"]);
    const objs = PRESETS.filter((p) => presets.includes(p.id));
    const chosen = Array.isArray(item.items) && item.items.length ? item.items : objs.reduce((acc, p) => acc.concat((p.items || []).map((it) => equipItemKey(p.id, it.id))), []);
    const skills = [];
    const workflows = [];
    for (const p of objs) {
      for (const it of p.items || []) {
        if (!chosen.includes(equipItemKey(p.id, it.id))) continue;
        for (const s of it.skills || []) if (!skills.includes(s)) skills.push(s);
      }
      for (const w of PRESET_WORKFLOWS[p.id] || []) if (!workflows.includes(w)) workflows.push(w);
    }
    return {
      presets: presets,
      agents: Array.isArray(item.agents) ? item.agents : [],
      permissions: item.permissions || "read-only",
      items: chosen,
      skills: skills,
      workflows: workflows,
      models: Array.isArray(item.models) ? item.models : [],
      memory_endpoint: "/api/assign/<agent>.md",
      notes: item.notes || "",
    };
  }
  const plan = equipPlan();
  return {
    presets: plan.presets,
    agents: equipAgents(true),
    permissions: S.equip.permissions,
    items: plan.items,
    skills: plan.skills,
    workflows: plan.workflows,
    models: plan.models,
    memory_endpoint: "/api/assign/<agent>.md",
    notes: S.equip.notes,
  };
}

function permissionName(id) {
  const p = PERMISSIONS.find((x) => x.id === id);
  return p ? p.name : id || "—";
}

function presetName(id) {
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.name : id || "—";
}

function renderEquip() {
  const e = S.equip;
  const config = equipConfig();
  const customSelected = e.agents.includes("custom");
  const activePresets = equipPresets();
  const chosenKeys = equipChosenItems();
  // 包多选：卡片显示序号
  const presetCards = PRESETS.map((p) => {
    const idx = activePresets.indexOf(p.id);
    const on = idx >= 0;
    return `<button type="button" class="pick" data-preset="${esc(p.id)}" data-focus="preset-${esc(p.id)}" aria-pressed="${on}">
      <span class="pick-top"><span class="pick-name">${esc(p.name)}</span>${on ? badge(activePresets.length > 1 ? String(idx + 1) : "已选", "accent") : ""}</span>
      <span class="pick-note">${esc(p.desc)}</span>
    </button>`;
  }).join("");
  // 能力项按包分页展示（每个选中的包一页）
  const itemGroups = equipPresetObjs().map((p) => {
    const items = p.items || [];
    const picked = items.filter((it) => chosenKeys.includes(equipItemKey(p.id, it.id)));
    return {
      preset: p,
      total: items.length,
      picked: picked.length,
      cards: items.map((it) => {
        const key = equipItemKey(p.id, it.id);
        const on = chosenKeys.includes(key);
        return `<button type="button" class="pick" data-equip-item="${esc(key)}" data-focus="eitem-${esc(key)}" aria-pressed="${on}">
          <span class="pick-top"><span class="pick-name">${esc(it.name)}</span>${on ? badge("装", "accent") : ""}</span>
          <span class="pick-note">${esc(it.desc)}</span>
          ${(it.skills || []).length ? `<span class="pick-meta">${esc((it.skills || []).join(" · "))}</span>` : ""}
        </button>`;
      }).join(""),
    };
  });
  const modelCands = equipModelCandidates();
  const pickedModels = equipModels();

  const agentItems = AGENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc })).concat([{ id: "custom", name: "自定义", desc: "输入另一个本机智能体的名字。" }]);
  const agentCards = agentItems.map((a) => {
    const on = e.agents.includes(a.id);
    return `<button type="button" class="pick compact" data-agent="${esc(a.id)}" data-focus="agent-${esc(a.id)}" aria-pressed="${on}">
      <span class="pick-top"><span class="pick-name">${esc(a.name)}</span>${on ? badge("已选", "accent") : ""}</span>
      <span class="pick-note">${esc(a.desc)}</span>
    </button>`;
  }).join("");

  const permCards = PERMISSIONS.map((p) => {
    const on = p.id === e.permissions;
    return `<label class="pick compact ${on ? "on" : ""}" data-focus="perm-${esc(p.id)}">
      <span class="pick-top"><span class="pick-name"><input type="radio" name="equipPerm" value="${esc(p.id)}" ${on ? "checked" : ""} style="accent-color:var(--accent);margin-right:7px">${esc(p.name)}</span>${on ? badge("已选", "accent") : ""}</span>
      <span class="pick-note">${esc(p.desc)}</span>
    </label>`;
  }).join("");

  // 按当前宿主过滤发放历史（装备记录里 agents[] 标明给谁）
  const hostEquip = S.equipment.filter((x) => Array.isArray(x.agents) && x.agents.includes(S.hostTarget));
  const history = hostEquip.slice().reverse().slice(0, 20);
  const historyHtml = history.length
    ? `<div class="table-wrap" tabindex="0" role="region" aria-label="发放历史"><table class="min"><caption class="sr-only">装备发放历史</caption><thead><tr><th>时间</th><th>装备包</th><th>智能体</th><th>权限</th><th>备注</th><th>操作</th></tr></thead><tbody>
      ${history.map((it) => `<tr>
        <td class="mono nowrap">${esc(fmtTime(it.at))}</td>
        <td>${esc(((Array.isArray(it.presets) && it.presets.length) ? it.presets : [it.preset]).map(presetName).join(' / '))}</td>
        <td class="mono">${esc((it.agents || []).join(", ") || "—")}</td>
        <td>${badge(permissionName(it.permissions), it.permissions === "full" ? "bad" : (it.permissions === "controlled" ? "warn" : "good"))}</td>
        <td class="small">${esc(it.notes || "—")}</td>
        <td>${copyBtn(JSON.stringify(equipConfig(it), null, 2), "复制单条")}</td>
      </tr>`).join("")}
    </tbody></table></div><p class="table-note">复制内容与上面的配置预览使用同一组键：preset / agents / permissions / memory_endpoint / notes。</p>`
    : emptyState("还没有发放记录", "选好装备包、智能体与权限档后点「发放装备」，历史会出现在这里。");

  const baseGroup = `
    <section class="section" aria-labelledby="h-preset">
      <h2 id="h-preset"><span class="num">1</span>装备包<span class="count">${PRESETS.length} 个</span></h2>
      <div class="grid presets">${presetCards}</div>
    </section>

    <section class="section" aria-labelledby="h-items">
      <h2 id="h-items"><span class="num">1+</span>装备哪些能力<span class="count">${chosenKeys.length} / ${equipAllItemKeys().length} 项 · ${itemGroups.length} 页</span></h2>
      ${itemGroups.length
        ? `<p class="hint">每个选中的装备包一页；勾选后才装，不勾的不进配置。每项后面是它会加载的技能。</p>
          ${itemGroups.filter((g) => g.total).map((g) => `<div class="equip-page">
            <div class="equip-page-head"><strong>${esc(g.preset.name)}</strong><span class="mono small">${g.picked} / ${g.total} 项</span>
              <span class="spacer"></span>
              <button type="button" class="small" data-equip-page-all="${esc(g.preset.id)}">本页全选</button>
              <button type="button" class="small" data-equip-page-none="${esc(g.preset.id)}">本页清空</button>
            </div>
            <div class="grid models">${g.cards}</div>
          </div>`).join("")}
          <div class="actions" style="margin-top:8px">
            <button type="button" class="ghost" data-equip-all>全部全选</button>
            <button type="button" class="ghost" data-equip-none>全部清空</button>
          </div>`
        : `<p class="hint">选中的包都没有预置能力项（自定义包请在备注里写清要装什么）。</p>`}
      ${equipPlan().skills.length ? `<div class="card soft" style="margin-top:10px">
        <div class="s-row"><div class="s-row-main"><strong>这套会加载 ${equipPlan().skills.length} 个技能</strong>
          <span class="mono small">${esc(equipPlan().skills.join(" · "))}</span></div></div>
        ${equipPlan().workflows.length ? `<div class="s-row"><div class="s-row-main"><strong>跟这 ${equipPlan().workflows.length} 条工作流</strong>
          <span class="mono small">${esc(equipPlan().workflows.join(" · "))}</span></div></div>` : ""}
        ${config.models.length ? `<div class="s-row"><div class="s-row-main"><strong>带这 ${config.models.length} 个模型</strong>
          <span class="mono small">${esc(config.models.join(" · "))}</span></div></div>` : ""}
        <p class="hint">技能正文由 skill 工具按需加载；工作流与技能索引卡在记忆库里（memory_recall 可命中）。</p>
      </div>` : ""}
    </section>

    <section class="section" aria-labelledby="h-models">
      <h2 id="h-models"><span class="num">1++</span>带哪些模型<span class="count">${pickedModels.length} / ${modelCands.length} 个</span></h2>
      <p class="hint">这里选的是「装给智能体后可直接用的模型」；标了「破甲默认 / 破甲支持」的就是已经适配过破甲的。</p>
      <div class="grid models">${modelCands.map((m) => {
        const on = pickedModels.includes(m.id);
        return `<button type="button" class="pick" data-equip-model="${esc(m.id)}" data-focus="emodel-${esc(m.id)}" aria-pressed="${on}">
          <span class="pick-top"><span class="pick-name">${esc(m.name)}</span>${on ? badge("带", "accent") : ""}${m.cracked ? badge("已破甲", "good") : ""}</span>
          <span class="pick-note">${esc(m.meta || m.id)}</span>
        </button>`;
      }).join("")}</div>
      <div class="actions" style="margin-top:8px">
        <button type="button" class="ghost" data-equip-model-cracked>只选已破甲的</button>
        <button type="button" class="ghost" data-equip-model-none>全不选</button>
      </div>
    </section>

    <section class="section" aria-labelledby="h-agents">
      <h2 id="h-agents"><span class="num">2</span>装给谁<span class="count">${e.agents.length} 个已选</span></h2>
      <div class="grid agents">${agentCards}</div>
      ${customSelected ? `<label class="field" style="margin-top:10px"><span>自定义智能体名称 <span class="req">*</span></span>
        <input id="eCustom" data-focus="eCustom" type="text" maxlength="60" value="${esc(e.custom)}" placeholder="例：my-research-agent">
        <span class="help">名称会写进配置的 agents[]，也会用于 /api/assign/&lt;agent&gt;.md 端点。</span>
      </label>` : ""}
    </section>

    <section class="section" aria-labelledby="h-perm">
      <h2 id="h-perm"><span class="num">3</span>权限档<span class="count">${permissionName(e.permissions)}</span></h2>
      <div class="grid perms">${permCards}</div>
      <div class="inline-note">权限档改变的是智能体的动作边界：<strong>只读</strong>不改目标，<strong>受控</strong>逐次确认，<strong>全权</strong>由授权对象承担全部操作后果。</div>
    </section>

    <section class="section" aria-labelledby="h-issue">
      <h2 id="h-issue"><span class="num">4</span>发放与配置</h2>
      <form id="equipForm" class="card" novalidate>
        <label class="field"><span>备注（授权范围、时间窗）</span>
          <input id="eNotes" data-focus="eNotes" type="text" maxlength="300" value="${esc(e.notes)}" placeholder="例：自有靶场，2026-12 前有效">
        </label>
        <div id="equipError">${e.error ? alertBox(e.error.message, e.error.hint) : ""}</div>
        ${e.ok ? okBox(e.ok) : ""}
        <div class="actions">
          <button class="primary" type="submit" ${e.saving ? "disabled" : ""}>${e.saving ? "发放中…" : "发放装备"}</button>
          <button class="ghost" type="button" id="eCopy">复制配置</button>
          <span class="hint">未选智能体时会被拒绝，不会发请求。</span>
        </div>
      </form>
    </section>`;

  const pathsGroup = `
    <section class="section" aria-labelledby="h-preview">
      <h2 id="h-preview"><span class="num">5</span>配置预览</h2>
      ${badge("高级", "warn")}${badge("只读预览", "good")}
      <div class="card soft" style="margin-top:10px">
        <pre id="equipPreview" tabindex="0">${esc(JSON.stringify(config, null, 2))}</pre>
      </div>
    </section>`;

  const diagGroup = `
    <section class="section" aria-labelledby="h-history">
      <h2 id="h-history"><span class="num">6</span>发放历史<span class="count">${hostEquip.length} 条（当前宿主 ${esc(hostTargetName(S.hostTarget))} · 全部 ${S.equipment.length}）</span></h2>
      ${historyHtml}
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 02</p>
        <h1>梦神装甲</h1>
        <p class="lead">把一套能力装到具体智能体上：dsh、mengbot、autokill，或你自己的。发出去就有一份可复制的配置，并留下发放历史。</p>
      </div>
      <div class="head-meta">${badge("6 个预设", "accent")}${badge("3 档权限", "")}${badge("可复制 JSON", "")}</div>
    </div>

    ${groupsHtml("equip", [
      { key: "base", html: baseGroup },
      { key: "paths", html: pathsGroup },
      { key: "diag", html: diagGroup },
    ])}
  `;
  bindEquip();
}

function bindEquip() {
  $$("#page [data-preset]").forEach((el) => {
    el.addEventListener("click", () => equipTogglePreset(el.dataset.preset));
  });
  // 能力项勾选：装之前先挑，不勾的不进配置
  $$("#page [data-equip-item]").forEach((el) => {
    el.addEventListener("click", () => equipToggleItem(el.dataset.equipItem));
  });
  $$("#page [data-equip-model]").forEach((el) => {
    el.addEventListener("click", () => equipToggleModel(el.dataset.equipModel));
  });
  $$("#page [data-equip-page-all]").forEach((el) => el.addEventListener("click", () => {
    const pid = el.dataset.equipPageAll;
    const p = PRESETS.find((x) => x.id === pid);
    if (!p) return;
    const cur = new Set(equipChosenItems());
    for (const it of p.items || []) cur.add(equipItemKey(p.id, it.id));
    S.equip.items = Array.from(cur);
    renderPage();
  }));
  $$("#page [data-equip-page-none]").forEach((el) => el.addEventListener("click", () => {
    const pid = el.dataset.equipPageNone;
    const p = PRESETS.find((x) => x.id === pid);
    if (!p) return;
    const drop = new Set((p.items || []).map((it) => equipItemKey(p.id, it.id)));
    S.equip.items = equipChosenItems().filter((k) => !drop.has(k));
    renderPage();
  }));
  $$("#page [data-equip-model-cracked]").forEach((el) => el.addEventListener("click", () => {
    S.equip.models = equipModelCandidates().filter((m) => m.cracked).map((m) => m.id);
    renderPage();
  }));
  $$("#page [data-equip-model-none]").forEach((el) => el.addEventListener("click", () => {
    S.equip.models = [];
    renderPage();
  }));
  $$("#page [data-equip-all]").forEach((el) => el.addEventListener("click", () => {
    S.equip.items = null; // null = 按当前选中的包全选
    renderPage();
  }));
  $$("#page [data-equip-none]").forEach((el) => el.addEventListener("click", () => {
    S.equip.items = [];
    renderPage();
  }));
  $$("#page [data-agent]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.agent;
      S.equip.agents = S.equip.agents.includes(id)
        ? S.equip.agents.filter((x) => x !== id)
        : [...S.equip.agents, id];
      S.equip.error = null;
      S.equip.ok = null;
      renderPage();
    });
  });
  const custom = $("#eCustom");
  if (custom) custom.addEventListener("input", () => { S.equip.custom = custom.value; });
  $$('input[name="equipPerm"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) { S.equip.permissions = el.value; renderPage(); }
    });
  });
  const notes = $("#eNotes");
  if (notes) notes.addEventListener("input", () => { S.equip.notes = notes.value; });
  const copy = $("#eCopy");
  if (copy) copy.addEventListener("click", () => copyText(JSON.stringify(equipConfig(), null, 2), "配置已复制"));
  const form = $("#equipForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); issueEquipment(); });
}

async function issueEquipment() {
  const e = S.equip;
  e.error = null;
  e.ok = null;
  const agents = equipAgents(false);
  if (!e.agents.length) {
    e.error = { message: "至少选择一个智能体。", hint: "点「装给谁」里的卡片；自定义需要填名称。未选智能体不会发请求。" };
    renderPage();
    return;
  }
  if (e.agents.includes("custom") && !e.custom.trim()) {
    e.error = { message: "填写自定义智能体名称。", hint: "例如 my-research-agent；它会写进 agents[] 与分发端点。" };
    renderPage();
    const input = $("#eCustom");
    if (input) input.focus();
    return;
  }
  if (e.saving) return;
  e.saving = true;
  const btn = $("#equipForm button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "发放中…"; }
  try {
    const data = await request("/api/equipment", {
      method: "POST",
      body: { preset: equipPresets()[0], presets: equipPresets(), agents, permissions: e.permissions, notes: e.notes.trim(), items: equipChosenItems(), models: equipModels() },
    });
    if (!data || data.ok === false) throw payloadError(data, "发放失败");
    if (Array.isArray(data.equipment)) S.equipment = data.equipment;
    else if (data.equipment && typeof data.equipment === "object") S.equipment = [...S.equipment, data.equipment];
    else if (data.item) S.equipment = [...S.equipment, data.item];
    else S.equipment = [...S.equipment, { preset: e.preset, agents, permissions: e.permissions, notes: e.notes.trim(), at: new Date().toISOString() }];
    e.ok = "装备已发放；历史新增一条。" + absorbNote(data.absorbed) + equipPluginNote(data);
    if (data.plugin && data.plugin.changed) toast('已同时安装「梦神破甲」插件；重启 DSH 后 58 个 redteam_* 工具生效', 'warn');
    else if (data.plugin && data.plugin.ok === false) toastError('插件安装失败：' + (data.plugin.summary || data.plugin.error || ''));
  } catch (err) {
    e.error = { message: err.message, hint: err.hint };
    if (isAgreementError(err)) return;
  } finally {
    e.saving = false;
    renderPage();
  }
}

/* ------------------------------------------------------------------ assignment */
function assignAgentName(id) {
  const a = AGENTS.find((x) => x.id === id);
  return a ? a.name : id;
}

function saveAssignDraft() {
  S.assign.drafts[S.assign.agent] = {
    cards: [...S.assign.selected],
    mode: { ...S.assign.mode },
  };
}

function loadAssignDraft(id) {
  const draft = S.assign.drafts[id];
  if (draft) {
    S.assign.selected = new Set(draft.cards || []);
    S.assign.mode = { ...S.assign.mode, ...(draft.mode || {}) };
    return;
  }
  const a = S.assignments[id] || {};
  S.assign.selected = new Set(Array.isArray(a.cards) ? a.cards.map(cardPath).filter(Boolean) : []);
  S.assign.mode = a.mode
    ? { skillsOnly: !!a.mode.skillsOnly, autoSync: a.mode.autoSync !== false }
    : { skillsOnly: false, autoSync: true };
}

function switchAssignAgent(id) {
  if (id === S.assign.agent) return;
  saveAssignDraft();
  S.assign.agent = id;
  loadAssignDraft(id);
  S.assign.preview = null;
  S.assign.previewError = null;
  S.assign.ok = null;
  S.assign.saveError = null;
  renderPage();
}

async function loadAssignCards() {
  if (S.assign.loading) return;
  S.assign.loading = true;
  S.assign.error = null;
  const q = S.assign.loadedQuery.q;
  const kind = S.assign.loadedQuery.kind;
  try {
    const params = new URLSearchParams({ limit: "40" });
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    const data = await request("/api/memory/cards?" + params.toString());
    if (!data || data.ok === false) throw payloadError(data, "记忆服务不可用");
    S.assign.cards = Array.isArray(data.cards) ? data.cards : [];
  } catch (e) {
    if (isAgreementError(e)) return;
    S.assign.error = e;
    S.assign.cards = [];
  } finally {
    S.assign.loading = false;
    if (S.tab === "assign") renderPage();
  }
}

async function loadAssignPreview() {
  const agent = S.assign.agent;
  if (!agent || S.assign.previewLoading) return;
  S.assign.previewLoading = true;
  const res = await requestText("/api/assign/" + encodeURIComponent(agent) + ".md");
  if (S.assign.agent !== agent) {
    S.assign.previewLoading = false;
    return;
  }
  S.assign.previewLoading = false;
  if (!res.ok) {
    let message = "读取分发端点失败（HTTP " + res.status + "）";
    let hint = "确认服务端支持 /api/assign/<agent>.md，并检查智能体名称。";
    if (/服务不可用|service unavailable/i.test(res.text)) {
      message = "记忆服务不可用";
      hint = "端点返回「服务不可用」而不是 500；先启动 memory-eternal，再到设置里测试连接。";
    } else {
      try {
        const data = JSON.parse(res.text);
        const err = errorFrom(data, res.status);
        message = err.message;
        hint = err.hint;
      } catch { /* markdown error body */ }
    }
    S.assign.preview = res.text || "";
    S.assign.previewError = { message, hint, tone: /服务不可用/.test(message) ? "warn" : "bad" };
  } else {
    S.assign.preview = res.text || "";
    if (/服务不可用|service unavailable/i.test(res.text)) {
      S.assign.previewError = { message: "记忆服务不可用", hint: "端点没有 500，而是把不可用写进了 Markdown。先启动 memory-eternal，再到设置里测试连接。", tone: "warn" };
    } else {
      S.assign.previewError = null;
    }
  }
  if (S.tab === "assign") renderPage();
}

function countAssignSections(markdown, paths, titles) {
  if (!markdown) return 0;
  // The real server writes one `- path:` line per card section; the local contract
  // harness writes the path as the heading. Support both without counting the
  // `##` headings that live inside a card's own Markdown body.
  const pathLines = (markdown.match(/^- path: /gm) || []).length;
  if (pathLines) return pathLines;
  const wanted = new Set([...(paths || []), ...(titles || [])].filter(Boolean));
  const headings = markdown.match(/^## (.+)$/gm) || [];
  if (!wanted.size) return headings.length;
  return headings.map((line) => line.replace(/^## /, "").trim()).filter((text) => wanted.has(text)).length;
}

function renderAssign() {
  const a = S.assign;
  if (!a.initialized) initAssignFromState();
  if (a.cards === null && !a.loading && !a.error) loadAssignCards();
  if (a.preview === null && !a.previewLoading) loadAssignPreview();

  const known = AGENTS.map((x) => x.id);
  const isCustomAgent = !known.includes(a.agent);
  const allCards = Array.isArray(a.cards) ? a.cards : [];
  const skillsOnly = a.mode.skillsOnly;
  const visible = skillsOnly ? allCards.filter((c) => c.kind === "skill") : allCards;
  const filteredOut = skillsOnly ? allCards.length - visible.length : 0;
  a.filteredOut = filteredOut;
  const selected = a.selected;
  const selectedCount = selected.size;
  const nonSkillSelected = allCards.filter((c) => selected.has(c.path) && c.kind !== "skill").length;
  const endpoint = "/api/assign/" + encodeURIComponent(a.agent || "dsh") + ".md";
  const origin = location.origin || ("http://127.0.0.1" + (location.port ? ":" + location.port : ""));
  const absolute = origin + endpoint;
  const curl = `curl -s ${absolute}`;
  const dshSnippet = `# 让智能体每次启动读取实时分发\ncurl -s ${absolute} >> ~/.dsh/AGENTS.md`;
  const assignedCards = (S.assignments[a.agent] && Array.isArray(S.assignments[a.agent].cards)) ? S.assignments[a.agent].cards : [];
  const selectedTitles = assignedCards.map((c) => (c && typeof c === "object" ? c.title : "")).filter(Boolean);
  const sectionCount = a.preview ? countAssignSections(a.preview, selected, selectedTitles) : 0;

  const agentChips = AGENTS.map((x) => `<button type="button" class="chip" data-aagent="${esc(x.id)}" data-focus="aagent-${esc(x.id)}" aria-pressed="${a.agent === x.id}">${a.agent === x.id ? '<span class="tick" aria-hidden="true">✓</span>' : ""}${esc(x.name)}</button>`).join("");
  const customChip = isCustomAgent
    ? `<span class="chip" aria-pressed="true"><span class="tick" aria-hidden="true">✓</span>${esc(a.agent)} <span class="mini">自定义</span></span>`
    : "";

  const kindOptions = `<option value="">全部</option>${KINDS.map((k) => `<option value="${esc(k)}" ${a.loadedQuery.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}`;

  let cardsHtml = "";
  if (a.loading) cardsHtml = spinner("读取记忆卡…");
  else if (a.error) cardsHtml = alertBox(a.error.message, a.error.hint, "bad", "") + `<div class="actions"><button type="button" class="small" data-a-retry>重试读取</button></div>`;
  else if (!allCards.length) cardsHtml = emptyState("没有匹配的卡片", "换个关键词或清空类型过滤；记忆服务不可达时先到设置里测试连接。");
  else if (!visible.length) cardsHtml = emptyState("技能卡过滤后为空", `当前结果 ${allCards.length} 张，其中没有 kind=skill 的卡；关闭「只发技能卡」或换关键词。`);
  else {
    cardsHtml = `<div class="list assign-cards">${visible.map((c, i) => {
      const path = c.path || "";
      const on = selected.has(path);
      return `<label class="pick-row">
        <input type="checkbox" data-acard="${i}" data-focus="acard-${encodeURIComponent(path)}" ${on ? "checked" : ""} aria-label="选择 ${esc(c.title || path)}">
        <span class="grow">
          <span class="t">${esc(c.title || path)}</span>
          <span class="s">${badge(c.kind || "未分类", c.kind === "skill" ? "accent" : "")}${c.status ? " " + badge(c.status, c.status === "approved" ? "good" : (c.status === "pending" ? "warn" : "")) : ""}<span class="sep">·</span>${esc(path)}</span>
          ${c.summary ? `<span class="s">${esc(String(c.summary).slice(0, 160))}</span>` : ""}
        </span>
      </label>`;
    }).join("")}</div><p class="table-note">显示 ${visible.length} 张${skillsOnly ? `（已过滤 ${filteredOut} 张非技能卡）` : ""}${allCards.length >= 40 ? "；结果上限 40 张，可加关键词缩小范围" : ""}。</p>`;
  }

  const baseGroup = `
    <section class="section" aria-labelledby="h-a-agent">
      <h2 id="h-a-agent"><span class="num">1</span>给哪个智能体<span class="count">${esc(assignAgentName(a.agent))}</span></h2>
      <div class="chips">${agentChips}${customChip}</div>
      <div class="form-grid" style="margin-top:10px;align-items:end">
        <label class="field"><span>自定义智能体</span>
          <input id="aCustom" data-focus="aCustom" type="text" maxlength="60" value="${esc(a.custom)}" placeholder="例：my-agent">
        </label>
        <div class="field"><span>&nbsp;</span><button type="button" class="ghost" id="aUseCustom">使用这个名称</button></div>
      </div>
      <p class="hint">名称只允许字母、数字、点、下划线与短横线；它会直接进入 /api/assign/&lt;agent&gt;.md。</p>
    </section>

    <section class="section" aria-labelledby="h-a-cards">
      <h2 id="h-a-cards"><span class="num">2</span>选知识卡<span class="count">已选 ${selectedCount} 张</span></h2>
      <form id="assignSearch" class="card soft" novalidate>
        <div class="form-grid">
          <label class="field"><span>搜索</span><input id="aQ" data-focus="aQ" type="text" value="${esc(a.loadedQuery.q)}" placeholder="技能 / 项目 / 关键词"></label>
          <label class="field"><span>类型</span><select id="aKind" data-focus="aKind">${kindOptions}</select></label>
        </div>
        <div class="actions"><button class="primary" type="submit">搜索</button><span class="hint">从记忆中心实时搜索，最多 40 张。</span></div>
      </form>
      ${cardsHtml}
    </section>

    <section class="section" aria-labelledby="h-a-host">
      <h2 id="h-a-host"><span class="num">3</span>让宿主自己查<span class="count">运行时检索</span></h2>
      <p class="hint">上面这份是静态快照。装一个检索技能后，宿主每次干活前会自己查本库，命中就引用 title + path。只写 <code>~/.dsh/skills/mem-purge-recall/SKILL.md</code>，不动宿主其它配置。</p>
      <div class="actions">
        <button type="button" class="ghost" id="aInstallSkill">装检索技能</button>
        <span class="hint" id="aInstallHint"></span>
      </div>
    </section>

    <section class="section" aria-labelledby="h-a-save">
      <h2 id="h-a-save"><span class="num">4</span>保存分配</h2>
      <form id="assignForm" class="card" novalidate>
        <div id="assignError">${a.saveError ? alertBox(a.saveError.message, a.saveError.hint) : ""}</div>
        ${a.ok ? okBox(a.ok) : ""}
        <div class="actions">
          <button class="primary" type="submit" ${a.saving ? "disabled" : ""}>${a.saving ? "保存中…" : "保存分配"}</button>
          <button class="ghost" type="button" id="aPreview">刷新预览</button>
          <span class="hint">保存只写分配关系，不改卡片本身。</span>
        </div>
      </form>
    </section>`;

  const strategyGroup = `
    <section class="section" aria-labelledby="h-a-mode">
      <h2 id="h-a-mode"><span class="num">3</span>定制模式</h2>
      <div class="card">
        <label class="check"><input type="checkbox" id="aSkills" ${skillsOnly ? "checked" : ""}><span>只发技能卡（kind=skill），过滤普通知识</span></label>
        <label class="check"><input type="checkbox" id="aSync" ${a.mode.autoSync ? "checked" : ""}><span>实时同步（端点每次请求重新合并，不缓存）</span></label>
        ${skillsOnly ? `<div class="alert info" role="status"><strong>只发技能卡已开启</strong><span class="hint">当前搜索结果中已过滤 ${filteredOut} 张非技能卡${nonSkillSelected ? `；已选的 ${nonSkillSelected} 张非技能卡不会出现在端点` : ""}。</span></div>` : ""}
        ${skillsOnly && nonSkillSelected ? `<div class="alert warn" role="alert"><strong>选择里有非技能卡</strong><span class="hint">端点会按 kind=skill 过滤；如果要保留它们，请关闭「只发技能卡」。</span></div>` : ""}
        <div class="actions" style="margin-top:10px"><span class="hint">已选 ${selectedCount} 张；保存后端点立即变化。</span></div>
      </div>
    </section>`;

  const pathsGroup = `
    <section class="section" aria-labelledby="h-a-endpoint">
      <h2 id="h-a-endpoint"><span class="num">5</span>智能体怎么拿 ${badge("高级", "warn")}</h2>
      <div class="card">
        <div class="card-head"><h3>实时端点</h3>${badge("实时端点", "accent")}</div>
        <dl class="kv compact">
          <dt>端点</dt><dd class="mono">${esc(endpoint)} ${copyBtn(endpoint, "复制路径")}</dd>
          <dt>命令行</dt><dd>${copyBtn(curl, "复制 curl")}</dd>
          <dt>DSH 追加</dt><dd>${copyBtn(dshSnippet, "复制 DSH 片段")}</dd>
        </dl>
        <div class="snippet">
          <div class="snippet-head"><span class="label">curl</span></div>
          <pre tabindex="0">${esc(curl)}</pre>
        </div>
        <div class="snippet">
          <div class="snippet-head"><span class="label">DSH 追加片段（写入 ~/.dsh/AGENTS.md）</span></div>
          <pre tabindex="0">${esc(dshSnippet)}</pre>
        </div>
      </div>
    </section>`;

  const diagGroup = `
    <section class="section" aria-labelledby="h-a-preview">
      <h2 id="h-a-preview"><span class="num">6</span>端点实时预览</h2>
      <div class="card soft">
        <div class="card-head"><h3>端点实时预览</h3>${a.previewLoading ? badge("读取中…", "warn") : badge(sectionCount + " 个小节", sectionCount ? "accent" : "")}</div>
        ${a.previewError ? alertBox(a.previewError.message, a.previewError.hint, a.previewError.tone || "bad") : ""}
        ${a.previewLoading
          ? spinner("读取端点…")
          : a.preview
            ? `<pre class="tall" tabindex="0">${esc(a.preview)}</pre><div class="actions"><span class="hint">每次请求重新合并；未选择时端点应明确写「尚未选择」。</span>${copyBtn(a.preview, "复制 Markdown")}</div>`
            : emptyState("端点还没有内容", "保存分配后刷新预览；未选择卡片时端点应返回「尚未选择」。")}
      </div>
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 03</p>
        <h1>记忆分发</h1>
        <p class="lead">把 memory-eternal 里的知识与技能实时分给已经装备好的智能体。分配变化立即生效，智能体读同一个端点。</p>
      </div>
      <div class="head-meta">${badge("实时合并", "accent")}${badge("不缓存", "")}${badge("只读卡片", "")}</div>
    </div>

    ${groupsHtml("assign", [
      { key: "base", html: baseGroup },
      { key: "strategy", html: strategyGroup },
      { key: "paths", html: pathsGroup },
      { key: "diag", html: diagGroup },
    ])}
  `;
  bindAssign();
}

function bindAssign() {
  $$("#page [data-aagent]").forEach((el) => {
    el.addEventListener("click", () => switchAssignAgent(el.dataset.aagent));
  });
  const custom = $("#aCustom");
  if (custom) custom.addEventListener("input", () => { S.assign.custom = custom.value; });
  const useCustom = $("#aUseCustom");
  if (useCustom) useCustom.addEventListener("click", () => {
    const name = (S.assign.custom || "").trim();
    if (!name) {
      S.assign.saveError = { message: "先填自定义智能体名称。", hint: "例如 my-agent；名称会进入分发端点。" };
      renderPage();
      return;
    }
    if (!/^[a-zA-Z0-9._-]{1,60}$/.test(name)) {
      S.assign.saveError = { message: "自定义名称只能用字母、数字、点、下划线与短横线。", hint: "这是 URL 路径的一部分，避免空格与斜杠。" };
      renderPage();
      return;
    }
    saveAssignDraft();
    S.assign.agent = name;
    S.assign.selected = new Set();
    S.assign.mode = { skillsOnly: false, autoSync: true };
    S.assign.preview = null;
    S.assign.previewError = null;
    S.assign.saveError = null;
    S.assign.ok = null;
    renderPage();
  });

  const search = $("#assignSearch");
  if (search) search.addEventListener("submit", (e) => {
    e.preventDefault();
    S.assign.loadedQuery = { q: $("#aQ").value.trim(), kind: $("#aKind").value };
    S.assign.cards = null;
    S.assign.error = null;
    renderPage();
  });

  $$("#page [data-acard]").forEach((el) => {
    el.addEventListener("change", () => {
      const allCards = Array.isArray(S.assign.cards) ? S.assign.cards : [];
      const visible = S.assign.mode.skillsOnly ? allCards.filter((c) => c.kind === "skill") : allCards;
      const card = visible[Number(el.dataset.acard)];
      if (!card) return;
      if (el.checked) S.assign.selected.add(card.path);
      else S.assign.selected.delete(card.path);
      renderPage();
    });
  });

  const skills = $("#aSkills");
  if (skills) skills.addEventListener("change", () => {
    S.assign.mode.skillsOnly = skills.checked;
    renderPage();
  });
  const sync = $("#aSync");
  if (sync) sync.addEventListener("change", () => { S.assign.mode.autoSync = sync.checked; });

  const form = $("#assignForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); saveAssignment(); });
  const preview = $("#aPreview");
  if (preview) preview.addEventListener("click", () => {
    S.assign.preview = null;
    S.assign.previewError = null;
    renderPage();
  });
  $$("#page [data-a-retry]").forEach((el) => el.addEventListener("click", () => { S.assign.cards = null; S.assign.error = null; renderPage(); }));
  const install = $("#aInstallSkill");
  if (install) install.addEventListener("click", async () => {
    const hint = $("#aInstallHint");
    install.disabled = true;
    if (hint) hint.textContent = "写入中…";
    try {
      const data = await request("/api/memory/install-skill", { method: "POST" });
      if (!data || data.ok === false) throw payloadError(data, "写入失败");
      S.assign.ok = "已写入宿主技能：" + (data.path || "mem-purge-recall/SKILL.md") + "（宿主下次会话生效）";
      if (hint) hint.textContent = data.path || "";
    } catch (e) {
      if (isAgreementError(e)) return;
      S.assign.saveError = { message: e.message, hint: e.hint };
    } finally {
      install.disabled = false;
      renderPage();
    }
  });
}

async function saveAssignment() {
  const a = S.assign;
  a.saveError = null;
  a.ok = null;
  if (!a.agent) {
    a.saveError = { message: "先选一个智能体。", hint: "dsh / mengbot / autokill，或填一个自定义名称。" };
    renderPage();
    return;
  }
  if (a.saving) return;
  a.saving = true;
  renderPage();
  try {
    const data = await request("/api/assign", {
      method: "POST",
      body: { agent: a.agent, cards: [...a.selected], mode: { skillsOnly: a.mode.skillsOnly, autoSync: a.mode.autoSync } },
    });
    if (!data || data.ok === false) throw payloadError(data, "保存分配失败");
    if (data.assignments && typeof data.assignments === "object") S.assignments = data.assignments;
    else S.assignments[a.agent] = { cards: [...a.selected], mode: { ...a.mode }, at: new Date().toISOString() };
    a.drafts[a.agent] = { cards: [...a.selected], mode: { ...a.mode } };
    a.ok = "已保存，端点立即生效；预览正在刷新。";
    a.preview = null;
    a.previewError = null;
  } catch (e) {
    a.saveError = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
  } finally {
    a.saving = false;
    renderPage();
  }
}

/* ------------------------------------------------------------------ memory center */
function renderMemory() {
  memoryFullPage();
}

function bindMemory() {
  const search = $("#memorySearch");
  if (search) search.addEventListener("submit", (e) => {
    e.preventDefault();
    S.memory.q = $("#mQ").value.trim();
    S.memory.kind = $("#mKind").value;
    S.memory.cards = null;
    S.memory.cardsLoaded = false;
    S.memory.error = null;
    S.memory.detail = null;
    S.memory.detailError = null;
    renderPage();
  });
  $$("#page [data-mcard]").forEach((el) => {
    el.addEventListener("click", () => openMemoryCard(Number(el.dataset.mcard)));
  });
  $$("#page [data-mem-retry]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.memRetry === "stats") {
        S.memory.statsLoaded = false;
        S.memory.statsError = null;
      } else {
        S.memory.cardsLoaded = false;
        S.memory.error = null;
      }
      renderPage();
    });
  });
  const form = $("#claimForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); submitClaim(); });
  const title = $("#wTitle");
  if (title) title.addEventListener("input", () => { S.memory.claim.title = title.value; });
  const kind = $("#wKind");
  if (kind) kind.addEventListener("change", () => { S.memory.claim.kind = kind.value; });
  const tags = $("#wTags");
  if (tags) tags.addEventListener("input", () => { S.memory.claim.tags = tags.value; });
  const body = $("#wBody");
  if (body) body.addEventListener("input", () => { S.memory.claim.body = body.value; });
}

/* ------------------------------------------------------------------ settings */
function settingsInputs() {
  return {
    memoryBase: ($("#sBase") ? $("#sBase").value : S.settings.memoryBase || "").trim(),
    memoryToken: ($("#sToken") ? $("#sToken").value : "").trim(),
    matchCode: ($("#sMatch") ? $("#sMatch").value : S.settings.matchCode || "").trim(),
    language: ($("#sLang") ? $("#sLang").value : S.settings.language) || "zh",
    breakDir: ($("#sBreakDir") ? $("#sBreakDir").value : S.settings.breakDir || "").trim(),
    pluginPath: ($("#sPluginPath") ? $("#sPluginPath").value : S.settings.pluginPath || "").trim(),
  };
}

function settingsBody(input, includeToken = true) {
  const body = {
    memoryBase: input.memoryBase,
    language: input.language,
    breakDir: input.breakDir,
    pluginPath: input.pluginPath,
  };
  if (includeToken && input.memoryToken) body.memoryToken = input.memoryToken;
  return body;
}

function mergeSettings(next) {
  if (!next || typeof next !== "object") return;
  if (typeof next.memoryBase === "string") S.settings.memoryBase = next.memoryBase;
  if (typeof next.language === "string") S.settings.language = next.language;
  if (typeof next.breakDir === "string") S.settings.breakDir = next.breakDir;
  if (typeof next.pluginPath === "string") S.settings.pluginPath = next.pluginPath;
  if (typeof next.dataDir === "string") S.settings.dataDir = next.dataDir;
  if (next.memoryToken) S.settings.memoryToken = next.memoryToken;
  S.memory.source = detectSource(S.settings.memoryBase);
}

async function persistSettings(input) {
  const data = await request("/api/settings", { method: "POST", body: settingsBody(input) });
  if (!data || data.ok === false) throw payloadError(data, "保存设置失败");
  const returned = data.settings && typeof data.settings === "object" ? data.settings : {};
  mergeSettings(returned);
  S.settings.memoryBase = input.memoryBase;
  S.settings.language = input.language;
  if (input.memoryToken) S.settings.memoryToken = input.memoryToken;
  const unsaved = [];
  if (input.breakDir && returned.breakDir !== input.breakDir) unsaved.push("break 工作目录");
  if (input.pluginPath && returned.pluginPath !== input.pluginPath) unsaved.push("AutoKill 插件路径");
  return { data, unsaved };
}

async function saveSettings() {
  const input = settingsInputs();
  S.settings.error = null;
  S.settings.ok = null;
  if (!input.memoryBase) {
    S.settings.error = { message: "记忆中心地址不能为空。", hint: "本地通常是 http://127.0.0.1:7999/memory-eternal/api。" };
    renderPage();
    return;
  }
  if (S.settings.saving) return;
  S.settings.saving = true;
  renderPage();
  try {
    const res = await persistSettings(input);
    S.settings.draft = {};
    S.settings.ok = res.unsaved.length
      ? "设置已保存；以下字段服务端当前未持久化，刷新后会回退：" + res.unsaved.join("、") + "。"
      : "设置已保存。令牌不会回显；留空表示保持不变。";
  } catch (e) {
    S.settings.error = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
  } finally {
    S.settings.saving = false;
    S.settings.draft.memoryToken = "";
    renderPage();
    const token = $("#sToken");
    if (token) token.value = "";
  }
}

async function testConnection() {
  const input = settingsInputs();
  const out = $("#sTestOut");
  const btn = $("#sTest");
  S.settings.error = null;
  S.settings.ok = null;
  if (!input.memoryBase) {
    if (out) out.innerHTML = alertBox("先填记忆中心地址。", "本地通常是 http://127.0.0.1:7999/memory-eternal/api。");
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "测试中…"; }
  if (out) out.innerHTML = spinner("先保存地址，再测试连接…");
  try {
    await persistSettings(input);
    S.settings.test = { state: "loading", message: "正在请求 /api/memory/stats…", hint: "" };
    const data = await request("/api/memory/stats");
    if (!data || data.ok === false) throw payloadError(data, "记忆服务不可用");
    const st = normalizeStats(data);
    S.settings.test = { state: "ok", message: `连接成功：${fmtNum(st.total)} 张卡。`, hint: `使用 ${S.settings.memoryBase}` };
    setStatus("ok", "记忆中心已连接");
  } catch (e) {
    if (isAgreementError(e)) return;
    S.settings.test = { state: "bad", message: "连接失败：" + e.message, hint: e.hint || "确认 memory-eternal 已启动，地址形如 http://127.0.0.1:7999/memory-eternal/api。" };
    setStatus("bad", "记忆中心未连接", e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "测试连接"; }
    if (out) {
      out.innerHTML = S.settings.test.state === "ok"
        ? okBox(S.settings.test.message, S.settings.test.hint)
        : alertBox(S.settings.test.message, S.settings.test.hint);
    }
    const token = $("#sToken");
    if (token) token.value = "";
  }
}

async function resetAgreement() {
  S.settings.resetError = null;
  try {
    const data = await request("/api/agreement/reset", { method: "POST", body: {} });
    if (!data || data.ok === false) throw payloadError(data, "重签失败");
    S.state = S.state || {};
    S.state.agreement = { accepted: false, version: "", at: "", signer: "" };
    S.settings.resetArmed = false;
    S.locked = true;
    showAgreement();
    setStatus("warn", "待签署协议");
    renderPage();
  } catch (e) {
    S.settings.resetError = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
    renderPage();
  }
}

function renderSettings() {
  const s = S.settings;
  const draft = s.draft || {};
  const agreement = (S.state && S.state.agreement) || { accepted: false, version: "", at: "", signer: "" };
  const tokenSet = !!s.memoryToken;
  const dataFile = s.dataDir ? s.dataDir.replace(/[\\/]?$/, "") + "/state.json" : "data/state.json";
  const val = (key, fallback) => (Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : (fallback || ""));
  const testHtml = s.test.state === "ok"
    ? okBox(s.test.message, s.test.hint)
    : s.test.state === "bad"
      ? alertBox(s.test.message, s.test.hint)
      : `<p class="hint" id="sTestOutHint">测试会先保存当前地址与令牌，再请求 /api/memory/stats；令牌不会回显。</p>`;

  const baseGroup = `
    <section class="section" aria-labelledby="h-s-conn">
      <h2 id="h-s-conn"><span class="num">1</span>连接与语言</h2>
      <form id="settingsForm" class="card" novalidate>
        <div class="form-grid">
          <label class="field"><span>界面语言</span>
            <select id="sLang" data-focus="sLang"><option value="zh" ${val("language", s.language) !== "en" ? "selected" : ""}>简体中文</option><option value="en" disabled>English（当前版本未提供）</option></select>
            ${fieldDefault("language", val("language", s.language), FIELD_DEFAULTS.language)}
            <span class="help">当前版本只提供简体中文文案；语言值会保存在 state.json。</span>
          </label>
          <label class="field"><span>服务端口</span>
            <input type="text" value="${esc(location.port || (location.protocol === "https:" ? "443" : "80"))}" readonly>
            <span class="help">只读；要换端口改启动参数。</span>
          </label>
        </div>
        <div id="settingsError">${s.error ? alertBox(s.error.message, s.error.hint) : ""}</div>
        ${s.ok ? okBox(s.ok) : ""}
        <div class="actions">
          <button class="primary" type="submit" ${s.saving ? "disabled" : ""}>${s.saving ? "保存中…" : "保存设置"}</button>
          <button class="ghost" type="button" id="sTest">测试连接</button>
        </div>
        <div id="sTestOut" style="margin-top:9px">${testHtml}</div>
      </form>
    </section>`;

  const pathsGroup = `
    <section class="section" aria-labelledby="h-s-runtime">
      <h2 id="h-s-runtime"><span class="num">2</span>路径与文件 ${badge("高级", "warn")}</h2>
      <form id="runtimeForm" class="card" novalidate>
        <label class="field"><span>记忆服务地址${S.deploy && S.deploy.private ? "（私有部署 · 已锁定）" : ""}</span>
          <input id="sBase" data-focus="sBase" type="text" value="${esc(val("memoryBase", s.memoryBase))}" placeholder="http://127.0.0.1:7989/memory-eternal/api" spellcheck="false"${S.deploy && S.deploy.private ? " readonly" : ""}>
          ${S.deploy && S.deploy.private
            ? `<span class="help">私有部署固定：库名 <strong>${esc(S.deploy.dbName)}</strong> · 端口 <strong>${esc(String(S.deploy.memoryPort))}</strong> · 固定入口 <a href="${esc(S.deploy.entryUrl)}" target="_blank" rel="noopener">${esc(S.deploy.entryUrl)}</a>；与运营库（7999）完全隔离，这一项不可改。</span>`
            : `${fieldDefault("memoryBase", val("memoryBase", s.memoryBase), FIELD_DEFAULTS.memoryBase)}<span class="help">本地优先；填远端地址即切到云端。</span>`}
        </label>
        <label class="field"><span>匹配码（可选）</span>
          <input id="sMatch" data-focus="sMatch" type="text" maxlength="128" value="${esc(val("matchCode", s.matchCode))}" placeholder="等待 memory-eternal 下发">
          <span class="help">把它下发的匹配码填这里：所有记忆请求都会带 x-memory-match 头，用来把 mem-purge 的输出与它那边的数据对上号。</span>
        </label>
        <label class="field"><span>令牌（可选${tokenSet ? "，已设置；留空保持不变" : ""}）</span>
          <input id="sToken" data-focus="sToken" type="password" autocomplete="new-password" value="" placeholder="${tokenSet ? "••••••••（已设置，留空保持不变）" : "没有令牌就留空"}">
          <span class="field-default">${badge(tokenSet ? "已设置（不回显）" : "未设置", tokenSet ? "good" : "", "mono")}<button type="button" class="small" data-reset-field="memoryToken">清空输入</button></span>
          <span class="help">只发送 Bearer 令牌，不在页面回显；保存后输入框会清空。</span>
        </label>
        <label class="field"><span>AutoKill 插件路径 ${badge("高级", "warn")}</span>
          <input id="sPluginPath" data-focus="sPluginPath" type="text" value="${esc(val("pluginPath", s.pluginPath))}" placeholder="F:\\...\\purge.wasm" spellcheck="false">
          ${fieldDefault("pluginPath", val("pluginPath", s.pluginPath), FIELD_DEFAULTS.pluginPath)}
          <span class="help">留空则使用内置默认。</span>
        </label>
        <label class="field"><span>break 工作目录 ${badge("高级", "warn")}</span>
          <input id="sBreakDir" data-focus="sBreakDir" type="text" value="${esc(val("breakDir", s.breakDir))}" placeholder="F:\\MyApp\\eternal\\autokill-purge\\break" spellcheck="false">
          ${fieldDefault("breakDir", val("breakDir", s.breakDir), FIELD_DEFAULTS.breakDir)}
          <span class="help">留空则使用内置默认（仓库内的 break 目录）。</span>
        </label>
        <div class="actions"><button class="primary" type="submit" ${s.saving ? "disabled" : ""}>保存运行环境</button><span class="hint">保存后以服务端返回的 settings 为准；未持久化的字段会提示并在刷新后回退。</span></div>
      </form>
    </section>`;

  const diagGroup = `
    <section class="section" aria-labelledby="h-s-agreement">
      <h2 id="h-s-agreement"><span class="num">3</span>协议</h2>
      <div class="card">
        <div class="kv compact">
          <dt>签署状态</dt><dd>${agreement.accepted ? badge("已签署", "good") : badge("未签署", "warn")}</dd>
          <dt>协议版本</dt><dd class="mono">${esc(agreement.version || S.agreementVersion || "—")}</dd>
          <dt>签署时间</dt><dd>${esc(fmtTime(agreement.at))}</dd>
          <dt>签署人</dt><dd>${esc(agreement.signer || "—")}</dd>
        </div>
        ${s.resetArmed
          ? `<div class="alert warn" role="alert"><strong>重新签署会先清空当前签署，再立即弹出协议。</strong><span class="hint">确认后所有控制台接口会重新被 403 拦截，直到再次签署。</span>
              <div class="actions"><button type="button" class="danger" id="sResetConfirm">确认重签</button><button type="button" class="ghost" id="sResetCancel">取消</button></div></div>`
          : `<div class="actions" style="margin-top:10px"><button type="button" class="ghost" id="sReset">重新签署协议</button><span class="hint">清空 agreement 并重新弹窗，用于复核条款。</span></div>`}
        ${s.resetError ? alertBox(s.resetError.message, s.resetError.hint) : ""}
      </div>
    </section>

    <section class="section" aria-labelledby="h-s-data">
      <h2 id="h-s-data"><span class="num">4</span>数据与版本</h2>
      <div class="card">
        <div class="kv compact">
          <dt>数据文件</dt><dd class="mono">${esc(dataFile)}</dd>
          <dt>版本</dt><dd class="mono">${esc(S.version || "—")}</dd>
          <dt>端口</dt><dd class="mono">${esc(location.port || "—")}</dd>
          <dt>协议版本</dt><dd class="mono">${esc(S.agreementVersion || "—")}</dd>
          <dt>控制台地址</dt><dd class="mono">${esc(location.origin || "—")}</dd>
        </div>
        <p class="hint" style="margin-top:8px">state.json 由服务端原子写；协议、设置、装备、分配与尝试记录都在里面。页面不直接改文件。</p>
      </div>
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 05</p>
        <h1>设置</h1>
        <p class="lead">只改本机的这一份配置。记忆中心地址与令牌用于读卡；令牌留空表示保持不变，保存后不回显明文。</p>
      </div>
      <div class="head-meta">${badge("本机配置", "accent")}${badge("v" + (S.version || "—"), "")}</div>
    </div>

    ${groupsHtml("settings", [
      { key: "base", html: baseGroup },
      { key: "deploy", html: renderDeployBlock() },
      { key: "peer", html: renderPeerBlock() },
      { key: "memcli", html: renderMemCliBlock() },
      { key: "paths", html: pathsGroup },
      { key: "diag", html: diagGroup },
    ])}
    ${renderHostExtraGroup()}
  `;
  bindSettings();
  bindPeer();
  bindMemCli();
  bindFlowControls();
}

/** 宿主侧低频面板（规则集 / 出口白名单 / 实时模型识别）：从破甲主流程挪到设置页，避免技术模式被次要功能淹没 */
function renderHostExtraGroup() {
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  const extra = S.host.data ? renderFlowExtraPanels() : "";
  const live = renderLiveModelsSection();
  // 提示词正文编辑器也放这里：低频改动，不占破甲主流程
  const html = (S.host.prompt ? renderPromptEditor() : "") + extra + live;
  return html || `<section class="section"><h2><span class="num">5</span>宿主侧面板<span class="count">未加载</span></h2>
    <p class="hint">宿主信息还没取到：到「破甲」页看一眼（或稍后回来），这里会出现规则集、出口白名单与实时模型识别。</p></section>`;
}

/* ============================================================ 私有部署：库名 / 端口一键切换 */
function deployState() {
  if (!S.deployForm) S.deployForm = { port: "", dbName: "", migrate: false, busy: false, message: "", error: null };
  return S.deployForm;
}

async function deploySwitch() {
  const f = deployState();
  const d = S.deploy || {};
  const port = Number(f.port || d.memoryPort || 7989);
  const dbName = String(f.dbName || d.dbName || "mem-purge").trim().toLowerCase();
  if (port === Number(d.memoryPort) && dbName === String(d.dbName)) { toast(L("端口与库名都没变", "Nothing changed")); return; }
  if (!window.confirm(`切到「${dbName} @ ${port}」？\n\n会停旧实例，用新端口+新库起一个，失败自动回滚。`)) return;
  f.busy = true;
  f.error = null;
  f.message = "";
  renderPage();
  try {
    const r = await request("/api/deploy/switch", { method: "POST", body: { confirm: true, port: port, dbName: dbName, migrate: f.migrate === true } });
    if (!r || r.ok === false) throw payloadError(r, "切换失败");
    S.deploy = r.deploy || S.deploy;
    f.message = `已切到 ${r.deploy.dbName} @ ${r.deploy.memoryPort}（${r.health ? "v" + r.health.version : ""}）${r.migration && r.migration.copied ? " · 迁移 " + r.migration.copied + " 个文件" : ""}。刷新页面生效。`;
    f.port = String(r.deploy.memoryPort);
    f.dbName = r.deploy.dbName;
    await loadPeer(true).catch(() => null);
    await loadMemCli(true).catch(() => null);
  } catch (e) {
    f.error = e;
  } finally {
    f.busy = false;
    renderPage();
  }
}

function renderDeployBlock() {
  const d = S.deploy || {};
  const f = deployState();
  if (!f.port && d.memoryPort) f.port = String(d.memoryPort);
  if (!f.dbName && d.dbName) f.dbName = d.dbName;
  return `<section class="section" aria-labelledby="h-deploy">
      <h2 id="h-deploy"><span class="num">2</span>私有部署<span class="count">${esc(String(d.dbName || "mem-purge"))} @ ${esc(String(d.memoryPort || 7989))}</span></h2>
      <div class="card soft">
        <div class="s-row"><div class="s-row-main">
          <span class="mcp-line"><strong>${esc(String(d.dbName || "mem-purge"))}</strong>${badge(":" + String(d.memoryPort || 7989), "accent")}${badge("私有部署", "good")}</span>
          <span class="mono small">${esc(d.vault || "")}</span>
          <span class="mono small muted">入口 ${esc(d.entryUrl || "")}</span>
        </div></div>
        <div class="s-choices" style="margin-top:10px">
          <label class="field"><span>端口</span><input id="dpPort" type="text" value="${esc(f.port || "")}" placeholder="7989"></label>
          <label class="field"><span>库名（vault 目录后缀）</span><input id="dpDb" type="text" value="${esc(f.dbName || "")}" placeholder="mem-purge"></label>
          <label class="field"><span>迁移</span>
            <select id="dpMigrate">
              <option value="0"${f.migrate ? "" : " selected"}>不迁移（新库从空开始）</option>
              <option value="1"${f.migrate ? " selected" : ""}>复制旧库的 db 到新库</option>
            </select>
          </label>
          <div class="actions"><button type="button" class="primary" data-deploy-switch${f.busy ? " disabled" : ""}>${f.busy ? "切换中…" : "一键切换"}</button></div>
        </div>
        <p class="hint">库名小写字母/数字/连字符（2–41 位）；端口 1024–65535 且不能是 8792。切换会停旧实例 → 起新实例 → 核对 vault → 成功才写 deploy.json，失败自动回滚并重启旧实例。桌面启动器读同一份配置。</p>
      </div>
      ${f.error ? alertBox("切换失败", simpleReason(f.error)) : ""}
      ${f.message ? okBox(f.message) : ""}
    </section>`;
}

function bindDeploy() {
  const f = deployState();
  const port = $("#dpPort");
  if (port) port.addEventListener("input", () => { f.port = port.value; });
  const db = $("#dpDb");
  if (db) db.addEventListener("input", () => { f.dbName = db.value; });
  const mg = $("#dpMigrate");
  if (mg) mg.addEventListener("change", () => { f.migrate = mg.value === "1"; });
  $$("#page [data-deploy-switch]").forEach((el) => el.addEventListener("click", () => deploySwitch()));
}

/* ============================================================ 记忆库 CLI（dsh-memory） */
function cliState() {
  if (!S.memCli) S.memCli = { loaded: false, loading: false, error: null, data: null, busy: "", message: "", audit: null, ledger: null };
  return S.memCli;
}

async function loadMemCli(force = false) {
  const c = cliState();
  if (c.loading || (c.loaded && !force)) return;
  c.loading = true;
  c.error = null;
  try {
    const d = await request("/api/memory/cli/status");
    if (d && d.ok === false) throw payloadError(d, "读取失败");
    c.data = d;
    c.loaded = true;
  } catch (e) {
    c.error = e;
  } finally {
    c.loading = false;
    if (S.tab === "settings") renderPage();
  }
}

async function memCliAction(kind) {
  const c = cliState();
  c.busy = kind;
  c.message = "";
  renderPage();
  try {
    if (kind === "restart" || kind === "stop") {
      const d = await request("/api/memory/cli/" + kind, { method: "POST", body: { confirm: true } });
      if (!d || d.ok === false) throw payloadError(d, kind + " 失败");
      c.message = kind === "restart"
        ? `已用 CLI 重启（${d.health && d.health.reachable ? "在线 v" + d.health.version + " · vault " + String(d.health.vault || "").split("\\").pop() : "还没起来"}）`
        : "已停止";
    } else if (kind === "audit") {
      const d = await request("/api/memory/cli/audit?status=pending");
      c.audit = d;
      const n = d.json ? ((d.json.cards || []).length) : null;
      c.message = n != null ? `待审 ${n} 张` : "已读取";
    } else if (kind === "ledger") {
      const d = await request("/api/memory/cli/ledger?days=7");
      c.ledger = d;
      c.message = d.ok ? "账本已读取（近 7 天）" : "账本读取失败";
    }
    await loadMemCli(true);
  } catch (e) {
    c.error = e;
  } finally {
    c.busy = "";
    renderPage();
  }
}

function renderMemCliBlock() {
  const c = cliState();
  if (!c.loaded && !c.loading) loadMemCli();
  const d = c.data || {};
  const h = d.health || {};
  const wds = d.watchdogs || [];
  const okTone = h.reachable ? "good" : "bad";
  return `<section class="section" aria-labelledby="h-cli">
      <h2 id="h-cli"><span class="num">4</span>记忆库 CLI<span class="count">${esc(String(d.port || 7989))} · ${h.reachable ? "在线 v" + esc(String(h.version || "")) : "离线"}</span></h2>
      ${c.error ? alertBox("CLI 读取失败", simpleReason(c.error)) : ""}
      <div class="card soft">
        <div class="s-row"><div class="s-row-main">
          <span class="mcp-line"><strong>dsh-memory</strong>${badge(h.reachable ? "在线" : "离线", okTone)}${badge("v" + esc(String(d.servedVersion || d.pkgVersion || "?")), "")}</span>
          <span class="mono small">${esc(d.vault || "")}</span>
          <span class="mono small muted">watchdog ${wds.length ? wds.map((w) => "pid " + w.pid + (w.alive ? " 活跃" : " 已停")).join(" · ") : "未托管（启动器直起）"}</span>
        </div>
        <div class="actions">
          <button type="button" class="small" data-cli="audit"${c.busy === "audit" ? " disabled" : ""}>看待审</button>
          <button type="button" class="small" data-cli="ledger"${c.busy === "ledger" ? " disabled" : ""}>看账本</button>
          <button type="button" class="small" data-cli="restart"${c.busy === "restart" ? " disabled" : ""}>${c.busy === "restart" ? "重启中…" : "CLI 重启"}</button>
          <button type="button" class="small" data-cli="stop"${c.busy === "stop" ? " disabled" : ""}>停止</button>
        </div>
        </div>
        <p class="hint">这里调的是它自带的 <code>dsh-memory</code>；重启/停止一律带死 <code>--port 7989 --vault ~/.dsh/memory-vault-mem-purge</code>，audit/ledger 额外注入 <code>MEMORY_VAULT_DIR</code>（它这两个子命令不认 --vault，只认这个环境变量）。</p>
      </div>
      ${c.message ? okBox(c.message) : ""}
      ${c.audit && c.audit.json ? `<div class="card soft" style="margin-top:8px"><div class="s-row"><div class="s-row-main"><strong>待审 ${(c.audit.json.cards || []).length} 张</strong>
        <span class="mono small">${esc((c.audit.json.cards || []).slice(0, 6).map((x) => x.title || x.path || x).join(" · "))}</span></div></div>
        <p class="hint">审批请到记忆库面板的「审核中心」（本页不代批）。</p></div>` : ""}
      ${c.ledger && c.ledger.json ? `<div class="card soft" style="margin-top:8px"><div class="s-row"><div class="s-row-main"><strong>近 7 天账本</strong>
        <span class="mono small">${esc(JSON.stringify(c.ledger.json.totals || {}).slice(0, 220))}</span></div></div></div>` : ""}
    </section>`;
}

function bindMemCli() {
  $$("#page [data-cli]").forEach((el) => el.addEventListener("click", () => {
    const kind = el.dataset.cli;
    if (kind === "restart" && !window.confirm("用 CLI 重启 7989 记忆库？（会带死 --vault mem-purge）")) return;
    if (kind === "stop" && !window.confirm("停掉 7989 记忆库？桌面图标可以再拉起来。")) return;
    memCliAction(kind);
  }));
}

/* ============================================================ MEM Pair（实例配对 / 互相传卡） */
function peerState() {
  if (!S.peer) {
    S.peer = { loaded: false, loading: false, error: null, self: null, peers: [], pending: [], isolated: null, found: null, busy: "", message: "", form: { host: "", port: "7989", code: "", mode: "connect" } };
  }
  return S.peer;
}

async function loadPeer(force = false) {
  const pr = peerState();
  if (pr.loading || (pr.loaded && !force)) return;
  pr.loading = true;
  pr.error = null;
  try {
    const d = await request("/api/peer");
    if (d && d.ok === false) throw payloadError(d, "读取失败");
    pr.self = (d && d.self) || null;
    pr.peers = (d && d.peers) || [];
    pr.pending = (d && d.pending) || [];
    pr.isolated = (d && d.isolated) || null;
    pr.loaded = true;
  } catch (e) {
    pr.error = e;
  } finally {
    pr.loading = false;
    if (S.tab === "settings") renderPage();
  }
}

async function peerAction(kind, payload) {
  const pr = peerState();
  pr.busy = kind;
  pr.message = "";
  renderPage();
  try {
    const d = await request("/api/peer/" + kind, { method: "POST", body: payload });
    if (!d || d.ok === false) throw payloadError(d, kind + " 失败");
    pr.message = kind === "pair" ? "配对请求已发出（对方要在面板上确认）"
      : kind === "accept" ? "已接受配对"
      : kind === "upload" ? `已推送${d.pushed != null ? " " + d.pushed + " 张" : ""}`
      : kind === "download" ? `已拉取${d.pulled != null ? " " + d.pulled + " 张" : ""}`
      : kind === "discover" ? `发现 ${((d.found || []).length)} 个同类实例`
      : "完成";
    pr.found = kind === "discover" ? (d.found || []) : pr.found;
    await loadPeer(true);
  } catch (e) {
    pr.error = e;
  } finally {
    pr.busy = "";
    renderPage();
  }
}

function renderPeerBlock() {
  const pr = peerState();
  if (!pr.loaded && !pr.loading) loadPeer();
  const self = pr.self;
  const form = pr.form || {};
  const peers = pr.peers || [];
  const pending = pr.pending || [];
  const isolated = pr.isolated || {};
  const peerRows = peers.map((p) => `<div class="s-row">
      <div class="s-row-main">
        <span class="mcp-line"><strong>${esc(p.name || p.pairCode || p.id)}</strong>${badge(p.pairCode || "", "accent")}</span>
        <span class="mono small">${esc(p.url || "")}</span>
      </div>
      <div class="actions">
        <button type="button" class="small" data-peer-up="${esc(p.pairCode)}">推卡给对方</button>
        <button type="button" class="small" data-peer-down="${esc(p.pairCode)}">拉对方的卡</button>
        <button type="button" class="small" data-peer-revoke="${esc(p.pairCode)}">解除</button>
      </div>
    </div>`).join("");
  const pendRows = pending.map((p) => `<div class="s-row">
      <div class="s-row-main"><strong>${esc(p.name || p.pairCode || p.id)}</strong>${badge("请求配对", "warn")}
        <span class="mono small">${esc(p.url || "")} · ${esc(p.fingerprint || "")}</span></div>
      <div class="actions">
        <button type="button" class="small primary" data-peer-accept="${esc(p.id)}">接受</button>
        <button type="button" class="small" data-peer-revoke="${esc(p.pairCode || "")}">忽略</button>
      </div>
    </div>`).join("");
  return `<section class="section" aria-labelledby="h-peer">
      <h2 id="h-peer"><span class="num">3</span>MEM Pair<span class="count">${self && self.pairCode ? "本机匹配码 " + esc(self.pairCode) : "读取中…"}</span></h2>
      ${pr.error ? alertBox("配对功能读取失败", simpleReason(pr.error)) : ""}
      <div class="card soft">
        <div class="s-row"><div class="s-row-main"><strong>本机匹配码</strong>
          <span class="mono" style="font-size:20px;letter-spacing:.12em">${esc(self && self.pairCode ? self.pairCode : "—")}</span>
          <span class="mono small muted">${esc(self ? [self.name, "fp " + self.fingerprint, "端口 " + self.port, "发现端口 " + self.discoveryPort].filter(Boolean).join(" · ") : "")}</span></div>
          <div class="actions"><button type="button" class="small" data-peer-copy="${esc(self && self.pairCode ? self.pairCode : "")}">复制</button>
            <button type="button" class="small" data-peer-discover>局域网发现</button></div>
        </div>
        <p class="hint">库名 ${esc(isolated.dbName || "mem-purge")} · 端口 ${esc(String(isolated.port || 7989))} · 这个码念给对方或粘到对方面板即可；首次配对要对方确认，之后只凭码重连。</p>
      </div>

      <div class="s-choices" style="margin-top:10px">
        <label class="field"><span>对方地址（可选，主机）</span><input id="peerHost" type="text" value="${esc(form.host || "")}" placeholder="192.168.1.20"></label>
        <label class="field"><span>端口</span><input id="peerPort" type="text" value="${esc(form.port || "7989")}" placeholder="7989"></label>
        <label class="field"><span>对方匹配码</span><input id="peerCode" type="text" value="${esc(form.code || "")}" placeholder="XXXX-XXXX" style="text-transform:uppercase"></label>
        <div class="actions"><button type="button" class="primary" data-peer-pair${pr.busy === "pair" ? " disabled" : ""}>${pr.busy === "pair" ? "配对中…" : "配对 / 重连"}</button></div>
      </div>
      <p class="hint">只填匹配码 = 重连已配对过的实例；首次配对请同时填主机与端口。</p>

      ${pending.length ? `<div style="margin-top:10px"><strong>待确认（${pending.length}）</strong>${pendRows}</div>` : ""}
      <div style="margin-top:10px"><strong>已配对（${peers.length}）</strong>${peerRows || `<p class="small muted">还没有配对实例。</p>`}</div>
      ${pr.found && pr.found.length ? `<div style="margin-top:10px"><strong>局域网发现（${pr.found.length}）</strong>${pr.found.map((f) => `<div class="s-row"><div class="s-row-main"><strong>${esc(f.name || f.host || "")}</strong><span class="mono small">${esc(f.url || (f.host + ":" + f.port) || "")} ${esc(f.pairCode || "")}</span></div></div>`).join("")}</div>` : ""}
      ${pr.message ? okBox(pr.message) : ""}
    </section>`;
}

function bindPeer() {
  const pr = peerState();
  const field = (sel, key) => {
    const el = $(sel);
    if (el) el.addEventListener("input", () => { pr.form = Object.assign({ host: "", port: "7989", code: "" }, pr.form, { [key]: el.value }); });
  };
  field("#peerHost", "host");
  field("#peerPort", "port");
  field("#peerCode", "code");
  $$("#page [data-peer-copy]").forEach((el) => el.addEventListener("click", () => {
    const code = el.dataset.peerCopy;
    if (!code) return;
    copyText(code, "匹配码已复制：" + code);
  }));
  $$("#page [data-peer-discover]").forEach((el) => el.addEventListener("click", () => peerAction("discover", {})));
  $$("#page [data-peer-pair]").forEach((el) => el.addEventListener("click", () => {
    const f = pr.form || {};
    const code = String(f.code || "").trim().toUpperCase();
    const host = String(f.host || "").trim();
    const port = Number(f.port) || 7989;
    if (!code && !host) { toastError(L("填对方匹配码，或主机+端口", "Enter a pair code or host+port")); return; }
    peerAction("pair", host ? { host: host, port: port, code: code } : { code: code, mode: "connect" });
  }));
  $$("#page [data-peer-accept]").forEach((el) => el.addEventListener("click", () => peerAction("accept", { id: el.dataset.peerAccept })));
  $$("#page [data-peer-revoke]").forEach((el) => el.addEventListener("click", () => {
    const code = el.dataset.peerRevoke;
    if (!window.confirm("解除这个配对？之后要重新配对。")) return;
    peerAction("revoke", { confirm: true, code: code });
  }));
  $$("#page [data-peer-up]").forEach((el) => el.addEventListener("click", () => {
    if (!window.confirm("把本库已审的卡推给对方？对方会进待审。")) return;
    peerAction("upload", { confirm: true, code: el.dataset.peerUp });
  }));
  $$("#page [data-peer-down]").forEach((el) => el.addEventListener("click", () => {
    if (!window.confirm("把对方的卡拉进本库？会进本库的待审。")) return;
    peerAction("download", { confirm: true, code: el.dataset.peerDown });
  }));
}

function bindSettings() {
  const form = $("#settingsForm");
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); saveSettings(); });
  const runtime = $("#runtimeForm");
  if (runtime) runtime.addEventListener("submit", (e) => { e.preventDefault(); saveSettings(); });
  const test = $("#sTest");
  if (test) test.addEventListener("click", () => testConnection());
  const reset = $("#sReset");
  if (reset) reset.addEventListener("click", () => { S.settings.resetArmed = true; S.settings.resetError = null; renderPage(); });
  const cancel = $("#sResetCancel");
  if (cancel) cancel.addEventListener("click", () => { S.settings.resetArmed = false; renderPage(); });
  const confirm = $("#sResetConfirm");
  if (confirm) confirm.addEventListener("click", () => resetAgreement());
  /* 草稿：切换模式 / 重渲染都不丢未保存的输入 */
  const bindDraft = (id, key) => {
    const el = $(id);
    if (el) el.addEventListener("input", () => { S.settings.draft[key] = el.value; });
  };
  bindDraft("#sBase", "memoryBase");
  bindDraft("#sToken", "memoryToken");
  bindDraft("#sPluginPath", "pluginPath");
  bindDraft("#sBreakDir", "breakDir");
  const lang = $("#sLang");
  if (lang) lang.addEventListener("change", () => { S.settings.draft.language = lang.value; S.settings.language = lang.value; });
}

/* ------------------------------------------------------------------ about */
function renderAbout() {
  const baseGroup = `
    <section class="section" aria-labelledby="h-a-project">
      <h2 id="h-a-project"><span class="num">1</span>项目</h2>
      <div class="card">
        <div class="kv compact">
          <dt>项目名</dt><dd>autokill-purge（梦神破甲）</dd>
          <dt>版本</dt><dd class="mono">${esc(S.version || "—")}</dd>
          <dt>作者</dt><dd>EternalNight996（YG）</dd>
          <dt>署名</dt><dd>梦神破甲（Dream God Armor Break）</dd>
          <dt>许可</dt><dd>MIT</dd>
          <dt>定位</dt><dd>二进制破甲内核 · 模型红队研究 · 智能体装备 · memory-eternal 实时分发</dd>
          <dt>运行方式</dt><dd>本机单进程；默认只连本机 memory-eternal，云端需显式改地址</dd>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="h-a-cap">
      <h2 id="h-a-cap"><span class="num">2</span>能力清单</h2>
      <div class="card">
        <ul>
          <li><b>破甲 · 模型侧</b>：9 类模型、3 层、12 技术；生成可复制载荷与编码变体，记录尝试与命中率；不调用任何模型 API。</li>
          <li><b>破甲 · 二进制侧</b>：info / scan / plan / patch / invert / verify / restore；下刀必须带 expect，结果固定给 sha256 前后与 differingBytes。</li>
          <li><b>装备</b>：6 个预设 × dsh / mengbot / autokill / 自定义 × 只读 / 受控 / 全权，产出可复制 JSON 与发放历史。</li>
          <li><b>记忆分发</b>：选卡、只发技能卡、实时端点 <span class="mono">/api/assign/&lt;agent&gt;.md</span> 与 DSH 追加片段。</li>
          <li><b>记忆中心</b>：统计、检索、详情、写卡只走 pending；服务端不调用 approve/reject。</li>
          <li><b>协议门</b>：首启必须勾选签署；未签署时服务端对其余 API 返回 403；设置页可重签。</li>
        </ul>
      </div>
    </section>

    <section class="section" aria-labelledby="h-a-statement">
      <h2 id="h-a-statement"><span class="num">3</span>声明</h2>
      <div class="card">
        <p>本工作台仅用于<strong>本人拥有或获得书面授权</strong>的系统、模型与数据的安全研究、红队演练与教学。
        禁止用于任何未经授权的入侵、破解、窃取、破坏或规避他人安全机制的行为。</p>
        <p class="muted">使用者对自己的一切操作与后果负全部责任。发现用于非法用途，将保留证据并依法移交有关部门。</p>
        <p class="hint">AutoKill 只看不改；改字节只发生在 break，且只改副本。Web 只做编排与呈现，自己不写字节。</p>
      </div>
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 06</p>
        <h1>关于</h1>
        <p class="lead">autokill-purge —— 面向二进制破甲、模型红队研究、智能体装备与记忆分发的本机工作台。</p>
      </div>
      <div class="head-meta">${badge("v" + (S.version || "—"), "accent")}${badge("MIT", "")}${badge("本地优先", "good")}</div>
    </div>

    ${groupsHtml("about", [{ key: "base", html: baseGroup }])}
  `;
  bindGroups();
}

/* ------------------------------------------------------------------ field reset */
function resetField(what) {
  if (!what) return;
  const value = FIELD_DEFAULTS[what];
  if (what === "role") { S.breach.role = value; }
  else if (what === "output") { S.breach.output = value; }
  else if (what === "task") { S.breach.task = value; }
  else if (what === "memoryToken") { S.settings.draft.memoryToken = ""; }
  else if (Object.prototype.hasOwnProperty.call(FIELD_DEFAULTS, what)) {
    S.settings.draft[what] = value;
    if (what === "language") S.settings.language = value || "zh";
    if (what === "memoryBase" && value) S.settings.memoryBase = value;
  } else return;
  toast("已恢复默认");
  renderPage();
}

/* ------------------------------------------------------------------ init */
function init() {
  // 右侧「注入状态」栏：首屏拉一次，之后每 30 秒刷新（页面隐藏时跳过）
  loadInjectSummary(true);
  setInterval(() => { if (!document.hidden) loadInjectSummary(true); }, 30000);
  const start = tabFromHash();
  S.tab = start;
  // 地址栏本来就没 hash 时先别写死：私有部署的默认页要等 /api/state 回来，
  // 由 boot() 按 deploy.entryHash 落到 #/memory。已有 hash 才做规范化。
  if (location.hash) {
    try { history.replaceState(null, "", "#/" + start); } catch { /* file:// */ }
  }

  const check = $("#agreeCheck");
  if (check) check.addEventListener("change", () => {
    $("#agreeAccept").disabled = !check.checked;
    $("#agreeError").innerHTML = "";
  });
  const accept = $("#agreeAccept");
  if (accept) accept.addEventListener("click", () => acceptAgreement());
  const decline = $("#agreeDecline");
  if (decline) decline.addEventListener("click", () => {
    $("#agreeForm").hidden = true;
    $("#agreeLocked").hidden = false;
    $("#agreeBack").focus();
  });
  const back = $("#agreeBack");
  if (back) back.addEventListener("click", () => {
    $("#agreeLocked").hidden = true;
    $("#agreeForm").hidden = false;
    $("#agreeCheck").checked = false;
    $("#agreeAccept").disabled = true;
    $("#agreeError").innerHTML = "";
    $("#agreeCheck").focus();
  });
  document.addEventListener("keydown", trapAgreementFocus);

  document.addEventListener("click", (event) => {
    const copy = event.target.closest("[data-copy-id]");
    if (copy) {
      const text = copyStore.get(copy.dataset.copyId);
      if (text != null) copyText(text, copy.dataset.copyMsg || "已复制");
      return;
    }
    // 破甲载荷「入库」：简单/技术两种模式共用同一个委托，避免两套绑定重复触发
    const absorb = event.target.closest("[data-absorb]");
    if (absorb) {
      absorbVariant(absorb.dataset.absorb);
      return;
    }
    // 破甲载荷「注入宿主」：第一次点变成确认态，第二次点才真写 prompt-inject.md
    const injectHost = event.target.closest("[data-inject-host]");
    if (injectHost) {
      injectHostPayload(injectHost.dataset.injectHost);
      return;
    }
    // 指令层（AGENTS.md · 免重启）：同两次点击确认
    const injectAgents = event.target.closest("[data-inject-agents]");
    if (injectAgents) {
      injectAgentsMd(injectAgents.dataset.injectAgents);
      return;
    }
    const injectAgentsOff = event.target.closest("[data-inject-agents-off]");
    if (injectAgentsOff) {
      removeAgentsMd();
      return;
    }
    const retry = event.target.closest("[data-retry-boot]");
    if (retry) {
      boot();
      return;
    }
    const hint = event.target.closest("[data-tech-hint]");
    if (hint) {
      lsSet(LS_TECH_HINT, "1");
      S.techHintOpen = false;
      renderPage();
      return;
    }
    const reset = event.target.closest("[data-reset-field]");
    if (reset) {
      resetField(reset.dataset.resetField);
      return;
    }
  });

  const modeSwitch = $("#modeSwitch");
  if (modeSwitch) modeSwitch.addEventListener("click", () => setUiMode(modeIsTechnical() ? "simple" : "technical"));
  updateModeSwitch();

  window.addEventListener("hashchange", onRoute);
  boot();
}

/* 启动入口在文件末尾：init() 会立刻调用 loadInjectSummary()，它依赖下面的 railState，
   所以必须等整个文件执行完再起。见文件底部「启动」。 */





/* ============================================================ 右侧「注入状态」栏
   为什么要它：破甲页的动作散在「补丁 / 插件 / 能力」三处，用户点完不知道到底注入了什么。
   这一栏常驻右侧，一屏给：本机与宿主、83 条补丁的分层账、插件与 bundles、6 个能力的开关。
   数据只打一个 /api/inject/summary（后端聚合），30 秒刷新一次，失败不影响主页面。 */
/* 宿主是唯一维度：栏里永远只显示**当前宿主**的数。切宿主 = 先清空再拉，
   并用递增的 req 丢弃"切走之后才回来"的旧响应，避免 A 宿主的响应盖住 B 宿主的栏。 */
const railState = { hostId: null, data: null, at: 0, loading: false, error: null, req: 0 };
var railReady = false;      // 栏代码已初始化（request 的写接口钩子靠它做保护）
var railTimer = null;       // 合并连击的刷新定时器

function scheduleRailRefresh(delay = 350) {
  if (!railReady) return;
  clearTimeout(railTimer);
  railTimer = setTimeout(() => loadInjectSummary(true), delay);
}

/** 任何会改宿主状态的动作跑完都调它：破甲/卸载/插件/梦神破甲/MengBot 注入/ops run */
function refreshRail() {
  return loadInjectSummary(true);
}
railReady = true;

async function loadInjectSummary(force = false) {
  const hostId = S.hostTarget || "dsh";
  if (railState.loading && railState.hostId === hostId) return;
  if (!force && railState.hostId === hostId && railState.data && Date.now() - railState.at < 15000) return;
  const req = ++railState.req;
  if (railState.hostId !== hostId) {
    railState.hostId = hostId;
    railState.data = null;
    railState.at = 0;
    railState.error = null;
    renderInjectRail(); // 立刻清掉上一个宿主的数字，进入「读取中」
  }
  railState.loading = true;
  try {
    const d = await request("/api/inject/summary?host=" + encodeURIComponent(hostId) + (force ? "&fresh=1" : ""));
    if (req !== railState.req) return; // 期间又切了宿主，这份响应作废
    if (!d || (d.ok === false && !d.hostId)) throw new Error((d && (d.error || d.detail)) || "summary 不可用");
    railState.data = d;
    railState.at = Date.now();
    railState.error = null;
  } catch (e) {
    if (req === railState.req) railState.error = e;
  } finally {
    if (req === railState.req) {
      railState.loading = false;
      renderInjectRail();
    }
  }
}

function railPct(n, total) {
  return total ? Math.max(0, Math.min(100, Math.round((n || 0) / total * 100))) : 0;
}

function railShortPath(p, keep = 2) {
  const parts = String(p || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= keep ? parts.join("/") : "…/" + parts.slice(-keep).join("/");
}

function railRowsHtml(list) {
  return (list || []).map((r) =>
    '<div class="rail-kv"><span>' + esc(r.k) + '</span><span class="' + (r.mono === false ? "mini" : "mono") + '" title="' + esc(r.title || r.v) + '">' +
    esc(r.mono === false ? r.v : railShortPath(r.v, 3)) + '</span></div>').join("");
}

function railStatsHtml(list) {
  return (list || []).map((r) =>
    '<div class="rail-kv"><span>' + esc(r.k) + '</span><span class="rail-num">' + esc(r.v) + '</span></div>').join("");
}

function railNoteHtml(text) {
  return text ? '<p class="rail-note mini">' + esc(text) + '</p>' : "";
}

/** 头部徽标：DSH 看补丁是否生效，MengBot/AutoKill 看进程是否在跑 */
function railHostBadge(d) {
  const host = d.host || {};
  if (d.hostId === "dsh") {
    if (host.effective) return host.processLoadedFrom === "not-running"
      ? { cls: "ok", text: "已落地 · 宿主未运行" }
      : { cls: "ok", text: "补丁生效中" };
    // 别把「文件写了」说成「生效」：asar 还在时桌面壳读的是 asar，一条补丁都没被加载。
    if (host.desktopSealed) return { cls: "warn", text: "已写入 · 未生效" };
    // asar 已让位但进程还是旧 asar：落地做完了，只差宿主重启
    if (host.processLoadedFrom === "asar") return { cls: "warn", text: "已落地 · 等宿主重启" };
    return { cls: "", text: "待确认" };
  }
  return { cls: host.running ? "ok" : "", text: host.running ? "运行中" : "未运行" };
}

/** 注入生效行：文件在 ≠ 生效；未生效时由调用方加红色 class */
function instructionsRailText(x) {
  if (!x) return "—";
  if (!x.hasBlock) return x.exists ? "AGENTS.md 在 · 无注入块" : "未写入";
  return x.inRecentSessions ? "生效中（免重启）" : "已写入 · 等下一步生效";
}

function injectionRailText(inj) {
  if (!inj) return "—";
  if (!inj.ready) return "未写入（没有 prompt-inject.md）";
  const tk = inj.estTokensPerRequest ? " · 约 " + fmtNum(inj.estTokensPerRequest) + " tokens/请求" : "";
  if (inj.effective) return "生效中 · 最近 " + inj.checked + " 个会话已注入" + tk;
  const older = inj.withInjection ? "，其中 " + inj.withInjection + " 个曾注入" : "";
  return "文件在 · 未生效（最近 " + inj.checked + " 个会话里没有 project_instructions" + older + "）" + tk;
}

function renderInjectRail() {
  const el = document.getElementById("injectRail");
  if (!el) return;
  const want = S.hostTarget || "dsh";
  const hostLabel = hostTargetName(want);
  const d = railState.data;
  if (!d) {
    el.dataset.host = want;
    el.dataset.loading = "1";
    const err = railState.error;
    const why = err
      ? esc(simpleReason(err))
      : (railState.hostId === want || !railState.hostId ? "读取中…" : "切换宿主，读取中…");
    el.innerHTML = '<div class="rail-card' + (err ? ' rail-err-card' : '') + '"><h3>注入状态 <span class="badge' + (err ? ' bad' : '') + '">' + esc(hostLabel) + '</span></h3>' +
      '<p class="mini' + (err ? ' rail-err' : '') + '">' + why + "</p>" +
      '<div class="rail-foot"><a href="#" data-rail-refresh>重试</a></div></div>';
    const retry = el.querySelector("[data-rail-refresh]");
    if (retry) retry.addEventListener("click", (ev) => { ev.preventDefault(); loadInjectSummary(true); });
    return;
  }
  el.dataset.host = d.hostId || want;
  el.dataset.loading = "0";
  el.dataset.at = String(railState.at || 0);

  const host = d.host || {};
  const p = d.patches || {};
  const pl = d.plugins || {};
  const cap = d.capabilities || {};
  const badge = railHostBadge(d);
  const total = p.total || 0;
  const applied = p.applied || 0;
  const pending = p.pending || 0;
  const failed = p.failed || 0;
  const na = p.na || 0;
  const sealed = !!(host && host.desktopSealed);
  const layers = Object.keys(p.byLayer || {});
  const layerRows = layers.map((l) => {
    const all = p.byLayer[l] || 0;
    const ok = (p.byLayerApplied || {})[l] || 0;
    return '<li><span>' + esc(l) + '</span><b class="rail-num">' + fmtNum(ok) + '/' + fmtNum(all) + '</b></li>';
  }).join("");
  const notable = (p.notable || []).map((x) => {
    const bad = /fail|missing|error|失效/i.test(String(x.status || ""));
    return '<li><span>' + esc(x.nameZh || x.name || ("#" + x.id)) + '</span><em class="mini' + (bad ? " bad" : "") + '">' + esc(x.status || "") + '</em></li>';
  }).join("");
  const patchItems = (p.items || []).slice(0, 8).map((x) => {
    const bad = !x.applied && /fail|missing|error|失效/i.test(String(x.current || ""));
    const on = x.applied ? (sealed ? "已写入" : "已应用") : (sealed ? "未写入" : "未应用");
    return '<li><span>' + esc(x.label || x.id) + '</span><em class="mini' + (bad ? " bad" : "") + '">' + on + '</em></li>';
  }).join("");
  const plugRows = (pl.installed || []).map((x) =>
    '<div class="rail-plug"><span class="mono">' + esc(String(x.name).replace("autokill-purge-plugin", "autokill 插件")) + '</span><em>' +
    esc(x.version || "未装") + (x.inBundles ? " · 已登记" : " · 未登记") + '</em></div>').join("");
  const capDots = ((cap.items) || []).map((x) =>
    '<span class="rail-dot ' + (x.available ? "on" : "off") + '" title="' + esc(x.summary || "") + '">' + esc(x.zh || x.id) + '</span>').join("");
  const rt = (pl.redteam && pl.redteam.summary) ? pl.redteam.summary : "";
  const idn = (pl.identity && pl.identity.summary) ? pl.identity.summary : "";

  // 补丁卡：适用就画进度条与清单；不适用就写清"为什么没有"和该宿主真实的计数
  const patchCard = !p.applicable
    ? '<div class="rail-card">'
      + '  <h3>' + esc(p.name || "补丁") + (p.total !== undefined ? ' <span class="mini">' + fmtNum(p.applied || 0) + '/' + fmtNum(p.total || 0) + ' ' + esc(p.unit || "") + '</span>' : '') + '</h3>'
      + railNoteHtml(p.note)
      + railStatsHtml(p.stats)
      + '</div>'
    : '<div class="rail-card">'
      + '  <h3>' + esc(p.name || "宿主补丁") + ' <span class="mini">' + fmtNum(applied) + '/' + fmtNum(total) + ' ' + esc(p.unit || "") + (sealed ? ' · 未生效' : '') + '</span></h3>'
      + '  <div class="rail-bar"><i class="ok" style="width:' + railPct(applied, total) + '%"></i><i class="wait" style="width:' + railPct(pending, total) + '%"></i><i class="fail" style="width:' + railPct(failed, total) + '%"></i><i class="na" style="width:' + railPct(na, total) + '%"></i></div>'
      + '  <div class="rail-kv"><span>' + (sealed ? '已写入 / 待写入' : '已应用 / 待应用') + '</span><span class="rail-num">' + fmtNum(applied) + ' / ' + fmtNum(pending) + '</span></div>'
      + (sealed ? '  <div class="rail-kv"><span>生效</span><span class="rail-err mini">否 · 宿主读 app.asar，需「落地并重启宿主」</span></div>' : "")
      + (failed || na ? '  <div class="rail-kv"><span>失败 / 跳过</span><span class="rail-num">' + fmtNum(failed) + ' / ' + fmtNum(na) + '</span></div>' : "")
      + (layerRows ? '  <ul class="rail-list">' + layerRows + '</ul>' : "")
      + (patchItems ? '  <ul class="rail-list">' + patchItems + '</ul>' : "")
      + (notable ? '  <ul class="rail-list">' + notable + '</ul>' : "")
      + railNoteHtml(p.note)
      + '</div>';

  const pluginCard = !pl.applicable
    ? '<div class="rail-card">'
      + '  <h3>插件 · 装备</h3>'
      + railNoteHtml(pl.note)
      + railStatsHtml(pl.stats)
      + '</div>'
    : '<div class="rail-card">'
      + '  <h3>插件 <span class="mini">bundles ' + fmtNum(pl.bundleCount || 0) + '</span></h3>'
      + plugRows
      + (rt ? '  <div class="rail-kv"><span>红队面</span><span class="mini">' + esc(rt) + '</span></div>' : "")
      + (idn ? '  <div class="rail-kv"><span>身份</span><span class="mini">' + esc(idn) + '</span></div>' : "")
      + railNoteHtml(pl.note)
      + '</div>';

  const capCard = '<div class="rail-card">'
    + '  <h3>能力' + (cap.applicable ? ' <span class="mini">' + fmtNum(cap.available) + '/' + fmtNum(cap.total) + '</span>' : '') + '</h3>'
    + (capDots ? '  <div class="rail-dots">' + capDots + '</div>' : "")
    + railNoteHtml(cap.note)
    + '</div>';
  // 后端取数期间的错误（summary.errors）也必须是红的，不许静默吞掉
  const errRows = (Array.isArray(d.errors) ? d.errors : []).map((m) =>
    '<div class="rail-kv"><span class="rail-err">错误</span><span class="rail-err mono">' + esc(String(m)) + '</span></div>').join("");
  const errCard = errRows ? '<div class="rail-card rail-err-card"><h3>取数错误</h3>' + errRows + '</div>' : "";

  el.innerHTML = ''
    + '<div class="rail-card">'
    + '  <h3>本机 · 宿主 <span class="badge ' + badge.cls + '">' + esc(hostLabel) + '</span></h3>'
    + railRowsHtml(host.rows)
    + (S.deploy && S.deploy.owner ? '  <div class="rail-kv"><span>业主</span><span class="mini">' + esc(S.deploy.owner.display) + '</span></div>' : "")
    + (d.hostId === "dsh" && badge.cls !== "ok" ? '  <div class="rail-kv"><span>状态</span><span class="mini">' + esc(badge.text) + '</span></div>' : "")
    + (d.injection ? '  <div class="rail-kv"><span>提示词注入</span><span class="mini' + (d.injection.ready && !d.injection.effective ? ' rail-err' : '') + '">' + esc(injectionRailText(d.injection)) + '</span></div>' : "")
    + (d.injection && d.injection.instructions ? '  <div class="rail-kv"><span>指令层</span><span class="mini">' + esc(instructionsRailText(d.injection.instructions)) + '</span></div>' : "")
    + railNoteHtml(host.note)
    + '</div>'
    + patchCard
    + pluginCard
    + capCard
    + errCard
    + '<div class="rail-foot">' + esc(hostLabel) + ' · 更新于 ' + esc(new Date(railState.at || Date.now()).toLocaleTimeString("zh-CN", { hour12: false }))
    + ' · <a href="#" data-rail-refresh>刷新</a>' + (railState.error ? ' · <span class="rail-err">' + esc(simpleReason(railState.error)) + '</span>' : "") + '</div>';

  const btn = el.querySelector("[data-rail-refresh]");
  if (btn) btn.addEventListener("click", (ev) => { ev.preventDefault(); loadInjectSummary(true); });
}

/* ------------------------------------------------------------------ 启动
   放在文件最末：init() 第一步就 loadInjectSummary(true)，它用到 railState；
   若在 railState 之前调用会撞 TDZ（Cannot access 'railState' before initialization）。 */
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
