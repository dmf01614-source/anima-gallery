// fetch-gelbooru.mjs —— 简单可靠版：cursor 递增 + 每画师串行抓页
import { ProxyAgent, fetch } from 'undici';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

const PROXY = 'http://127.0.0.1:9910';
const API_KEY = 'YOUR_GELBOORU_API_KEY';
const USER_ID = 'YOUR_GELBOORU_USER_ID';
const agent = new ProxyAgent(PROXY);
const CONCURRENCY = 5;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;           // 最多 1000 张
const OUT = 'data/gelbooru-progress.jsonl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

mkdirSync('data', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const artists = JSON.parse(readFileSync('artists.json', 'utf8'));
const allTags = [...new Set(artists.map(a => a.b))];

const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.artist) done.add(r.artist); } catch {}
  }
}
const todo = allTags.filter(t => !done.has(t));

console.log(`[Gelbooru] 总 ${allTags.length} | 已完成 ${done.size} | 待抓 ${todo.length} | 并发 ${CONCURRENCY}`);

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

async function processArtist(tag) {
  let postCount = 0, scoreTotal = 0;
  const tagCount = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await jfetch(gelbooruUrl(tag, page));
    if (!data || !data.post) break;
    const posts = Array.isArray(data.post) ? data.post : [data.post];
    if (page === 0 && data['@attributes']) postCount = data['@attributes'].count || 0;
    for (const p of posts) {
      scoreTotal += p.score || 0;
      const s = p.tags || '';
      for (const t of s.split(' ')) if (t) tagCount[t] = (tagCount[t] || 0) + 1;
    }
    if (posts.length < PAGE_SIZE) break;
  }
  return { artist: tag, post_count: postCount, score_total: scoreTotal, tags: tagCount };
}

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= todo.length) return;
    const tag = todo[i];
    try {
      const result = await processArtist(tag);
      appendFileSync(OUT, JSON.stringify(result) + '\n');
      completed++;
      if (completed % 50 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`[Gelbooru] 进度 ${completed}/${todo.length} | 用时 ${el.toFixed(0)}s | 速率 ${(completed / el).toFixed(2)}/s`);
      }
    } catch (e) {
      errors++;
      if (errors % 10 === 1) console.error(`[Gelbooru] 错误 #${errors}: ${e.message} (tag=${tag})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const el = (Date.now() - t0) / 1000;
console.log(`[Gelbooru] 完成！待抓 ${todo.length} | 错误 ${errors} | 用时 ${el.toFixed(0)}s`);
