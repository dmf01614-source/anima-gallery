# update-check.py —— 检查 GitHub 最新数据更新并可选下载（给本地版用户用）
# 用法：双击运行（或 python update-check.py）
# 首次运行：记录当前基线；之后运行：对比 GitHub 最新提交，有更新则询问是否下载数据
import json, os, socket, urllib.request, sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.join(BASE_DIR, 'site')
VERSION_FILE = os.path.join(BASE_DIR, '.version')
REPO = 'dmf01614-source/anima-gallery'
BRANCH = 'main'
API = f'https://api.github.com/repos/{REPO}/commits/{BRANCH}'
RAW = f'https://raw.githubusercontent.com/{REPO}/{BRANCH}/site'
# 需要同步的数据文件（GitHub 仓库 site/ 下有；index-full.json 139MB 超 GitHub 限制不入库）
DATA_FILES = ['artists-data.json', 'artists-tags-top.json'] + [f'index-{c}.json' for c in 'abcdefghijklmnopqrstuvwxyz0other']

# 代理自动探测（Clash/Geph/V2Ray 常见端口，与 server.py 一致）
COMMON_PORTS = [7897, 9910, 7890, 10809, 1080, 2080, 8888]


def detect_proxy():
    """探测可用代理：端口监听 + 实测 GitHub 连通，谁连得上用谁；全失败返回 None（main 会提示）"""
    for port in COMMON_PORTS:
        p = f'http://127.0.0.1:{port}'
        try:
            s = socket.create_connection(('127.0.0.1', port), timeout=1.5)
            s.close()
        except OSError:
            continue
        # 实测连通性：请求 GitHub API，成功才算可用
        try:
            handler = urllib.request.ProxyHandler({'http': p, 'https': p})
            opener = urllib.request.build_opener(handler)
            req = urllib.request.Request(API, headers={'User-Agent': 'anima-gallery-updater/1.0'})
            opener.open(req, timeout=8).read(200)
            return p
        except Exception:
            continue
    # 代理都不通，试直连
    try:
        opener = urllib.request.build_opener()
        req = urllib.request.Request(API, headers={'User-Agent': 'anima-gallery-updater/1.0'})
        opener.open(req, timeout=8).read(200)
        return None
    except Exception:
        return None


def http_get(url, proxy, timeout=60):
    if proxy:
        handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
        opener = urllib.request.build_opener(handler)
    else:
        opener = urllib.request.build_opener()
    req = urllib.request.Request(url, headers={'User-Agent': 'anima-gallery-updater/1.0'})
    return opener.open(req, timeout=timeout).read()


def get_latest_commit(proxy):
    data = json.loads(http_get(API, proxy))
    return data['sha'], data['commit']['message'].splitlines()[0]


def main():
    proxy = detect_proxy()
    if proxy:
        print(f'使用代理: {proxy}')
    else:
        print('未探测到代理，直连（国内可能较慢）')
    print('正在检查 GitHub 更新...')
    try:
        sha, msg = get_latest_commit(proxy)
    except Exception as e:
        print(f'连接 GitHub 失败：{e}')
        print('请确认网络/代理可用后重试')
        return

    local = ''
    if os.path.exists(VERSION_FILE):
        local = open(VERSION_FILE, encoding='utf-8').read().strip()

    if not local:
        open(VERSION_FILE, 'w', encoding='utf-8').write(sha)
        print(f'首次运行：已记录当前基线（版本 {sha[:8]}）')
        print('以后每次运行本脚本都会检查 GitHub 是否有新数据。')
        return

    if local == sha:
        print(f'✓ 已是最新版本（{sha[:8]}），无需更新')
        return

    print('┌──────────────────────────────────────────')
    print(f'│  发现新版本！')
    print(f'│  本地: {local[:8]}')
    print(f'│  最新: {sha[:8]}  {msg}')
    print('└──────────────────────────────────────────')
    # --auto 模式（start.bat 启动时自动更新）：有更新就直接下载，不询问
    if '--auto' in sys.argv:
        print('自动更新模式：发现新版本，开始自动下载...')
        ans = 'y'
    else:
        try:
            ans = input('是否下载最新数据？（y/n）: ').strip().lower()
        except EOFError:
            ans = 'n'
    if ans != 'y':
        print('已取消下载。')
        return

    print(f'开始下载 {len(DATA_FILES)} 个数据文件（约 140MB，请耐心等待）...')
    ok = 0
    fail = []
    for i, f in enumerate(DATA_FILES, 1):
        url = f'{RAW}/{f}'
        try:
            data = http_get(url, proxy, timeout=120)
            os.makedirs(SITE_DIR, exist_ok=True)
            open(os.path.join(SITE_DIR, f), 'wb').write(data)
            ok += 1
            print(f'  [{i}/{len(DATA_FILES)}] ✓ {f}')
        except Exception as e:
            fail.append(f)
            print(f'  [{i}/{len(DATA_FILES)}] ✗ {f}: {str(e)[:50]}')

    if fail:
        print(f'下载完成 {ok}/{len(DATA_FILES)}，失败 {len(fail)} 个：{", ".join(fail)}')
        print('失败的文件请稍后重跑本脚本（断点续传式跳过已下载的）')
    else:
        open(VERSION_FILE, 'w', encoding='utf-8').write(sha)
        print(f'✓ 全部 {ok} 个文件下载完成！版本已更新到 {sha[:8]}')
        print('重启 start.bat（或刷新网页）即可生效！')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'脚本出错：{e}')
        input('按回车退出...')
