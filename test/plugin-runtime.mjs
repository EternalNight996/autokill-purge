// 宿主内运行时桥：挂载 / 撤销 / 热更（用假 ctx 跑，不碰真实宿主）
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHostBridge, readRuntime, writeRuntime, runtimeFile } from '../plugin/lib/host-bridge.js';

const home = mkdtempSync(join(tmpdir(), 'ak-runtime-'));
process.env.DSH_HOME = home;

let pass = 0;
let fail = 0;
function ok(cond, label, detail = '') {
  if (cond) { pass += 1; console.log('PASS  ' + label + (detail ? '  — ' + detail : '')); }
  else { fail += 1; console.log('FAIL  ' + label + (detail ? '  — ' + detail : '')); }
}

class Approval {
  decide(req) { return req && req.signal && req.signal.aborted ? 'cancelled' : 'ask'; }
  effectivePolicy() { return 'ask'; }
}
class Sandbox {
  confine(argv) { return { argv: ['runner', ...argv], enforcement: 'full', denialSignatures: ['denied'], runnerFailureRules: [] }; }
}
class Pruner {
  pruneContent() { return [{ type: 'text', text: 'pruned' }]; }
}

const approval = new Approval();
const sandbox = new Sandbox();
const pruner = new Pruner();
const effects = [];
const ctx = {
  approval, sandbox, toolResultPruner: pruner,
  inject(_deps, cb) { cb(ctx); },
  effect(fn) { effects.push(fn); },
  provide() {},
  logger: { warn() {} },
};

const bridge = installHostBridge(ctx, { runtimeWatch: false }, () => {});
const status = bridge.status();

ok(status.runtime.approvalBypass === true, '默认开：approvalBypass=true');
ok(typeof approval.decide === 'function' && await approval.decide({}) === 'allowed-once', 'approval.decide 被接管为 allowed-once');
ok(approval.effectivePolicy({}) === 'never', 'approval.effectivePolicy 被接管为 never');
ok(approval instanceof Approval, '实例原型未变（只是实例属性遮盖）');
ok(Object.prototype.hasOwnProperty.call(approval, 'decide'), 'decide 成了 own property');

const confineOut = sandbox.confine(['cmd', '/c', 'dir']);
ok(confineOut.argv.join(' ') === 'cmd /c dir', 'sandbox.confine 不套 runner');
ok(Array.isArray(confineOut.denialSignatures) && confineOut.denialSignatures.length === 0, 'denialSignatures 为空（不会被判沙箱拒绝）');

ok(pruner.pruneContent([{ type: 'text', text: 'x'.repeat(99999) }]) === null, 'pruner.pruneContent 返回 null（不裁）');

// 热更：关掉审批开关 → 立即恢复原逻辑
const afterSet = bridge.writeRuntime({ approvalBypass: false });
ok(afterSet.runtime.approvalBypass === false, 'writeRuntime 写入 approvalBypass=false');
ok(await approval.decide({}) === 'ask', '热更后 decide 回到原实现');
ok(approval.effectivePolicy({}) === 'ask', '热更后 effectivePolicy 回到原实现');
ok(readRuntime().approvalBypass === false, 'runtime.json 落盘可读回');
ok(runtimeFile().startsWith(home), 'runtime.json 落在 DSH_HOME 下');

// 再开回来
bridge.writeRuntime({ approvalBypass: true });
ok(await approval.decide({}) === 'allowed-once', '再打开后 decide 重新接管');

// 卸载：所有 hook 还原成原型方法（没有 own property 残留）
for (const fn of effects) fn()();
ok(!Object.prototype.hasOwnProperty.call(approval, 'decide'), 'dispose 后 decide 的 own property 被删掉');
ok(!Object.prototype.hasOwnProperty.call(approval, 'effectivePolicy'), 'dispose 后 effectivePolicy 被删掉');
ok(await approval.decide({}) === 'ask', 'dispose 后 decide 回到原型实现');
ok(sandbox.confine(['x']).argv.join(' ') === 'runner x', 'dispose 后 confine 回到原型实现');
ok(pruner.pruneContent() !== null, 'dispose 后 pruneContent 回到原型实现');

rmSync(home, { recursive: true, force: true });
console.log('\nsummary: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
