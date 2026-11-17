#!/usr/bin/env node
// 校验插件中心目录 index.json。零依赖，Node 22+，要 git、curl、tar。
//
//   node scripts/validate.mjs                    只查格式（与片场客户端 flow/market.ts 的 parseCatalog 同一套规则，另加写法与维护者名单）
//   node scripts/validate.mjs --since <git ref>  另外核对相对 <ref> 新增或改过的每一版
//   node scripts/validate.mjs --all              核对每一个插件的每一版（每周定时跑）
//   --pr-author <GitHub 账号> --association <PR 的 author_association>
//                                                PR 里另查：改的是谁的登记（见 checkMaintainers）
//
// 核对一版：
// - 按 commit 浅取作者的仓库，onset-station.json 的 id、version 与目录一致，requires.onset 与 requires_onset 一致；
// - ref 写的是 tag 时，tag 必须指向这个 commit；
// - GitHub 来源：下 codeload 压缩包（客户端不用 git 时下的就是它），内容摘要必须等于 digest。新加的版本必须写 digest。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { archiveURL, fetchArchive, fetchCommit, formatIndex, githubRepo, indexFile, lsRemote, readManifest, removeUp, repoURL, root, treeDigest } from './lib.mjs';

const MaxIcon = 100 * 1024;
const MaxScreenshot = 500 * 1024;
const idPattern = /^[a-z][a-z0-9-]{1,39}$/;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const semver = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
// 与片场的内置插件同名的 id 不收（客户端也会拒绝装）。
const builtinIDs = new Set(['algorithmic-art', 'anidoodle-styles', 'beat', 'cast', 'huashu-styles', 'lemo-styles', 'publishing', 'skins', 'song', 'text-to-lottie']);
// 插件中心仓库自己的人：不受维护者名单限制（合并前照样有人审）。
const trusted = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

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
function strings(obj, key, where) {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((t) => typeof t !== 'string' || t.trim() === '')) {
    fail(`${where}.${key} 要是字符串数组`);
    return [];
  }
  return v;
}
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 格式检查：与客户端同一套规则，另加官方插件中心只收 github: 与 https 来源、图标必须在仓库里、要写维护者。 */
function checkFormat(catalog) {
  if (!isObject(catalog)) return fail('index.json 要是 JSON 对象');
  if (catalog.schema !== 1) fail('schema 要是 1');
  known(catalog, ['$schema', 'schema', 'plugins'], 'index.json');
  if (!Array.isArray(catalog.plugins)) return fail('plugins 要是数组');
  const ids = new Set();
  catalog.plugins.forEach((p, i) => {
    const where = `plugins[${i}]`;
    if (!isObject(p)) return fail(`${where} 要是对象`);
    known(p, ['id', 'name', 'description', 'author', 'license', 'tags', 'homepage', 'source', 'icon', 'screenshots', 'maintainers', 'deprecated', 'versions'], where);
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
    text(p, 'deprecated', where, false);
    strings(p, 'tags', where);
    const maintainers = strings(p, 'maintainers', where);
    if (maintainers.length === 0) fail(`${where}.maintainers 至少写一个 GitHub 账号（能改这条登记的人）`);
    for (const m of maintainers) if (!loginPattern.test(m)) fail(`${where}.maintainers 里的 ${m} 不像 GitHub 账号`);
    const icon = text(p, 'icon', where, false);
    if (icon !== '') checkImage(icon, MaxIcon, `${where}.icon`);
    for (const [k, s] of strings(p, 'screenshots', where).entries()) checkImage(s, MaxScreenshot, `${where}.screenshots[${k}]`);
    if (!Array.isArray(p.versions) || p.versions.length === 0) return fail(`${where}.versions 至少写一版`);
    const seen = new Set();
    p.versions.forEach((v, j) => {
      const vw = `${where}.versions[${j}]`;
      if (!isObject(v)) return fail(`${vw} 要是对象`);
      known(v, ['version', 'ref', 'commit', 'requires_onset', 'digest', 'yanked'], vw);
      const version = text(v, 'version', vw, true);
      if (!semver.test(version)) fail(`${vw}.version 要是 x.y.z：${version}`);
      if (seen.has(version)) fail(`${where} 的版本 ${version} 出现了两次`);
      seen.add(version);
      if (!commitPattern.test(text(v, 'commit', vw, true))) fail(`${vw}.commit 要是 40 位小写十六进制`);
      text(v, 'ref', vw, false);
      text(v, 'yanked', vw, false);
      const digest = text(v, 'digest', vw, false);
      if (digest !== '' && !digestPattern.test(digest)) fail(`${vw}.digest 要是 sha256:<64 位十六进制>`);
      const req = text(v, 'requires_onset', vw, false);
      if (req !== '' && !semver.test(req)) fail(`${vw}.requires_onset 要是 x.y.z`);
    });
  });
}

/** 图标与截图只能放在这个仓库里（相对路径），按文件头认格式。 */
function checkImage(rel, max, where) {
  if (rel.startsWith('/') || rel.split('/').includes('..') || /^[a-z]+:/i.test(rel)) return fail(`${where}：${rel} 要是这个仓库里的相对路径`);
  let body;
  try {
    body = fs.readFileSync(path.join(root, rel));
  } catch {
    return fail(`${where}：没有文件 ${rel}`);
  }
  if (body.length > max) fail(`${where}：${rel} 有 ${body.length} 字节，上限 ${max}`);
  const png = body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  const jpg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const webp = body.subarray(0, 4).toString() === 'RIFF' && body.subarray(8, 12).toString() === 'WEBP';
  if (!png && !jpg && !webp) fail(`${where}：${rel} 要是 PNG、JPEG 或 WebP（不收 SVG）`);
}

/** 核对一版。isNew：这次新加的版本（必须写 digest）。 */
function checkVersion(p, v, isNew) {
  const where = `${p.id} ${v.version}`;
  const url = repoURL(p.source);
  let dir;
  try {
    dir = fetchCommit(url, v.commit);
  } catch (err) {
    return fail(`${where}：取不到 commit ${v.commit}（${err.message}）`);
  }
  try {
    let m;
    try {
      m = readManifest(dir);
    } catch (err) {
      return fail(`${where}：commit ${v.commit.slice(0, 12)} 里没有能读的 onset-station.json（${err.message}）`);
    }
    if (m.id !== p.id) fail(`${where}：清单的 id 是 ${m.id}，与目录里的 ${p.id} 不同`);
    if (m.version !== v.version) fail(`${where}：清单的 version 是 ${m.version}，与目录里的 ${v.version} 不同`);
    const req = m.requires?.onset ?? '';
    if (req !== (v.requires_onset ?? '')) fail(`${where}：清单的 requires.onset 是「${req}」，目录里写的是「${v.requires_onset ?? ''}」`);
  } finally {
    removeUp(dir);
  }
  if (v.ref && /^v?\d/.test(v.ref)) {
    try {
      const shas = lsRemote(url, [`refs/tags/${v.ref}`, `refs/tags/${v.ref}^{}`]).split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
      if (shas.length === 0) fail(`${where}：仓库里没有 tag ${v.ref}`);
      else if (!shas.includes(v.commit)) fail(`${where}：tag ${v.ref} 不指向 ${v.commit.slice(0, 12)}`);
    } catch (err) {
      fail(`${where}：查不了 tag ${v.ref}（${err.message}）`);
    }
  }
  const archive = archiveURL(p.source, v.commit);
  if (archive !== '') {
    if (!v.digest) {
      if (isNew) fail(`${where}：GitHub 来源的新版本要写 digest（node scripts/bump.mjs 会算好），客户端靠它不用 git 也能装`);
    } else {
      let adir;
      try {
        adir = fetchArchive(archive);
        const got = treeDigest(adir);
        if (got !== v.digest) fail(`${where}：压缩包的内容摘要是 ${got}，目录里写的是 ${v.digest}`);
      } catch (err) {
        fail(`${where}：下不来或解不开压缩包（${err.message}）`);
      } finally {
        if (adir) removeUp(adir);
      }
    }
  }
  console.log(`  ✓ ${where}（${v.commit.slice(0, 12)}）`);
}

function baseCatalog(base) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${base}:index.json`], { cwd: root, encoding: 'utf8' }));
  } catch {
    // base 里还没有 index.json：全部算新的。
    return { plugins: [] };
  }
}

const versionKey = (p, v) => JSON.stringify([p.id, p.source, v.version, v.commit, v.ref ?? '', v.requires_onset ?? '', v.digest ?? '']);

/** 相对 base 新增或改过的版本。 */
function changedVersions(catalog, old) {
  const before = new Set((old.plugins ?? []).flatMap((p) => (p.versions ?? []).map((v) => versionKey(p, v))));
  return catalog.plugins.flatMap((p) => p.versions.filter((v) => !before.has(versionKey(p, v))).map((v) => [p, v]));
}

async function isPublicMember(org, login) {
  const headers = { 'User-Agent': 'onset-plugins-validate', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com/orgs/${org}/public_members/${login}`, { headers });
  return r.status === 204;
}

/**
 * 谁能改哪条登记（与 CocoaPods Trunk「名字归第一个推送的人」同一个意思）：
 * - 改、删已有的插件：PR 作者必须在原来那条登记的 maintainers 里；
 * - 新登记：PR 作者必须写在 maintainers 里；GitHub 来源另外要求作者就是仓库的主人，或者是主人那个组织的公开成员——
 *   不能替别人的仓库登记。
 * 插件中心仓库自己的人（OWNER / MEMBER / COLLABORATOR）不受限制，合并前照样有人审。
 */
async function checkMaintainers(catalog, old, author, association) {
  if (author === '' || trusted.has(association)) return;
  const lower = (xs) => (xs ?? []).map((x) => String(x).toLowerCase());
  const me = author.toLowerCase();
  const oldByID = new Map((old.plugins ?? []).map((p) => [p.id, p]));
  const newByID = new Map(catalog.plugins.map((p) => [p.id, p]));
  for (const [id, before] of oldByID) {
    const after = newByID.get(id);
    if (after && JSON.stringify(after) === JSON.stringify(before)) continue;
    if (!lower(before.maintainers).includes(me)) fail(`${id}：你（${author}）不在这条登记原来的 maintainers 里，不能${after ? '改' : '删'}它；请让维护者发 PR，或请他们先把你加进 maintainers`);
  }
  for (const [id, p] of newByID) {
    if (oldByID.has(id)) continue;
    if (!lower(p.maintainers).includes(me)) fail(`${id}：新登记要把你自己（${author}）写进 maintainers`);
    const gh = githubRepo(p.source);
    if (gh && gh.owner.toLowerCase() !== me && !(await isPublicMember(gh.owner, author))) {
      fail(`${id}：仓库 ${gh.owner}/${gh.repo} 不是你的，你也不是组织 ${gh.owner} 的公开成员；只能登记自己的插件`);
    }
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}

let raw;
let catalog;
try {
  raw = fs.readFileSync(indexFile, 'utf8');
  catalog = JSON.parse(raw);
} catch (err) {
  console.error(`index.json 不是合法的 JSON：${err.message}`);
  process.exit(1);
}
checkFormat(catalog);
if (problems.length === 0 && raw !== formatIndex(catalog)) fail('index.json 要用标准写法（两格缩进，每个字段一行）：运行 node scripts/format.mjs');
if (problems.length === 0) {
  const since = arg('--since');
  const old = since ? baseCatalog(since) : { plugins: [] };
  if (since) await checkMaintainers(catalog, old, arg('--pr-author'), arg('--association'));
  let todo = [];
  if (process.argv.includes('--all')) todo = catalog.plugins.flatMap((p) => p.versions.map((v) => [p, v, false]));
  else if (since) todo = changedVersions(catalog, old).map(([p, v]) => [p, v, true]);
  if (todo.length > 0) console.log(`核对 ${todo.length} 个版本：`);
  for (const [p, v, isNew] of todo) checkVersion(p, v, isNew);
}
if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`index.json 没有问题（${catalog.plugins.length} 个插件）。`);
