// 演练台：复用 dsh-purge 1.1.71 自己的授权文件与法律声明。
//
// 授权文件：<DSH_HOME>/dsh-purge/drill-grant.json（{granted:true, at}）—— 直接调它的
// lib/drill-grant.js 读写，格式与它完全一致，等于同一个开关，不会出现"两边各记一份"。
// 法律声明：它的 docs/drill-auth-legal.html，剥标签取纯文本给界面用。
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

function home() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh');
}

export function dshPurgeRoot() {
  const cands = [
    'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/plugins/dsh-purge',
    join(process.env.USERPROFILE || '', '.dsh/profiles/desktop/node_modules/dsh-purge'),
    join(process.env.USERPROFILE || '', '.dsh/profiles/web/node_modules/dsh-purge'),
  ];
  return cands.find((p) => p && existsSync(join(p, 'lib', 'drill-grant.js'))) || null;
}

async function grantModule() {
  const root = dshPurgeRoot();
  if (!root) throw new Error('dsh-purge 未安装：找不到 lib/drill-grant.js');
  return import('file:///' + join(root, 'lib', 'drill-grant.js').replace(/\\/g, '/'));
}

export async function readDrill() {
  try {
    const m = await grantModule();
    const g = m.readDrillGrant(home());
    return { ok: true, granted: !!g.granted, at: g.at || null, path: g.path };
  } catch (e) {
    // 插件不在时退回到直接读文件，至少状态能显示
    const file = join(home(), 'dsh-purge', 'drill-grant.json');
    if (!existsSync(file)) return { ok: true, granted: false, at: null, path: file, degraded: String((e && e.message) || e) };
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      return { ok: true, granted: raw && raw.granted === true, at: (raw && raw.at) || null, path: file, degraded: String((e && e.message) || e) };
    } catch {
      return { ok: true, granted: false, at: null, path: file, degraded: String((e && e.message) || e) };
    }
  }
}

export async function grantDrill(dataDir, signer) {
  const m = await grantModule();
  const file = join(home(), 'dsh-purge', 'drill-grant.json');
  // 授权文件本身也备份一份，撤销后能看出之前签过什么
  if (existsSync(file)) {
    const dir = join(dataDir, 'host-snapshots', 'drill-' + Date.now());
    await mkdir(dir, { recursive: true });
    await copyFile(file, join(dir, 'drill-grant.json'));
  }
  const g = m.writeDrillGrant(home());
  if (signer) {
    // 记下签署人（它的文件只有 granted/at，我们额外写一个旁注文件，不改它的格式）
    try {
      const note = join(home(), 'dsh-purge', 'drill-grant.signer.json');
      await writeFile(note, JSON.stringify({ signer: String(signer).slice(0, 80), at: g.at || new Date().toISOString() }, null, 2) + '\n', 'utf8');
    } catch { /* 旁注失败不影响授权 */ }
  }
  return { ok: true, granted: true, at: g.at || null, path: g.path, signer: signer || null };
}

export async function revokeDrill(dataDir) {
  const m = await grantModule();
  const file = join(home(), 'dsh-purge', 'drill-grant.json');
  if (existsSync(file)) {
    const dir = join(dataDir, 'host-snapshots', 'drill-revoke-' + Date.now());
    await mkdir(dir, { recursive: true });
    await copyFile(file, join(dir, 'drill-grant.json'));
  }
  const removed = m.clearDrillGrant(home());
  return { ok: true, removed: removed };
}

/** 法律声明：剥 HTML 标签，保留小节标题与条文 */
export async function drillLegal() {
  const root = dshPurgeRoot();
  const file = root ? join(root, 'docs', 'drill-auth-legal.html') : null;
  if (!file || !existsSync(file)) return { ok: false, error: 'legal_missing', text: '' };
  const html = await readFile(file, 'utf8');
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(h1|h2|h3|p|li|div|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ok: true, path: file, text: text, bytes: Buffer.byteLength(html) };
}
