// test/client-nav.mjs —— DSH 侧栏导航项「梦神装甲」的契约
//
// 它验证的是**插件自带的 client bundle**（plugin/lib/client.js），不依赖 DSH 是否在跑：
//   1) 清单里声明了 dsh.client（platform=web）与 exports["./client"]
//   2) bundle 是 __ModuleLoader__ 工厂格式，id 与包名一致
//   3) apply() 只注册到 sidebar.footer.action（list 槽），不抢别人的 single 槽
//   4) 组件展开时渲染「图标 + 名称」，收起时只有图标；点击打开控制台地址
//   5) 本地 tgz 与 profile 里安装的版本一致（避免"改了源码但装的是旧包"）
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const clip = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

const PLUGIN_DIR = 'plugin';
const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf8'));

// 1) 清单契约
ok('1. 清单声明 dsh.client.platform=web', !!(manifest.dsh && manifest.dsh.client && manifest.dsh.client.platform === 'web'), clip(JSON.stringify(manifest.dsh && manifest.dsh.client)));
ok('1a. exports["./client"] 指向 client.js', !!(manifest.exports && manifest.exports['./client'] && String(manifest.exports['./client'].default || '').endsWith('client.js')), manifest.exports && manifest.exports['./client'] && manifest.exports['./client'].default);
ok('1b. files 覆盖 lib（client.js 随包发出）', (manifest.files || []).includes('lib'));

// 2) bundle 加载
const bundlePath = join(PLUGIN_DIR, 'lib', 'client.js');
ok('2. 本地存在 lib/client.js', existsSync(bundlePath));
const src = readFileSync(bundlePath, 'utf8');
let loaded = null;
const fakeReact = { createElement(type, props, ...children) { return { type, props: props || {}, children }; } };
globalThis.window = { __ModuleLoader__: { load: (def) => { loaded = def; } } };
new Function('window', src)(globalThis.window);
ok('2a. bundle 走 __ModuleLoader__.load', !!loaded);
ok('2b. bundle id = 包名', loaded && loaded.id === manifest.name, loaded && loaded.id);

const mod = loaded.factory((name) => {
  if (name === 'react') return fakeReact;
  throw new Error('bundle 只能 require 平台内置模块，实际请求了：' + name);
});
ok('3. 导出 apply/inject', typeof mod.apply === 'function' && Array.isArray(mod.inject), JSON.stringify(mod.inject));

// 3) 注册位置
let options = null;
let component = null;
const registered = [];
mod.apply({
  slots: {
    inject(name, fn) { registered.push(name); fn(); return () => {}; },
    register(opts, comp) { options = opts; component = comp; return () => {}; },
  },
});
ok('3a. 只注册到 sidebar.footer.action', registered.length === 1 && registered[0] === 'sidebar.footer.action', registered.join(','));
ok('3b. 注册项带稳定 id', !!(options && options.id), options && options.id);
ok('3c. 组件是函数', typeof component === 'function');

// 4) 渲染：展开图标+名称，收起只有图标，点击打开控制台
const flatten = (node) => (!node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(flatten)]);
const wideNodes = flatten(component({ wide: true }));
const narrowNodes = flatten(component({ wide: false }));
const labelOf = (nodes) => (nodes.find((n) => n.props && n.props.className === 'ap-armor-label') || {}).children;
ok('4. 展开时出现名称「梦神装甲」', clip([].concat(labelOf(wideNodes) || []).join('')) === '梦神装甲', clip([].concat(labelOf(wideNodes) || []).join('')));
ok('4a. 收起时不渲染名称（只留图标）', !labelOf(narrowNodes));
const btn = wideNodes.find((n) => n.props && n.props['data-mengshen-armor']);
ok('4b. 按钮带 aria-label', !!(btn && btn.props['aria-label'] === '梦神装甲'), btn && btn.props['aria-label']);
ok('4c. 点击有 onClick 处理器', !!(btn && typeof btn.props.onClick === 'function'));

// 5) 安装态一致（只在 profile 存在时断言）
const profile = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'profiles', 'desktop');
const installedPkg = join(profile, 'node_modules', 'autokill-purge-plugin', 'package.json');
if (existsSync(installedPkg)) {
  const inst = JSON.parse(readFileSync(installedPkg, 'utf8'));
  ok('5. profile 里的版本 = 源码版本', inst.version === manifest.version, inst.version + ' vs ' + manifest.version);
  ok('5a. profile 里已带 lib/client.js', existsSync(join(profile, 'node_modules', 'autokill-purge-plugin', 'lib', 'client.js')));
  ok('5b. profile 清单也声明 dsh.client', !!(inst.dsh && inst.dsh.client && inst.dsh.client.platform === 'web'));
} else {
  console.log('SKIP  5.x profile 未安装该插件（只校验源码侧）');
}

console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
