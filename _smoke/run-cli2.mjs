import { execFile } from 'node:child_process';
const cmd = 'C:/Program Files/nodejs/dsh-memory.cmd';
execFile(cmd, ['status', '--json', '--port', '7999'], { timeout: 20000, windowsHide: true, shell: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
  console.log(JSON.stringify({ err: err ? String(err.code) + ' ' + err.message.slice(0, 120) : null, out: String(stdout).slice(0, 160), errOut: String(stderr).slice(0, 200) }, null, 2));
});
