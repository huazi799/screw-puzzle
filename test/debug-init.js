// 诊断：loadLevel 后盒子初始颜色
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); },
};
const fs = require('fs');
const path = require('path');
const src = ['rng', 'audio', 'levels', 'game']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');
const { Levels, Game } = new Function(src + '\nreturn { Levels, Game };')();

for (const n of [5, 6, 7]) {
  Game.loadLevel(n);
  const cnt = {};
  Game.plates.forEach(p => p.screws.forEach(s => { if (!s.removed) cnt[s.color] = (cnt[s.color] || 0) + 1; }));
  console.log(`第${n}关 盒1=${JSON.stringify(Game.boxes[0])} 盒2=${JSON.stringify(Game.boxes[1])} 板载分布=${JSON.stringify(cnt)}`);
}
