// RAVIOK motion kit. Every frame is a pure function of time t (seconds):
// no CSS transitions, no timers, no state carried between frames.
// An episode page defines `async function seek(t)` and `window.READY = M.ready({...}).then(() => DUR)`.
(function () {
  const M = {};
  M.params = new URLSearchParams(location.search);
  M.lang = M.params.get('lang') || 'ko';
  document.documentElement.lang = M.lang;
  if (M.params.get('guide') === '1') document.documentElement.classList.add('guide');
  // NK Studio: stage size from <html data-size="1920x1080"> (default 1080x1920 = season 1, unchanged).
  // Defaults below scale from the 1080x1920 originals so the default size renders exactly as before.
  const size = String(document.documentElement.dataset.size || '1080x1920').match(/^(\d{3,4})x(\d{3,4})$/);
  M.W = size ? Number(size[1]) : 1080;
  M.H = size ? Number(size[2]) : 1920;
  if (M.W !== 1080 || M.H !== 1920) {
    const css = document.documentElement.style;
    css.setProperty('--stage-w', M.W + 'px');
    css.setProperty('--stage-h', M.H + 'px');
    css.setProperty('--cam-ox', M.W / 2 + 'px');
    css.setProperty('--cam-oy', Math.round(M.H * 1000 / 1920) + 'px');
  }
  const sy = (v) => Math.round(v * M.H / 1920);

  // ---------- math ----------
  M.clamp = (x, a = 0, c = 1) => Math.min(c, Math.max(a, x));
  M.lerp = (a, c, p) => a + (c - a) * p;
  // closed-form spring step response (tiny overshoot by default)
  M.sp = (t, t0, f = 2.4, z = 0.72) => {
    const x = t - t0; if (x <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + (z * w / wd) * Math.sin(wd * x));
  };
  M.pop = (t, t0, f = 2.4) => M.sp(t, t0, f, 0.62);          // springier, for things appearing
  M.io = (t, t0, d) => { const x = M.clamp((t - t0) / d); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  M.ein = (t, t0, d) => { const x = M.clamp((t - t0) / d); return x * x; };
  M.eout = (t, t0, d) => { const x = M.clamp((t - t0) / d); return 1 - Math.pow(1 - x, 3); };
  // decaying shake/punch after a hit at t0
  M.hit = (t, t0, amp = 1, rate = 12) => { const x = t - t0; return x > 0 && x < 0.6 ? Math.exp(-x * rate) * amp : 0; };

  // beat grid: B = array of beat times (seconds). b(i) accepts fractional beats.
  M.beats = (B) => (i) => {
    const k = Math.floor(i), f = i - k;
    if (k + 1 < B.length) return B[k] + f * (B[k + 1] - B[k]);
    const ibi = B[B.length - 1] - B[B.length - 2];
    return B[B.length - 1] + (i - (B.length - 1)) * ibi;
  };

  // ---------- placing elements ----------
  // Elements use class "a" (absolute at 0,0); put() centers them at x,y.
  M.put = (el, o) => {
    const { x = M.W / 2, y = M.H / 2, s = 1, sx = 1, sy = 1, r = 0, a = 1, show = true, w, h, f, z } = o;
    el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) rotate(${r}deg) scale(${s * sx},${s * sy})`;
    el.style.opacity = a;
    if (w !== undefined) el.style.width = w + 'px';
    if (h !== undefined) el.style.height = h + 'px';
    if (z !== undefined) el.style.zIndex = z;
    el.style.filter = f || '';
    el.style.visibility = (show && a > 0.002 && Math.abs(s * sx * sy) > 0.002) ? 'visible' : 'hidden';
  };
  M.hide = (el) => { el.style.visibility = 'hidden'; };
  M.$ = (id) => document.getElementById(id);
  // a circle that floods the frame from (x,y): p 0..1
  M.flood = (el, x, y, p, color) => {
    const r = p * 2400 * Math.max(M.W, M.H) / 1920;
    if (color) el.style.background = color;
    M.put(el, { x, y, w: 2 * r + 1, h: 2 * r + 1, show: p > 0 });
  };

  // ---------- text ----------
  // tx({ko:'...', en:'...'}) -> string for the current language
  M.tx = (o) => (typeof o === 'string' ? o : (o[M.lang] ?? o.ko));

  // Headlines that rise out of a mask line and exit upward.
  // list: [{s, e, ko, en, cls, y}] with s/e in seconds (e = null -> stays).
  M.heads = (container, list, defY = 330) => {
    const items = list.map((h) => {
      const m = document.createElement('div'); m.className = 'mask';
      const d = document.createElement('div'); d.className = 'head ' + (h.cls || '');
      d.innerHTML = M.tx(h);
      m.appendChild(d); container.appendChild(m);
      return { ...h, m, d };
    });
    return (t) => {
      for (const h of items) {
        const t1 = h.e == null ? 1e9 : h.e;
        if (t < h.s - 0.01 || t > t1 + 0.35) { M.hide(h.m); continue; }
        const p = M.sp(t, h.s, 2.6, 0.82), q = M.eout(t, t1, 0.24);
        h.m.style.visibility = 'visible';
        h.m.style.transform = `translate(${M.W / 2}px,${h.y ?? defY}px) translate(-50%,-50%)`;
        h.d.style.transform = `translateY(${(1 - p) * 115 - q * 115}%)`;
      }
    };
  };

  // ---------- real gameplay clips ----------
  // Clips must be all-intra encoded (tools/prep_clip.py) so seeking is exact and fast.
  const clips = [];
  M.clip = (el) => { const c = { el, src: el.getAttribute('data-src').replace('{lang}', M.lang) }; clips.push(c); return c; };
  // show clip frame at local time lt (seconds); returns a promise resolved when the frame is ready
  M.clipAt = (c, lt) => new Promise((res) => {
    if (c.missing) return res();          // clip not captured yet: keep rendering the rest
    const v = c.el;
    const tt = M.clamp(lt, 0, Math.max(0, (v.duration || 0) - 0.02));
    if (Math.abs(v.currentTime - tt) < 1e-4 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = tt;
  });

  M.ready = async ({ images = [] } = {}) => {
    await document.fonts.ready;
    for (const f of [...document.fonts]) { try { await f.load(); } catch (e) {} }
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    await Promise.all(images.map((src) => { const i = new Image(); i.src = src; return i.decode().catch(() => {}); }));
    for (const c of clips) {
      try {
        c.el.muted = true; c.el.preload = 'auto';
        c.el.src = c.src;                     // file:// pages cannot fetch(); load the file directly
        await new Promise((r, j) => { c.el.onloadeddata = r; c.el.onerror = j; });
      } catch (e) { c.missing = true; }
    }
  };

  // ---------- kinetic captions (2026 short-form standard) ----------
  // Words pop in one chunk at a time, key chunks highlighted, the line leaves upward.
  // lines: [{ko:'블록을|*밀어라!*', en:'Slide|the *blocks!*', s, step, e, y}]  ('|' = chunk, '*x*' = highlight)
  M.kinetic = (container, lines, defY = sy(1270)) => {
    const items = lines.map((L) => {
      const el = document.createElement('div'); el.className = 'kline';
      const chunks = M.tx(L).split('|').map((c) => {
        const w = document.createElement('span');
        const c2 = c.trim(), hi = /^\*[^*]*\*$/.test(c2);
        w.className = 'kw' + (hi ? ' hi' : '');
        // 튀어나올 때 살짝 커졌다 돌아온다. 가운데 기준이면 앞 단어 쪽으로 커져 띄어쓰기를 덮는다(2026-10-22 "미국이그를")
        // → 둘째 덩어리부터는 왼쪽 기준으로 커진다(오른쪽은 아직 보이지 않는 다음 덩어리 자리).
        if (el.childElementCount) w.style.transformOrigin = '0% 60%';
        w.innerHTML = hi ? c2.slice(1, -1) : c2.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        el.appendChild(w); return w;
      });
      container.appendChild(el);
      return { ...L, el, chunks };
    });
    return (t) => {
      for (const L of items) {
        const e = L.e == null ? 1e9 : L.e;
        if (t < L.s - 0.01 || t > e + 0.3) { L.el.style.visibility = 'hidden'; continue; }
        const q = M.ein(t, e, 0.18);
        L.el.style.visibility = 'visible';
        L.el.style.transform = `translate(${M.W / 2}px,${(L.y ?? defY) - q * 90}px) translate(-50%,-50%)`;
        L.el.style.opacity = 1 - q;
        L.chunks.forEach((w, i) => {
          const t0 = L.s + i * (L.step ?? 0.3);
          const p = M.sp(t, t0, 3.2, 0.55);
          const hi = w.classList.contains('hi');
          w.style.opacity = t < t0 ? 0 : M.clamp(p * 3);
          w.style.transform = `translateY(${(1 - p) * 60}px) scale(${0.55 + 0.45 * p + (hi ? M.hit(t, t0 + 0.12, 0.08, 7) : 0)}) rotate(${(1 - p) * (i % 2 ? 6 : -6)}deg)`;
        });
      }
    };
  };

  // sticker callout (e.g. "+200", "쏙!"): pops with a tilt, wobbles, leaves
  M.sticker = (el, t, t0, t1, { x = M.W / 2, y = sy(900), r = -8, s = 1 } = {}) => {
    if (t < t0 || t > t1 + 0.25) return M.hide(el);
    const p = M.sp(t, t0, 3.4, 0.5), q = M.ein(t, t1, 0.2);
    M.put(el, { x, y: y - q * 40, s: s * p * (1 - q * 0.4), r: r + Math.sin((t - t0) * 9) * 2 * Math.exp(-(t - t0) * 2), a: 1 - q });
  };

  // NK Studio: number counting up between t0 and t0+d (ease-out), formatted for the language (1,234 / 12.5)
  M.count = (t, t0, d, from, to, decimals = 0) => M.lerp(from, to, M.eout(t, t0, d))
    .toLocaleString(M.lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  // keyframed camera: keys = [[t, s, fx, fy], ...]; returns {s, fx, fy} eased between keys
  M.keys = (t, keys) => {
    if (t <= keys[0][0]) return { s: keys[0][1], fx: keys[0][2], fy: keys[0][3] };
    for (let i = 0; i < keys.length - 1; i++) {
      const [ta, sa, xa, ya] = keys[i], [tb, sb, xb, yb] = keys[i + 1];
      if (t <= tb) { const p = M.io(t, ta, tb - ta); return { s: M.lerp(sa, sb, p), fx: M.lerp(xa, xb, p), fy: M.lerp(ya, yb, p) }; }
    }
    const k = keys[keys.length - 1]; return { s: k[1], fx: k[2], fy: k[3] };
  };

  // full-bleed real gameplay: the clip fitted (contain) over a blurred copy of itself, so any aspect fills 9:16.
  // markup: <div class="full" id=..><video class="blurbg" data-src=..></video><video class="fg" data-src=..></video></div>
  M.full = (box, vw, vh) => {
    const fg = box.querySelector('.fg'), bg = box.querySelector('.blurbg');
    fg.style.width = vw + 'px'; fg.style.height = vh + 'px';
    return { box, fg, vw, vh, cf: M.clip(fg), cb: M.clip(bg) };
  };
  // lt = local clip time, cam = {s, fx, fy} (focus in clip px), open = 0..1 (card -> full frame)
  M.fullAt = (F, lt, cam = {}, open = 1) => {
    const base = Math.min(M.W / F.vw, M.H / F.vh), s = base * (cam.s ?? 1);
    const fx = cam.fx ?? F.vw / 2, fy = cam.fy ?? F.vh / 2;
    F.fg.style.transform = `translate(${-fx * s}px,${-fy * s}px) scale(${s})`;
    const c = 1 - open;
    F.box.style.clipPath = `inset(${c * sy(330)}px ${c * Math.round(200 * M.W / 1080)}px round ${c * 64}px)`;
    F.box.style.visibility = 'visible';
    return Promise.all([M.clipAt(F.cf, lt), M.clipAt(F.cb, lt)]);
  };

  // film grain: deterministic per frame (pure function of t)
  M.grain = (el, t) => {
    const n = Math.floor(t * 24);
    el.style.backgroundPosition = `${(n * 73) % 256}px ${(n * 151) % 256}px`;
  };

  // ---------- NK Studio: generative graphics (2026-10-23) ----------
  // Everything is seeded: the same t and seed draw the same frame on every render worker.

  // seeded random stream: const R = M.rng(7); R() -> 0..1
  M.rng = (seed = 1) => {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };
  // stable 0..1 value for integer indices (particle i, tile (col,row), ...)
  M.hash = (a, b = 0, c = 0) => {
    let h = Math.imul((a | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul((b | 0) + 0x632BE5AB, 0xC2B2AE35) ^ Math.imul((c | 0) + 0x165667B1, 0x27D4EB2F);
    h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D);
    h = Math.imul(h ^ (h >>> 12), 0x297A2D39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  // smooth 3D Perlin noise -> about -1..1 (use z = t * speed to animate)
  const perm = new Uint8Array(512);
  {
    const r = M.rng(1337), p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const fade = (x) => x * x * x * (x * (x * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  M.noise = (x, y = 0, z = 0) => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z), L = M.lerp;
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return L(
      L(L(grad(perm[AA] & 15, x, y, z), grad(perm[BA] & 15, x - 1, y, z), u),
        L(grad(perm[AB] & 15, x, y - 1, z), grad(perm[BB] & 15, x - 1, y - 1, z), u), v),
      L(L(grad(perm[AA + 1] & 15, x, y, z - 1), grad(perm[BA + 1] & 15, x - 1, y, z - 1), u),
        L(grad(perm[AB + 1] & 15, x, y - 1, z - 1), grad(perm[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
  };
  // layered noise (rougher, more natural)
  M.fbm = (x, y = 0, z = 0, octaves = 4) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += amp * M.noise(x * freq, y * freq, z * freq); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };

  // precise easing for the editorial track (fast start, long settle, no bounce)
  M.ease = {
    linear: (x) => x,
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inOutQuint: (x) => (x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  };
  // 0..1 progress from t0 over d seconds with a named (or custom) ease
  M.tw = (t, t0, d, ease = 'outExpo') => (typeof ease === 'function' ? ease : (M.ease[ease] || M.ease.outExpo))(M.clamp((t - t0) / d));

  // <canvas class="layer"> -> 2D context sized to the stage (or w x h). Redraw everything inside seek(t).
  M.canvas = (el, { w = M.W, h = M.H } = {}) => {
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    return el.getContext('2d');
  };
  // halftone dots: each cell gets fn(x, y) -> 0..1 as its dot radius. One fill call, so ~15k dots stay fast.
  M.halftone = (ctx, fn, { cell = 14, color = '#fff', x0 = 0, y0 = 0, w = ctx.canvas.width, h = ctx.canvas.height, square = false, max = 0.5 } = {}) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let y = y0 + cell / 2; y < y0 + h; y += cell) {
      for (let x = x0 + cell / 2; x < x0 + w; x += cell) {
        const v = fn(x, y);
        if (!(v > 0.02)) continue;
        const r = Math.min(1, v) * cell * max;
        if (square) ctx.rect(x - r, y - r, 2 * r, 2 * r);
        else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      }
    }
    ctx.fill();
  };
  // motion that needs the previous state (physics, flow trails): simulate once at a fixed step before READY,
  // then seek(t) only reads it. snap(state) returns numbers (positions...); sim(t) interpolates two saved steps.
  // const sim = M.bake({ dur: DUR, init: () => ({...}), step: (s, dt, t) => {...}, snap: (s) => s.xy }); const xy = sim(t);
  M.bake = ({ dur, fps = 60, sub = 2, init, step, snap }) => {
    const n = Math.ceil(dur * fps) + 1, dt = 1 / (fps * sub), frames = new Array(n);
    const state = init();
    for (let i = 0; i < n; i++) {
      frames[i] = Float32Array.from(snap(state, i / fps));
      for (let k = 0; k < sub; k++) step(state, dt, (i * sub + k) * dt);
    }
    let out = null;
    return (t) => {
      const f = M.clamp(t * fps, 0, n - 1), i = Math.floor(f), p = f - i;
      const a = frames[i], b = frames[Math.min(n - 1, i + 1)];
      if (b.length !== a.length) return a;
      if (!out || out.length !== a.length) out = new Float32Array(a.length);
      for (let j = 0; j < a.length; j++) out[j] = a[j] + (b[j] - a[j]) * p;
      return out;
    };
  };
  // split text into <span class="ch"> per character (staggered letters, echoes). Spaces are kept.
  M.chars = (el, text) => {
    const value = text == null ? el.textContent : M.tx(text);
    el.textContent = '';
    return [...value].map((c) => {
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = c === ' ' ? ' ' : c;
      el.appendChild(span);
      return span;
    });
  };

  window.M = M;
})();
