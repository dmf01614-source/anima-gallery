// build-full-index.mjs —— 本地满血索引构建（Danbooru 全量，流式）
// 策略：≥2 画师的标签 + 每标签最多 2000 画师（corruption 这类低频标签全保留，超高频无意义标签截断）
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const artists = JSON.parse(readFileSync('site/artists-data.json', 'utf8'));
const byBooru = new Map(artists.map((a, i) => [a.b, i]));

// 反向索引：tag -> Map(idx -> count)
const index = new Map();
let matched = 0, total = 0;
const rl = createInterface({ input: createReadStream('data/danbooru-progress.jsonl'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let d;
  try { d = JSON.parse(line); } catch { continue; }
  total++;
  const idx = byBooru.get(d.artist);
  if (idx === undefined) continue;
  matched++;
  for (const [tag, cnt] of Object.entries(d.tags || {})) {
    if (!tag) continue;
    let m = index.get(tag);
    if (!m) { m = new Map(); index.set(tag, m); }
    m.set(idx, (m.get(idx) || 0) + cnt);
  }
  if (total % 10000 === 0) console.log(`  已处理 ${total} 画师（匹配 ${matched}）`);
}
console.log(`匹配 ${matched}/${total}`);

// refetch 补抓数据并入
const REFETCH_FILES = ['data/refetch-danbooru.jsonl', 'data/refetch-gelbooru.jsonl', 'data/refetch-missing.jsonl'];
for (const rf of REFETCH_FILES) {
  if (!existsSync(rf)) continue;
  const rl2 = createInterface({ input: createReadStream(rf), crlfDelay: Infinity });
  for await (const line of rl2) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const idx = byBooru.get(d.artist);
    if (idx === undefined) continue;
    matched++;
    for (const [tag, cnt] of Object.entries(d.tags || {})) {
      if (!tag) continue;
      let m = index.get(tag);
      if (!m) { m = new Map(); index.set(tag, m); }
      m.set(idx, (m.get(idx) || 0) + cnt);
    }
  }
}
const TOP_PER_TAG = 2000;
const out = {};
let tagsKept = 0, pairs = 0;
for (const [tag, m] of index) {
  if (m.size < 2) continue;            // 单画师标签无反查价值
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_PER_TAG);
  out[tag] = arr;
  tagsKept++; pairs += arr.length;
}
writeFileSync('site/index-full.json', JSON.stringify(out));
const sizeMB = (Buffer.byteLength(JSON.stringify(out)) / 1048576).toFixed(1);
console.log(`index-full.json: ${tagsKept} 标签 | ${pairs.toLocaleString()} 对 | ${sizeMB} MB`);
console.log('corruption 画师:', out.corruption?.length);
console.log('cosplay 画师:', out.cosplay?.length);
console.log('1girl 画师:', out['1girl']?.length);
console.log('完成');
