// 画布适配、输入分发、主循环
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const VW = 390, VH = 740;
  let scale = 1, offX = 0, offY = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    scale = Math.min(w / VW, h / VH);
    offX = (w - VW * scale) / 2;
    offY = (h - VH * scale) / 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  window.addEventListener('resize', resize);
  resize();

  function toLogical(cx, cy) {
    return { x: (cx - offX) / scale, y: (cy - offY) / scale };
  }

  function onTap(cx, cy) {
    Sound.ensure();
    const p = toLogical(cx, cy);
    if (Game.state === 'won' && Game.stateTime > 0.6) { Game.loadLevel(Game.levelNo + 1); return; }
    if (Game.state === 'lost' && Game.stateTime > 0.6) { Game.loadLevel(Game.levelNo); return; }
    Game.clickLogical(p.x, p.y);
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); onTap(e.clientX, e.clientY); });
  } else {
    canvas.addEventListener('mousedown', e => onTap(e.clientX, e.clientY));
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onTap(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
  }
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', e => e.preventDefault());

  Game.init();
  window.Game = Game;
  window.Levels = Levels; // 便于控制台调试

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame); // 先重排队：单帧异常不终止主循环
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    Game.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 留边沿用游戏区同一条渐变（按游戏区屏幕位置取色），宽窄屏都无缝
    const gTop = offY, gBottom = offY + VH * scale;
    const letterbox = ctx.createLinearGradient(0, gTop, 0, gBottom);
    letterbox.addColorStop(0, '#e9f4fb');
    letterbox.addColorStop(0.55, '#d9eaf6');
    letterbox.addColorStop(1, '#c9e0f0');
    ctx.fillStyle = letterbox;
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    Render.draw(ctx, Game);
    ctx.restore();
  }
  requestAnimationFrame(frame);
})();
