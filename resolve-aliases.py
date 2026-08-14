# resolve-aliases.py —— 对 0 作品标签自动检测别名（"X (Y)" 格式，Y 可能是实际 tag）
import json, time, re
import httpx

KEY = 'YOUR_GELBOORU_API_KEY'
UID = 'YOUR_GELBOORU_USER_ID'
client = httpx.Client(proxy='http://127.0.0.1:9910', timeout=25,
                      limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))

zero = json.load(open('zero-tags.json', encoding='utf-8'))
alias_map = {}
candidates = []

# 提取 "X (Y)" 格式的标签：括号里的 Y 作为候选实际 tag
for tag in zero:
    m = re.match(r'^.+_\((.+)\)$', tag)
    if m:
        y = m.group(1)
        # 跳过明显不是 tag 的候选（user_xxx / artist / pixiv xxx 等）
        if y in ('artist',) or y.startswith(('user_', 'pixiv_')):
            continue
        candidates.append((tag, y))

print(f'0作品标签 {len(zero)} 个，其中括号格式候选 {len(candidates)} 个')

# 批量查 Y 的 count（s=tag 端点），count>0 的即别名映射
for i in range(0, len(candidates), 50):
    batch = candidates[i:i + 50]
    names = ' '.join(y for _, y in batch)
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
            # type 字段：1=artist(画师) 0=general(通用词如 pixiv) 3=copyright 4=character 5=meta
            # 只接受 type=1 的候选，排除 pixiv/voice_actor 这类通用词误判
            tag_info = {str(t.get('name')): (int(t.get('count', 0)), int(t.get('type', -1))) for t in d.get('tag', [])}
            for tag, y in batch:
                cnt, typ = tag_info.get(y, (0, -1))
                if cnt > 0 and typ == 1:
                    alias_map[tag] = y
                    print(f'  别名: {tag} -> {y} ({cnt} 作品, 画师)')
            break
        except Exception as e:
            print(f'  错误: {e}')
            time.sleep(5)
    time.sleep(0.5)

json.dump(alias_map, open('alias-map.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'发现 {len(alias_map)} 个别名映射（已存 alias-map.json）')
