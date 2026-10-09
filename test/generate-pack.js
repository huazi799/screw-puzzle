// 生成预计算关卡包：node test/generate-pack.js
// 生成第 1~60 关写入 js/generated-levels.js（游戏加载后零耗时读取）。
// 改动了 genLayout / trySolve / 开盒规则后（GEN_VERSION 递增时）重新运行一次即可。
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); },
};
const fs = require('fs');
const path = require('path');

let src = ['rng', 'levels']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');
const genVer = +(src.match(/GEN_VERSION = (\d+)/) || [])[1] || 0;
const { Levels } = new Function(src + '\nreturn { Levels };')();

const MAX_PACK = 60;
const levels = {};
let slowest = 0, slowestL = 0;
for (let l = 1; l <= MAX_PACK; l++) {
  const t0 = Date.now();
  levels[l] = Levels.get(l);
  const ms = Date.now() - t0;
  if (ms > slowest) { slowest = ms; slowestL = l; }
  if (l <= 12 || l % 10 === 0 || ms > 5000) {
    console.log(`第${l}关 ${ms}ms`);
  }
}
const out = `// 预生成关卡包（由 test/generate-pack.js 自动产出，请勿手改；GEN_VERSION=${genVer}）
globalThis.GeneratedLevels = { v: ${genVer}, levels: ${JSON.stringify(levels)} };\n`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'generated-levels.js'), out);
console.log(`\n关卡包已写入 js/generated-levels.js（${(out.length / 1024).toFixed(0)}KB，1~${MAX_PACK} 关，最慢第 ${slowestL} 关 ${slowest}ms）`);
