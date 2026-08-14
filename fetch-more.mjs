// fetch-more.mjs —— 增量抓取：post_count>1000 的画师继续抓 1000→5000 张
// 傻瓜式说明：之前每个画师最多抓 1000 张（10 页），这个脚本对作品数超过 1000 的画师，
// 继续抓第 11-50 页（即第 1001-5000 张），结果追加到 gelbooru-more.jsonl，merge 时和旧数据相加。
import { ProxyAgent, fetch } from 'undici';
import { createReadStream, appendFileSync, existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';

const PROXY = 'http://127.0.0.1:9910';  // Geph（Gelbooru 走 Geph 不限流）
const API_KEY = 'YOUR_GELBOORU_API_KEY';
const USER_ID = 'YOUR_GELBOORU_USER_ID';
const agent = new ProxyAgent(PROXY);
const CONCURRENCY = 6;         // 并发（Geph 恢复后可提高）
const PAGE_SIZE = 100;
const START_PAGE = 10;         // 从第 10 页开始（前 1000 张已抓过）
const MAX_PAGES = 50;          // 最多 50 页 = 5000 张
const OUT = 'data/gelbooru-more.jsonl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

mkdirSync('data', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 1. 流式读旧进度文件，找出作品数 > 1000 的画师（需要增量抓取的）
const todo = [];
const rl = createInterface({ input: createReadStream('data/gelbooru-progress.jsonl'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.artist && (r.post_count || 0) > START_PAGE * PAGE_SIZE) todo.push({ tag: r.artist, post_count: r.post_count || 0 });
  } catch {}
}
console.log(`[增量] 作品数>1000 的画师：${todo.length} 个`);

// 2. 断点续传：读增量文件的已有画师，跳过
const done = new Set();
if (existsSync(OUT)) {
  const rl2 = createInterface({ input: createReadStream(OUT), crlfDelay: Infinity });
  for await (const line of rl2) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.artist) done.add(r.artist); } catch {}
  }
}
const pending = todo.filter(x => !done.has(x.tag));
console.log(`[增量] 已完成 ${done.size} | 待抓 ${pending.length} | 并发 ${CONCURRENCY}`);

let cursor = 0, completed = 0, errors = 0;
const t0 = Date.now();

function gelbooruUrl(tag, page) {
  const params = new URLSearchParams({
    page: 'dapi', s: 'post', q: 'index', json: '1',
    api_key: API_KEY, user_id: USER_ID,
    tags: tag, limit: String(PAGE_SIZE), pid: String(page * PAGE_SIZE),
  });
  return `https://gelbooru.com/index.php?${params}`;
}

async function jfetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { dispatcher: agent, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 200) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) return await r.json();
        await sleep(30000);
        continue;
      }
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (r.status === 404 || r.status === 500) return null;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  return null;
}

// 抓一个画师的第 11-50 页（1001-5000 张）
async function processArtist({ tag, post_count }) {
  const maxPage = Math.min(MAX_PAGES - 1, Math.ceil(post_count / PAGE_SIZE) - 1); // 不超过画师实际页数
  let scoreTotal = 0;
  const tagCount = {};
  for (let page = START_PAGE; page <= maxPage; page++) {
    const data = await jfetch(gelbooruUrl(tag, page));
    if (!data || !data.post) break;
    const posts = Array.isArray(data.post) ? data.post : [data.post];
    for (const p of posts) {
      scoreTotal += p.score || 0;
      const s = p.tags || '';
      for (const t of s.split(' ')) if (t) tagCount[t] = (tagCount[t] || 0) + 1;
    }
    if (posts.length < PAGE_SIZE) break;
  }
  return { artist: tag, post_count, score_total: scoreTotal, tags: tagCount };
}

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= pending.length) return;
    const item = pending[i];
    try {
      const result = await processArtist(item);
      appendFileSync(OUT, JSON.stringify(result) + '\n');
      completed++;
      if (completed % 10 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`[增量] 进度 ${completed}/${pending.length} | 用时 ${el.toFixed(0)}s | 速率 ${(completed / el).toFixed(2)}/s`);
      }
    } catch (e) {
      errors++;
      if (errors % 10 === 1) console.error(`[增量] 错误 #${errors}: ${e.message} (tag=${item.tag})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const el = (Date.now() - t0) / 1000;
console.log(`[增量] 完成！待抓 ${pending.length} | 错误 ${errors} | 用时 ${el.toFixed(0)}s`);
