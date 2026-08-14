// app.js —— Anima 绘师画廊 前端逻辑
'use strict';

// ========== 状态 ==========
const state = {
  artists: [],                 // 画师数据 [{a,d,b,n,h,t}]
  artistByBooru: new Map(),    // booruTag -> artist 对象
  artistIndex: new Map(),      // booruTag -> 数组索引
  index: {},                   // 倒排索引 {tag: {booruTag: count}}
  searchMode: 'artist',        // 'artist' | 'tag'
  source: 'gelbooru',          // 'danbooru' | 'gelbooru'（Gelbooru 能预览，默认用它）
  sort: 'name-asc',
  multiMode: false,
  selected: new Set(),         // 选中的 booruTag
  favorites: new Set(),        // 收藏的 booruTag
  settings: {},                // {dbLogin, dbKey, gbKey, gbUid}
  results: [],                 // 当前展示的画师列表
  resultMode: 'artist',        // 当前结果是画师模式还是标签模式（影响卡片数字）
  tagCountMap: {},             // 标签模式下 {booruTag: count}
};

// ========== 中文标签词典 ==========
const CN_TAGS = {
  '黑丝': 'black_pantyhose', '白丝': 'white_pantyhose', '过膝袜': 'thighhighs',
  '丝袜': 'pantyhose', '连裤袜': 'pantyhose', '渔网袜': 'fishnets', '裸足': 'barefoot',
  '初音未来': 'hatsune_miku', '东方': 'touhou', '碧蓝航线': 'azur_lane',
  '明日方舟': 'arknights', '原神': 'genshin_impact', '崩坏': 'honkai',
  '赛马娘': 'umamusume', '东方Project': 'touhou', 'fate': 'fate_(series)',
  '女仆': 'maid', '和服': 'kimono', '水手服': 'sailor_uniform', '制服': 'school_uniform',
  '泳装': 'swimsuit', '兔女郎': 'bunny_girl', '猫耳': 'cat_ears', '兽耳': 'animal_ears',
  '双马尾': 'twintails', '长发': 'long_hair', '短发': 'short_hair', '银发': 'silver_hair',
  '金发': 'blonde_hair', '粉发': 'pink_hair', '蓝发': 'blue_hair', '红发': 'red_hair',
  '黑发': 'black_hair', '紫发': 'purple_hair', '绿发': 'green_hair', '白毛': 'white_hair',
  '异色瞳': 'heterochromia', '眼镜': 'glasses', '贫乳': 'flat_chest', '巨乳': 'large_breasts',
  '黑皮': 'dark_skin', '萝莉': 'loli', '御姐': 'mature_female', '正太': 'shota',
  '百合': 'yuri', 'bl': 'yaoi', '校园': 'school', '浴衣': 'yukata', '巫女': 'miko',
  '护士': 'nurse', '警察': 'police', '军人': 'military', '天使': 'angel', '恶魔': 'demon',
  '兽娘': 'kemonomimi', '机器人': 'robot', '吸血鬼': 'vampire', '幽灵': 'ghost',
  '黄昏': 'sunset', '夜景': 'night', '星空': 'starry_sky', '樱花': 'cherry_blossoms',
  '雨': 'rain', '雪': 'snow', '沙滩': 'beach', '森林': 'forest', '天空': 'sky',
  '冬天': 'winter', '夏天': 'summer', '春天': 'spring', '秋天': 'autumn',
};

// ========== DOM ==========
const $ = id => document.getElementById(id);
const els = {
  search: $('search-input'), suggest: $('suggest'), gallery: $('gallery'),
  statusbar: $('statusbar'), statusText: $('status-text'),
  loading: $('loading'), loadingText: $('loading-text'),
  mode: $('mode-select'), source: $('source-select'), sort: $('sort-select'),
  multi: $('multi-btn'), settingsBtn: $('settings-btn'),
  drawer: $('drawer'), drawerList: $('drawer-list'), drawerCount: $('drawer-count'),
  drawerClose: $('drawer-close'), copySel: $('copy-selected'), favSel: $('fav-selected'), clearSel: $('clear-selected'),
  lightbox: $('lightbox'), lightboxImg: $('lightbox-img'), lightboxWrap: $('lightbox-img-wrap'), lightboxInfo: $('lightbox-info'), lightboxClose: $('lightbox-close'),
  modal: $('settings-modal'), settingsClose: $('settings-close'), settingsSave: $('settings-save'),
  loadMore: $('load-more'), adultToggle: $('adult-toggle'),
  testDanbooru: $('test-danbooru'), testDanbooruResult: $('test-danbooru-result'),
  testGelbooru: $('test-gelbooru'), testGelbooruResult: $('test-gelbooru-result'),
  toast: $('toast'),
};

// ========== 工具 ==========
let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制：' + text); }
  catch { /* 降级 */ const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('已复制'); }
}

function norm(s) { return s.trim().replace(/^@+/, '').replace(/[ _]+/g, ' ').toLowerCase(); }

function getApiCred() {
  const s = state.settings;
  return {
    db: (s.dbLogin && s.dbKey) ? `&login=${encodeURIComponent(s.dbLogin)}&api_key=${encodeURIComponent(s.dbKey)}` : '',
    gb: (s.gbKey && s.gbUid) ? `&api_key=${encodeURIComponent(s.gbKey)}&user_id=${encodeURIComponent(s.gbUid)}` : '',
  };
}

// ========== 数据加载 ==========
// 标签索引按首字母分片（index-a.json ~ index-z.json + index-0.json + index-other.json）：
// Cloudflare Pages 单文件限 25MB，拆分后每个 ~1MB，还能并行加载提速
const INDEX_CHUNKS = [...'abcdefghijklmnopqrstuvwxyz', '0', 'other'];
async function loadIndex() {
  if (IS_LOCAL) {
    // 本地满血版：加载全量单文件索引（无 25MB 限制，139MB，标签反查覆盖远超在线版）
    try {
      const r = await fetch('index-full.json');
      return await r.json();
    } catch (e) {
      // 兜底：满血文件缺失时退回分片版
      return loadIndexChunks();
    }
  }
  return loadIndexChunks();
}
async function loadIndexChunks() {
  const chunks = await Promise.all(INDEX_CHUNKS.map(c =>
    fetch(`index-${c}.json`).then(r => r.json()).catch(() => ({}))
  ));
  const idx = {};
  for (const chunk of chunks) Object.assign(idx, chunk);
  return idx;
}

async function loadData() {
  try {
    els.loadingText.textContent = '加载画师数据…';
    const [artistsData, indexData] = await Promise.all([
      fetch('artists-data.json').then(r => r.json()),
      loadIndex(),
    ]);
    state.artists = artistsData;
    state.index = indexData;
    for (let i = 0; i < state.artists.length; i++) { state.artistByBooru.set(state.artists[i].b, state.artists[i]); state.artistIndex.set(state.artists[i].b, i); }
    state.favorites = new Set(JSON.parse(localStorage.getItem('favorites') || '[]'));
    state.settings = JSON.parse(localStorage.getItem('settings') || '{}');
    // 成人开关（仅网页版显示）：默认开启（显示全部），关闭后只看全年龄
    state.adult = localStorage.getItem('adult') !== 'off';
    if (els.adultToggle) els.adultToggle.checked = state.adult;
    els.loading.classList.add('hidden');
    setStatus(`已加载 ${state.artists.length.toLocaleString()} 位画师 | ${Object.keys(state.index).length.toLocaleString()} 个标签`);
    render();
  } catch (e) {
    els.loadingText.textContent = '加载失败：' + e.message;
  }
}

function setStatus(msg) { els.statusText.textContent = msg; }

// ========== 搜索 ==========
function searchArtist(q) {
  const nq = norm(q);
  if (!nq) return [];
  const lower = nq.replace(/ /g, '_');
  const matches = [];
  for (const a of state.artists) {
    const d = a.d.toLowerCase();
    const m = (a.m || '').toLowerCase();
    // 原名(d) 和 Danbooru 别名(m) 都能搜到
    if (d.startsWith(nq) || m.startsWith(nq) || a.b.toLowerCase().startsWith(lower)) matches.push({ a, score: 0 });
    else if (d.includes(nq) || m.includes(nq) || a.b.toLowerCase().includes(lower)) matches.push({ a, score: 1 });
    if (matches.length >= 200) break;
  }
  matches.sort((x, y) => x.score - y.score);
  return matches.map(m => m.a);
}

function resolveTag(q) {
  let tag = q.trim().toLowerCase();
  // 中文映射
  for (const [cn, en] of Object.entries(CN_TAGS)) {
    if (q.trim() === cn || q.trim().includes(cn)) { tag = en; break; }
  }
  return tag.replace(/ /g, '_');
}

// 本地索引查询（Gelbooru 预抓）
function searchTagLocal(tag) {
  const arr = state.index[tag];
  if (!arr) return [];
  return arr.map(([idx, count]) => ({ idx, count })).sort((a, b) => b.count - a.count);
}

// ========== 渲染 ==========
function render() {
  let list;
  if (state.searchMode === 'artist') {
    const q = els.search.value.trim();
    list = q ? searchArtist(q) : state.artists.slice();   // 空搜索 → 默认加载全部画师
    state.resultMode = 'artist';
    state.tagCountMap = {};
  } else {
    const tag = resolveTag(els.search.value);
    state.resultMode = 'tag';
    state.tagCountMap = {};
    const rl = searchTagLocal(tag);
    for (const x of rl) state.tagCountMap[state.artists[x.idx]?.b] = x.count;
    list = rl.map(x => state.artists[x.idx]).filter(Boolean);
  }

  // ========== 排序 ==========
  // 傻瓜式说明：每个分类都有「正序」(从小到大) 和「倒序」(从大到小)，随机除外
  // sort 值 = 分类 + 方向：如 'hot-desc' = 热度从高到低，'count-asc' = 作品数从少到多
  const s = state.sort;
  // 数量排序：标签模式下按「该标签下的作品数」（tagCountMap），画师模式下按画师总作品数（n）——与卡片显示一致
  const cntOf = a => (state.resultMode === 'tag' ? (state.tagCountMap[a.b] || 0) : (a.n || 0));
  if (s === 'hot-desc') list.sort((a, b) => (b.h || 0) - (a.h || 0));          // 🔥 热度：高 → 低（画师总热度，无标签级数据）
  else if (s === 'hot-asc') list.sort((a, b) => (a.h || 0) - (b.h || 0));       // 🔥 热度：低 → 高
  else if (s === 'count-desc') list.sort((a, b) => cntOf(b) - cntOf(a));        // 📊 作品数：多 → 少（标签模式下=该标签作品数）
  else if (s === 'count-asc') list.sort((a, b) => cntOf(a) - cntOf(b));         // 📊 作品数：少 → 多
  else if (s === 'tags-desc') list.sort((a, b) => (b.t || 0) - (a.t || 0));     // 🏷️ 标签数：多 → 少（画师级数据）
  else if (s === 'tags-asc') list.sort((a, b) => (a.t || 0) - (b.t || 0));      // 🏷️ 标签数：少 → 多
  else if (s === 'name-asc') list.sort((a, b) => (a.m || a.d).localeCompare(b.m || b.d));       // 🔤 名字：A → Z
  else if (s === 'name-desc') list.sort((a, b) => (b.m || b.d).localeCompare(a.m || a.d));      // 🔤 名字：Z → A
  else if (s === 'random') list = list.slice().sort(() => Math.random() - 0.5); // 🎲 随机：每次乱序

  state.results = list;
  setStatus(`显示 ${list.length.toLocaleString()} 位画师`);
  renderGallery(list);
}

const ROWS_PER_PAGE = 4;
let visibleCount = 0;

function getColumns() {
  return Math.max(1, Math.floor(els.gallery.clientWidth / 276));
}

function renderGallery(list) {
  state.results = list;
  els.gallery.innerHTML = '';
  if (list.length === 0) {
    els.gallery.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px;">没有结果</div>';
    els.loadMore.classList.add('hidden');
    return;
  }
  visibleCount = 0;
  renderMore();
}

function renderMore() {
  const perPage = getColumns() * ROWS_PER_PAGE;
  const slice = state.results.slice(visibleCount, visibleCount + perPage);
  const frag = document.createDocumentFragment();
  for (const a of slice) frag.appendChild(buildCard(a));
  els.gallery.appendChild(frag);
  visibleCount += perPage;
  updateLoadMore();
  observeThumbs();
}

function updateLoadMore() {
  if (visibleCount >= state.results.length) {
    els.loadMore.classList.add('hidden');
  } else {
    els.loadMore.classList.remove('hidden');
    els.loadMore.textContent = `加载更多（已显示 ${visibleCount.toLocaleString()} / ${state.results.length.toLocaleString()}）`;
  }
}

function buildCard(a) {
  const card = document.createElement('div');
  card.className = 'card' + (state.selected.has(a.b) ? ' selected' : '');
  card.dataset.booru = a.b;

  const countLabel = state.resultMode === 'tag' ? `${state.tagCountMap[a.b] || 0} 张` : `${(a.n || 0).toLocaleString()} 张`;

  card.innerHTML = `
    <div class="card-head">
      <div class="card-name">
        <div class="display">${escapeHtml(a.m || a.d)}</div>
        <div class="anima" data-copy="${escapeAttr(a.a)}" title="点击复制 Anima 调用 id">${escapeHtml(a.a)}</div>
      </div>
      <div class="card-count">${countLabel}</div>
      <button class="fav-star ${state.favorites.has(a.b) ? 'on' : ''}" data-fav="${escapeAttr(a.b)}">${state.favorites.has(a.b) ? '★' : '☆'}</button>
    </div>
    <div class="card-thumbs" data-booru="${escapeAttr(a.b)}">
      ${[0,1,2,3,4].map(i => `<div class="thumb ${i === 0 ? 'main' : ''}" data-idx="${i}"><div class="placeholder">…</div></div>`).join('')}
    </div>
    <div class="card-actions">
      <button class="copy-btn" data-copy="${escapeAttr(a.a)}" title="复制 Anima id">⧉ 复制</button>
      <button data-danbooru="${escapeAttr(a.b)}">Danbooru ↗</button>
      <button data-gelbooru="${escapeAttr(a.b)}">Gelbooru ↗</button>
    </div>
  `;

  // 事件
  card.querySelector('.fav-star').addEventListener('click', e => { e.stopPropagation(); toggleFav(a.b); });
  card.querySelectorAll('[data-copy]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); copyText(el.dataset.copy); }));
  card.querySelector('[data-gelbooru]').addEventListener('click', e => { e.stopPropagation(); window.open('https://gelbooru.com/index.php?page=post&s=list&tags=' + encodeURIComponent(a.b), '_blank'); });
  // Danbooru 按钮在线版不渲染（被 Cloudflare 防护拦截），只有本地版才有，所以条件绑定
  const dbBtn = card.querySelector('[data-danbooru]');
  if (dbBtn) dbBtn.addEventListener('click', e => { e.stopPropagation(); window.open('https://danbooru.donmai.us/posts?tags=' + encodeURIComponent(a.b), '_blank'); });

  // 单点卡片：点缩略图=灯箱，点其他区域=选中
  card.addEventListener('click', e => {
    const img = e.target.closest('.thumb img');
    if (img && img.src) { openLightbox(img.dataset.full || img.src, a.d); return; }
    toggleSelect(a.b, card);
  });

  return card;
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// ========== 缩略图懒加载 ==========
let thumbObserver;
function observeThumbs() {
  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (en.isIntersecting) {
        const card = en.target;
        loadThumbs(card.dataset.booru, card);
        thumbObserver.unobserve(card);
      }
    }
  }, { rootMargin: '200px' });
  document.querySelectorAll('.card-thumbs:not([data-loaded])').forEach(t => thumbObserver.observe(t));
}

// 图片走本地代理（绕过 Gelbooru referer 防盗链）
// 本地运行(127.0.0.1)：轮换 6 个端口 = 36 并发提速
// 在线部署(pages.dev等)：走相对路径 /proxy，由 Cloudflare Pages Functions 处理
const PROXY_PORTS = [8765, 8766, 8767, 8768, 8769, 8770];
let proxyCounter = 0;
const IS_LOCAL = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
// 在线版只保留 Gelbooru（Danbooru 在线被 Cloudflare 防护拦截，用不了）；本地版双站完整
if (!IS_LOCAL) {
  document.body.classList.add('online');
  const dbOpt = document.querySelector('#source-select option[value="danbooru"]');
  if (dbOpt) dbOpt.remove();
  if (state.source === 'danbooru') state.source = 'gelbooru';
}
function proxyUrl(url) {
  if (!url) return url;
  if (IS_LOCAL) {
    const port = PROXY_PORTS[proxyCounter++ % PROXY_PORTS.length];
    return `http://127.0.0.1:${port}/proxy?url=${encodeURIComponent(url)}`;
  }
  return `/proxy?url=${encodeURIComponent(url)}`;
}

async function loadThumbs(booru, container) {
  if (container.dataset.loaded) return;   // 已加载过就跳过（防止重复请求 API）
  container.dataset.loaded = '1';
  const { posts, error } = await fetchPosts(booru, 5);
  const thumbs = container.querySelectorAll('.thumb');
  if (error) {
    // 没填 key / 查询失败：卡片缩略图区直接显示原因（不再静默空白）
    container.innerHTML = `<div class="thumbs-error">⚠ ${error.replace(/</g, '&lt;')}</div>`;
    return;
  }
  posts.forEach((p, i) => {
    if (i >= thumbs.length) return;
    const img = document.createElement('img');
    img.src = proxyUrl(p.preview);
    img.dataset.full = p.full;
    img.onerror = () => { img.closest('.thumb').innerHTML = '<span class="thumb-fail">图</span>'; };
    thumbs[i].innerHTML = '';
    thumbs[i].appendChild(img);
  });
}

const postsCache = new Map();   // 作品查询缓存：key -> {posts, error}，避免滚动/重渲染重复打 API
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 并发池：同时最多 2 个 API 请求，其余排队（Gelbooru 对数据中心 IP 限流严格，低并发 + 长间隔最稳）
let API_ACTIVE = 0;
const API_MAX = 2;
async function fetchPosts(booru, limit = 5) {
  const s = state.settings;
  // 成人开关（仅网页版显示）：关闭时排除露骨 R18（-rating:explicit），保留全年龄+R15擦边
  const tagQuery = state.adult ? booru : `${booru} -rating:explicit`;
  // 用户自己的 key 传给本地服务器/在线 Worker（不内置在服务器里）
  const params = new URLSearchParams({ booru: tagQuery, limit, source: state.source });
  if (s.gbKey) params.set('gb_key', s.gbKey);
  if (s.gbUid) params.set('gb_uid', s.gbUid);
  if (s.dbLogin) params.set('db_login', s.dbLogin);
  if (s.dbKey) params.set('db_key', s.dbKey);
  const cacheKey = `${state.source}:${booru}:${limit}`;
  if (postsCache.has(cacheKey)) return postsCache.get(cacheKey);
  // 排队等待（并发池：满了就等）
  while (API_ACTIVE >= API_MAX) await sleep(300);
  API_ACTIVE++;
  try {
    // 429/网络错误：退避重试最多 4 次（间隔 2s/4s/6s/8s，尽量躲过限流窗口）
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`/api/posts?${params.toString()}`);
        const data = await r.json();
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }  // 限流，等一会儿再试
        const result = Array.isArray(data)
          ? { posts: data, error: '' }
          : { posts: [], error: data.error || '查询失败（请检查设置中的 API Key）' };
        postsCache.set(cacheKey, result);
        return result;
      } catch (e) {
        if (attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
        return { posts: [], error: '网络错误：无法连接本地服务器，请确认 start.bat 正在运行' };
      }
    }
    return { posts: [], error: '多次尝试仍失败（可能被限流），请稍后刷新页面重试' };
  } finally {
    API_ACTIVE--;
  }
}

// ========== 灯箱 ==========
let lbScale = 1, lbTx = 0, lbTy = 0;
function openLightbox(url, name) {
  els.lightbox.classList.remove('hidden');
  els.lightboxImg.src = proxyUrl(url);
  els.lightboxInfo.textContent = name || '';
  lbScale = 1; lbTx = 0; lbTy = 0;
  applyLb();
}
function applyLb() {
  els.lightboxImg.style.transform = `translate(${lbTx}px, ${lbTy}px) scale(${lbScale})`;
}
els.lightboxClose.addEventListener('click', () => els.lightbox.classList.add('hidden'));
// 灯箱：点击空白处自动退出——点背景或图片周围的空白都关；点图片本身不关（要拖动/缩放）；刚拖动过不关
els.lightbox.addEventListener('click', e => {
  if (dragged) return;
  if (e.target === els.lightbox || e.target === els.lightboxWrap) els.lightbox.classList.add('hidden');
});
els.lightboxWrap.addEventListener('wheel', e => {
  e.preventDefault();
  lbScale = Math.min(4, Math.max(0.5, lbScale * (e.deltaY < 0 ? 1.15 : 0.87)));
  applyLb();
});
// 拖动平移（注意：拖动后松手会触发 click，要标记 dragged 避免误关灯箱）
let dragging = false, dragged = false, sx = 0, sy = 0;
els.lightboxWrap.addEventListener('mousedown', e => { dragging = true; dragged = false; sx = e.clientX - lbTx; sy = e.clientY - lbTy; });
window.addEventListener('mousemove', e => { if (dragging) { lbTx = e.clientX - sx; lbTy = e.clientY - sy; if (Math.abs(lbTx) + Math.abs(lbTy) > 3) dragged = true; applyLb(); } });
window.addEventListener('mouseup', () => { dragging = false; setTimeout(() => { dragged = false; }, 0); });
els.lightboxWrap.addEventListener('dblclick', () => { lbScale = lbScale === 1 ? 2 : 1; lbTx = 0; lbTy = 0; applyLb(); });

// ========== 多选 ==========
function toggleSelect(booru, card) {
  if (state.selected.has(booru)) { state.selected.delete(booru); }
  else { state.selected.add(booru); }
  if (card) card.classList.toggle('selected', state.selected.has(booru));
  renderDrawer();
  updateDrawer();
}

function updateDrawer() {
  const show = state.selected.size > 0;
  els.drawer.classList.toggle('hidden', !show);
  document.body.classList.toggle('drawer-open', show);
}

// 多选按钮改为「清空所选」
els.multi.addEventListener('click', () => {
  state.selected.clear();
  syncCards();
  renderDrawer();
  updateDrawer();
});

els.drawerClose.addEventListener('click', () => {
  state.selected.clear();
  syncCards();
  renderDrawer();
  updateDrawer();
});

function renderDrawer() {
  const list = [...state.selected].map(b => state.artistByBooru.get(b)).filter(Boolean);
  els.drawerCount.textContent = `已选画师 (${list.length})`;
  els.drawerList.innerHTML = '';
  for (const a of list) {
    const item = document.createElement('div');
    item.className = 'drawer-item';
    item.innerHTML = `
      <img class="di-thumb" src="" alt="" data-booru="${escapeAttr(a.b)}">
      <div class="di-name"><div class="d">${escapeHtml(a.d)}</div><div class="b">${escapeHtml(a.b)}</div></div>
      <div class="di-btns">
        <button class="${state.favorites.has(a.b) ? 'on' : ''}" data-fav="${escapeAttr(a.b)}">★</button>
        <button data-remove="${escapeAttr(a.b)}">✕</button>
      </div>
    `;
    item.querySelector('[data-fav]').addEventListener('click', () => toggleFav(a.b));
    item.querySelector('[data-remove]').addEventListener('click', () => { state.selected.delete(a.b); renderDrawer(); syncCards(); });
    els.drawerList.appendChild(item);
    // 加载缩略图
    fetchPosts(a.b, 1).then(({ posts }) => { if (posts[0]) item.querySelector('.di-thumb').src = proxyUrl(posts[0].preview); });
  }
}

function syncCards() {
  document.querySelectorAll('.card').forEach(c => {
    c.classList.toggle('selected', state.selected.has(c.dataset.booru));
  });
}

els.copySel.addEventListener('click', () => {
  const ids = [...state.selected].map(b => state.artistByBooru.get(b)?.a).filter(Boolean);
  if (ids.length === 0) { toast('未选中画师'); return; }
  copyText(ids.join('\n'));
});
els.favSel.addEventListener('click', () => {
  for (const b of state.selected) state.favorites.add(b);
  saveFavorites(); renderDrawer(); syncCards();
  toast('已收藏所选画师');
});
els.clearSel.addEventListener('click', () => {
  state.selected.clear(); renderDrawer(); syncCards();
});

// ========== 收藏 ==========
function toggleFav(booru) {
  if (state.favorites.has(booru)) state.favorites.delete(booru);
  else state.favorites.add(booru);
  saveFavorites();
  syncCards();
  renderDrawer();
  // 同步所有卡片上的星星按钮视觉状态（否则点了星星不变）
  const on = state.favorites.has(booru);
  document.querySelectorAll('.fav-star').forEach(btn => {
    if (btn.dataset.fav === booru) { btn.classList.toggle('on', on); btn.textContent = on ? '★' : '☆'; }
  });
}
function saveFavorites() {
  localStorage.setItem('favorites', JSON.stringify([...state.favorites]));
}

// ========== 设置 ==========
els.settingsBtn.addEventListener('click', () => {
  els.modal.classList.remove('hidden');
  $('set-danbooru-login').value = state.settings.dbLogin || '';
  $('set-danbooru-key').value = state.settings.dbKey || '';
  $('set-gelbooru-key').value = state.settings.gbKey || '';
  $('set-gelbooru-uid').value = state.settings.gbUid || '';
});
els.settingsClose.addEventListener('click', () => els.modal.classList.add('hidden'));
els.settingsSave.addEventListener('click', () => {
  state.settings = {
    dbLogin: $('set-danbooru-login').value.trim(),
    dbKey: $('set-danbooru-key').value.trim(),
    gbKey: cleanGelbooruKey($('set-gelbooru-key').value),
    gbUid: $('set-gelbooru-uid').value.trim(),
  };
  localStorage.setItem('settings', JSON.stringify(state.settings));
  postsCache.clear();  // key 可能变了，清缓存让新 key 生效
  els.modal.classList.add('hidden');
  toast('设置已保存，正在刷新…');
  setTimeout(() => location.reload(), 800);  // 刷新让新 key 重新加载全部预览图
});

// ========== 搜索联想 ==========
let suggestTimer;
els.search.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(() => {
    const q = els.search.value.trim();
    if (!q) { els.suggest.classList.add('hidden'); return; }
    const list = state.searchMode === 'artist' ? searchArtist(q).slice(0, 12) : searchTagLocal(resolveTag(q)).slice(0, 12).map(x => ({ a: state.artists[x.idx], count: x.count }));
    if (state.searchMode === 'artist') renderSuggest(list);
    else renderSuggestTag(list);
  }, 150);
});
els.search.addEventListener('keydown', e => { if (e.key === 'Enter') { els.suggest.classList.add('hidden'); render(); } });

function renderSuggest(list) {
  if (list.length === 0) { els.suggest.classList.add('hidden'); return; }
  els.suggest.innerHTML = list.map(a => `<div class="suggest-item" data-booru="${escapeAttr(a.b)}"><span class="tag-name">${escapeHtml(a.m || a.d)}</span></div>`).join('');
  els.suggest.classList.remove('hidden');
  els.suggest.querySelectorAll('.suggest-item').forEach(item => {
    item.addEventListener('click', () => {
      els.search.value = item.dataset.booru.replace(/_/g, ' ');
      els.suggest.classList.add('hidden');
      render();
    });
  });
}
function renderSuggestTag(list) {
  if (list.length === 0) { els.suggest.classList.add('hidden'); return; }
  els.suggest.innerHTML = list.map(x => x.a ? `<div class="suggest-item" data-booru="${escapeAttr(x.a.b)}"><span class="tag-name">${escapeHtml(x.a.d)}</span> <span class="tag-alias">${x.count || 0} 张</span></div>` : '').join('');
  els.suggest.classList.remove('hidden');
  els.suggest.querySelectorAll('.suggest-item').forEach(item => {
    item.addEventListener('click', () => { els.suggest.classList.add('hidden'); render(); });
  });
}
document.addEventListener('click', e => { if (!e.target.closest('.search-box')) els.suggest.classList.add('hidden'); });

// ========== 控件事件 ==========
els.mode.addEventListener('change', () => { state.searchMode = els.mode.value; render(); });
els.source.addEventListener('change', () => { state.source = els.source.value; postsCache.clear(); render(); });
els.sort.addEventListener('change', () => { state.sort = els.sort.value; render(); });
els.loadMore.addEventListener('click', () => renderMore());
// 成人开关：切换后清缓存并重新渲染（仅网页版显示此开关）
els.adultToggle.addEventListener('change', () => {
  state.adult = els.adultToggle.checked;
  localStorage.setItem('adult', state.adult ? 'on' : 'off');
  postsCache.clear();
  render();
});

// 防痴呆：用户可能从 URL 复制 key（带 &api_key= 前缀），自动清洗成纯 key
function cleanGelbooruKey(s) {
  if (!s) return '';
  return String(s).trim()
    .replace(/^.*?api_key=/i, '')   // 去掉 &api_key= 等前缀
    .replace(/[&?#].*$/, '');       // 去掉后面的 &user_id= 等尾巴
}
const isHex = s => /^[0-9a-fA-F]+$/.test(s);

async function testApi(source) {
  const resultEl = source === 'danbooru' ? els.testDanbooruResult : els.testGelbooruResult;
  resultEl.textContent = '测试中…';
  resultEl.style.color = '';
  try {
    // 直接读输入框当前值（不用先点保存）：填完 key 就能立即测试
    const s = {
      gbKey: cleanGelbooruKey($('set-gelbooru-key').value),
      gbUid: $('set-gelbooru-uid').value.trim(),
      dbLogin: $('set-danbooru-login').value.trim(),
      dbKey: $('set-danbooru-key').value.trim(),
    };
    // 防痴呆校验：格式不对直接提示，不用等 Gelbooru 401
    if (source === 'gelbooru') {
      if (!s.gbKey || !s.gbUid) {
        resultEl.textContent = '❌ 请填写 Gelbooru API Key 和 User ID';
        resultEl.style.color = '#f87171';
        return;
      }
      if (!/^\d+$/.test(s.gbUid)) {
        resultEl.textContent = '❌ User ID 应该是纯数字';
        resultEl.style.color = '#f87171';
        return;
      }
      if (!isHex(s.gbKey) || s.gbKey.length < 64) {
        resultEl.textContent = '❌ Key 像是从 URL 复制的（已自动清理）或复制不完整——请去 Gelbooru 账号 Options 页复制完整 64 位 key';
        resultEl.style.color = '#f87171';
        return;
      }
    }
    const params = new URLSearchParams({ booru: 'ask_(askzy)', limit: 1, source });
    if (s.gbKey) params.set('gb_key', s.gbKey);
    if (s.gbUid) params.set('gb_uid', s.gbUid);
    if (s.dbLogin) params.set('db_login', s.dbLogin);
    if (s.dbKey) params.set('db_key', s.dbKey);
    const r = await fetch(`/api/posts?${params.toString()}`);
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      resultEl.textContent = '✅ 可用';
      resultEl.style.color = '#4ade80';
    } else if (data && data.error) {
      resultEl.textContent = '❌ ' + data.error;
      resultEl.style.color = '#f87171';
    } else {
      resultEl.textContent = '❌ 返回空';
      resultEl.style.color = '#f87171';
    }
  } catch (e) {
    resultEl.textContent = '❌ ' + e.message;
    resultEl.style.color = '#f87171';
  }
}
els.testDanbooru.addEventListener('click', () => testApi('danbooru'));
els.testGelbooru.addEventListener('click', () => testApi('gelbooru'));

// ========== 启动 ==========
loadData();
// 心跳：每 15 秒告诉服务器「页面还开着」。
// 服务器超过 2 分钟没收到心跳就自动退出（用户已关闭网页）。
// 刷新页面会立刻发新心跳，不会误杀。
fetch('/heartbeat').catch(() => {});
setInterval(() => fetch('/heartbeat').catch(() => {}), 15000);
