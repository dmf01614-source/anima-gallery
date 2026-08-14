// fetch-danbooru.mjs —— 稳健版：低并发 + API key + Cloudflare challenge 检测
// 输出 JSONL：每行一个画师 {artist, post_count, fav_total, tags:{tag:count}}
import { ProxyAgent, fetch } from 'undici';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

const PROXY = 'http://127.0.0.1:9910';
const LOGIN = 'YOUR_DANBOORU_LOGIN';
const API_KEY = 'YOUR_DANBOORU_API_KEY';
const agent = new ProxyAgent(PROXY);
const CONCURRENCY = 15;          // 低并发，避免触发 Cloudflare
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const OUT = 'data/danbooru-progress.jsonl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

mkdirSync('data', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = () => sleep(100 + Math.random() * 300);   // 随机延迟 100-400ms

const artists = JSON.parse(readFileSync('artists.json', 'utf8'));
const allTags = [...new Set(artists.map(a => a.b))];

// 断点续传：只跳过「tags 非空」的画师（tags 空的要重抓）
const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.artist && r.tags && Object.keys(r.tags).length > 0) done.add(r.artist);
    } catch {}
  }
}
const todo = allTags.filter(t => !done.has(t));

const results = new Map();
const queue = [];
for (const tag of todo) {
  results.set(tag, { artist: tag, post_count: 0, fav_total: 0, tags: {}, remaining: 1 });
  queue.push({ tag, page: 1 });
}
let pending = queue.length;

console.log(`[Danbooru] 总 ${allTags.length} | 已完成(有标签) ${done.size} | 待抓 ${todo.length} | 并发 ${CONCURRENCY}`);

let completed = 0, errors = 0, challenges = 0;
const t0 = Date.now();

async function jfetch(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    await jitter();
    try {
      const r = await fetch(url, { dispatcher: agent, headers: { 'User-Agent': UA } });
      if (r.status === 200) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) return await r.json();
        // HTML 响应 = Cloudflare challenge
        challenges++;
        console.log(`[challenge] 等待 45s 后重试 (第 ${i + 1}/${retries} 次)`);
        await sleep(45000);
        continue;
      }
      if (r.status === 429) { await sleep(6000 * (i + 1)); continue; }
      if (r.status === 404) return [];
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(4000 * (i + 1));
    }
  }
  return [];
}

async function getCount(tag) {
  try {
    const c = await jfetch(`https://danbooru.donmai.us/counts/posts.json?tags=${encodeURIComponent(tag)}&login=${LOGIN}&api_key=${API_KEY}`);
    return c?.counts?.posts || 0;
  } catch { return 0; }
}

async function worker() {
  while (true) {
    const task = queue.shift();
    if (!task) {
      if (pending === 0) return;
      await sleep(100);
      continue;
    }
    const { tag, page } = task;
    const rec = results.get(tag);
    if (!rec) { pending--; continue; }
    try {
      const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(tag)}+parent:none&limit=${PAGE_SIZE}&page=${page}&only=id,tag_string_general,tag_string_character,tag_string_copyright,fav_count&login=${LOGIN}&api_key=${API_KEY}`;
      const posts = await jfetch(url);
      if (Array.isArray(posts) && posts.length > 0) {
        for (const p of posts) {
          rec.fav_total += p.fav_count || 0;
          for (const field of ['tag_string_general', 'tag_string_character', 'tag_string_copyright']) {
            const s = p[field];
            if (!s) continue;
            for (const t of s.split(' ')) if (t) rec.tags[t] = (rec.tags[t] || 0) + 1;
          }
        }
        if (page === 1 && posts.length === PAGE_SIZE) {
          for (let np = 2; np <= MAX_PAGES; np++) {
            queue.push({ tag, page: np });
            pending++;
            rec.remaining++;
          }
        }
        if (page === 1) rec.post_count = await getCount(tag);
      }
      rec.remaining--;
      if (rec.remaining <= 0) {
        appendFileSync(OUT, JSON.stringify({ artist: tag, post_count: rec.post_count, fav_total: rec.fav_total, tags: rec.tags }) + '\n');
        completed++;
        if (completed % 50 === 0) {
          const el = (Date.now() - t0) / 1000;
          console.log(`[Danbooru] 进度 ${completed}/${todo.length} | 用时 ${el.toFixed(0)}s | 速率 ${(completed / el).toFixed(2)}/s | challenge ${challenges}`);
        }
      }
    } catch (e) {
      errors++;
      if (errors % 10 === 1) console.error(`[Danbooru] 错误 #${errors}: ${e.message} (tag=${tag})`);
    }
    pending--;
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const el = (Date.now() - t0) / 1000;
console.log(`[Danbooru] 完成！待抓 ${todo.length} | 错误 ${errors} | challenge ${challenges} | 用时 ${el.toFixed(0)}s`);
