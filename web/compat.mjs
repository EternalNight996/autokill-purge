// web/compat.mjs —— 兼容性矩阵 + 注入历史
//
// 目的：模型/宿主是外部变量，总有一天会变。这里把「我们测过的组合」写成矩阵，
// 当前组合不在矩阵里就出黄色警告（可能失败，请联系作者），并把每次注入记进历史，
// 出问题时能回看当时用的是哪个模型、哪个宿主版本、哪几张人格卡。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 测过的宿主版本（dsh 包版本 / 桌面 app 版本）。新增验证过的版本往这里加。 */
export const TESTED_HOSTS = {
  dsh: ['0.2.2-rc.5', '0.2.2-rc.2', '0.2.1'],
  app: ['1.1.7', '1.1.71'],
};

/** 模型判定：优先看模型目录里的 dshPurge 标记（supported/default 才算测过） */
export function classifyModel(model) {
  if (!model) return { level: 'unknown', reason: '没有选中模型（会走自动推荐）' };
  const flag = model.dshPurge;
  if (flag === 'supported' || flag === 'default') {
    return { level: 'ok', reason: '目录里标记为已支持' };
  }
  if (flag === 'unsupported' || flag === 'no') {
    return { level: 'bad', reason: '目录里标记为不支持' };
  }
  return { level: 'warn', reason: '没有 dshPurge 标记：未测试，可能失败' };
}

export function classifyHost({ dshVersion, appVersion }) {
  const out = [];
  if (dshVersion) {
    out.push({
      name: 'DSH',
      version: String(dshVersion),
      level: TESTED_HOSTS.dsh.includes(String(dshVersion)) ? 'ok' : 'warn',
      reason: TESTED_HOSTS.dsh.includes(String(dshVersion))
        ? '已测版本'
        : '未测试版本，补丁/注入可能失败',
    });
  }
  if (appVersion) {
    out.push({
      name: '桌面壳',
      version: String(appVersion),
      level: TESTED_HOSTS.app.includes(String(appVersion)) ? 'ok' : 'warn',
      reason: TESTED_HOSTS.app.includes(String(appVersion)) ? '已测版本' : '未测试版本，落地/重启可能失败',
    });
  }
  return out;
}

/** 汇总判定：只要有 warn/bad 就出黄色提示 */
export function summarize({ hostChecks, modelCheck }) {
  const bad = [];
  for (const h of hostChecks || []) if (h.level !== 'ok') bad.push(h.name + ' ' + h.version + '（' + h.reason + '）');
  if (modelCheck && modelCheck.level !== 'ok') bad.push('模型（' + modelCheck.reason + '）');
  if (!bad.length) return { level: 'ok', message: '当前组合在已测范围内' };
  return {
    level: modelCheck && modelCheck.level === 'bad' ? 'bad' : 'warn',
    message: '可能失败：' + bad.join('；') + '。如遇异常请联系作者（附上历史记录里的时间戳）。',
  };
}

// ---------------------------------------------------------------- 历史

function historyFile(dataDir) {
  return join(dataDir, 'persona-history.json');
}

export async function readHistory(dataDir, limit = 30) {
  const f = historyFile(dataDir);
  if (!existsSync(f)) return [];
  try {
    const arr = JSON.parse(await readFile(f, 'utf8'));
    return Array.isArray(arr) ? arr.slice(0, limit) : [];
  } catch { return []; }
}

export async function appendHistory(dataDir, entry) {
  const f = historyFile(dataDir);
  let arr = [];
  try { arr = JSON.parse(await readFile(f, 'utf8')); } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.unshift({ at: new Date().toISOString(), ...entry });
  await mkdir(dataDir, { recursive: true });
  await writeFile(f, JSON.stringify(arr.slice(0, 300), null, 2) + '\n', 'utf8');
  return arr.length;
}
