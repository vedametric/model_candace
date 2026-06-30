// Optional git commit+push for persona-doc edits, so edits made in the dashboard
// survive a redeploy (which re-syncs the account folder from git).
//
// If the account folder is a git repo AND a push token is configured
// (DASHBOARD_GIT_TOKEN, with DASHBOARD_GIT_REMOTE owner/repo), the edited file is
// committed and pushed. Otherwise the edit is written to disk only and we report
// committed:false so the UI can warn that it is ephemeral until the next deploy.

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const exec = promisify(execFile);

function isRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

export async function commitDoc(dir, fileName) {
  if (!isRepo(dir)) return { committed: false, reason: 'not a git repo' };

  const token = process.env.DASHBOARD_GIT_TOKEN || '';
  const remote = process.env.DASHBOARD_GIT_REMOTE || ''; // e.g. github.com/vedametric/model_candace
  const author = process.env.DASHBOARD_GIT_AUTHOR || 'admin-dashboard';
  const email = process.env.DASHBOARD_GIT_EMAIL || 'dashboard@local';

  const opts = { cwd: dir, env: { ...process.env } };
  const run = (args) => exec('git', args, opts);

  try {
    await run(['add', fileName]);
    // nothing staged → no-op (idempotent re-save of identical content)
    const status = await run(['status', '--porcelain']).catch(() => ({ stdout: '' }));
    if (!status.stdout.trim()) return { committed: false, reason: 'no changes' };

    await run(['-c', `user.name=${author}`, '-c', `user.email=${email}`,
      'commit', '-m', `dashboard: edit ${fileName}`]);

    if (!token || !remote) {
      return { committed: true, pushed: false, reason: 'no push token — committed locally only' };
    }
    const pushUrl = `https://x-access-token:${token}@${remote}.git`;
    const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || 'HEAD';
    await run(['push', pushUrl, `HEAD:${branch}`]);
    return { committed: true, pushed: true };
  } catch (e) {
    return { committed: false, error: (e.stderr || e.message || '').toString().slice(0, 300) };
  }
}
