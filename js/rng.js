// 可播种随机数：同一关卡号每次生成完全一致，方便排查和分享
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 返回可调用对象：rng() 取 [0,1)，rng.range/int/pick/shuffle 为便捷方法
function makeRng(seed) {
  const next = mulberry32(seed);
  const rng = () => next();
  rng.next = next;
  rng.range = (a, b) => a + next() * (b - a);
  rng.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  return rng;
}
