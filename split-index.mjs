// split-index.mjs —— 把 index.json 拆成按标签首字母分片（Cloudflare Pages 25MB 限制）
// index-a.json ~ index-z.json + index-0.json（数字）+ index-other.json（其他字符）
import { readFileSync, writeFileSync } from 'fs';

const src = 'site/index.json';
const index = JSON.parse(readFileSync(src, 'utf8'));
const total = Object.keys(index).length;

const chunks = {};
for (const [k, v] of Object.entries(index)) {
  let c;
  if (/^[a-z]/.test(k)) c = k[0];
  else if (/^[0-9]/.test(k)) c = '0';
  else c = 'other';
  (chunks[c] ||= {})[k] = v;
}

let sum = 0;
for (const c of Object.keys(chunks).sort()) {
  const data = chunks[c];
  const json = JSON.stringify(data);
  writeFileSync(`site/index-${c}.json`, json);
  sum += json.length;
  console.log(`index-${c}.json: ${Object.keys(data).length} 标签, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`\n共 ${total} 标签, 分片 ${Object.keys(chunks).length} 个, 合计 ${(sum / 1024 / 1024).toFixed(2)} MB`);
