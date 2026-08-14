# validate-alias-gelbooru.py —— 验证 Danbooru 别名候选在 Gelbooru 是否有作品
import json, time
import httpx

KEY = 'YOUR_GELBOORU_API_KEY'
UID = 'YOUR_GELBOORU_USER_ID'
client = httpx.Client(proxy='http://127.0.0.1:9910', timeout=25,
                      limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))

candidates = json.load(open('alias-candidates-danbooru.json', encoding='utf-8'))
alias_map = {}
items = list(candidates.items())
print(f'待验证 {len(items)} 个候选')

for i in range(0, len(items), 50):
    batch = items[i:i + 50]
    names = ' '.join(v for _, v in batch)
    for attempt in range(3):
        try:
            r = client.get('https://gelbooru.com/index.php', params={
                'page': 'dapi', 's': 'tag', 'q': 'index', 'json': '1',
                'api_key': KEY, 'user_id': UID, 'names': names, 'limit': 50,
            })
            if r.status_code == 429:
                time.sleep(20)
                continue
            d = r.json()
            info = {str(t.get('name')): int(t.get('count', 0)) for t in d.get('tag', [])}
            for tag, cons in batch:
                if info.get(cons, 0) > 0:
                    alias_map[tag] = cons
                    print(f'  有效: {tag} -> {cons} ({info[cons]} 作品)')
            break
        except Exception as e:
            print(f'  错误: {e}')
            time.sleep(5)
    if (i // 50) % 5 == 0:
        print(f'  进度 {min(i + 50, len(items))}/{len(items)}，有效 {len(alias_map)} 个')
    time.sleep(0.4)

json.dump(alias_map, open('alias-map-danbooru.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'\nGelbooru 有效映射 {len(alias_map)} 个（alias-map-danbooru.json）')
