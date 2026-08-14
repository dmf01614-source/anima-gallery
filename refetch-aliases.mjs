// refetch-aliases.mjs —— 用别名映射后的正确 tag 重抓 19 个画师的 Gelbooru 数据
import { ProxyAgent, fetch } from 'undici';
import { appendFileSync } from 'fs';

const agent = new ProxyAgent('http://127.0.0.1:9910');
const KEY = 'YOUR_GELBOORU_API_KEY';
const UID = 'YOUR_GELBOORU_USER_ID';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 19 个别名画师的正确 tag（来自 alias-map.json，type=1 画师类型）
const tags = ['rakkasei', 'milkchaotea', 'porankaran', 'ushaku', 'shiro_n', 'rahit', 'rarasa',
  'momokomati', 'hanasawa062', 'rainpoow', 'aguri0406-aoi', 'ki', 'bbbs', 'shinia', 'roku',
  '8107ka', 'namorton09', 'mazumaro', 'siratamamil'];

async function processArtist(tag) {
  let postCount = 0, scoreTotal = 0;
  const tagCount = {};
  for (let page = 0; page < 10; page++) {  // 最多 1000 张（和主抓取一致）
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&api_key=${KEY}&user_id=${UID}&tags=${encodeURIComponent(tag)}&limit=100&pid=${page * 100}`;
    let data = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      try {
        const r = await fetch(url, { dispatcher: agent, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        if (r.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
        if (r.status === 200 && (r.headers.get('content-type') || '').includes('json')) data = await r.json();
        else if (r.status === 404 || r.status === 500) break;
        else await sleep(3000);
      } catch { await sleep(3000 * (attempt + 1)); }
    }
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

let okCount = 0;
for (const tag of tags) {
  await sleep(300);
  try {
    const result = await processArtist(tag);
    appendFileSync('data/gelbooru-progress.jsonl', JSON.stringify(result) + '\n');
    if (result.post_count > 0) okCount++;
    console.log(`✓ ${tag}: ${result.post_count} 作品, ${Object.keys(result.tags).length} 标签`);
  } catch (e) {
    console.log(`✗ ${tag}: ${e.message}`);
  }
}
console.log(`完成：${okCount}/${tags.length} 个有作品`);
