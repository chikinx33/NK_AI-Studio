// RAVIOK motion kit. Every frame is a pure function of time t (seconds):
// no CSS transitions, no timers, no state carried between frames.
// An episode page defines `async function seek(t)` and `window.READY = M.ready({...}).then(() => DUR)`.
(function () {
  const M = {};
  M.params = new URLSearchParams(location.search);
  M.lang = M.params.get('lang') || 'ko';
  document.documentElement.lang = M.lang;
  if (M.params.get('guide') === '1') document.documentElement.classList.add('guide');

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
    const { x = 540, y = 960, s = 1, sx = 1, sy = 1, r = 0, a = 1, show = true, w, h, f, z } = o;
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
    const r = p * 2400;
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
        h.m.style.transform = `translate(540px,${h.y ?? defY}px) translate(-50%,-50%)`;
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
  M.kinetic = (container, lines, defY = 1270) => {
    const items = lines.map((L) => {
      const el = document.createElement('div'); el.className = 'kline';
      const chunks = M.tx(L).split('|').map((c) => {
        const w = document.createElement('span');
        const c2 = c.trim(), hi = /^\*[^*]*\*$/.test(c2);
        w.className = 'kw' + (hi ? ' hi' : '');
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
        L.el.style.transform = `translate(540px,${(L.y ?? defY) - q * 90}px) translate(-50%,-50%)`;
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
  M.sticker = (el, t, t0, t1, { x = 540, y = 900, r = -8, s = 1 } = {}) => {
    if (t < t0 || t > t1 + 0.25) return M.hide(el);
    const p = M.sp(t, t0, 3.4, 0.5), q = M.ein(t, t1, 0.2);
    M.put(el, { x, y: y - q * 40, s: s * p * (1 - q * 0.4), r: r + Math.sin((t - t0) * 9) * 2 * Math.exp(-(t - t0) * 2), a: 1 - q });
  };

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
    const base = Math.min(1080 / F.vw, 1920 / F.vh), s = base * (cam.s ?? 1);
    const fx = cam.fx ?? F.vw / 2, fy = cam.fy ?? F.vh / 2;
    F.fg.style.transform = `translate(${-fx * s}px,${-fy * s}px) scale(${s})`;
    const c = 1 - open;
    F.box.style.clipPath = `inset(${c * 330}px ${c * 200}px round ${c * 64}px)`;
    F.box.style.visibility = 'visible';
    return Promise.all([M.clipAt(F.cf, lt), M.clipAt(F.cb, lt)]);
  };

  // film grain: deterministic per frame (pure function of t)
  M.grain = (el, t) => {
    const n = Math.floor(t * 24);
    el.style.backgroundPosition = `${(n * 73) % 256}px ${(n * 151) % 256}px`;
  };

  window.M = M;
})();
