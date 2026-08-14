// merge-index.mjs —— 边读边聚合（流式，不存完整 Map）
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from 'fs';
import { createInterface } from 'readline';

mkdirSync('site', { recursive: true });

const artists = JSON.parse(readFileSync('artists.json', 'utf8'));
const booruSet = new Set(artists.map(a => a.b.toLowerCase()));

const MIN_COUNT = 2;
const TOP_N = 200;
const MAX_TAG_LEN = 100;

function isValidTag(tag) {
  if (!tag || tag.length > MAX_TAG_LEN) return false;
  if (/[^\x00-\x7F]/.test(tag)) return false;
  return true;
}

// 边读边聚合
async function processJsonl(path, onRecord) {
  if (!existsSync(path)) return;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.artist) onRecord(r); } catch {}
  }
}

const meta = new Map();          // booruTag -> {post_count, hot}
const mergedTags = new Map();    // booruTag -> {tag: count}（过滤后）

// Danbooru：tags 只含 general/character/copyright（脚本已分类），无需 artist 过滤
await processJsonl('data/danbooru-progress.jsonl', (r) => {
  const m = meta.get(r.artist) || { post_count: 0, hot: 0 };
  m.post_count = Math.max(m.post_count, r.post_count || 0);
  m.hot += r.fav_total || 0;
  meta.set(r.artist, m);
  const tags = mergedTags.get(r.artist) || {};
  for (const [tag, count] of Object.entries(r.tags || {})) {
    if (count < MIN_COUNT) continue;
    if (!isValidTag(tag)) continue;
    tags[tag] = Math.max(tags[tag] || 0, count);
  }
  mergedTags.set(r.artist, tags);
});
console.log('Danbooru 聚合完成');

// Gelbooru：tags 混合，需过滤 artist 标签
// 说明：这个聚合函数对「主数据」和「增量数据(1000-5000张)」都适用，
// tags 用加法合并，所以同一画师两个文件的标签统计会自动累加
function aggregateGelbooru(r) {
  const m = meta.get(r.artist) || { post_count: 0, hot: 0 };
  m.post_count = Math.max(m.post_count, r.post_count || 0);
  m.hot += r.score_total || 0;
  meta.set(r.artist, m);
  const tags = mergedTags.get(r.artist) || {};
  for (const [tag, count] of Object.entries(r.tags || {})) {
    if (count < MIN_COUNT) continue;
    if (booruSet.has(tag.toLowerCase())) continue;
    if (!isValidTag(tag)) continue;
    tags[tag] = (tags[tag] || 0) + count;
  }
  mergedTags.set(r.artist, tags);
}

await processJsonl('data/gelbooru-progress.jsonl', aggregateGelbooru);
console.log('Gelbooru 聚合完成');
// 增量数据（每画师 1001-5000 张）追加聚合
await processJsonl('data/gelbooru-more.jsonl', aggregateGelbooru);
console.log('Gelbooru 增量聚合完成');

// 生成 artists-data
const artistsData = [];
const booruToIndex = new Map();
for (const a of artists) {
  const m = meta.get(a.b) || { post_count: 0, hot: 0 };
  const tagCount = Object.keys(mergedTags.get(a.b) || {}).length;
  booruToIndex.set(a.b, artistsData.length);
  artistsData.push({ a: a.a, d: a.d, b: a.b, n: m.post_count, h: m.hot, t: tagCount, m: a.m || '' });
}
writeFileSync('site/artists-data.json', JSON.stringify(artistsData));
console.log(`artists-data.json：${artistsData.length} 条`);

// 生成倒排索引（每画师 top N）
const index = {};
for (const [booru, tags] of mergedTags) {
  const idx = booruToIndex.get(booru);
  if (idx === undefined) continue;
  const sorted = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, TOP_N);
  for (const [tag, count] of sorted) {
    (index[tag] ||= []).push([idx, count]);
  }
}
writeFileSync('site/index.json', JSON.stringify(index));

const tagCount = Object.keys(index).length;
let pairCount = 0;
for (const k in index) pairCount += index[k].length;
console.log(`index.json：${tagCount} 个标签 | ${pairCount} 个「标签-画师」对`);
console.log('完成');
