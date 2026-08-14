// refetch-aliases2.mjs —— 重抓 601 个别名画师（用 alias-map-danbooru.json 的正确 tag）
import { ProxyAgent, fetch } from 'undici';
import { readFileSync, appendFileSync, existsSync, createReadStream } from 'fs';
import { createInterface } from 'readline';

const PROXY = 'http://127.0.0.1:9910';
const API_KEY = 'YOUR_GELBOORU_API_KEY';
const USER_ID = 'YOUR_GELBOORU_USER_ID';
const agent = new ProxyAgent(PROXY);
const CONCURRENCY = 6;
const OUT = 'data/gelbooru-progress.jsonl';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 601 个实际 tag（去重）
const aliasMap = JSON.parse(readFileSync('alias-map-danbooru.json', 'utf8'));
const tags = [...new Set(Object.values(aliasMap))];

// 断点续传：已抓过（进度文件有 post_count>0 记录）的跳过
const done = new Set();
const rl = createInterface({ input: createReadStream(OUT), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  try { const r = JSON.parse(line); if (r.artist && (r.post_count || 0) > 0) done.add(r.artist); } catch {}
}
const todo = tags.filter(t => !done.has(t));
console.log(`[重抓] 别名实际tag ${tags.length} 个 | 已抓 ${done.size} | 待抓 ${todo.length} | 并发 ${CONCURRENCY}`);

let cursor = 0, completed = 0, errors = 0;
const t0 = Date.now();

async function jfetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { dispatcher: agent, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 200) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) return await r.json();
        await sleep(30000); continue;
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
  for (let page = 0; page < 10; page++) {
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&api_key=${API_KEY}&user_id=${USER_ID}&tags=${encodeURIComponent(tag)}&limit=100&pid=${page * 100}`;
    const data = await jfetch(url);
    if (!data || !data.post) break;
    const posts = Array.isArray(data.post) ? data.post : [data.post];
    if (page === 0 && data['@attributes']) postCount = data['@attributes'].count || 0;
    for (const p of posts) {
      scoreTotal += p.score || 0;
      for (const t of (p.tags || '').split(' ')) if (t) tagCount[t] = (tagCount[t] || 0) + 1;
    }
    if (posts.length < 100) break;
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
      if (completed % 25 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`[重抓] 进度 ${completed}/${todo.length} | 用时 ${el.toFixed(0)}s | 速率 ${(completed / el).toFixed(2)}/s`);
      }
    } catch (e) {
      errors++;
      if (errors % 10 === 1) console.error(`[重抓] 错误 #${errors}: ${e.message} (tag=${tag})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const el = (Date.now() - t0) / 1000;
console.log(`[重抓] 完成！待抓 ${todo.length} | 错误 ${errors} | 用时 ${el.toFixed(0)}s`);
