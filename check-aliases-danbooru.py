# check-aliases-danbooru.py —— 用 Danbooru alias API 检查 Gelbooru 0 作品画师的别名
# 原理：Danbooru 有完整的 tag 别名库，查 antecedent(名单名) 的 consequent(实际tag)，
#       再用 Gelbooru 验证 consequent 是否有作品，有就建立映射。
import json, time
from curl_cffi import requests as cffi_requests

PROXY = {'http': 'http://127.0.0.1:9910', 'https': 'http://127.0.0.1:9910'}

zero = json.load(open('zero-tags.json', encoding='utf-8'))
# 去掉已经处理过的括号别名
already = set(json.load(open('alias-map.json', encoding='utf-8')).keys())
already.add('0:00')  # 已人工映射
todo = [t for t in zero if t not in already]
print(f'待查 {len(todo)} 个 0 作品标签（用 Danbooru alias API）')

alias_candidates = {}
for i, tag in enumerate(todo):
    try:
        r = cffi_requests.get('https://danbooru.donmai.us/tag_aliases.json',
                              params={'search[antecedent_name]': tag, 'limit': 1},
                              impersonate='chrome', proxies=PROXY, timeout=20)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and data:
                consequent = str(data[0].get('consequent_name', '')).strip()
                status = str(data[0].get('status', ''))
                if consequent and status == 'active':
                    alias_candidates[tag] = consequent
                    print(f'  Danbooru别名: {tag} -> {consequent}')
        elif r.status_code == 429:
            time.sleep(10)
    except Exception as e:
        pass
    if (i + 1) % 50 == 0:
        print(f'  进度 {i + 1}/{len(todo)}，已发现 {len(alias_candidates)} 个')
    time.sleep(0.25)  # 低频率，避免 challenge

json.dump(alias_candidates, open('alias-candidates-danbooru.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'\nDanbooru 别名候选 {len(alias_candidates)} 个（已存 alias-candidates-danbooru.json）')
