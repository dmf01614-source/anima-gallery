// parse-artists.mjs —— 将 artists.txt 解析为三字段 JSON，供前端加载
// 用法: node parse-artists.mjs
import { readFileSync, writeFileSync } from 'fs';

const raw = readFileSync('artists.txt', 'utf8');
const lines = raw.split(/\r?\n/);
const out = [];

// 别名映射：Anima 名单里的名字 → booru 站实际 tag（名单里有别名的情况）
// 这些是通过 Gelbooru s=tag 端点自动检测 + 人工确认的（type=1 画师类型）
const ALIAS = {
  '0:00': 'mayonaka_reiji',
  'o (rakkasei)': 'rakkasei',
  'kaijumilk (milkchaotea)': 'milkchaotea',
  'poranka (porankaran)': 'porankaran',
  'feza chen (ushaku)': 'ushaku',
  'shiron (shiro n)': 'shiro_n',
  'c (rahit)': 'rahit',
  'rarasa (rarasa)': 'rarasa',
  'kamota (momokomati)': 'momokomati',
  'hanasawa (hanasawa062)': 'hanasawa062',
  'moja (rainpoow)': 'rainpoow',
  'aguri (aguri0406-aoi)': 'aguri0406-aoi',
  'sasami (ki)': 'ki',
  'b.sa (bbbs)': 'bbbs',
  'endend (shinia)': 'shinia',
  'go (roku)': 'roku',
  'asakawa-san (8107ka)': '8107ka',
  'namou (namorton09)': 'namorton09',
  'mazu (mazumaro)': 'mazumaro',
  'mil (siratamamil)': 'siratamamil',
};

// 自动检测的别名（booruTag 格式 → 实际 booruTag），从 JSON 文件加载
// alias-map-danbooru.json：Danbooru alias API 检测（601 个）
// alias-map.json：Gelbooru 括号格式检测（19 个）
const BOORU_ALIAS = {};
for (const f of ['alias-map-danbooru.json', 'alias-map.json']) {
  try { Object.assign(BOORU_ALIAS, JSON.parse(readFileSync(f, 'utf8'))); } catch {}
}

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  const animaId = trimmed;                                  // 原样：含 @ 和转义符
  const plain = animaId
    .replace(/^@/, '')                                      // 只去 1 个 @ 前缀（名字本身可能以 @ 开头）
    .replace(/\\\(/g, '(')                                  // 反转义左括号
    .replace(/\\\)/g, ')')                                  // 反转义右括号
    .replace(/\\\\/g, '');                                  // 兜底：残留双反斜杠

  const rawBooru = plain.replace(/ /g, '_');
  // 两层别名映射：人工(plain格式) → 自动检测(booruTag格式) → 默认转换
  const mapped = ALIAS[plain] || BOORU_ALIAS[rawBooru];
  const booruTag = mapped || rawBooru;

  out.push({
    a: animaId,                                             // Anima 调用 id（原样，永远不变）
    d: plain,                                               // 名单原名（搜索用，也兜底显示）
    b: booruTag,                                            // booru tag（跳转/预览，别名已映射）
    m: mapped || '',                                        // Danbooru 别名（有映射时，卡片优先显示它）
  });
}

writeFileSync('artists.json', JSON.stringify(out));
console.log(`生成 artists.json：${out.length} 条`);

// 抽查
const ask = out.find(x => x.d === 'ask (askzy)');
const hammer = out.find(x => x.d === 'hammer (sunset beach)');
const dairi = out[0];
console.log('抽查：');
console.log('  ask    ->', JSON.stringify(ask));
console.log('  hammer ->', JSON.stringify(hammer));
console.log('  首条   ->', JSON.stringify(dairi));
