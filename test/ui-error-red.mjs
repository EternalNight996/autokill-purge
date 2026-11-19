// test/ui-error-red.mjs —— 「报错一律红色标识」的静态断言（不需要控制台在跑）
//
// 背景：toast 原本是"只有确认"的单色条（style.css 原注释：never errors），
// 但 30+ 处失败路径都走它 —— 失败和成功长得一样。本文件锁住三件事：
//   1) toast 有 bad/warn 两态且 bad 用 --bad；
//   2) 失败/拦截提示不再走中性 toast；
//   3) 右侧栏取数错误是红的。
import { readFileSync } from 'node:fs';
import process from 'node:process';

const css = readFileSync('web/public/style.css', 'utf8');
const js = readFileSync('web/public/app.js', 'utf8');
const html = readFileSync('web/public/index.html', 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};

// 1) toast 三态
ok('1. toast() 支持 kind 参数', /function toast\(message, kind = "ok"\)/.test(js));
ok('1a. toastError() 存在', /function toastError\(message\)/.test(js));
ok('1b. .toast.bad 用 --bad 描边', /\.toast\.bad\s*\{[^}]*var\(--bad\)/.test(css));
ok('1c. .toast.bad 用 --bad-soft 底', /\.toast\.bad\s*\{[^}]*var\(--bad-soft\)/.test(css));
ok('1d. .toast.warn 用 --warn', /\.toast\.warn\s*\{[^}]*var\(--warn\)/.test(css));
ok('1e. 每次 toast 重置类名', /el\.className = "toast"/.test(js));
ok('1f. 红态 role=alert + aria-live=assertive', /tone === "bad" \? "alert" : "status"/.test(js) && /"assertive"/.test(js));
ok('1g. 红态停留更久（4.2s > 确认 2.2s）', /bad: 4200/.test(js) && /ok: 2200/.test(js));

// 2) 失败路径零漏网
const silent = js.match(/toast\((?:simpleReason\(|"失败：")/g) || [];
ok('2. 没有走中性 toast 的失败提示', silent.length === 0, silent.join(', '));
const errCalls = (js.match(/toastError\(/g) || []).length;
ok('2a. toastError 调用点 ≥ 30（定义+失败+拦截）', errCalls >= 30, 'count=' + errCalls);

// 3) 右侧栏取数错误红色
ok('3. .rail-err 用 --bad', /\.inject-rail \.rail-err\s*\{[^}]*var\(--bad/.test(css));
ok('3a. 错误卡片 rail-err-card（样式+用法）', /\.rail-card\.rail-err-card/.test(css) && /rail-err-card/.test(js));
ok('3b. summary.errors 有红色渲染', /d\.errors/.test(js) && /取数错误/.test(js));

// 4) 既有红色面不回归
ok('4. 补丁失败态 tone-fail 仍是红', /\.patch-state\.tone-fail\s*\{[^}]*#f85149/.test(css));
ok('4a. alert.bad 仍是红', /\.alert\.bad\s*\{[^}]*var\(--bad-soft\)/.test(css));
ok('4b. toast 容器存在', /id="toast"/.test(html));
// 5) 运行时 JS 错误红色横幅（技术模式）
ok('5. 运行时错误容器存在', /id="runtimeErrors"/.test(html));
ok('5a. renderRuntimeErrors 用 alert bad', /function renderRuntimeErrors\(\)/.test(js) && /alert bad" role="alert"><strong>页面运行时错误/.test(js));
ok('5b. 只在技术模式显示', /!list\.length \|\| !modeIsTechnical\(\)/.test(js));
ok('5c. 错误处理器会重渲染横幅', (js.match(/try \{ renderRuntimeErrors\(\); \}/g) || []).length >= 2);

// 6) 注入生效探针（文件在 ≠ 生效）
ok('6. 右侧栏渲染注入生效行', /injectionRailText/.test(js) && /d\.injection/.test(js));
ok('7. 指令层 rail 文案存在', /instructionsRailText/.test(js) && js.includes('指令层'));
ok('7a. 破甲页有「写 AGENTS.md」按钮', /data-inject-agents=/.test(js) && /data-inject-agents-off/.test(js));
ok('6a. 未生效时用 rail-err', /d\.injection\.ready && !d\.injection\.effective \? ' rail-err'/.test(js));


console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
