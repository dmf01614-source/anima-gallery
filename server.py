# server.py —— 本地画廊服务器（支持 PyInstaller 打包 + config.json 配置）
import http.server
import urllib.parse
import os
import sys
import json
import hashlib
import time as _time
import webbrowser
import threading

import httpx
from curl_cffi import requests as cffi_requests

# ========== 路径（支持打包） ==========
if getattr(sys, 'frozen', False):
    # PyInstaller 打包：exe 所在目录（配置/缓存），数据在 _MEIPASS
    BASE_DIR = os.path.dirname(sys.executable)
    SITE_DIR = os.path.join(sys._MEIPASS, 'site')
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    SITE_DIR = os.path.join(BASE_DIR, 'site')

CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
CACHE_DIR = os.path.join(BASE_DIR, 'cache', 'media')

# ========== 配置（config.json 可覆盖） ==========
# 重要：不再内置任何 API key！每个用户用自己的 key（前端设置面板填写，存在本机）
DEFAULTS = {
    'port': 8765,
    # Geph(9910) 优先——Gelbooru 走 Geph 不限流；Clash(7897) 和直连作为备选
    'proxies': ['http://127.0.0.1:9910', 'http://127.0.0.1:7897', None],
}

def load_config():
    cfg = dict(DEFAULTS)
    if os.path.exists(CONFIG_PATH):
        try:
            user_cfg = json.load(open(CONFIG_PATH, encoding='utf-8'))
            cfg.update({k: v for k, v in user_cfg.items() if v not in (None, '')})
        except Exception:
            pass
    return cfg

CONFIG = load_config()
PORT = int(CONFIG['port'])
PROXIES = list(CONFIG['proxies'])

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36'

# 内存缓存：url -> (timestamp, data, content_type)
IMG_CACHE = {}
CACHE_TTL = 3600

# 心跳：前端页面每 15 秒发 /heartbeat，超时未收到说明用户关闭了网页
LAST_HEARTBEAT = _time.time()
HEARTBEAT_TIMEOUT = 300  # 5 分钟没心跳就自动退出（留足用户打开页面的时间）


def heartbeat_watchdog():
    """监控线程：2 分钟没收到网页心跳就退出（用户已关闭网页）。
    只退出本进程（画廊 server.py 自己），不影响其他任何进程。"""
    while True:
        _time.sleep(15)
        idle = _time.time() - LAST_HEARTBEAT
        if idle > HEARTBEAT_TIMEOUT:
            print(f'已 {int(idle)} 秒未收到网页心跳，用户已关闭网页，服务器退出。')
            os._exit(0)  # 立即退出自身进程（不碰其他进程）

# 每个代理一个连接池（复用连接，避免每张图 DNS+TCP+TLS 握手）
def _make_client(proxy):
    return httpx.Client(
        proxy=proxy,
        timeout=30,
        follow_redirects=True,
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
    )

CLIENTS = {p: _make_client(p) for p in PROXIES}


def fetch_url(url, referer, accept):
    """抓取任意 URL，依次尝试各代理（走连接池），返回 (bytes, content_type)"""
    last_err = None
    for proxy in PROXIES:
        try:
            client = CLIENTS[proxy]
            r = client.get(url, headers={'User-Agent': UA, 'Referer': referer, 'Accept': accept})
            if r.status_code == 200:
                return r.content, r.headers.get('content-type', '')
            last_err = f'HTTP {r.status_code}'
        except Exception as e:
            last_err = str(e)
    raise Exception(last_err or '无法获取')


def fetch_danbooru(url):
    """Danbooru 专用：curl_cffi 伪装 Chrome TLS 指纹，过 Cloudflare challenge
    注意：不显式传 headers，否则覆盖 impersonate 的指纹 → 403
    Danbooru 走 Geph(9910) + curl_cffi——实测 9910 出口 curl_cffi 伪装 Chrome 能过 Cloudflare"""
    danbooru_proxies = ['http://127.0.0.1:9910', 'http://127.0.0.1:7897', None]
    last_err = None
    for proxy in danbooru_proxies:
        for attempt in range(2):  # 每个代理试 2 次：Cloudflare 偶尔拦，重试通常能过
            try:
                proxies = None if proxy is None else {'http': proxy, 'https': proxy}
                r = cffi_requests.get(url, impersonate='chrome', proxies=proxies, timeout=25)
                if r.status_code == 200:
                    return r.content, r.headers.get('content-type', '')
                last_err = f'HTTP {r.status_code}'
                if r.status_code not in (403, 429):
                    break  # 4xx/5xx 非 challenge，换代理
            except Exception as e:
                last_err = str(e)
    raise Exception(last_err or '无法获取')


def _cache_path(url):
    digest = hashlib.sha256(url.encode('utf-8')).hexdigest()[:24]
    return os.path.join(CACHE_DIR, digest + '.bin')


def fetch_image(target):
    # 内存缓存
    cached = IMG_CACHE.get(target)
    if cached and _time.time() - cached[0] < CACHE_TTL:
        return cached[1], cached[2]
    # 磁盘缓存
    path = _cache_path(target)
    if os.path.exists(path):
        try:
            raw = open(path, 'rb').read()
            header, _, body = raw.partition(b'\n')
            ct = header.decode('ascii', errors='ignore')
            if ct and body:
                IMG_CACHE[target] = (_time.time(), body, ct)
                return body, ct
        except OSError:
            pass
    # 网络抓取（Danbooru 用 curl_cffi 过 Cloudflare，Gelbooru 走连接池 + Referer 防盗链）
    if 'danbooru' in target or 'donmai.us' in target:
        data, ct = fetch_danbooru(target)
    else:
        data, ct = fetch_url(target, 'https://gelbooru.com/', 'image/*')
    if ct.split(';')[0].lower() in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'):
        IMG_CACHE[target] = (_time.time(), data, ct)
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = path + '.tmp'
            open(tmp, 'wb').write(ct.encode('ascii') + b'\n' + data)
            os.replace(tmp, path)
        except OSError:
            pass
        return data, ct
    raise Exception(f'非图片响应({ct})')


def fetch_posts(booru, limit, source, gb_key='', gb_uid='', db_login='', db_key=''):
    """查 booru API，返回 [{preview, full}]。key 全部由用户自己传入（前端设置面板填写）。"""
    if source == 'gelbooru':
        if not gb_key or not gb_uid:
            raise Exception('请先在设置 ⚙ 中填写你自己的 Gelbooru API Key 和 User ID')
        url = (f'https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1'
               f'&api_key={urllib.parse.quote(gb_key)}&user_id={urllib.parse.quote(gb_uid)}'
               f'&tags={urllib.parse.quote(booru)}&limit={limit}')
        data, _ = fetch_url(url, 'https://gelbooru.com/', 'application/json')
        d = json.loads(data)
        posts = d.get('post') or []
        if isinstance(posts, dict):
            posts = [posts]
        out = []
        for p in posts:
            thumb = p.get('preview_url') or f"https://img3.gelbooru.com/thumbnails/{p.get('directory')}/thumbnail_{p.get('image')}"
            full = p.get('file_url') or f"https://img3.gelbooru.com/images/{p.get('directory')}/{p.get('image')}"
            out.append({'preview': thumb, 'full': full})
        return out
    else:
        # Danbooru：填了自己的 login+key 就用（速率更高），没填则匿名
        auth = f'&login={urllib.parse.quote(db_login)}&api_key={urllib.parse.quote(db_key)}' if db_login and db_key else ''
        url = f'https://danbooru.donmai.us/posts.json?tags={urllib.parse.quote(booru)}&limit={limit}{auth}'
        data, ct = fetch_danbooru(url)
        if 'application/json' not in ct:
            return []
        posts = json.loads(data)
        return [{'preview': p.get('preview_file_url'), 'full': p.get('large_file_url') or p.get('file_url')} for p in posts]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_DIR, **kwargs)

    def end_headers(self):
        # 静态文件（html/js/css/json）禁用缓存：代码更新后刷新即可看到最新版，
        # 不会被浏览器缓存成旧页面。图片代理(/proxy)有自己更长的缓存头，不受影响。
        if not getattr(self, '_cache_set', False):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/heartbeat':
            # 前端心跳：页面每 15 秒发一次，服务器据此判断页面是否还开着
            global LAST_HEARTBEAT
            LAST_HEARTBEAT = _time.time()
            self._send_json({'ok': True})
            return

        if self.path.startswith('/proxy'):
            parsed = urllib.parse.urlparse(self.path)
            target = urllib.parse.parse_qs(parsed.query).get('url', [''])[0]
            if not target:
                self.send_error(400, 'missing url'); return
            try:
                data, ct = fetch_image(target)
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self._cache_set = True  # 图片已有长缓存，end_headers 不再加 no-cache
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        elif self.path.startswith('/api/posts'):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            booru = qs.get('booru', [''])[0]
            limit = qs.get('limit', ['5'])[0]
            source = qs.get('source', ['gelbooru'])[0]
            # 用户自己的 key（前端设置面板传入，不用内置）
            gb_key = qs.get('gb_key', [''])[0]
            gb_uid = qs.get('gb_uid', [''])[0]
            db_login = qs.get('db_login', [''])[0]
            db_key = qs.get('db_key', [''])[0]
            try:
                posts = fetch_posts(booru, limit, source, gb_key, gb_uid, db_login, db_key)
                self._send_json(posts)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)

        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        if '/proxy' in fmt or '/api' in fmt:
            super().log_message(fmt, *args)


def open_browser():
    webbrowser.open(f'http://127.0.0.1:{PORT}/')


if __name__ == '__main__':
    # 开多个端口：浏览器对每个端口(origin)有 6 个并发连接上限，
    # 前端图片请求轮换端口就能突破这个限制，图片加载提速数倍
    PORTS = [PORT + i for i in range(6)]  # 8765-8770，共 6 端口 = 36 并发
    for p in PORTS:
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', p), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f'  端口 {p} 已监听')
    print(f'画廊已启动：http://127.0.0.1:{PORT}/')
    print(f'配置：{CONFIG_PATH}（可改代理/端口/API key）')
    print('页面关闭超过 2 分钟后自动退出。按 Ctrl+C 关闭。')
    threading.Thread(target=heartbeat_watchdog, daemon=True).start()
    threading.Timer(1.0, open_browser).start()
    try:
        while True:
            _time.sleep(3600)
    except KeyboardInterrupt:
        print('\n已关闭。')
