'use strict';
/* =====================================================
   USDA Foundation Foods → public/js/seed-data.json 的 foods 导入工具
   - 数据源：FoodData Central 的 Foundation Foods JSON
     默认在 resources/ 下按 FoodData_Central_foundation_food_json_*.json 找最新的那份（也兼容仓库根目录）
   - 中文名：server/test/seed-food-zh.json（英文 description → 中文名），可由人工继续补充
   - 只导入「热量 + 蛋白 + 碳水 + 脂肪」四项都齐全的条目（缺任一项则跳过，不臆造数值）
   - 负值一律夹到 0：USDA 用「碳水 by difference」时会算出 -0.06~-0.7 的负碳水，
     而前端 itemMacro 不夹 0、服务端 sanitizeLibrary 又丢弃负数，负数落库会两边不一致
   - 整份替换（不保留旧条目）：foods = USDA 抽出的条目；重跑结果一致
   用法：node server/test/import-usda-food.js [usda.json] [zh.json]
   ===================================================== */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SEED_PATH = path.join(ROOT, 'public', 'js', 'seed-data.json');
const ZH_PATH = path.join(__dirname, 'seed-food-zh.json');
const { FOOD_SRC_SYS } = require('../../public/js/seed-data.js');
const USDA_DIRS = [path.join(ROOT, 'resources'), ROOT];

function findUsda() {
  for (const dir of USDA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const hits = fs.readdirSync(dir).filter(n => /^FoodData_Central_foundation_food_json_.*\.json$/.test(n)).sort();
    if (hits.length) return path.join(dir, hits[hits.length - 1]);
  }
  return null;
}

/* 合并空白：源数据里有双空格/尾随空格/不换行空格，映射键按同一规则归一 */
const norm = s => String(s).replace(/\s+/g, ' ').trim();
const clamp0 = n => (n < 0 ? 0 : n);
const round = (n, d) => { const m = Math.pow(10, d); return Math.round(n * m) / m; };

function amount(food, ids) {
  for (const id of ids) {
    const hit = (food.foodNutrients || []).find(n => n.nutrient && n.nutrient.id === id && Number.isFinite(n.amount));
    if (hit) return hit.amount;
  }
  return undefined;
}

function extract(food) {
  const kcal = amount(food, [2047, 2048, 1008]);
  const p = amount(food, [1003]);
  const c = amount(food, [1005, 1050]);
  const f = amount(food, [1004]);
  if (kcal === undefined || p === undefined || c === undefined || f === undefined) return null;
  return { kcal: round(clamp0(kcal), 1), p: round(clamp0(p), 2), c: round(clamp0(c), 2), f: round(clamp0(f), 2) };
}

function main() {
  const usdaPath = process.argv[2] || findUsda();
  if (!usdaPath) throw new Error('找不到 USDA 源文件：把 FoodData_Central_foundation_food_json_*.json 放进 resources/ 或仓库根目录，或作为第一个参数传入');
  const zhPath = process.argv[3] || ZH_PATH;
  const usda = JSON.parse(fs.readFileSync(usdaPath, 'utf8'));
  const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  const zhMap = new Map(Object.keys(zh).map(k => [norm(k), zh[k]]));
  const list = (usda.FoundationFoods || []).filter(Boolean);

  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const foods = [];
  const seen = new Set();

  let added = 0, skippedNoNutrients = 0, skippedDuplicate = 0, untranslated = 0;
  for (const food of list) {
    const per100 = extract(food);
    if (!per100) { skippedNoNutrients++; continue; }
    const name = zhMap.get(norm(food.description)) || norm(food.description);
    if (!zhMap.has(norm(food.description))) untranslated++;
    if (seen.has(name)) { skippedDuplicate++; continue; }
    foods.push({ name, per100, src: FOOD_SRC_SYS });
    seen.add(name);
    added++;
  }
  const out = Object.assign({}, seed, { foods });
  fs.writeFileSync(SEED_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log('[usda] src=' + usdaPath);
  console.log('[usda] total=' + list.length + ' added=' + added + ' duplicate=' + skippedDuplicate +
    ' skipped(缺四项)=' + skippedNoNutrients + ' untranslated=' + untranslated);
  console.log('[usda] foods now=' + foods.length + ' -> ' + SEED_PATH);
}

main();
