#!/usr/bin/env node
// 校验插件中心目录 index.json。零依赖，Node 22+。
//
//   node scripts/validate.mjs                    只查格式（与片场客户端 flow/market.ts 的 parseCatalog 同一套规则）
//   node scripts/validate.mjs --since <git ref>  另外取回相对 <ref> 新增或改过的每一版，核对清单与 commit
//   node scripts/validate.mjs --all              取回每一个插件的每一版核对（每周定时跑）
//
// 核对一版：按 commit 浅取作者的仓库，onset-station.json 的 id、version 与目录一致，requires.onset 与 requires_onset 一致；
// ref 写的是 tag 时，tag 必须指向这个 commit。图标与截图：在目录仓库里、是 PNG / JPEG / WebP、大小不超限。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MaxIcon = 100 * 1024;
const MaxScreenshot = 500 * 1024;
const idPattern = /^[a-z][a-z0-9-]{1,39}$/;
const semver = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const commitPattern = /^[0-9a-f]{40}$/;
// 与片场的内置插件同名的 id 不收（客户端也会拒绝装）。
const builtinIDs = new Set(['algorithmic-art', 'anidoodle-styles', 'beat', 'cast', 'huashu-styles', 'lemo-styles', 'publishing', 'skins', 'song', 'text-to-lottie']);

const problems = [];
const fail = (msg) => problems.push(msg);

function known(obj, keys, where) {
  for (const k of Object.keys(obj)) if (!keys.includes(k)) fail(`${where} 里有不认识的字段 ${k}`);
}
function text(obj, key, where, required) {
  const v = obj[key];
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && v.trim() === '')) {
    fail(`${where}.${key} 要是非空字符串`);
    return '';
  }
  return v.trim();
}
function repoURL(source) {
  const gh = /^github:([\w.-]+\/[\w.-]+)$/.exec(source);
  if (gh) return `https://github.com/${gh[1]}.git`;
  if (/^https:\/\/\S+$/.test(source)) return source;
  return '';
}
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 格式检查：与客户端同一套规则，另加官方插件中心只收 github: 与 https 来源、图标必须在仓库里。 */
function checkFormat(catalog) {
  if (!isObject(catalog)) return fail('index.json 要是 JSON 对象');
  if (catalog.schema !== 1) fail('schema 要是 1');
  known(catalog, ['$schema', 'schema', 'plugins'], 'index.json');
  if (!Array.isArray(catalog.plugins)) return fail('plugins 要是数组');
  const ids = new Set();
  catalog.plugins.forEach((p, i) => {
    const where = `plugins[${i}]`;
    if (!isObject(p)) return fail(`${where} 要是对象`);
    known(p, ['id', 'name', 'description', 'author', 'license', 'tags', 'homepage', 'source', 'icon', 'screenshots', 'versions'], where);
    const id = text(p, 'id', where, true);
    if (!idPattern.test(id)) fail(`${where}.id 只能用小写字母、数字与 -，以字母开头：${id}`);
    if (builtinIDs.has(id)) fail(`${where}.id ${id} 与片场自带的功能同名`);
    if (ids.has(id)) fail(`${id} 出现了两次`);
    ids.add(id);
    text(p, 'name', where, true);
    const desc = text(p, 'description', where, true);
    if (desc.length > 200) fail(`${where}.description 不超过 200 字`);
    const source = text(p, 'source', where, true);
    if (source.includes('#')) fail(`${where}.source 不带 #ref`);
    else if (repoURL(source) === '') fail(`${where}.source 要是 github:owner/repo 或 https 的 git 地址`);
    if (p.author !== undefined) {
      if (!isObject(p.author)) fail(`${where}.author 要是对象`);
      else {
        known(p.author, ['name', 'url'], `${where}.author`);
        text(p.author, 'name', `${where}.author`, true);
        const url = text(p.author, 'url', `${where}.author`, false);
        if (url !== '' && !url.startsWith('https://')) fail(`${where}.author.url 要是 https 地址`);
      }
    }
    const homepage = text(p, 'homepage', where, false);
    if (homepage !== '' && !homepage.startsWith('https://')) fail(`${where}.homepage 要是 https 地址`);
    text(p, 'license', where, false);
    if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== 'string' || t.trim() === ''))) fail(`${where}.tags 要是字符串数组`);
    const icon = text(p, 'icon', where, false);
    if (icon !== '') checkImage(icon, MaxIcon, `${where}.icon`);
    if (p.screenshots !== undefined) {
      if (!Array.isArray(p.screenshots)) fail(`${where}.screenshots 要是数组`);
      else p.screenshots.forEach((s, k) => checkImage(String(s), MaxScreenshot, `${where}.screenshots[${k}]`));
    }
    if (!Array.isArray(p.versions) || p.versions.length === 0) return fail(`${where}.versions 至少写一版`);
    const seen = new Set();
    p.versions.forEach((v, j) => {
      const vw = `${where}.versions[${j}]`;
      if (!isObject(v)) return fail(`${vw} 要是对象`);
      known(v, ['version', 'ref', 'commit', 'requires_onset'], vw);
      const version = text(v, 'version', vw, true);
      if (!semver.test(version)) fail(`${vw}.version 要是 x.y.z：${version}`);
      if (seen.has(version)) fail(`${where} 的版本 ${version} 出现了两次`);
      seen.add(version);
      if (!commitPattern.test(text(v, 'commit', vw, true))) fail(`${vw}.commit 要是 40 位小写十六进制`);
      text(v, 'ref', vw, false);
      const req = text(v, 'requires_onset', vw, false);
      if (req !== '' && !semver.test(req)) fail(`${vw}.requires_onset 要是 x.y.z`);
    });
  });
}

/** 图标与截图只能放在这个仓库里（相对路径），按文件头认格式。 */
function checkImage(rel, max, where) {
  if (rel.startsWith('/') || rel.split('/').includes('..') || /^[a-z]+:/i.test(rel)) return fail(`${where}：${rel} 要是这个仓库里的相对路径`);
  const file = path.join(root, rel);
  let body;
  try {
    body = fs.readFileSync(file);
  } catch {
    return fail(`${where}：没有文件 ${rel}`);
  }
  if (body.length > max) fail(`${where}：${rel} 有 ${body.length} 字节，上限 ${max}`);
  const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const jpg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const webp = body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpg && !webp) fail(`${where}：${rel} 要是 PNG、JPEG 或 WebP（不收 SVG）`);
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}：${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`);
  return r.stdout.trim();
}

/** 取回一版、核对清单。 */
function checkVersion(p, v) {
  const where = `${p.id} ${v.version}`;
  const url = repoURL(p.source);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onset-catalog-'));
  try {
    git(['init', '-q'], dir);
    try {
      git(['fetch', '-q', '--depth', '1', url, v.commit], dir);
    } catch (err) {
      return fail(`${where}：取不到 commit ${v.commit}（${err.message}）`);
    }
    git(['checkout', '-q', 'FETCH_HEAD'], dir);
    let m;
    try {
      m = JSON.parse(fs.readFileSync(path.join(dir, 'onset-station.json'), 'utf8'));
    } catch (err) {
      return fail(`${where}：commit ${v.commit.slice(0, 12)} 里没有能读的 onset-station.json（${err.message}）`);
    }
    if (m.id !== p.id) fail(`${where}：清单的 id 是 ${m.id}，与目录里的 ${p.id} 不同`);
    if (m.version !== v.version) fail(`${where}：清单的 version 是 ${m.version}，与目录里的 ${v.version} 不同`);
    const req = m.requires?.onset ?? '';
    if (req !== (v.requires_onset ?? '')) fail(`${where}：清单的 requires.onset 是「${req}」，目录里写的是「${v.requires_onset ?? ''}」`);
    if (v.ref && /^v?\d/.test(v.ref)) {
      try {
        const out = git(['ls-remote', url, `refs/tags/${v.ref}`, `refs/tags/${v.ref}^{}`], dir);
        const shas = out.split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
        if (shas.length === 0) fail(`${where}：仓库里没有 tag ${v.ref}`);
        else if (!shas.includes(v.commit)) fail(`${where}：tag ${v.ref} 不指向 ${v.commit.slice(0, 12)}`);
      } catch (err) {
        fail(`${where}：查不了 tag ${v.ref}（${err.message}）`);
      }
    }
    console.log(`  ✓ ${where}（${v.commit.slice(0, 12)}）`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 相对 base 新增或改过的版本：按 id + version + commit 比。 */
function changedVersions(catalog, base) {
  let old = { plugins: [] };
  try {
    old = JSON.parse(execFileSync('git', ['show', `${base}:index.json`], { cwd: root, encoding: 'utf8' }));
  } catch {
    // base 里还没有 index.json：全部算新的。
  }
  const before = new Set((old.plugins ?? []).flatMap((p) => (p.versions ?? []).map((v) => `${p.id}@${v.version}@${v.commit}@${p.source}@${v.requires_onset ?? ''}@${v.ref ?? ''}`)));
  const out = [];
  for (const p of catalog.plugins) for (const v of p.versions) if (!before.has(`${p.id}@${v.version}@${v.commit}@${p.source}@${v.requires_onset ?? ''}@${v.ref ?? ''}`)) out.push([p, v]);
  return out;
}

const args = process.argv.slice(2);
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
} catch (err) {
  console.error(`index.json 不是合法的 JSON：${err.message}`);
  process.exit(1);
}
checkFormat(catalog);
if (problems.length === 0) {
  let todo = [];
  if (args[0] === '--all') todo = catalog.plugins.flatMap((p) => p.versions.map((v) => [p, v]));
  else if (args[0] === '--since') todo = changedVersions(catalog, args[1] ?? 'origin/main');
  if (todo.length > 0) console.log(`核对 ${todo.length} 个版本：`);
  for (const [p, v] of todo) checkVersion(p, v);
}
if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`index.json 没有问题（${catalog.plugins.length} 个插件）。`);
