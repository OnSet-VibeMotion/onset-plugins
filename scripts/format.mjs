#!/usr/bin/env node
// 把 index.json 改成标准写法（两格缩进、末尾换行）。bump.mjs 也照这个写，PR 的差异因此只有真正改动的几行。
import fs from 'node:fs';
import { formatIndex, indexFile } from './lib.mjs';

fs.writeFileSync(indexFile, formatIndex(JSON.parse(fs.readFileSync(indexFile, 'utf8'))));
