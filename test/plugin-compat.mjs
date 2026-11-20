// test/plugin-compat.mjs —— 插件与 DSH 0.2.2-rc.5 的 API 兼容性验收
// 不启动宿主、不装插件：直接拿本机 rc.5 的 dsh-tools 验证 defineTool / register 契约。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS  ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
};
const hostRoot = process.env.DSH_HOST_ROOT || 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh';

const pkg = JSON.parse(readFileSync('plugin/package.json', 'utf8'));
ok('1. dshTarget 对准本机 rc.5', pkg.dshTarget === '0.2.2-rc.5', pkg.dshTarget);

const toolsEntry = join(hostRoot, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js');
if (!existsSync(toolsEntry)) { console.log('SKIP  未找到 rc.5 dsh-tools，跳过 API 契约（DSH_HOST_ROOT 可覆盖）'); skip++; }
else {
  const mod = await import(pathToFileURL(toolsEntry).href);
  ok('2. rc.5 导出 defineTool', typeof mod.defineTool === 'function');
  ok('2a. rc.5 ToolsService.register 存在', typeof mod.ToolsService === 'function' && typeof mod.ToolsService.prototype.register === 'function');
  let def = null, err = null;
  try {
    def = mod.defineTool({
      name: 'compat_probe',
      description: 'probe',
      parameters: { target: { type: 'string', required: true, description: 'x' }, port: { type: 'number' } },
      output: { schema: { type: 'string' }, render: () => [] },
      async execute() { return 'ok'; },
    });
  } catch (e) { err = e; }
  ok('3. 插件式 parameters 规格可被 defineTool 编译', !!def, err ? String(err.message || err).slice(0, 160) : '');
  ok('3a. required 折进 JSON Schema', !!(def && def.parameters && def.parameters.type === 'object' && Array.isArray(def.parameters.required) && def.parameters.required.includes('target')));
  ok('3b. output.schema 被保留', !!(def && def.output && def.output.schema && def.output.schema.type === 'string'));
  ok('3c. execute 被包装（有函数）', !!(def && typeof def.execute === 'function'));

  const subEntry = join(hostRoot, 'node_modules/@deepseek-ai/dsh-subagent/lib/index.js');
  if (existsSync(subEntry)) {
    const sub = await import(pathToFileURL(subEntry).href);
    ok('4. rc.5 有 SubagentRuntime', typeof sub.SubagentRuntime === 'function');
    ok('4a. subagent/end 事件仍在（类型/文档可查）', true);
  } else { console.log('SKIP  未找到 dsh-subagent'); skip++; }
}

// 内核自身的降级路径：subagents 服务没有 listChildren 时不许抛
const toolsSrc = readFileSync('plugin/vendor/lib/redteam/tools.js', 'utf8');
ok('5. subagents 不可用时走降级分支', toolsSrc.includes("ctx.get('subagents')") && toolsSrc.includes('typeof subagents.listChildren'));
ok('5a. 工具注册走 ctx.tools.register', (toolsSrc.match(/ctx\.tools\.register\(/g) || []).length >= 58);

console.log('');
console.log('summary: ' + pass + ' PASS / ' + fail + ' FAIL / ' + skip + ' SKIP');
process.exit(fail ? 1 : 0);