// build-artist-tags.mjs —— 生成画师 top 30 标签（风格特征，供 AI 出图提示词），一次性
import { createReadStream, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';

const artists = JSON.parse(readFileSync('site/artists-data.json', 'utf8'));
const byBooru = new Map(artists.map((a, i) => [a.b, i]));
const TOP_TAGS = 30;

// 每画师聚合标签（count 累加）
const agg = new Map(); // booru -> {tag: count}
let total = 0;
const rl = createInterface({ input: createReadStream('data/danbooru-progress.jsonl'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let d;
  try { d = JSON.parse(line); } catch { continue; }
  total++;
  if (!byBooru.has(d.artist)) continue;
  let m = agg.get(d.artist);
  if (!m) { m = {}; agg.set(d.artist, m); }
  for (const [tag, cnt] of Object.entries(d.tags || {})) {
    if (!tag) continue;
    m[tag] = (m[tag] || 0) + cnt;
  }
  if (total % 10000 === 0) console.log(`  已处理 ${total} 画师`);
}
console.log(`处理 ${total} 画师，有标签数据 ${agg.size}`);

// 输出：画师 booru -> [ [tag, count], ... ] top 30
const out = {};
for (const [booru, m] of agg) {
  const top = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, TOP_TAGS);
  out[booru] = top;
}
writeFileSync('site/artists-tags-top.json', JSON.stringify(out));
const mb = (Buffer.byteLength(JSON.stringify(out)) / 1048576).toFixed(1);
console.log(`artists-tags-top.json: ${Object.keys(out).length} 画师, 每画师 top ${TOP_TAGS} 标签, ${mb} MB`);
// 抽样验证
const sample = out['inoino'] || out[Object.keys(out)[0]];
console.log('样例画师标签:', JSON.stringify(sample).slice(0, 200));
console.log('完成');
