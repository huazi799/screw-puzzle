// 在 Node 里验证关卡生成器：node test/test-levels.js
const fs = require('fs');
const path = require('path');

const src = ['rng.js', 'levels.js']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))
  .join('\n');
const { Levels } = new Function(src + '\nreturn { Levels };')();

let problems = 0;
let totalTime = 0;
let maxTime = 0;
for (let l = 1; l <= 40; l++) {
  const t0 = Date.now();
  const lv = Levels.get(l);
  const ms = Date.now() - t0;
  totalTime += ms;
  maxTime = Math.max(maxTime, ms);

  const counts = {};
  let n = 0;
  for (const p of lv.plates) {
    for (const h of p.holes) {
      counts[h.color] = (counts[h.color] || 0) + 1;
      n++;
    }
  }
  const badColor = Object.entries(counts).find(([, c]) => c % 3 !== 0);
  if (badColor) { console.log(`第${l}关 颜色${badColor[0]}数量${badColor[1]} 不是3的倍数!`); problems++; }
  if (n % 3 !== 0) { console.log(`第${l}关 总数${n} 不是3的倍数!`); problems++; }
  if (lv.nColors > 5) { console.log(`第${l}关 颜色数${lv.nColors} 超界!`); problems++; }
  console.log(`第${String(l).padStart(2)}关: 板=${lv.plates.length} 螺丝=${n} 颜色=${lv.nColors} 分布={${Object.entries(counts).map(([c, k]) => c + ':' + k).join(',')}} ${ms}ms`);
}
console.log('----------------------------------------');
console.log(`40 关全部生成完毕，总耗时 ${totalTime}ms，单关最大 ${maxTime}ms，问题数 ${problems}`);
