/** Linux runner installed on Agent Computer. Owns one CLI process group and its checkpoint. */
export const CODING_JOB_RUNNER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const job = JSON.parse(fs.readFileSync('job.json', 'utf8'));
const checkpoint = 'checkpoint.json';
const save = () => { if (!state.sessionId && fs.existsSync('progress.log')) { const fd=fs.openSync('progress.log','r'); const chunk=Buffer.alloc(65536); const count=fs.readSync(fd,chunk,0,chunk.length,0); fs.closeSync(fd); for(const line of chunk.subarray(0,count).toString().split('\n')) { try { const event=JSON.parse(line); if(event.type==='thread.started' && typeof event.thread_id==='string') state.sessionId=event.thread_id; } catch {} } } fs.writeFileSync(checkpoint + '.next', JSON.stringify(state)); fs.renameSync(checkpoint + '.next', checkpoint); };
let state = fs.existsSync(checkpoint) ? JSON.parse(fs.readFileSync(checkpoint, 'utf8')) : { phase: 'starting', repository: job.repository, branch: job.branch, worktree: path.resolve('worktree'), artifacts: ['progress.log','diff.patch'] };
function identity(pid) { try { return fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ')[1].split(' ')[19]; } catch { try { return cp.execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {encoding: 'utf8'}).trim() || null; } catch { return null; } } }
function verified() { return state.pid && identity(state.pid) === state.identity; }
function signal(name) { if (verified()) { try { process.kill(-state.pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; } } }
const lock = 'runner.lock';
try { fs.mkdirSync(lock); } catch {
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
  if (identity(owner.pid) === owner.identity) process.exit(0);
  fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); fs.mkdirSync(lock);
}
fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, identity: identity(process.pid)}));
process.on('exit', () => { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); });
function pause() { if (verified()) signal('SIGSTOP'); state.phase = 'paused'; save(); }
function launch() {
  if (verified()) { signal('SIGCONT'); state.phase = 'running'; save(); return; }
  if (state.phase === 'completed' || state.phase === 'stopped') return;
  try {
    if (!job.testCommand) {
      cp.execFileSync('codex', ['login', 'status'], {stdio: 'ignore'});
      cp.execFileSync('gh', ['auth', 'status'], {stdio: 'ignore'});
      if (!fs.existsSync('repo')) cp.execFileSync('git', ['clone', '--', 'https://github.com/' + job.repository + '.git', 'repo'], {stdio: 'ignore'});
      if (!fs.existsSync('worktree')) cp.execFileSync('git', ['-C', 'repo', 'worktree', 'add', '-b', job.branch, '../worktree'], {stdio: 'ignore'});
    }
    const output = fs.openSync('progress.log', 'a', 0o600);
    const prompt = 'Read repository instructions and implement this approved task. Continue from the current worktree and diff. Run focused checks and report commands and exit codes. Do not push, publish a PR, merge, deploy, copy credentials or disable permission checks. Save a local PR draft. Task data follows:\n' + job.task;
    const args = job.testCommand ? ['-e', job.testCommand] : state.sessionId ? ['exec', '--sandbox', 'workspace-write', 'resume', '--json', state.sessionId, prompt] : ['exec', '--json', '--sandbox', 'workspace-write', prompt];
    const child = cp.spawn(job.testCommand ? process.execPath : 'codex', args, {cwd: job.testCommand ? process.cwd() : path.resolve('worktree'), detached: true, stdio: ['ignore', output, output]});
    fs.closeSync(output);
    child.on('error', () => { state.phase = 'blocked'; save(); });
    state = {...state, pid: child.pid, identity: identity(child.pid), phase: 'running'}; save();
    child.on('exit', (code, sig) => { state.phase = state.phase === 'stopping' ? 'stopped' : code === 0 ? 'completed' : 'blocked'; state.exitCode = code; state.signal = sig; if (!job.testCommand) { try { fs.writeFileSync('diff.patch', cp.execFileSync('git', ['diff', 'HEAD'], {cwd: 'worktree'})); } catch {} } save(); });
  } catch { state.phase = 'blocked'; state.reason = 'Remote Codex/GitHub sign-in or repository setup failed'; save(); }
}
launch();
let stoppingAt = null;
const timer = setInterval(() => {
  if (fs.existsSync('control.json')) {
    const control = JSON.parse(fs.readFileSync('control.json', 'utf8')); fs.unlinkSync('control.json');
    if (control.action === 'resume') { job.deadline = control.deadline; launch(); }
    if (control.action === 'pause') pause();
    if (control.action === 'stop') { signal('SIGCONT'); signal('SIGTERM'); state.phase = verified() ? 'stopping' : 'stopped'; stoppingAt = Date.now(); save(); }
  }
  if (state.phase === 'stopping' && verified() && Date.now() - stoppingAt > 3000) signal('SIGKILL');
  if (state.phase === 'stopping' && !verified()) { state.phase = 'stopped'; save(); }
  if (state.phase === 'running' && !verified()) { state.phase = 'blocked'; state.reason = 'CLI exit status unavailable after supervisor recovery'; save(); }
  if (state.phase === 'running' && Date.now() >= job.deadline) pause();
  if (['stopped', 'completed', 'blocked'].includes(state.phase)) { clearInterval(timer); process.exit(0); }
}, 100);
`;
