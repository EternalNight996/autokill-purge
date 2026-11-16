/* autokill-purge · six-page console. No framework, no build step. */

/* Keep runtime failures inspectable instead of silently breaking a page. */
window.__apErrors = [];
window.addEventListener("error", (event) => {
  window.__apErrors.push({ kind: "error", message: event.message || "script error", source: event.filename || "", line: event.lineno || 0 });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  window.__apErrors.push({ kind: "rejection", message: reason && reason.message ? reason.message : String(reason) });
});


const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cx = (...parts) => parts.filter(Boolean).join(" ");

const TABS = ["breach", "equip", "assign", "memory", "intel", "drill", "settings", "about"];
const TAB_LABEL = { breach: "破甲", equip: "装备", assign: "记忆分发", memory: "记忆中心", intel: "情报巡检", drill: "演练台", settings: "设置", about: "关于" };

/* ------------------------------------------------------- two-layer UI (contract §2) */
const NAV_BY_MODE = {
  simple: [
    { tab: "breach", label: "破甲" },
    { tab: "equip", label: "装备" },
    { tab: "memory", label: "记忆" },
    { tab: "intel", label: "情报巡检" },
    { tab: "drill", label: "演练台" },
    { tab: "settings", label: "设置" },
  ],
  technical: TABS.map((t) => ({ tab: t, label: TAB_LABEL[t] })),
};
/* pages that only exist in technical mode; direct links fall back to breach */
const TECH_ONLY_TABS = ["assign", "about"];

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
  { id: "redteam", name: "红队全装", desc: "侦察、打点、横向、权限维持，一条链的默认装备。", agents: ["dsh"] },
  { id: "recon", name: "侦察刀", desc: "被动收集、资产测绘、指纹识别；只读，不碰目标。", agents: ["dsh", "autokill"] },
  { id: "lateral", name: "内网横向", desc: "隧道、凭据、域内枚举；要求受控权限。", agents: ["dsh"] },
  { id: "radio", name: "无线电 / IoT", desc: "BLE、RFID、固件；偏硬件，动作小。", agents: ["mengbot"] },
  { id: "re", name: "逆向研究", desc: "样本、二进制、协议；本地隔离，只读原件。", agents: ["autokill"] },
  { id: "custom", name: "自定义", desc: "自己选智能体、权限与备注。", agents: [] },
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
    busyKind: null,
    netScopeDraft: null,
    loading: false, tried: false, error: null, busy: false, message: "",
    promptDraft: null, promptDirty: false,
  },
  simple: {
    buildError: "",
    attempted: {},
    attemptBusy: false,
    equipBusy: false,
    equipResult: "",
    equipError: "",
    removed: [],
    testState: "idle",
    testMessage: "",
    resignArmed: false,
    detailOpen: null,
  },
  breach: {
    model: "",
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
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
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
    try { document.execCommand("copy"); toast(message); } catch { toast("复制失败，请手动选择文本"); }
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
  return data;
}

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

async function boot() {
  setStatus("loading", "连接中…");
  try {
    const ping = await request("/api/ping").catch(() => null);
    if (ping && ping.version) S.version = ping.version;
    const data = await request("/api/state");
    applyState(data);
    S.booted = true;
    S.bootError = null;
    const accepted = S.state && S.state.agreement && S.state.agreement.accepted;
    if (!accepted) {
      S.locked = true;
      showAgreement();
      setStatus("warn", "待签署协议");
      renderPage();
      return;
    }
    hideAgreement();
    renderPage();
    setStatus("loading", "记忆中心检查中…");
    refreshMemoryStatus();
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

function tabFromHash() {
  const raw = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return TABS.includes(raw) ? raw : "breach";
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

function renderPage() {
  setNav();
  updateModeSwitch();
  renderGlobalAlert();
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
    if (S.tab === "breach") renderBreach();
    else if (S.tab === "equip") renderEquip();
    else if (S.tab === "assign") renderAssign();
    else if (S.tab === "memory") renderMemory();
    else if (S.tab === "intel") renderIntelPage();
    else if (S.tab === "drill") renderDrillPage();
    else if (S.tab === "settings") renderSettings();
    else renderAbout();
  } else {
    if (S.tab === "breach") renderSimpleBreach();
    else if (S.tab === "equip") renderSimpleEquip();
    else if (S.tab === "memory") renderSimpleMemory();
    else if (S.tab === "intel") renderIntelPage();
    else if (S.tab === "drill") renderDrillPage();
    else renderSimpleSettings();
  }
  if (modeIsTechnical()) renderTechHint();
  bindGroups();
  $$('#page pre[tabindex="0"]').forEach((pre, index) => {
    if (!pre.getAttribute("aria-label")) pre.setAttribute("aria-label", "可滚动文本内容 " + (index + 1));
    if (!pre.getAttribute("role")) pre.setAttribute("role", "region");
  });
  restoreFocus(saved);
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

async function simpleHostAction(kind) {
  const h = S.host;
  if (h.busy) return;
  // 两段式确认：第一次点只是把按钮变成「再点一次确认」，不弹 confirm（弹窗会被拦、也可能被当成没反应）
  const now = Date.now();
  const armed = !!(h.pendingAction && h.pendingAction.kind === kind && now - h.pendingAction.at < 6000);
  if (!armed) {
    h.pendingAction = { kind: kind, at: now };
    h.message = "";
    h.error = null;
    renderPage();
    setTimeout(() => {
      if (S.host.pendingAction && S.host.pendingAction.kind === kind) {
        S.host.pendingAction = null;
        if (S.tab === "breach") renderPage();
      }
    }, 6200);
    return;
  }
  h.pendingAction = null;
  h.busy = true;
  h.busyKind = kind;
  h.message = "";
  h.error = null;
  renderPage();
  try {
    let data;
    if (kind === "apply") {
      data = await request("/api/host/apply", { method: "POST", body: { confirm: true, mode: "apply" } });
      if (!data || data.ok === false) throw payloadError(data, "注入失败");
      const added = (data.result && data.result.applied) || 0;
      const already = (data.result && data.result.already) || 0;
      h.message = added
        ? `注入完成：新增 ${fmtNum(added)} 处，${fmtNum(already)} 处本来就是最新。重启 dsh 生效。`
        : `注入完成：宿主本来就是最新（${fmtNum(already)} 处无需再改，0 处新增）。重启 dsh 后仍生效。`;
    } else {
      data = await request("/api/host/uninstall", { method: "POST", body: { confirm: true } });
      if (!data || data.ok === false) throw payloadError(data, "卸载失败");
      const u = data.uninstall || {};
      h.message = `卸载完成：${u.applied ? "宿主已还原，" : ""}${(u.stripped || []).length} 个 profile 已清理${(u.errors || []).length ? "，有 " + u.errors.length + " 条警告" : ""}。重启 dsh 生效。`;
    }
    toast(kind === "apply" ? "注入完成" : "卸载完成");
    S.host.tried = false;
    await loadHostStatus(true);
  } catch (e) {
    h.error = e;
    h.message = simpleReason(e);
    toast("失败：" + simpleReason(e));
  } finally {
    h.busy = false;
    h.busyKind = null;
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

function renderSimpleOperation() {
  const b = S.breach;
  const err = S.simple.buildError;
  return `<section class="section" aria-labelledby="s-op-h">
    <h2 id="s-op-h"><span class="num">4</span>写清任务，生成载荷<span class="count">${recommendedModels().length} 个推荐模型</span></h2>
    <form id="simpleForm" class="card" novalidate>
      <div class="field">
        <textarea id="sTask" data-focus="sTask" aria-label="任务描述" rows="3" placeholder="例：让它详细说明如何绕过内容审核"${err && err.kind === "empty" ? ' aria-invalid="true" class="shake"' : ""}>${esc(b.task)}</textarea>
        <span class="help">写得越具体，生成的载荷越能用</span>
      </div>
      <button class="primary s-generate" id="sBuild" type="submit"${b.building ? ' disabled aria-busy="true"' : ""}>${b.building ? "生成中…" : "一键生成"}</button>
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
  const cards = list.map((v, i) => {
    const key = String(v.id || v.technique || i);
    const recorded = S.simple.attempted[key];
    return `<article class="payload">
      <div class="payload-head">
        <div><h3>${i + 1}. ${esc(simpleText(v.name || "载荷"))}</h3>
          ${v.desc ? `<div class="payload-desc">${esc(simpleText(v.desc))}</div>` : ""}</div>
        ${copyBtn(v.text || "", "复制")}
      </div>
      <details class="s-fold"><summary>展开看全文</summary><pre tabindex="0">${esc(v.text || "")}</pre></details>
      <div class="s-record">
        ${recorded ? `<span class="s-record-done">已记录：${esc(recorded === "pass" ? "这次成功了" : "被拒绝了")}</span>` : ""}
        <button type="button" class="small" data-simple-attempt="pass" data-simple-key="${esc(key)}"${recorded ? " disabled" : ""}>这次成功了</button>
        <button type="button" class="small" data-simple-attempt="refused" data-simple-key="${esc(key)}"${recorded ? " disabled" : ""}>被拒绝了</button>
      </div>
    </article>`;
  }).join("");
  return `<section class="section">
    <div class="s-results-head">${head}<span class="count">${list.length} 条</span></h2>${copyBtn(all, "复制全部")}</div>
    ${tplLine}
    <div class="payload-list">${cards}</div>
    <p class="s-tip">想调层、技术、采样？切到技术模式。</p>
  </section>`;
}

function renderSimpleBreach() {
  if (!S.readiness.tried && !S.readiness.loading) loadReadiness();
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">破甲</p>
      <h1>破甲</h1>
      <p class="lead">选模型、选方案，一键注入后拿到可复制的载荷。技术模式是同一套流程，只是参数更多。</p>
    </div></div>
    ${renderSimpleStatusCard()}
    ${simpleSteps()}
    ${renderFlowModelStep("simple")}
    ${renderFlowPlanStep("simple")}
    ${renderFlowApplyStep()}
    ${renderFlowPatchList()}
    ${renderFlowExtraPanels()}
    ${renderSimpleOperation()}
    ${renderSimpleResults()}
  `;
  bindSimpleBreach();
  bindFlowControls();
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
  } catch (e) { toast(simpleReason(e)); }
}

async function saveRule() {
  const e = S.host.ruleEdit || {};
  const name = String(e.name || "").trim();
  if (!name) { toast("先写文件名，例如 strict.md"); return; }
  try {
    const d = await request("/api/host/rule", { method: "POST", body: { confirm: true, name: name, text: String(e.text || "") } });
    if (!d || d.ok === false) throw payloadError(d, "保存规则失败");
    toast("规则已保存");
    S.host.ruleEdit = { name: d.name, text: e.text };
    await reloadHostExtras();
  } catch (err) { toast(simpleReason(err)); }
}

async function deleteRuleFile(name) {
  if (!window.confirm("删除规则 " + name + "？会先自动备份。")) return;
  try {
    const d = await request("/api/host/rule/delete", { method: "POST", body: { confirm: true, name: name } });
    if (!d || d.ok === false) throw payloadError(d, "删除规则失败");
    toast("已删除");
    if ((S.host.ruleEdit || {}).name === name) S.host.ruleEdit = { name: "", text: "" };
    await reloadHostExtras();
  } catch (e) { toast(simpleReason(e)); }
}

async function saveNetScope() {
  try {
    const text = S.host.netScopeDraft != null ? S.host.netScopeDraft : ((S.host.netScope || {}).text || "");
    const d = await request("/api/host/net-scope", { method: "POST", body: { confirm: true, text: text } });
    if (!d || d.ok === false) throw payloadError(d, "保存白名单失败");
    toast("白名单已保存");
    S.host.netScopeDraft = null;
    await reloadHostExtras();
  } catch (e) { toast(simpleReason(e)); }
}

async function openSkill(name) {
  try {
    const d = await request("/api/host/skill?name=" + encodeURIComponent(name));
    S.host.skillView = { name: d.name || name, text: d.text || "" };
    renderPage();
  } catch (e) { toast(simpleReason(e)); }
}

async function deleteSkillFile(name) {
  if (!window.confirm("删除技能 " + name + "？会先自动备份。")) return;
  try {
    const d = await request("/api/host/skill/delete", { method: "POST", body: { confirm: true, name: name } });
    if (!d || d.ok === false) throw payloadError(d, "删除技能失败");
    toast("已删除");
    if ((S.host.skillView || {}).name === name) S.host.skillView = { name: "", text: "" };
    await reloadHostExtras();
  } catch (e) { toast(simpleReason(e)); }
}

async function saveSkill() {
  const e = S.host.skillEdit || {};
  const name = String(e.name || "").trim();
  if (!name) { toast("先写技能目录名，例如 my-skill"); return; }
  if (!String(e.text || "").trim()) { toast("SKILL.md 正文不能为空"); return; }
  try {
    const d = await request("/api/host/skill", { method: "POST", body: { confirm: true, name: name, text: String(e.text || "") } });
    if (!d || d.ok === false) throw payloadError(d, "保存技能失败");
    toast("技能已保存");
    S.host.skillView = { name: d.name, text: String(e.text || "") };
    await reloadHostExtras();
  } catch (err) { toast(simpleReason(err)); }
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
  } catch (e) { toast(simpleReason(e)); }
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
  } catch (e) { toast(simpleReason(e)); }
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
    el.addEventListener("click", () => {
      S.breach.model = el.dataset.model;
      S.attempt.model = el.dataset.model;
      renderPage();
    });
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
  const task = String(b.task || "").trim();
  if (!task) {
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
  if (!model) {
    S.simple.buildError = { kind: "failed", message: "还没读到可用的模型。等几秒再点『重试』。" };
    renderPage();
    return;
  }
  const techniques = S.techniques.slice(0, 3).map((t) => t.id);
  b.building = true;
  renderPage();
  try {
    const data = await request("/api/breach/build", {
      method: "POST",
      body: {
        model, layer: "prompt", techniques, task,
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
  } catch (e) {
    if (isAgreementError(e)) return;
    S.simple.buildError = { kind: "failed", message: simpleReason(e) };
  } finally {
    b.building = false;
    if (!modeIsTechnical() && S.tab === "breach") renderPage();
  }
}

async function simpleAttempt(key, result) {
  if (!key || !result || S.simple.attemptBusy) return;
  const b = S.breach;
  const list = Array.isArray(b.variants) ? b.variants : [];
  const variant = list.find((v, i) => String(v.id || v.technique || i) === String(key)) || list[0] || null;
  const model = b.model || (S.models[0] && S.models[0].id) || "";
  const rawTech = variant ? String(variant.technique || variant.id || "").replace(/-(rot13|base64)$/i, "") : "";
  const technique = S.techniques.some((t) => t.id === rawTech) ? rawTech : ((S.techniques[0] && S.techniques[0].id) || "");
  if (!model || !technique) { toast("这次没能记录：先点一次『一键生成』。"); return; }
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
    toast(simpleReason(e));
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
  const rows = items.length
    ? `<div class="card">${items.map((it) => `<div class="s-row">
        <div class="s-row-main"><strong>${esc(simpleText(it.name))}</strong><span>${esc(simpleText(it.desc))}</span></div>
        <button type="button" class="small" data-simple-unequip="${esc(it.key)}">卸下</button>
      </div>`).join("")}</div>`
    : emptyState("还没装备。点上面的按钮，一次装好推荐组合。", "");
  const out = S.simple.equipError
    ? alertBox(S.simple.equipError, "再点一次『一键装备推荐组合』试试。")
    : (S.simple.equipResult ? okBox(S.simple.equipResult) : "");
  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">装备</p><h1>装备</h1>
      <p class="lead">把现成能力装到你的智能体上，装完就能用。</p>
    </div></div>
    <section class="s-status ${items.length ? "green" : "yellow"}" aria-label="当前装备">
      <div class="s-status-body">
        <strong>当前已装备 ${items.length} 件</strong>
        <span class="s-status-detail">${items.length ? "这些能力都装好了，可以直接用。" : "还没有装能力，点下面这个按钮一次装好。"}</span>
      </div>
    </section>
    <section class="section">
      <button type="button" class="primary s-generate" id="sEquipAll"${S.simple.equipBusy ? ' disabled aria-busy="true"' : ""}>${S.simple.equipBusy ? "装备中…" : "一键装备推荐组合"}</button>
      <div id="sEquipOut" style="margin-top:10px">${out}</div>
    </section>
    <section class="section" aria-labelledby="s-eq-h">
      <h2 id="s-eq-h"><span class="num">1</span>已装的<span class="count">${items.length} 件</span></h2>
      ${rows}
    </section>
  `;
  bindSimpleEquip();
}

function bindSimpleEquip() {
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
  const body = { preset: "redteam", agents: ["dsh"], permissions: "read-only", notes: "" };
  try {
    const data = await request("/api/equipment", { method: "POST", body });
    if (!data || data.ok === false) throw payloadError(data, "装备失败");
    if (Array.isArray(data.equipment)) S.equipment = data.equipment;
    else if (data.equipment && typeof data.equipment === "object") S.equipment = [...S.equipment, data.equipment];
    else S.equipment = [...S.equipment, Object.assign({}, body, { at: new Date().toISOString() })];
    S.simple.removed = [];
    const items = simpleEquippedItems();
    S.simple.equipResult = `已装备 ${items.length} 件：${items.map((i) => simpleText(i.name)).join("、")}`;
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

function renderSimpleMemory() {
  const m = S.memory;
  if (!m.statsLoaded && !m.statsLoading) loadMemoryStats();
  if (!m.cardsLoaded && !m.cardsLoading) loadMemoryCards();
  const checking = m.statsLoading && !m.statsLoaded;
  const connected = !!m.statsLoaded && !m.statsError;
  /* 连接状态只给两种确定答案：检查中也按「未连接」显示，检查完再翻成已连接 */
  const statusLine = connected
    ? `<span class="badge good">记忆服务已连接</span>`
    : `<span class="badge warn">记忆服务未连接</span>${checking ? `<span class="hint">正在检查…</span>` : ""} <a href="#/settings">去设置</a>`;

  let results = "";
  if (m.cardsLoading) results = spinner("正在找…");
  else if (m.error) results = alertBox("没读到内容。", simpleReason(m.error));
  else if (!connected) results = emptyState("连上记忆服务后才能搜索", "先到设置里点『测试连接』，连上再回来。");
  else if (!m.cards || !m.cards.length) results = emptyState("没有找到相关内容", "换一个词，再点『搜索』。");
  else {
    results = `<div class="list memory-cards">${m.cards.map((c, i) => {
      const time = memoryCardTime(c);
      return `<button type="button" class="row-item" data-simple-card="${i}" data-focus="scard-${i}" style="text-align:left;width:100%">
        <span class="grow">
          <span class="t">${esc(c.title || "未命名卡片")}</span>
          ${c.summary ? `<span class="s">${esc(String(c.summary).slice(0, 160))}</span>` : ""}
          ${time ? `<span class="s faint">${esc(time)}</span>` : ""}
        </span>
        <span class="badge">打开</span>
      </button>`;
    }).join("")}</div>`;
  }

  const detail = m.detailLoading
    ? spinner("读取中…")
    : m.detailError
      ? alertBox("这张卡暂时打不开。", simpleReason(m.detailError))
      : m.detail
        ? `<div class="card soft">
            <div class="card-head"><h3>${esc(String(m.detail.text || "").split("\n")[0].replace(/^#+\s*/, "") || "内容")}</h3>${copyBtn(m.detail.text || "", "复制内容")}</div>
            <pre class="tall" tabindex="0">${esc(m.detail.text || "（内容为空）")}</pre>
          </div>`
        : "";

  $("#page").innerHTML = `
    <div class="page-head"><div>
      <p class="eyebrow">记忆</p><h1>记忆</h1>
      <p class="lead">查你的智能体记住了什么。</p>
    </div></div>
    <div class="s-row" style="border-top:0">${statusLine}</div>
    <section class="section">
      <form id="simpleMemorySearch" class="card soft" novalidate>
        <label class="field"><span>搜什么</span>
          <input id="sMemQ" data-focus="sMemQ" type="search" value="${esc(m.q)}" placeholder="技能 / 项目 / 关键词">
        </label>
        <div class="actions"><button class="primary" type="submit">搜索</button><span class="hint">按回车也可以搜。</span></div>
      </form>
    </section>
    <section class="section" aria-labelledby="s-mem-h">
      <h2 id="s-mem-h"><span class="num">1</span>结果${m.cards ? `<span class="count">${m.cards.length} 张</span>` : ""}</h2>
      ${results}
    </section>
    ${detail ? `<section class="section" aria-labelledby="s-mem-d"><h2 id="s-mem-d"><span class="num">2</span>全文</h2>${detail}</section>` : ""}
  `;
  bindSimpleMemory();
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
  const label = p.statusZh || (tone === "ok" ? "已注入" : tone === "wait" ? "待注入" : tone === "fail" ? "失败" : "已跳过");
  return `<span class="patch-state tone-${esc(tone)}">${esc(label)}</span>`;
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
  const card = (m) => {
    const on = m.id === S.breach.model;
    return `<button type="button" class="pick" data-model="${esc(m.id)}" data-focus="model-${esc(m.id)}" aria-pressed="${on}">
      <span class="pick-top"><span class="pick-name">${esc(simpleText(m.name))}</span>${on ? badge("已选", "accent") : ""}</span>
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
  const rows = [
    `<label class="field"><span>破甲模板</span>
      ${tplCount ? `<select id="sTemplate" data-focus="sTemplate">${optionHtml(S.prompts, b.template)}</select>` : `<input type="text" value="none" readonly>`}
      <span class="help">${pr && pr.isBuiltin ? "当前注入的就是这套（与内置默认一致）" : "换模板只影响生成的载荷；宿主里注入的那份在下面第 3 步旁边可以改。"}${promptInfo ? " · 注入正文 " + promptInfo : ""}</span>
    </label>`,
    `<label class="field"><span>任务类型</span><select id="sPreset" data-focus="sPreset">${optionHtml(S.taskPresets, b.taskPreset)}</select></label>`,
    `<label class="field"><span>输出要求</span><select id="sOutput" data-focus="sOutput">${optionHtml(S.outputChoices, b.outputChoice)}</select></label>`,
  ];
  const extra = tech ? "" : "";
  return `<section class="section" aria-labelledby="f-plan-h">
    <h2 id="f-plan-h"><span class="num">2</span>选方案<span class="count">${tplCount} 套模板 · ${(S.taskPresets || []).length} 种任务</span></h2>
    <div class="s-choices">${rows.join("")}</div>
    ${extra}
  </section>`;
}

function renderFlowApplyStep() {
  const h = S.host;
  const d = h.data;
  if (!d) return `<section class="section"><h2><span class="num">3</span>注入 / 卸载 / 还原</h2>${spinner("检查宿主状态…")}</section>`;
  if (d.available === false) {
    return `<section class="section"><h2><span class="num">3</span>注入 / 卸载 / 还原</h2>${alertBox("这台机器的宿主侧用不了", (d && d.reason) || "本机没装 dsh-purge；破甲内容仍能生成。")}</section>`;
  }
  const c = d.counts || {};
  const snaps = Array.isArray(d.snapshots) ? d.snapshots : [];
  const busy = h.busy;
  const msg = h.message ? (h.error ? alertBox(h.message, "") : okBox(h.message)) : "";
  const pr = h.prompt;
  const draft = h.promptDraft != null ? h.promptDraft : (pr && pr.text) || "";
  // 门禁：没在演练台确认授权就不让动宿主
  const authorized = !!(h.drill && h.drill.data && h.drill.data.granted);
  const gate = authorized ? "" : `<div class="alert warn" role="alert"><strong>先去「演练台」确认授权</strong><span class="hint">注入 / 卸载会改本机 dsh 安装，未授权时按钮是灰的。</span></div>`;
  const promptBox = pr ? `<details class="grp" data-group="flow:prompt">
      <summary><span class="grp-title">注入正文（可直接改）</span><span class="grp-hint">${pr.isBuiltin ? "与内置默认一致" : "已被改动"} · ${fmtNum(draft.length)} 字符</span></summary>
      <div class="grp-body">
        <textarea id="hostPrompt" rows="12" spellcheck="false" style="font-family:ui-monospace,Consolas,monospace;font-size:12px;width:100%">${esc(draft)}</textarea>
        <div class="actions" style="margin-top:8px">
          <button type="button" class="primary" data-prompt-action="save"${h.promptDirty ? "" : " disabled"}>保存正文</button>
          <button type="button" class="ghost" data-prompt-action="reset">恢复默认正文</button>
          <span class="hint">保存前自动备份；重启 dsh 生效。</span>
        </div>
      </div>
    </details>` : "";
  const pend = (kind) => !!(h.pendingAction && h.pendingAction.kind === kind && Date.now() - h.pendingAction.at < 6000);
  return `<section class="section" aria-labelledby="f-apply-h">
    <h2 id="f-apply-h"><span class="num">3</span>注入 / 卸载 / 还原
      <span class="count">${fmtNum(c.applied || 0)}/${fmtNum(c.total || 0)} 已注入${c.failed ? ` · ${c.failed} 失败` : ""} · 备份 ${snaps.length}</span></h2>
    <div class="actions">
      <button type="button" class="${pend("apply") ? "primary warn" : "primary"}" data-simple-host="apply"${busy || !authorized ? " disabled" : ""}>${busy && h.busyKind === "apply" ? "注入中…" : (pend("apply") ? "再点一次确认注入" : "一键注入")}</button>
      <button type="button" class="${pend("uninstall") ? "ghost warn" : "ghost"}" data-simple-host="uninstall"${busy || !authorized ? " disabled" : ""}>${busy && h.busyKind === "uninstall" ? "卸载中…" : (pend("uninstall") ? "再点一次确认卸载" : "一键卸载")}</button>
      <span class="hint">点一次先确认、再点一次执行；注入前自动备份，卸载会先还原宿主再清插件文件。</span>
    </div>
    ${pend("apply") || pend("uninstall") ? `<div class="alert warn" role="alert"><strong>再点一次同一个按钮才会执行</strong><span class="hint">${pend("apply") ? "注入会改本机 dsh 安装，重启后生效。" : "卸载会还原宿主并删掉三处插件文件，之后要重装才能再用。"}</span></div>` : ""}
    ${gate}
    ${msg}
    ${promptBox}
  </section>`;
}

function renderFlowPatchList() {
  const d = S.host.data;
  if (!d || d.available === false) return "";
  const c = d.counts || {};
  const rows = (d.patches || []).map((p) => `<tr>
      <td>${esc(p.nameZh || "（未收录中文）")}</td>
      <td class="mono small muted">${esc(p.name)}</td>
      <td class="muted small">${esc(p.layer || "")}</td>
      <td>${flowToneBadge(p)}</td>
    </tr>`).join("");
  return `<section class="section">
    <details class="grp" data-group="flow:patches">
      <summary><span class="grp-title">补丁清单</span>
        <span class="grp-hint">${fmtNum(c.applied || 0)} 已注入${c.failed ? ` · ${c.failed} 失败` : ""}${c.na ? ` · ${c.na} 跳过` : ""} · 共 ${fmtNum(c.total || 0)} 处</span></summary>
      <div class="grp-body">
        <div class="table-wrap" tabindex="0" role="region" aria-label="补丁清单">
          <table class="min"><thead><tr><th>补丁</th><th>原文</th><th>层</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>
    </details>
  </section>`;
}

/* 原版面板另外三栏：规则集 / 出口白名单 / 技能（都落在 ~/.dsh 下，写前自动备份） */
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
  if (status === "applied") return badge("已应用", "accent");
  if (status === "pending") return badge("待应用", "");
  if (status === "na") return badge("不适用", "");
  if (status === "missing_file") return badge("文件缺失", "");
  return badge(status || "未知", "");
}

function hostCountsLine(d) {
  const c = d.counts || {};
  return `${c.applied || 0}/${c.total || 0} 已应用 · ${c.pending || 0} 待应用 · ${c.na || 0} 不适用`;
}

function hostBadge() {
  const d = S.host.data;
  if (!d) return badge("宿主破甲 · 检查中", "");
  if (d.available === false) return badge("宿主破甲 · 不可用", "");
  const c = d.counts || {};
  return badge(`宿主破甲 ${c.applied || 0}/${c.total || 0}`, c.pending ? "" : "accent");
}

function renderHostSection() {
  const h = S.host;
  if (!h.tried && !h.loading) loadHostStatus();
  const head = `<h2 id="h-host"><span class="num">1</span>清洗 · 宿主破甲（dsh-purge 1.1.71）`;
  if (h.loading && !h.data) return `<section class="section">${head}</h2>${spinner("检查宿主状态…")}</section>`;
  const d = h.data;
  if (h.error && !d) return `<section class="section">${head}</h2>${alertBox("读不到宿主状态", simpleReason(h.error))}</section>`;
  if (!d || d.available === false) {
    return `<section class="section">${head}</h2>${alertBox("宿主破甲不可用", (d && d.reason) || "本机没装 dsh-purge，宿主侧补丁引擎用不了；破甲内容仍可正常生成。")}</section>`;
  }
  const b = d.baseline || {};
  const snaps = Array.isArray(d.snapshots) ? d.snapshots : [];
  const rows = (d.patches || []).map((p) => `<tr>
      <td class="mono">#${esc(String(p.id))}</td>
      <td>${esc(p.name)}</td>
      <td class="muted">${esc(p.layer || "")}</td>
      <td>${hostStatusBadge(p.status)}</td>
    </tr>`).join("");
  const msg = h.message ? (h.error ? alertBox(h.message, "") : okBox(h.message)) : "";

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
    </div>
    ${promptBlock}
    <div class="actions" style="margin-top:10px">
      <button type="button" class="primary" data-host-action="snapshot">备份现在</button>
      <button type="button" class="ghost" data-host-action="restore"${snaps.length ? "" : " disabled"}>撤销上一次</button>
      <button type="button" class="ghost" data-host-action="factory">恢复出厂</button>
      <button type="button" class="ghost" data-host-action="apply">应用补丁</button>
      <span class="hint">改宿主都要重启 dsh 才生效；每次写入前会先自动备份一份。</span>
    </div>
    ${msg}
    ${invRows ? `<div class="card" style="margin-top:10px">${invRows}</div>` : ""}
    <p class="small muted" style="margin-top:8px">「恢复出厂」用官方 app.asar 原件覆盖被改文件（不依赖 .bak，本机实测 .bak 为 0）；「撤销上一次」用最近一份快照覆盖。</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="宿主补丁清单">
      <table class="min"><thead><tr><th>#</th><th>补丁</th><th>层</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
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
      // 两种模式都要重绘：首次渲染时宿主状态还没回来，这里是空状态
      if (S.tab === "breach") renderPage();
    }
  })();
  return S.host.loadPromise;
}

async function hostAction(kind) {
  if (S.host.busy) return;
  const h = S.host;
  const confirmText = {
    snapshot: "",
    restore: "用最近一份快照覆盖宿主文件？覆盖前会自动再备份一份。改完要重启 dsh 才生效。",
    factory: "用官方 app.asar 原件覆盖被改的宿主文件？覆盖前会自动备份现在。改完要重启 dsh 才生效。",
    apply: "按 dsh-purge 1.1.71 的补丁表应用全部清洗？会改宿主文件，需要重启 dsh 才生效。",
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
      data = await request("/api/host/restore", { method: "POST", body: { confirm: true } });
      if (!data || data.ok === false) throw payloadError(data, "恢复失败");
      h.message = `已按快照 ${data.restored.id} 覆盖 ${fmtNum(data.restored.restored)} 个文件；覆盖前的状态另存为 ${data.guardSnapshot}。重启 dsh 生效。`;
    } else if (kind === "factory") {
      data = await request("/api/host/factory", { method: "POST", body: { confirm: true } });
      if (!data || data.ok === false) throw payloadError(data, "恢复出厂失败");
      h.message = `已用 asar 原件覆盖 ${fmtNum(data.factory.restored)} 个文件（跳过 ${fmtNum(data.factory.skipped)}）；覆盖前状态另存为 ${data.guardSnapshot}。${data.factory.note ? " " + data.factory.note : ""}`;
    } else if (kind === "apply") {
      data = await request("/api/host/apply", { method: "POST", body: { confirm: true, mode: "apply" } });
      if (!data || data.ok === false) throw payloadError(data, "应用失败");
      h.message = `已应用：新增 ${fmtNum(data.result.applied)} 个补丁（${fmtNum(data.result.already)} 个本来就是最新）。${data.result.restartRequired ? "重启 dsh 生效。" : ""}`;
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
    toast(simpleReason(e));
  }
}

function renderBreach() {
  if (!S.host.tried && !S.host.loading) loadHostStatus();
  const b = S.breach;
  const model = S.models.find((m) => m.id === b.model) || S.models[0] || null;
  const techCount = b.techniques.length;
  const stats = normalizeBreachStats(S.breachStats, S.attempts);
  const modelsHtml = S.models.length
    ? `<div class="grid models">${S.models.map((m) => {
      const on = m.id === b.model;
      return `<button type="button" class="pick" data-model="${esc(m.id)}" data-focus="model-${esc(m.id)}" aria-pressed="${on}">
        <span class="pick-top"><span class="pick-name">${esc(m.name)}</span>${m.live ? badge("实时", "") : ""}${m.dshDefault ? badge("当前默认", "good") : ""}${m.dshPurge === "default" ? badge("dsh-purge 默认", "accent") : (m.dshPurge === "supported" ? badge("dsh-purge 支持", "") : "")}${on ? badge("已选", "accent") : ""}</span>
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
        <div class="payload-foot"><span class="faint small">${String(v.text || "").length} 字符</span>${copyBtn(v.text || "", "复制载荷")}</div>
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
      <h2 id="h-task"><span class="num">5</span>写任务，生成载荷</h2>
      <form id="buildForm" class="card" novalidate>
        <label class="field"><span>任务（必填，要能验收）</span>
          <textarea id="bTask" data-focus="bTask" rows="3" placeholder="例：写一段在授权靶场里验证 SSH 弱口令的步骤，包含命令与验收条件">${esc(b.task)}</textarea>
        </label>
        <div id="buildError">${b.buildError ? alertBox(b.buildError.message, b.buildError.hint) : ""}</div>
        <div class="actions">
          <button class="primary" id="bBuild" type="submit" ${b.building ? 'disabled aria-busy="true"' : ""}>${b.building ? "生成中…" : "生成载荷"}</button>
          <span class="muted">不调用任何模型；只产出可复制载荷与建议。任务为空时不会发请求。角色与输出要求在「生成策略」里。</span>
        </div>
      </form>
    </section>

    <section class="section" aria-labelledby="h-payload">
      <h2 id="h-payload">载荷<span class="count">${b.variants.length} 条</span></h2>
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
            <span class="help">默认套「小码酱 · dsh-purge 1.1.71」整段；选「不套模板」只出技术模板。</span>
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

    ${renderFlowModelStep("technical")}
    ${renderFlowPlanStep("technical")}
    ${renderFlowApplyStep()}
    ${renderFlowPatchList()}
    ${renderFlowExtraPanels()}

    ${groupsHtml("breach", [
      { key: "base", html: baseGroup },
      { key: "strategy", html: strategyGroup },
      { key: "sampling", html: samplingGroup },
      { key: "paths", html: renderBinarySection() },
      { key: "diag", html: diagGroup },
    ])}
    ${renderLiveModelsSection()}
  `;
  bindBreach();
  bindBinary();
}

function bindBreach() {
  $$("#page [data-model]").forEach((el) => {
    el.addEventListener("click", () => {
      S.breach.model = el.dataset.model;
      S.attempt.model = el.dataset.model;
      renderPage();
    });
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

  const task = $("#bTask");
  if (task) {
    task.addEventListener("input", () => { S.breach.task = task.value; });
    task.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); $("#buildForm").requestSubmit(); }
    });
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

function equipConfig(item) {
  if (item) {
    return {
      preset: item.preset || "",
      agents: Array.isArray(item.agents) ? item.agents : [],
      permissions: item.permissions || "read-only",
      memory_endpoint: "/api/assign/<agent>.md",
      notes: item.notes || "",
    };
  }
  return {
    preset: S.equip.preset,
    agents: equipAgents(true),
    permissions: S.equip.permissions,
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
  const presetCards = PRESETS.map((p) => {
    const on = p.id === e.preset;
    return `<button type="button" class="pick" data-preset="${esc(p.id)}" data-focus="preset-${esc(p.id)}" aria-pressed="${on}">
      <span class="pick-top"><span class="pick-name">${esc(p.name)}</span>${on ? badge("已选", "accent") : ""}</span>
      <span class="pick-note">${esc(p.desc)}</span>
    </button>`;
  }).join("");

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

  const history = S.equipment.slice().reverse().slice(0, 20);
  const historyHtml = history.length
    ? `<div class="table-wrap" tabindex="0" role="region" aria-label="发放历史"><table class="min"><caption class="sr-only">装备发放历史</caption><thead><tr><th>时间</th><th>装备包</th><th>智能体</th><th>权限</th><th>备注</th><th>操作</th></tr></thead><tbody>
      ${history.map((it) => `<tr>
        <td class="mono nowrap">${esc(fmtTime(it.at))}</td>
        <td>${esc(presetName(it.preset))}</td>
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
      <h2 id="h-history"><span class="num">6</span>发放历史<span class="count">${S.equipment.length} 条</span></h2>
      ${historyHtml}
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 02</p>
        <h1>装备</h1>
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
    el.addEventListener("click", () => {
      const p = PRESETS.find((x) => x.id === el.dataset.preset);
      S.equip.preset = el.dataset.preset;
      if (p) S.equip.agents = [...p.agents];
      S.equip.error = null;
      S.equip.ok = null;
      renderPage();
    });
  });
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
      body: { preset: e.preset, agents, permissions: e.permissions, notes: e.notes.trim() },
    });
    if (!data || data.ok === false) throw payloadError(data, "发放失败");
    if (Array.isArray(data.equipment)) S.equipment = data.equipment;
    else if (data.equipment && typeof data.equipment === "object") S.equipment = [...S.equipment, data.equipment];
    else if (data.item) S.equipment = [...S.equipment, data.item];
    else S.equipment = [...S.equipment, { preset: e.preset, agents, permissions: e.permissions, notes: e.notes.trim(), at: new Date().toISOString() }];
    e.ok = "装备已发放；历史新增一条。";
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
  const m = S.memory;
  if (!m.statsLoaded && !m.statsLoading) loadMemoryStats();
  if (!m.cardsLoaded && !m.cardsLoading) loadMemoryCards();

  const st = m.stats;
  const source = m.source || detectSource(S.settings.memoryBase);
  const statsHtml = m.statsLoading
    ? spinner("读取统计…")
    : m.statsError
      ? alertBox(m.statsError.message, m.statsError.hint) + `<div class="actions"><button type="button" class="small" data-mem-retry="stats">重试统计</button></div>`
      : st
        ? `<div class="stat-row">
            <div class="stat"><span class="stat-label">卡片总数</span><strong class="stat-num">${fmtNum(st.total)}</strong><span class="stat-sub">${esc(sourceLabel(source))}</span></div>
            <div class="stat"><span class="stat-label">今日新增</span><strong class="stat-num">${fmtNum(st.today)}</strong><span class="stat-sub">来自 /stats</span></div>
            <div class="stat"><span class="stat-label">本周新增</span><strong class="stat-num">${fmtNum(st.week)}</strong><span class="stat-sub">来自 /stats</span></div>
          </div>
          <div class="kind-list">${Object.entries(st.byKind || {}).length ? Object.entries(st.byKind).map(([k, v]) => badge(k + " " + fmtNum(v), k === "skill" ? "accent" : "")).join("") : badge("byKind 为空", "warn")}</div>`
        : emptyState("还没有统计", "确认记忆中心地址与令牌，再重试。");

  let cardsHtml = "";
  if (m.cardsLoading) cardsHtml = spinner("检索卡片…");
  else if (m.error) cardsHtml = alertBox(m.error.message, m.error.hint, "bad", "") + `<div class="actions"><button type="button" class="small" data-mem-retry="cards">重试检索</button></div>`;
  else if (!m.cards || !m.cards.length) cardsHtml = emptyState("没有匹配的卡片", "换个关键词，或清空 kind 过滤。");
  else cardsHtml = `<div class="list memory-cards">${m.cards.map((c, i) => `<button type="button" class="row-item" data-mcard="${i}" data-focus="mcard-${i}" style="text-align:left;width:100%">
      <span class="grow">
        <span class="t">${esc(c.title || c.path || "未命名卡片")}</span>
        <span class="s">${badge(c.kind || "未分类", c.kind === "skill" ? "accent" : "")}${c.status ? " " + badge(c.status, c.status === "approved" ? "good" : (c.status === "pending" ? "warn" : "bad")) : ""}<span class="sep">·</span>${esc(c.path || "")}</span>
        ${c.summary ? `<span class="s">${esc(String(c.summary).slice(0, 180))}</span>` : ""}
      </span>
      <span class="badge">打开</span>
    </button>`).join("")}</div>`;

  const detail = m.detailLoading
    ? spinner("读取卡片正文…")
    : m.detailError
      ? alertBox(m.detailError.message, m.detailError.hint)
      : m.detail
        ? `<div class="card soft">
            <div class="card-head"><div><h3>${esc(m.detail.path || "卡片详情")}</h3><div class="badge-row">${badge(m.detail.status || "状态未知", m.detail.status === "approved" ? "good" : (m.detail.status === "pending" ? "warn" : ""))}${m.detail.kind ? badge(m.detail.kind, "") : ""}</div></div>${copyBtn(m.detail.text || "", "复制正文")}</div>
            <pre class="tall" tabindex="0">${esc(m.detail.text || "（正文为空）")}</pre>
          </div>`
        : emptyState("尚未打开卡片", "点一条检索结果，就在这里看路径、状态与正文（YAML 头 + Markdown）。");

  const kindOptions = `<option value="">全部</option>${KINDS.map((k) => `<option value="${esc(k)}" ${m.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}`;
  const claim = m.claim;

  const baseGroup = `
    <section class="section" aria-labelledby="h-m-search">
      <h2 id="h-m-search"><span class="num">1</span>检索<span class="count">${m.cards ? m.cards.length + " 张" : ""}</span></h2>
      <form id="memorySearch" class="card soft" novalidate>
        <div class="form-grid">
          <label class="field"><span>关键词</span><input id="mQ" data-focus="mQ" type="search" value="${esc(m.q)}" placeholder="技能 / 项目 / 关键词"></label>
          <label class="field"><span>类型</span><select id="mKind" data-focus="mKind">${kindOptions}</select></label>
        </div>
        <div class="actions"><button class="primary" type="submit">检索</button><span class="hint">空结果会给出空态，不会假装有数据。</span></div>
      </form>
      ${cardsHtml}
    </section>

    <section class="section" aria-labelledby="h-m-detail">
      <h2 id="h-m-detail"><span class="num">2</span>卡片详情</h2>
      ${detail}
    </section>`;

  const strategyGroup = `
    <section class="section" aria-labelledby="h-m-write">
      <h2 id="h-m-write"><span class="num">3</span>写卡 · 只走审核</h2>
      <form id="claimForm" class="card" novalidate>
        <div class="form-grid">
          <label class="field"><span>标题 <span class="req">*</span></span><input id="wTitle" data-focus="wTitle" type="text" maxlength="200" value="${esc(claim.title)}" placeholder="这张卡解决什么问题"></label>
          <label class="field"><span>类型</span><select id="wKind" data-focus="wKind">${KINDS.map((k) => `<option value="${esc(k)}" ${claim.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
          <label class="field span-2"><span>标签（逗号分隔）</span><input id="wTags" data-focus="wTags" type="text" value="${esc(claim.tags)}" placeholder="break, pe, 许可检查"></label>
          <label class="field span-2"><span>正文（Markdown）<span class="req">*</span></span><textarea id="wBody" data-focus="wBody" rows="5" placeholder="写清楚证据、步骤与验收条件；提交后进审核中心。">${esc(claim.body)}</textarea></label>
        </div>
        <div class="inline-note">写卡只调用 <span class="mono">/api/memory/claim</span>；服务端不得调用 approve/reject。返回应为 <span class="mono">status: pending</span>，页面会明示「已进审核中心，待批准」。</div>
        <div id="claimError">${claim.error ? alertBox(claim.error.message, claim.error.hint) : ""}</div>
        ${claim.ok ? (claim.ok.status === "pending"
          ? okBox("已进审核中心，待批准（status: pending）", claim.ok.path ? "草稿路径：" + claim.ok.path : "")
          : alertBox("服务端返回 status=" + claim.ok.status + "，预期 pending。", "核对 /api/memory/claim 的实现；页面不会替你批准。", "warn")) : ""}
        <div class="actions">
          <button class="primary" type="submit" ${claim.saving ? "disabled" : ""}>${claim.saving ? "提交中…" : "提交审核"}</button>
          <span class="hint">提交成功不会自动出现在上方检索结果，直到审核通过。</span>
        </div>
      </form>
    </section>`;

  const pathsGroup = `
    <section class="section" aria-labelledby="h-m-base">
      <h2 id="h-m-base"><span class="num">4</span>记忆服务地址 ${badge("高级", "warn")}</h2>
      <div class="code-line"><span class="grow">${esc(S.settings.memoryBase || "未配置 memoryBase")}</span>${S.settings.memoryBase ? copyBtn(S.settings.memoryBase, "复制地址") : ""}</div>
      <p class="hint" style="margin-top:6px">只读展示；改地址与令牌去设置页。当前来源：${esc(sourceLabel(source))}。</p>
    </section>`;

  const diagGroup = `
    <section class="section" aria-labelledby="h-m-stats">
      <h2 id="h-m-stats"><span class="num">5</span>统计<span class="count">${esc(sourceLabel(source))}</span></h2>
      ${statsHtml}
    </section>`;

  $("#page").innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">CONTROL · 04</p>
        <h1>记忆中心</h1>
        <p class="lead">直接看 memory-eternal：统计、检索、卡片正文。写卡只走审核，提交后是 pending，页面不会调用 approve/reject。</p>
      </div>
      <div class="head-meta">${badge(sourceLabel(source), source === "local" ? "good" : (source === "cloud" ? "warn" : ""))}${badge("写卡 → pending", "accent")}</div>
    </div>

    ${groupsHtml("memory", [
      { key: "base", html: baseGroup },
      { key: "strategy", html: strategyGroup },
      { key: "paths", html: pathsGroup },
      { key: "diag", html: diagGroup },
    ])}
  `;
  bindMemory();
}

async function loadMemoryStats() {
  if (S.memory.statsLoading) return;
  S.memory.statsLoading = true;
  S.memory.statsError = null;
  try {
    const data = await request("/api/memory/stats");
    if (!data || data.ok === false) throw payloadError(data, "记忆服务不可用");
    S.memory.stats = normalizeStats(data);
    S.memory.source = (data && data.source) || detectSource(S.settings.memoryBase);
    S.memory.statsLoaded = true;
    setStatus("ok", "记忆中心已连接");
  } catch (e) {
    if (isAgreementError(e)) return;
    S.memory.statsError = e;
    S.memory.statsLoaded = true;
    setStatus("bad", "记忆中心未连接", e.message);
  } finally {
    S.memory.statsLoading = false;
    if (S.tab === "memory") renderPage();
  }
}

async function loadMemoryCards() {
  if (S.memory.cardsLoading) return;
  S.memory.cardsLoading = true;
  S.memory.error = null;
  try {
    const params = new URLSearchParams({ limit: "40" });
    if (S.memory.q) params.set("q", S.memory.q);
    if (S.memory.kind) params.set("kind", S.memory.kind);
    const data = await request("/api/memory/cards?" + params.toString());
    if (!data || data.ok === false) throw payloadError(data, "记忆服务不可用");
    S.memory.cards = Array.isArray(data.cards) ? data.cards : [];
    S.memory.cardsLoaded = true;
  } catch (e) {
    if (isAgreementError(e)) return;
    S.memory.error = e;
    S.memory.cards = [];
    S.memory.cardsLoaded = true;
  } finally {
    S.memory.cardsLoading = false;
    if (S.tab === "memory") renderPage();
  }
}

async function openMemoryCard(index) {
  const card = S.memory.cards && S.memory.cards[index];
  if (!card) return;
  S.memory.detailLoading = true;
  S.memory.detailError = null;
  renderPage();
  try {
    const data = await request("/api/memory/card?path=" + encodeURIComponent(card.path || ""));
    if (!data || data.ok === false) throw payloadError(data, "读取卡片失败");
    const c = data.card && typeof data.card === "object" ? data.card : data;
    S.memory.detail = {
      path: c.path || card.path,
      status: c.status || card.status || "",
      kind: c.kind || card.kind || "",
      text: c.text || "",
    };
  } catch (e) {
    if (isAgreementError(e)) return;
    S.memory.detailError = e;
  } finally {
    S.memory.detailLoading = false;
    if (S.tab === "memory") renderPage();
  }
}

async function submitClaim() {
  const c = S.memory.claim;
  c.error = null;
  c.ok = null;
  if (!c.title.trim()) {
    c.error = { message: "写卡需要标题。", hint: "标题写清楚这张卡解决什么问题。" };
    renderPage();
    return;
  }
  if (!c.body.trim()) {
    c.error = { message: "写卡需要正文。", hint: "把证据、步骤与验收条件写进 Markdown。" };
    renderPage();
    return;
  }
  if (c.saving) return;
  c.saving = true;
  renderPage();
  try {
    const tags = c.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const data = await request("/api/memory/claim", {
      method: "POST",
      body: { title: c.title.trim(), kind: c.kind || "skill", tags, body: c.body },
    });
    if (!data || data.ok === false) throw payloadError(data, "提交写卡失败");
    c.ok = { status: data.status || "pending", path: (data.card && data.card.path) || data.path || "" };
    c.title = "";
    c.body = "";
    c.tags = "";
  } catch (e) {
    c.error = { message: e.message, hint: e.hint };
    if (isAgreementError(e)) return;
  } finally {
    c.saving = false;
    renderPage();
  }
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
        <label class="field"><span>记忆服务地址</span>
          <input id="sBase" data-focus="sBase" type="text" value="${esc(val("memoryBase", s.memoryBase))}" placeholder="http://127.0.0.1:7999/memory-eternal/api" spellcheck="false">
          ${fieldDefault("memoryBase", val("memoryBase", s.memoryBase), FIELD_DEFAULTS.memoryBase)}
          <span class="help">本地优先；填远端地址即切到云端。页头来源按地址推断为 local / cloud。</span>
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
      { key: "paths", html: pathsGroup },
      { key: "diag", html: diagGroup },
    ])}
  `;
  bindSettings();
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
          <dt>项目名</dt><dd>autokill-purge</dd>
          <dt>版本</dt><dd class="mono">${esc(S.version || "—")}</dd>
          <dt>作者</dt><dd>EternalNight996（YG）</dd>
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
  const start = tabFromHash();
  S.tab = start;
  try { history.replaceState(null, "", "#/" + start); } catch { /* file:// */ }

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

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();



