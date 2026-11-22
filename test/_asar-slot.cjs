const fs = require('fs');
const p = 'C:/Users/Administrator/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const b = fs.readFileSync(p);
const headerSize = b.readUInt32LE(12);
const header = JSON.parse(b.subarray(16, 16 + headerSize).toString('utf8'));
const DATA_OFFSET = 16 + headerSize;

/** 从 asar 读一个文件（支持 .unpacked 就返回 null） */
function readAsar(rel) {
  let node = header;
  for (const part of rel.split('/')) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  if (!node || node.unpacked) return null;
  const start = DATA_OFFSET + Number(node.offset || 0);
  return b.subarray(start, start + Number(node.size || 0));
}

const targets = [
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-input-trigger/lib/client.js',
  'dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',
];
for (const t of targets) {
  const buf = readAsar(t);
  if (!buf) { console.log('MISS', t); continue; }
  const text = buf.toString('utf8');
  console.log('===', t, '(' + text.length + ' B) ===');
  const slots = new Set();
  for (const m of text.matchAll(/[\`'"]([a-z][a-zA-Z0-9_.-]{3,40})[\`'"]\s*\)?\s*(?:,\s*\{|;)/g)) {
    if (/^(composer|chat|session|input|toolbar|message)[.\-]/.test(m[1])) slots.add(m[1]);
  }
  for (const m of text.matchAll(/name:\s*[\`'"]([a-z][\w.-]{3,40})[\`'"]/g)) slots.add('name:' + m[1]);
  console.log([...slots].slice(0, 30).join(', ') || '(none)');
  // 找「标准模式 / standard」附近的 slot
  const idx = text.indexOf('standard');
  if (idx > 0) {
    const around = text.slice(Math.max(0, idx - 300), idx + 300).replace(/\s+/g, ' ');
    console.log('--- near "standard" ---', around.slice(0, 500));
  }
  console.log('');
}
