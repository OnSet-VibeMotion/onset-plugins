// validate.mjs 与 bump.mjs 共用的零件。零依赖，Node 22+，要 git、curl、tar。
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const indexFile = path.join(root, 'index.json');

/** index.json 的标准写法：两格缩进、末尾换行。bump.mjs 照这个写，validate.mjs 照这个查。 */
export function formatIndex(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}

/** github:owner/repo 或 https 地址 → git 地址；认不出为空。 */
export function repoURL(source) {
  const gh = /^github:([\w.-]+\/[\w.-]+)$/.exec(source);
  if (gh) return `https://github.com/${gh[1]}.git`;
  if (/^https:\/\/\S+$/.test(source)) return source;
  return '';
}

/** GitHub 上的仓库：{owner, repo}；不是 GitHub 为 null。 */
export function githubRepo(source) {
  const m = /^(?:github:|https:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** 某个 commit 的压缩包地址（客户端不用 git 时下的就是它，flow/archive.ts 的 githubArchiveURL）。 */
export function archiveURL(source, commit) {
  const gh = githubRepo(source);
  return gh ? `https://codeload.github.com/${gh.owner}/${gh.repo}/tar.gz/${commit}` : '';
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]}：${(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ')}`);
  return r.stdout.trim();
}

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onset-catalog-'));
}

/** 下载压缩包并解开到新目录（去掉顶层目录），返回目录。调用方负责删掉它的上一层。 */
export function fetchArchive(url) {
  const tmp = tempDir();
  const file = path.join(tmp, 'plugin.tar.gz');
  const dir = path.join(tmp, 'src');
  run('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '3', '--max-filesize', String(50 * 1024 * 1024), '--output', file, url]);
  fs.mkdirSync(dir);
  run('tar', ['-xzf', file, '-C', dir, '--strip-components', '1']);
  return dir;
}

/** 按 commit 浅取仓库，返回检出目录（git 那条路：客户端没有内容摘要或下不来压缩包时用它）。 */
export function fetchCommit(url, commit) {
  const dir = path.join(tempDir(), 'src');
  fs.mkdirSync(dir);
  run('git', ['init', '-q'], dir);
  run('git', ['fetch', '-q', '--depth', '1', url, commit], dir);
  run('git', ['checkout', '-q', 'FETCH_HEAD'], dir);
  return dir;
}

export function lsRemote(url, refs) {
  return run('git', ['ls-remote', url, ...refs]);
}

/**
 * 插件目录的内容摘要，与片场 packages/engine/src/flow/digest.ts 的 treeDigest 逐字节同一算法：
 * 跳过 .git，按 UTF-8 字节序列出全部文件，逐个记「相对路径\n长度\n」加内容；有符号链接直接报错。
 */
export function treeDigest(dir) {
  const files = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`插件里不能有符号链接：${child}`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk('');
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    const body = fs.readFileSync(path.join(dir, rel));
    hash.update(`${rel}\n${body.length}\n`);
    hash.update(body);
  }
  return 'sha256:' + hash.digest('hex');
}

export function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'onset-station.json'), 'utf8'));
}

export function removeUp(dir) {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}
