import { execFile } from 'node:child_process';
const cmd = 'C:/Program Files/nodejs/dsh-memory.ps1';
const args = ['status', '--json', '--port', '7999'];
const file = 'powershell.exe';
const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cmd, ...args];
execFile(file, argv, { timeout: 20000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
  console.log(JSON.stringify({ err: err && (err.code + ' ' + err.message), out: String(stdout).slice(0, 200), errOut: String(stderr).slice(0, 300) }, null, 2));
});
