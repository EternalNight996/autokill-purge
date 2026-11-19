// autokill-purge 专用的 memory-eternal「家目录」（DSH_HOME 重定向）。
//
// 为什么需要：memory-eternal 把「用哪个库」写在 $DSH_HOME/memory-eternal-active-vault.json，
// 而看门狗重启 web 时**优先读这个文件、无视 --vault**（lib/watchdog.js resolveVaultForSpawn：
// "优先共享偏好，没有偏好才用启动参数里的 --vault"）。于是只要 DSH_HOME 与 DSH/MengBot 共用，
// autokill-purge 起的实例迟早被看门狗拽回运营库（实测：7990 上跑的是 memory-vault-ok）。
//
// 解法：给 autokill-purge 一套自己的 DSH_HOME。因为 configFilePath() / vaultPrefPath() /
// 看门狗锁文件 / 沉淀流水全都只看 DSH_HOME，一次重定向就同时隔离六个面：
//   config.json、active-vault.json、watchdog 注册表、capture 流水、peer 配对、云同步队列。
//
// 用法：spawn memory-eternal 前调用 ensureMemHome()，并把 memEnv() 传给子进程。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || homedir();

/** autokill-purge 专属 DSH_HOME（与 DSH/MengBot 的 ~/.dsh 并列，不嵌套避免互相扫描） */
export const MEM_HOME = join(HOME, '.dsh', 'autokill-purge');
export const MEM_CONFIG = join(MEM_HOME, 'memory-eternal-config.json');
export const MEM_ACTIVE_VAULT = join(MEM_HOME, 'memory-eternal-active-vault.json');
export const MEM_WATCHDOG = join(MEM_HOME, 'memory-eternal-watchdog.json');
export const MEM_EMBED = join(MEM_HOME, 'memory-eternal-config.embedding.v2.json');

/** 必须在独立家里被钉死的键：不自动沉淀、不自动同步技能卡、不自己起 web、不改宿主 MCP */
const GUARD = {
  autoCapture: false,
  skillCardsAutoSync: false,
  autoWeb: false,
  mcpAutoMount: false,
  autoMcpSetup: false,
};

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
};

/**
 * 建好独立家目录，并钉死「用哪个库 / 哪个端口 / 哪些自动化」。
 * @param {{port:number, dbName:string}} cfg
 * @returns {{home:string, vault:string, config:string}}
 */
export function ensureMemHome({ port, dbName }) {
  const vault = join(HOME, '.dsh', 'memory-vault-' + dbName);
  mkdirSync(MEM_HOME, { recursive: true });
  mkdirSync(vault, { recursive: true });

  // ① 偏好文件：看门狗重启 web 时读的就是它 —— 指向分库，看门狗就不会再拽回运营库
  writeFileSync(MEM_ACTIVE_VAULT, JSON.stringify({
    path: vault,
    updatedAt: new Date().toISOString(),
    by: 'autokill-purge',
  }, null, 2) + '\n', 'utf8');

  // ② 配置：首次从全局继承一份（保留主题/方言等无害设置），再强制盖上隔离键
  let cfg = readJson(MEM_CONFIG);
  if (!cfg) cfg = readJson(join(HOME, '.dsh', 'memory-eternal-config.json')) || {};
  cfg.vaultDir = vault;
  cfg.webPort = Number(port) || 7990;
  cfg.autoRecall = true;            // 检索要能用
  Object.assign(cfg, GUARD);
  delete cfg.vaultProfiles;         // 不带任何按 workspace 自动选库的规则进来
  cfg.activeVault = '';
  writeFileSync(MEM_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  // ③ 语义召回：默认用**内置**向量（builtin-ngram-768，随包升级、零外部依赖，不用本机 ollama）。
  //    只在文件不存在时写一次 —— 之后用户在控制台改成 local/online 不会被覆盖回去。
  if (!readJson(MEM_EMBED)) {
    writeFileSync(MEM_EMBED, JSON.stringify({
      enabled: true,
      mode: 'builtin',
      baseUrl: 'http://127.0.0.1:7997/v1', // builtin 用不到，占位保持字段齐全
      model: 'builtin-ngram-768',
      rerankModel: '',
      apiKey: '',
      updatedAt: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  }

  return { home: MEM_HOME, vault, config: MEM_CONFIG };
}

/** 子进程环境：把 DSH_HOME 钉到独立家目录；MEMORY_VAULT_DIR 是 vault 解析的最高优先级 */
export function memEnv(vault, extra = {}) {
  const env = Object.assign({}, process.env, { DSH_HOME: MEM_HOME }, extra);
  if (vault) env.MEMORY_VAULT_DIR = vault;
  return env;
}
