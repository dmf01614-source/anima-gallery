# check-all-tags.py —— 全量标签搜索：用 Gelbooru s=tag 端点检查所有画师标签的有效性
# 找出 count=0 的标签（可能是别名/无效），保存到 zero-tags.json
import json, time, sys
import httpx

KEY = 'YOUR_GELBOORU_API_KEY'
UID = 'YOUR_GELBOORU_USER_ID'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0 Safari/537.36'
PROXY = 'http://127.0.0.1:9910'  # Geph（Gelbooru API 走 Geph 不限流）

client = httpx.Client(proxy=PROXY, timeout=25, follow_redirects=True,
                      limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))

artists = json.load(open('site/artists-data.json', encoding='utf-8'))
tags = [a['b'] for a in artists]
print(f'待检查 {len(tags)} 个画师标签')

zero_tags = []
errors = 0
BATCH = 100  # Gelbooru s=tag 每批最多 100 个 names

for i in range(0, len(tags), BATCH):
    batch = tags[i:i + BATCH]
    names = ' '.join(batch)
    # 重试逻辑：429 限流时等待重试
    for attempt in range(5):
        try:
            r = client.get('https://gelbooru.com/index.php', params={
                'page': 'dapi', 's': 'tag', 'q': 'index', 'json': '1',
                'api_key': KEY, 'user_id': UID, 'names': names, 'limit': BATCH,
            }, headers={'User-Agent': UA})
            if r.status_code == 429:
                wait = 30 * (attempt + 1)
                print(f'  限流，等 {wait}s…')
                time.sleep(wait)
                continue
            if r.status_code != 200:
                errors += 1
                print(f'  HTTP {r.status_code} @ 批 {i // BATCH}')
                break
            d = r.json()
            items = d.get('tag', [])
            counts = {str(t.get('name')): int(t.get('count', 0)) for t in items if isinstance(t, dict)}
            for tag in batch:
                if counts.get(tag, -1) == 0:
                    zero_tags.append(tag)
            break
        except Exception as e:
            errors += 1
            print(f'  错误 @ 批 {i // BATCH}: {e}')
            time.sleep(5)
            break
    if (i // BATCH) % 10 == 0:
        print(f'  进度 {i + len(batch)}/{len(tags)}，已发现 0 作品 {len(zero_tags)} 个')
    time.sleep(0.6)  # 批次间隔，避免限流

json.dump(zero_tags, open('zero-tags.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'\n完成：发现 {len(zero_tags)} 个 count=0 的标签（已存 zero-tags.json），错误 {errors} 次')
