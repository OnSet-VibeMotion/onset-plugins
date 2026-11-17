#!/usr/bin/env node
// 给已登记的插件加一版：node scripts/bump.mjs --id <插件 id> --commit <40 位 commit> [--ref <tag>]
//
// 按 commit 下作者仓库的压缩包，从里面的 onset-station.json 读 version 与 requires.onset，算内容摘要，
// 追加到这个插件的 versions 里（旧版本保留），用标准写法写回 index.json。第一次登记请手写，见 CONTRIBUTING.md。
// 插件仓库里的「发版自动登记」工作流（.github/workflows/bump.yml）调的就是它。
import fs from 'node:fs';
import { archiveURL, fetchArchive, fetchCommit, formatIndex, indexFile, readManifest, removeUp, repoURL, treeDigest } from './lib.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? '') : '';
}
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const id = arg('--id');
const commit = arg('--commit');
const ref = arg('--ref');
if (!id || !/^[0-9a-f]{40}$/.test(commit)) die('用法：node scripts/bump.mjs --id <插件 id> --commit <40 位 commit> [--ref <tag>]');

const catalog = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const plugin = catalog.plugins.find((p) => p.id === id);
if (!plugin) die(`插件中心里还没有 ${id}：第一次登记请照 CONTRIBUTING.md 手写一条`);
if (plugin.versions.some((v) => v.commit === commit)) die(`${id} 已经登记过 commit ${commit.slice(0, 12)}`);

const archive = archiveURL(plugin.source, commit);
const dir = archive !== '' ? fetchArchive(archive) : fetchCommit(repoURL(plugin.source), commit);
let manifest;
let digest = '';
try {
  manifest = readManifest(dir);
  if (archive !== '') digest = treeDigest(dir);
} finally {
  removeUp(dir);
}
if (manifest.id !== id) die(`commit ${commit.slice(0, 12)} 里清单的 id 是 ${manifest.id}，不是 ${id}`);
if (plugin.versions.some((v) => v.version === manifest.version)) die(`${id} 已经有 ${manifest.version} 这一版了：发新版本前先改清单里的 version`);

const entry = { version: manifest.version };
if (ref) entry.ref = ref;
entry.commit = commit;
if (manifest.requires?.onset) entry.requires_onset = manifest.requires.onset;
if (digest) entry.digest = digest;
plugin.versions.push(entry);
fs.writeFileSync(indexFile, formatIndex(catalog));
console.log(`已加上 ${id} ${manifest.version}（${commit.slice(0, 12)}${digest ? `，${digest.slice(0, 19)}…` : ''}）`);
console.log(`::notice::${id} ${manifest.version}`);
