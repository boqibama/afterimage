// Afterimage doodles: a structured generator of small, funny, recognizable drawings built only from geometric primitives.
// Every doodle keeps its exact components, their semantic groups, attachments and relations as data, so it can be
// graded objectively. Runs in the browser or in Node. Board: 20 x 20 units, x right, y down.
(function (root) {
  'use strict';

  const BOARD = 20;
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rad = d => (d * Math.PI) / 180, deg = a => (a * 180) / Math.PI;
  const r2 = v => Math.round(v * 100) / 100;
  const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

  // ---------- primitives
  // A component has a centre (x, y), a frame (w, h) before turning and a turn r in degrees, clockwise.
  //   ellipse  an oval filling the frame              rect  a rectangle
  //   tri      isosceles, apex up before turning      semi  a half-oval, flat side down, dome height h
  //   line     from (x1, y1) to (x2, y2); w is its length and r its direction
  //   arc      part of the frame's oval from angle a0 to a1 (degrees, 0 = right, 90 = down)
  //   dot      a small filled circle
  // `grade` is the kind the freehand grader scores it as. need: 1 silhouette, 2 signature feature (kept at every level),
  // 3 useful detail, 4 minor detail; details are dropped, minor ones first, when a doodle is over its level's budget.
  const GRADE = { ellipse: 'circle', rect: 'square', tri: 'triangle', semi: 'half', line: 'line', arc: 'arc', dot: 'dot' };
  const NEED = { 1: 'silhouette', 2: 'signature', 3: 'detail', 4: 'minor detail' };
  function lineGeo(x1, y1, x2, y2) { return { x1, y1, x2, y2, x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: Math.hypot(x2 - x1, y2 - y1), h: 0, r: deg(Math.atan2(y2 - y1, x2 - x1)) }; }
  function builder(object) {
    const parts = [];
    const push = (kind, part, geo, o) => { const p = Object.assign({ kind, grade: GRADE[kind], object, part, need: 2, fill: null }, geo, o || {}); parts.push(p); return p; };
    const B = {
      parts,
      ell: (part, cx, cy, rx, ry, r, o) => push('ellipse', part, { x: cx, y: cy, w: 2 * rx, h: 2 * ry, r: r || 0 }, o),
      circ: (part, cx, cy, rr, o) => push('ellipse', part, { x: cx, y: cy, w: 2 * rr, h: 2 * rr, r: 0 }, o),
      rect: (part, cx, cy, w, h, r, o) => push('rect', part, { x: cx, y: cy, w, h, r: r || 0 }, o),
      tri: (part, cx, cy, w, h, r, o) => push('tri', part, { x: cx, y: cy, w, h, r: r || 0 }, o),
      semi: (part, cx, cy, w, h, r, o) => push('semi', part, { x: cx, y: cy, w, h, r: r || 0 }, o),
      line: (part, x1, y1, x2, y2, o) => push('line', part, lineGeo(x1, y1, x2, y2), o),
      arc: (part, cx, cy, rx, ry, a0, a1, r, o) => push('arc', part, { x: cx, y: cy, w: 2 * rx, h: 2 * ry, r: r || 0, a0, a1 }, o),
      dot: (part, cx, cy, rr, o) => push('dot', part, { x: cx, y: cy, w: 2 * rr, h: 2 * rr, r: 0 }, o),
      // a limb: an oval (or a bar) hanging from a pivot at an angle; returns the far end, where a hand would be
      limb(part, px, py, len, thick, angle, o, bar) {
        const c = Math.cos(rad(angle)), s = Math.sin(rad(angle));
        push(bar ? 'rect' : 'ellipse', part, { x: px + (c * len) / 2, y: py + (s * len) / 2, w: len, h: thick, r: angle }, o);
        return [px + c * len, py + s * len];
      },
      stick(part, px, py, len, angle, o) { const x2 = px + Math.cos(rad(angle)) * len, y2 = py + Math.sin(rad(angle)) * len; push('line', part, lineGeo(px, py, x2, y2), o); return [x2, y2]; },
    };
    return B;
  }

  // ---------- transforms, applied to a whole piece: its components and its named anchor points
  const rotPt = (x, y, d, ox, oy) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)), dx = x - ox, dy = y - oy; return [ox + dx * c - dy * s, oy + dx * s + dy * c]; };
  function moveP(p, dx, dy) { p.x += dx; p.y += dy; if (p.kind === 'line') { p.x1 += dx; p.y1 += dy; p.x2 += dx; p.y2 += dy; } }
  function scaleP(p, s, ox, oy) {
    p.x = ox + (p.x - ox) * s; p.y = oy + (p.y - oy) * s; p.w *= s; p.h *= s;
    if (p.kind === 'line') { p.x1 = ox + (p.x1 - ox) * s; p.y1 = oy + (p.y1 - oy) * s; p.x2 = ox + (p.x2 - ox) * s; p.y2 = oy + (p.y2 - oy) * s; }
  }
  function turnP(p, d, ox, oy) {
    [p.x, p.y] = rotPt(p.x, p.y, d, ox, oy); p.r += d;
    if (p.kind === 'line') { [p.x1, p.y1] = rotPt(p.x1, p.y1, d, ox, oy); [p.x2, p.y2] = rotPt(p.x2, p.y2, d, ox, oy); }
  }
  function mirrorP(p, axis) {
    p.x = 2 * axis - p.x; p.r = -p.r;
    if (p.kind === 'line') { p.x1 = 2 * axis - p.x1; p.x2 = 2 * axis - p.x2; p.r = deg(Math.atan2(p.y2 - p.y1, p.x2 - p.x1)); }
    if (p.kind === 'arc') { const a0 = 180 - p.a1, a1 = 180 - p.a0; p.a0 = a0; p.a1 = a1; }
  }
  function apply(piece, f, fpt) {
    piece.parts.forEach(f);
    for (const k of Object.keys(piece.anchors || {})) if (piece.anchors[k]) { const [x, y] = fpt(piece.anchors[k]); piece.anchors[k] = [x, y].concat(piece.anchors[k].slice(2)); }
  }
  const translate = (piece, dx, dy) => apply(piece, p => moveP(p, dx, dy), pt => [pt[0] + dx, pt[1] + dy]);
  const scaleBy = (piece, s, ox, oy) => apply(piece, p => scaleP(p, s, ox, oy), pt => [ox + (pt[0] - ox) * s, oy + (pt[1] - oy) * s]);
  const turnBy = (piece, d, ox, oy) => apply(piece, p => turnP(p, d, ox, oy), pt => rotPt(pt[0], pt[1], d, ox, oy));
  const mirror = (piece, axis) => apply(piece, p => mirrorP(p, axis), pt => [2 * axis - pt[0], pt[1]]);

  // outline points of a component in board units: for drawing, bounds, overlap and the grader's perfect trace
  function outline(p, n) {
    n = n || 48;
    const a = p.w / 2, b = p.h / 2, L = [];
    if (p.kind === 'line') return [[p.x1, p.y1], [p.x2, p.y2]];
    if (p.kind === 'ellipse' || p.kind === 'dot') for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI * 2; L.push([a * Math.cos(t), b * Math.sin(t)]); }
    else if (p.kind === 'arc') { const m = Math.max(6, Math.round((n * Math.abs(p.a1 - p.a0)) / 360)); for (let k = 0; k <= m; k++) { const t = rad(p.a0 + ((p.a1 - p.a0) * k) / m); L.push([a * Math.cos(t), b * Math.sin(t)]); } }
    else if (p.kind === 'rect') L.push([-a, -b], [a, -b], [a, b], [-a, b], [-a, -b]);
    else if (p.kind === 'tri') L.push([0, -b], [a, b], [-a, b], [0, -b]);
    else if (p.kind === 'semi') { for (let k = 0; k <= n; k++) { const t = Math.PI + (k / n) * Math.PI; L.push([a * Math.cos(t), b + p.h * Math.sin(t)]); } L.push([-a, b]); }
    const c = Math.cos(rad(p.r)), s = Math.sin(rad(p.r));
    return L.map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
  }
  function boundsOf(parts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (const [x, y] of outline(p, 32)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }

  // arm angles for front-view characters (0 = right, 90 = down, -90 = up); up: how many arms are raised
  function arms(pose) {
    if (pose === 'jump' || pose === 'dance') return { left: -140, right: -40, up: 2 };
    if (pose === 'wave') return { left: 105, right: -32, up: 1 };
    if (pose === 'hold') return { left: 105, right: -62, up: 1 };
    return { left: 105, right: 75, up: 0 };
  }

  // ---------- characters
  // Built in their own frame: feet on y = 0, centred on x = 0, about 8 units tall; side views face right. Each returns
  // its anchors: headTop [x, y, width] for hats, eyes [x, y, spacing] for glasses, neck for a bow tie, hand (the end of
  // the raised arm, or null), tail (where a balloon string is tied), seat (where it sits on a bench or saddle).
  const CHARACTERS = {
    pig: {
      name: 'pig', view: 'side', wears: ['hat', 'crown', 'bowtie'], holdWith: 'tail', poses: ['jump'], rides: ['bicycle', 'skateboard'], scenes: ['house', 'tree', 'sun'],
      details: ['a curly tail', 'a round snout', 'a pointy ear'],
      build(B, v) {
        const f = v.fat, hx = 2.9 * f;
        B.arc('curly tail', -3.3 * f - 0.5, -3.8, 0.58, 0.58, 160, 470, 0, { need: 2 });
        B.ell('body', 0, -3.0, 3.3 * f, 2.3, 0, { need: 1, fill: 'pink' });
        B.rect('back leg', -1.9 * f, -0.55, 0.8, 1.3, 0, { need: 1, fill: 'pink' });
        B.rect('front leg', 1.6 * f, -0.55, 0.8, 1.3, 0, { need: 1, fill: 'pink' });
        B.ell('head', hx, -4.3, 1.85, 1.75, 0, { need: 1, fill: 'pink' });
        B.tri('ear', hx - 0.95, -5.85, 1.0, 1.25, -28, { need: 2, fill: 'rose' });
        B.ell('snout', hx + 1.72, -4.05, 0.55, 0.75, 0, { need: 2, fill: 'rose' });
        B.dot('eye', hx + 0.45, -4.85, 0.19, { need: 2 });
        B.dot('upper nostril', hx + 1.74, -4.34, 0.14, { need: 4 });
        B.dot('lower nostril', hx + 1.74, -3.78, 0.14, { need: 4 });
        return { headTop: [hx + 0.4, -5.9, 2.0], neck: [hx - 1.05, -2.95], hand: null, tail: [-3.3 * f - 0.5, -4.35], seat: [0, -0.9] };
      },
    },
    penguin: {
      name: 'penguin', view: 'front', wears: ['hat', 'crown', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'dance', 'sit'], rides: ['skateboard', 'bicycle'], scenes: ['house', 'sun', 'tree'],
      details: ['a white belly', 'an orange beak', 'two flippers'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.ell('body', 0, -4.2, 2.4 * f, 3.9, 0, { need: 1, fill: 'ink' });
        B.ell('belly', 0, -3.75, 1.65 * f, 3.1, 0, { need: 2, fill: 'snow' });
        B.ell('left foot', -0.85, -0.2, 0.75, 0.3, 0, { need: 3, fill: 'orange' });
        B.ell('right foot', 0.85, -0.2, 0.75, 0.3, 0, { need: 3, fill: 'orange' });
        B.limb('left flipper', -2.15 * f, -5.0, 2.7, 0.85, A.left, { need: 2, fill: 'ink' });
        const hand = B.limb('right flipper', 2.15 * f, -5.0, 2.7, 0.85, A.right, { need: 2, fill: 'ink' });
        B.tri('beak', 0, -5.4, 0.95, 0.75, 180, { need: 2, fill: 'orange' });
        B.dot('left eye', -0.62, -6.3, 0.2, { need: 2 });
        B.dot('right eye', 0.62, -6.3, 0.2, { need: 2 });
        return { headTop: [0, -7.95, 2.6], eyes: [0, -6.3, 1.24], neck: [0, -4.55], hand, seat: [0, -0.55] };
      },
    },
    cat: {
      name: 'cat', view: 'front', wears: ['hat', 'crown', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'sit'], rides: ['bicycle', 'skateboard'], scenes: ['house', 'tree', 'sun'],
      details: ['two pointy ears', 'whiskers', 'a long tail'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        if (A.up) B.arc('tail', -1.6 * f, -2.6, 1.5, 2.0, 100, 255, 0, { need: 2 });
        else B.arc('tail', 1.6 * f, -2.6, 1.5, 2.0, -75, 80, 0, { need: 2 });
        B.ell('body', 0, -2.3, 2.15 * f, 2.3, 0, { need: 1, fill: v.coat });
        if (A.up === 2) B.limb('left paw', -1.55 * f, -3.5, 1.9, 0.75, A.left, { need: 3, fill: v.coat });
        const hand = A.up ? B.limb('right paw', 1.55 * f, -3.5, 1.9, 0.75, A.right, { need: 2, fill: v.coat }) : null;
        B.ell('head', 0, -5.6, 1.9, 1.65, 0, { need: 1, fill: v.coat });
        B.tri('left ear', -1.2, -7.15, 1.05, 1.25, -18, { need: 2, fill: v.coat });
        B.tri('right ear', 1.2, -7.15, 1.05, 1.25, 18, { need: 2, fill: v.coat });
        B.dot('left eye', -0.68, -5.85, 0.19, { need: 2 });
        B.dot('right eye', 0.68, -5.85, 0.19, { need: 2 });
        B.tri('nose', 0, -5.3, 0.42, 0.32, 180, { need: 4, fill: 'rose' });
        B.line('left whiskers', -0.55, -5.05, -2.2, -5.3, { need: 2 });
        B.line('right whiskers', 0.55, -5.05, 2.2, -5.3, { need: 2 });
        return { headTop: [0, -7.12, 2.3], eyes: [0, -5.85, 1.36], neck: [0, -3.95], hand, seat: [0, -0.3] };
      },
    },
    frog: {
      name: 'frog', view: 'front', wears: ['crown', 'hat', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'dance', 'sit'], rides: ['skateboard'], scenes: ['tree', 'house', 'sun'],
      details: ['two bulging eyes on top', 'a wide smile', 'big back legs'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.ell('left back leg', -2.3 * f, -1.1, 0.95, 1.35, -35, { need: 2, fill: 'green' });
        B.ell('right back leg', 2.3 * f, -1.1, 0.95, 1.35, 35, { need: 2, fill: 'green' });
        B.ell('body', 0, -2.1, 2.4 * f, 1.9, 0, { need: 1, fill: 'green' });
        let hand = null;
        if (A.up === 2) B.limb('left arm', -2.15 * f, -2.6, 2.0, 0.62, A.left, { need: 3, fill: 'green' });
        else B.ell('left hand', -1.15, -0.25, 0.7, 0.3, 0, { need: 4, fill: 'green' });
        if (A.up) hand = B.limb('right arm', 2.15 * f, -2.6, 2.0, 0.62, A.up === 2 ? A.right : pose === 'hold' ? -38 : -22, { need: 2, fill: 'green' });
        else B.ell('right hand', 1.15, -0.25, 0.7, 0.3, 0, { need: 4, fill: 'green' });
        B.ell('head', 0, -4.35, 2.65, 1.55, 0, { need: 1, fill: 'green' });
        B.circ('left eye bump', -1.4, -5.75, 0.85, { need: 2, fill: 'green' });
        B.circ('right eye bump', 1.4, -5.75, 0.85, { need: 2, fill: 'green' });
        B.dot('left pupil', -1.4, -5.8, 0.3, { need: 2 });
        B.dot('right pupil', 1.4, -5.8, 0.3, { need: 2 });
        B.arc('smile', 0, -4.75, 1.55, 0.85, 25, 155, 0, { need: 2 });
        return { headTop: [0, -5.92, 1.5], eyes: [0, -5.8, 2.8], neck: [0, -2.95], hand, seat: [0, -0.4] };
      },
    },
    dog: {
      name: 'dog', view: 'side', wears: ['hat', 'crown', 'bowtie'], holdWith: 'tail', poses: ['jump'], rides: ['skateboard', 'bicycle'], scenes: ['house', 'tree', 'sun'],
      details: ['a floppy ear', 'a long snout with a black nose', 'a tail sticking up'],
      build(B, v) {
        const f = v.fat, hx = 2.55 * f;
        B.line('tail', -2.75 * f, -3.55, -3.75 * f, -5.1, { need: 2 });
        B.rect('back leg', -2.0 * f, -0.85, 0.7, 1.7, 0, { need: 1, fill: 'tan' });
        B.rect('front leg', 1.45 * f, -0.85, 0.7, 1.7, 0, { need: 1, fill: 'tan' });
        B.ell('body', -0.3, -3.0, 2.85 * f, 1.6, 0, { need: 1, fill: 'tan' });
        B.ell('head', hx, -4.85, 1.5, 1.4, 0, { need: 1, fill: 'tan' });
        B.ell('snout', hx + 1.4, -4.45, 0.95, 0.62, 0, { need: 2, fill: 'tan' });
        B.dot('nose', hx + 2.25, -4.6, 0.24, { need: 2 });
        B.dot('eye', hx + 0.4, -5.25, 0.18, { need: 2 });
        B.ell('ear', hx - 0.55, -4.55, 0.48, 1.12, 18, { need: 2, fill: 'brown' });
        return { headTop: [hx + 0.15, -6.12, 2.1], neck: [hx - 1.05, -3.7], hand: null, tail: [-3.75 * f, -5.1], seat: [-0.3, -1.4] };
      },
    },
    duck: {
      name: 'duck', view: 'side', wears: ['hat', 'crown', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump'], rides: ['skateboard'], scenes: ['house', 'tree', 'sun'],
      details: ['a flat orange bill', 'a wing', 'orange feet'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.tri('tail', -2.6 * f - 0.1, -3.0, 0.95, 1.1, -55, { need: 3, fill: 'sun' });
        B.tri('back foot', -0.55, -0.22, 0.45, 1.0, 90, { need: 2, fill: 'orange' });
        B.tri('front foot', 0.75, -0.22, 0.45, 1.0, 90, { need: 2, fill: 'orange' });
        B.ell('body', -0.2, -2.2, 2.6 * f, 1.7, 0, { need: 1, fill: 'sun' });
        B.ell('head', 1.95, -4.9, 1.3, 1.25, 0, { need: 1, fill: 'sun' });
        B.ell('bill', 3.5, -4.6, 0.78, 0.36, 0, { need: 2, fill: 'orange' });
        B.dot('eye', 2.3, -5.2, 0.18, { need: 2 });
        // the wing rests on the body, or rises up and back when it holds or waves
        const hand = A.up ? B.limb('wing', -0.6, -2.7, 2.6, 0.95, A.up === 2 ? -150 : pose === 'hold' ? -118 : -140, { need: 2, fill: 'sun' }) : (B.ell('wing', -0.55, -2.45, 1.4, 0.62, 14, { need: 2, fill: 'sun' }), null);
        return { headTop: [2.05, -6.02, 1.9], neck: [1.25, -3.5], hand, seat: [-0.2, -0.6] };
      },
    },
    bear: {
      name: 'bear', view: 'front', wears: ['hat', 'crown', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'dance', 'sit'], rides: ['bicycle', 'skateboard'], scenes: ['tree', 'house', 'sun'],
      details: ['two round ears', 'a light muzzle with a dark nose', 'a round tummy'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.ell('body', 0, -2.65, 2.4 * f, 2.65, 0, { need: 1, fill: 'brown' });
        B.ell('tummy', 0, -2.3, 1.4 * f, 1.55, 0, { need: 4, fill: 'cream' });
        B.ell('left foot', -1.05, -0.25, 0.75, 0.35, 0, { need: 4, fill: 'brown' });
        B.ell('right foot', 1.05, -0.25, 0.75, 0.35, 0, { need: 4, fill: 'brown' });
        B.limb('left arm', -1.95 * f, -4.2, 2.4, 0.95, A.left, { need: A.up === 2 ? 2 : 3, fill: 'brown' });
        const hand = B.limb('right arm', 1.95 * f, -4.2, 2.4, 0.95, A.right, { need: A.up ? 2 : 3, fill: 'brown' });
        B.circ('left ear', -1.45, -7.55, 0.65, { need: 2, fill: 'brown' });
        B.circ('right ear', 1.45, -7.55, 0.65, { need: 2, fill: 'brown' });
        B.ell('head', 0, -6.15, 1.95, 1.75, 0, { need: 1, fill: 'brown' });
        B.ell('muzzle', 0, -5.55, 0.9, 0.62, 0, { need: 2, fill: 'cream' });
        B.ell('nose', 0, -5.8, 0.32, 0.22, 0, { need: 2, fill: 'ink' });
        B.dot('left eye', -0.72, -6.55, 0.19, { need: 2 });
        B.dot('right eye', 0.72, -6.55, 0.19, { need: 2 });
        return { headTop: [0, -7.78, 2.4], eyes: [0, -6.55, 1.44], neck: [0, -4.35], hand: A.up ? hand : null, seat: [0, -0.45] };
      },
    },
    bunny: {
      name: 'bunny', view: 'front', wears: ['hat', 'crown', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'dance', 'sit'], rides: ['bicycle', 'skateboard'], scenes: ['tree', 'house', 'sun'],
      details: ['two long ears', 'two buck teeth', 'a pink nose'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.ell('left ear', -0.85, -8.0, 0.45, 1.6, -10, { need: 1, fill: 'mist' });
        B.ell('right ear', 0.85, -8.0, 0.45, 1.6, 10, { need: 1, fill: 'mist' });
        B.ell('body', 0, -2.35, 2.0 * f, 2.35, 0, { need: 1, fill: 'mist' });
        B.ell('left foot', -0.95, -0.22, 0.85, 0.32, 0, { need: 4, fill: 'mist' });
        B.ell('right foot', 0.95, -0.22, 0.85, 0.32, 0, { need: 4, fill: 'mist' });
        if (A.up === 2) B.limb('left arm', -1.5 * f, -3.6, 1.8, 0.62, A.left, { need: 3, fill: 'mist' });
        const hand = A.up ? B.limb('right arm', 1.5 * f, -3.6, 1.8, 0.62, A.right, { need: 2, fill: 'mist' }) : null;
        B.ell('head', 0, -5.35, 1.65, 1.5, 0, { need: 1, fill: 'mist' });
        B.dot('left eye', -0.6, -5.6, 0.18, { need: 2 });
        B.dot('right eye', 0.6, -5.6, 0.18, { need: 2 });
        B.tri('nose', 0, -5.1, 0.36, 0.26, 180, { need: 4, fill: 'rose' });
        B.rect('teeth', 0, -4.62, 0.5, 0.42, 0, { need: 2, fill: 'snow' });
        return { headTop: [0, -6.82, 1.7], eyes: [0, -5.6, 1.2], neck: [0, -3.85], hand, seat: [0, -0.3] };
      },
    },
    owl: {
      name: 'owl', view: 'front', wears: ['hat', 'crown', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'sit'], rides: [], scenes: ['tree', 'tree', 'house'],
      details: ['huge round eyes', 'two ear tufts', 'a small beak'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.ell('body', 0, -3.6, 2.4 * f, 3.4, 0, { need: 1, fill: 'brown' });
        B.ell('left wing', -2.15 * f, -3.1, 0.7, 1.65, 12, { need: 3, fill: 'tan' });
        const hand = A.up ? B.limb('right wing', 2.0 * f, -4.3, 2.5, 1.0, A.right, { need: 2, fill: 'tan' }) : (B.ell('right wing', 2.15 * f, -3.1, 0.7, 1.65, -12, { need: 3, fill: 'tan' }), null);
        B.tri('left tuft', -1.55, -6.75, 0.85, 1.05, -25, { need: 2, fill: 'brown' });
        B.tri('right tuft', 1.55, -6.75, 0.85, 1.05, 25, { need: 2, fill: 'brown' });
        B.circ('left eye', -0.95, -5.0, 0.88, { need: 2, fill: 'snow' });
        B.circ('right eye', 0.95, -5.0, 0.88, { need: 2, fill: 'snow' });
        B.dot('left pupil', -0.95, -5.0, 0.34, { need: 2 });
        B.dot('right pupil', 0.95, -5.0, 0.34, { need: 2 });
        B.tri('beak', 0, -4.05, 0.55, 0.65, 180, { need: 2, fill: 'orange' });
        return { headTop: [0, -6.85, 2.2], eyes: [0, -5.0, 1.9], neck: [0, -3.35], hand, seat: [0, -0.4] };
      },
    },
    fish: {
      name: 'fish', view: 'side', wears: ['hat', 'crown'], holdWith: null, poses: [], rides: ['bicycle'], scenes: ['sun'],
      details: ['a triangle tail', 'a fin on top', 'a little smile'],
      build(B, v) {
        const f = v.fat;
        B.tri('tail', -2.85 * f - 0.65, -2.6, 2.0, 1.55, 90, { need: 1, fill: 'sky' });
        B.ell('body', 0, -2.6, 2.85 * f, 1.75, 0, { need: 1, fill: 'sky' });
        B.tri('fin', -0.4, -4.45, 1.5, 1.0, 0, { need: 2, fill: 'sky' });
        B.dot('eye', 1.55 * f, -3.0, 0.24, { need: 2 });
        B.arc('smile', 1.65 * f, -2.55, 0.5, 0.32, 20, 120, 0, { need: 2 });
        B.circ('small bubble', 2.85 * f + 0.85, -4.3, 0.26, { need: 4, fill: 'white' });
        B.circ('big bubble', 2.85 * f + 1.4, -5.3, 0.38, { need: 4, fill: 'white' });
        return { headTop: [1.1 * f, -4.1, 1.8], neck: [1.8, -1.4], hand: null, seat: [0, -0.85] };
      },
    },
    snail: {
      name: 'snail', view: 'side', wears: ['hat', 'crown'], holdWith: null, poses: [], rides: ['skateboard'], scenes: ['tree', 'house', 'sun'],
      details: ['a spiral shell', 'two feelers', 'a long flat body'],
      build(B, v) {
        const f = v.fat;
        B.ell('body', 0.4, -0.55, 3.25 * f, 0.55, 0, { need: 1, fill: 'tan' });
        B.ell('neck', 3.0 * f, -1.45, 0.6, 1.15, -8, { need: 1, fill: 'tan' });
        B.line('left feeler', 2.9 * f, -2.45, 2.55 * f, -3.8, { need: 2 });
        B.line('right feeler', 3.2 * f, -2.45, 3.75 * f, -3.7, { need: 2 });
        B.dot('left tip', 2.52 * f, -3.88, 0.17, { need: 4 });
        B.dot('right tip', 3.79 * f, -3.78, 0.17, { need: 4 });
        B.circ('shell', -0.35, -2.75, 2.0, { need: 1, fill: 'orange' });
        B.arc('spiral', -0.35, -2.75, 1.1, 1.1, -60, 250, 0, { need: 2 });
        return { headTop: [-0.35, -4.62, 2.4], neck: [2.2, -1.0], hand: null, seat: [0.4, -0.05] };
      },
    },
    snowman: {
      name: 'snowman', view: 'front', wears: ['hat', 'crown', 'sunglasses'], holdWith: 'hand', poses: ['wave', 'hold', 'dance'], rides: [], scenes: ['sun', 'tree', 'house'],
      details: ['three snowballs', 'a carrot nose', 'stick arms'],
      build(B, v, pose) {
        const up = pose === 'dance' || pose === 'jump';
        B.circ('bottom ball', 0, -1.95, 1.95, { need: 1, fill: 'snow' });
        B.circ('middle ball', 0, -4.85, 1.4, { need: 1, fill: 'snow' });
        B.circ('head', 0, -7.0, 1.05, { need: 1, fill: 'snow' });
        B.stick('left arm', -1.3, -5.0, 1.9, up ? -150 : 200, { need: 2 });
        const hand = B.stick('right arm', 1.3, -5.0, 1.9, pose === 'hold' ? -62 : pose === 'wave' ? -48 : up ? -30 : -20, { need: 2 });
        B.dot('left eye', -0.4, -7.25, 0.16, { need: 2 });
        B.dot('right eye', 0.4, -7.25, 0.16, { need: 2 });
        B.tri('carrot nose', 0.55, -6.95, 0.32, 1.1, 90, { need: 2, fill: 'orange' });
        B.dot('top button', 0, -5.2, 0.15, { need: 4 });
        B.dot('bottom button', 0, -4.5, 0.15, { need: 4 });
        return { headTop: [0, -7.9, 1.8], eyes: [0, -7.25, 0.76], neck: [0, -6.0], hand, seat: [0, -0.2] };
      },
    },
    robot: {
      name: 'robot', view: 'front', underHat: ['antenna', 'antenna ball'], wears: ['hat', 'crown', 'sunglasses', 'bowtie'], holdWith: 'hand', poses: ['wave', 'hold', 'jump', 'dance', 'sit'], rides: ['skateboard', 'bicycle'], scenes: ['house', 'tree', 'sun'],
      details: ['an antenna', 'a square head with round eyes', 'a box body'],
      build(B, v, pose) {
        const f = v.fat, A = arms(pose);
        B.rect('left leg', -0.75, -1.0, 0.6, 2.0, 0, { need: 1, fill: 'steel' });
        B.rect('right leg', 0.75, -1.0, 0.6, 2.0, 0, { need: 1, fill: 'steel' });
        B.limb('left arm', -1.6 * f, -4.6, 2.1, 0.5, A.left, { need: 2, fill: 'steel' }, true);
        const hand = B.limb('right arm', 1.6 * f, -4.6, 2.1, 0.5, A.right, { need: 2, fill: 'steel' }, true);
        B.rect('body', 0, -3.55, 3.2 * f, 3.1, 0, { need: 1, fill: 'grey' });
        B.line('antenna', 0, -7.65, 0, -8.55, { need: 2 });
        B.dot('antenna ball', 0, -8.72, 0.25, { need: 3 });
        B.rect('head', 0, -6.6, 2.6, 2.1, 0, { need: 1, fill: 'grey' });
        B.circ('left eye', -0.6, -6.85, 0.33, { need: 2, fill: 'sky' });
        B.circ('right eye', 0.6, -6.85, 0.33, { need: 2, fill: 'sky' });
        B.rect('mouth', 0, -6.0, 1.2, 0.26, 0, { need: 3, fill: 'ink' });
        return { headTop: [0, -7.55, 2.4], eyes: [0, -6.85, 1.2], neck: [0, -5.3], hand: A.up ? hand : null, seat: [0, -1.9] };
      },
    },
  };

  // ---------- things to wear or hold, built around their attachment point at (0, 0)
  const ACCESSORIES = {
    crown: { name: 'crown', kind: 'hat', phrase: 'wearing a crown', detail: 'a crown with three points', build(B, w) {
      const bw = Math.max(1.4, w * 0.75), th = bw * 0.42;
      B.rect('crown band', 0, -0.28, bw, 0.56, 0, { need: 1, fill: 'gold' });
      ['left point', 'middle point', 'right point'].forEach((nm, i) => B.tri(nm, ((i - 1) * bw) / 3, -0.54 - th / 2, bw / 3, th, 0, { need: 2, fill: 'gold' }));
    } },
    tophat: { name: 'top hat', kind: 'hat', phrase: 'in a top hat', detail: 'a tall top hat', build(B, w) {
      const bw = Math.max(1.6, w * 0.9);
      B.rect('brim', 0, -0.12, bw, 0.24, 0, { need: 1, fill: 'ink' });
      B.rect('hat crown', 0, -0.22 - bw * 0.34, bw * 0.6, bw * 0.68, 0, { need: 1, fill: 'ink' });
    } },
    partyhat: { name: 'party hat', kind: 'hat', phrase: 'in a party hat', detail: 'a pointy party hat with a pom-pom', build(B, w) {
      const bw = Math.max(1.2, w * 0.55), hh = bw * 1.35;
      B.tri('party hat', 0, -hh / 2 + 0.04, bw, hh, 0, { need: 1, fill: 'violet' });
      B.circ('pom-pom', 0, -hh - 0.14, 0.3, { need: 2, fill: 'gold' });
    } },
    sunglasses: { name: 'sunglasses', kind: 'face', phrase: 'wearing sunglasses', detail: 'dark sunglasses', build(B, w) {
      const gap = Math.max(1.3, w), rw = Math.min(0.68, Math.max(0.45, gap * 0.4));
      B.ell('left lens', -gap / 2, 0, rw, rw * 0.72, 0, { need: 1, fill: 'ink' });
      B.ell('right lens', gap / 2, 0, rw, rw * 0.72, 0, { need: 1, fill: 'ink' });
      B.line('bridge', -gap / 2 + rw * 0.85, -0.1, gap / 2 - rw * 0.85, -0.1, { need: 2 });
    } },
    bowtie: { name: 'bow tie', kind: 'neck', phrase: 'wearing a bow tie', detail: 'a bow tie', build(B) {
      B.tri('left bow', -0.45, 0, 0.8, 0.75, 90, { need: 1, fill: 'red' });
      B.tri('right bow', 0.45, 0, 0.8, 0.75, -90, { need: 1, fill: 'red' });
      B.circ('knot', 0, 0, 0.22, { need: 2, fill: 'red' });
    } },
    umbrella: { name: 'umbrella', kind: 'hold', phrase: 'holding an umbrella', detail: 'an umbrella held up high', build(B) {
      B.arc('handle hook', 0.32, 0.4, 0.32, 0.32, 0, 180, 0, { need: 4 });
      B.line('umbrella handle', 0, 0.4, 0, -3.1, { need: 1 });
      B.semi('canopy', 0, -3.1 - 0.9, 4.4, 1.8, 0, { need: 1, fill: 'red' });
    } },
    balloon: { name: 'balloon', kind: 'hold', phrase: 'holding a balloon', detail: 'a balloon on a string', build(B) {
      B.line('string', 0, 0, 0.3, -3.0, { need: 1 });
      B.tri('knot', 0.33, -3.12, 0.36, 0.3, 0, { need: 4, fill: 'red' });
      B.ell('balloon', 0.38, -4.42, 0.95, 1.2, 0, { need: 1, fill: 'red' });
    } },
  };
  // ---------- things to ride: built with their seat as an anchor and the wheels on y = 0
  const RIDES = {
    bicycle: { name: 'bicycle', phrase: 'riding a bicycle', detail: 'a bicycle with two big wheels', build(B) {
      B.circ('back wheel', -2.4, -1.45, 1.45, { need: 1 });
      B.circ('front wheel', 2.4, -1.45, 1.45, { need: 1 });
      B.tri('frame', 0, -2.5, 4.8, 2.1, 0, { need: 1 });
      B.line('handlebar', 2.4, -1.45, 2.0, -4.25, { need: 2 });
      B.rect('saddle', 0, -3.67, 1.1, 0.26, 0, { need: 2, fill: 'ink' });
      return { seat: [0, -3.8] };
    } },
    skateboard: { name: 'skateboard', phrase: 'riding a skateboard', detail: 'a skateboard under its feet', build(B, w) {
      const dw = Math.max(3.6, w + 0.4);
      B.circ('back wheel', -dw * 0.3, -0.3, 0.3, { need: 2, fill: 'ink' });
      B.circ('front wheel', dw * 0.3, -0.3, 0.3, { need: 2, fill: 'ink' });
      B.rect('deck', 0, -0.76, dw, 0.32, 0, { need: 1, fill: 'wood' });
      return { seat: [0, -0.92] };
    } },
  };
  // ---------- the world around: furniture, nature and effects
  const SCENERY = {
    bench: { name: 'bench', build(B) {
      B.rect('backrest', 0, -3.5, 7.2, 0.4, 0, { need: 1, fill: 'wood' });
      B.rect('left bench leg', -3.0, -1.85, 0.32, 3.7, 0, { need: 1, fill: 'wood' });
      B.rect('right bench leg', 3.0, -1.85, 0.32, 3.7, 0, { need: 1, fill: 'wood' });
      B.rect('bench seat', 0, -1.78, 7.2, 0.38, 0, { need: 1, fill: 'wood' });
      return { seat: [0, -1.97] };
    } },
    tree: { name: 'tree', setting: 'next to a tree', build(B) {
      B.rect('trunk', 0, -1.6, 0.85, 3.2, 0, { need: 1, fill: 'wood' });
      B.circ('treetop', 0, -4.7, 1.95, { need: 1, fill: 'leaf' });
    } },
    house: { name: 'house', setting: 'by a little house', build(B) {
      B.rect('walls', 0, -1.9, 3.8, 3.8, 0, { need: 1, fill: 'cream' });
      B.tri('roof', 0, -4.62, 4.7, 1.75, 0, { need: 1, fill: 'red' });
      B.rect('door', 0, -0.75, 1.05, 1.5, 0, { need: 2, fill: 'wood' });
    } },
    sun: { name: 'sun', setting: 'in the sunshine', build(B) {
      B.circ('sun disc', 0, 0, 1.0, { need: 1, fill: 'gold' });
      [45, 135, 225, 315].forEach((a, i) => { const c = Math.cos(rad(a)), s = Math.sin(rad(a)); B.line(`ray ${i + 1}`, c * 1.35, s * 1.35, c * 2.0, s * 2.0, { need: 2 }); });
    } },
    cloud: { name: 'cloud', setting: 'under a cloud', build(B) {
      B.circ('left puff', -1.2, 0.1, 0.85, { need: 1, fill: 'white' });
      B.circ('right puff', 1.25, 0.1, 0.85, { need: 1, fill: 'white' });
      B.circ('top puff', 0, -0.35, 1.15, { need: 1, fill: 'white' });
    } },
    rain: { name: 'rain', setting: 'in the rain', build(B) {
      [['left drop', -1.7, 0.45, 1], ['middle drop', 0, 0, 1], ['right drop', 1.7, 0.5, 3]].forEach(([nm, x, y, need]) => B.line(nm, x, y, x - 0.22, y + 0.8, { need }));
    } },
    notes: { name: 'music note', build(B) {
      B.ell('note head', 0, 0, 0.34, 0.25, -20, { need: 1, fill: 'ink' });
      B.line('note stem', 0.31, -0.05, 0.31, -1.4, { need: 1 });
    } },
    jumplines: { name: 'motion lines', build(B) {
      B.line('left motion line', -0.8, 0, -1.15, 0.85, { need: 1 });
      B.line('right motion line', 0.8, 0, 1.15, 0.85, { need: 1 });
    } },
  };
  const TEMPLATE_COUNT = [CHARACTERS, ACCESSORIES, RIDES, SCENERY].reduce((n, o) => n + Object.keys(o).length, 0);

  function buildPiece(type, key, v, pose, w) {
    const T = { character: CHARACTERS, accessory: ACCESSORIES, ride: RIDES, scenery: SCENERY }[type][key], B = builder(key);
    const anchors = T.build(B, type === 'character' ? v : w, pose) || {};
    return { key, kind: type, name: T.name, parts: B.parts, anchors };
  }

  // ---------- recipes: what each difficulty asks you to remember
  // Easy: one character standing, silhouette and signature features only. Normal: the whole character with an
  // accessory, a held object or a telling pose. Hard: an action, an interaction with an object, or a little scene.
  const BUDGET = { 1: [5, 9], 2: [8, 13], 3: [10, 14] };
  const ORDER = Object.keys(CHARACTERS);
  // Who stars each day. Every level keeps its own rotation: it picks one of the three characters it has gone longest
  // without, by the day's own seed, skipping characters already used today at another level and, when it can, the
  // characters of the day before. So a day has three different characters, none from yesterday, and a level brings a
  // character back only after a week or more. The schedule is built once from day 0, so it is the same everywhere.
  const DAYS = [], LASTL = [0, 1, 2].map(() => ORDER.map(() => -Infinity));
  function characterFor(seed, lvl) {
    // practice seeds (far beyond any calendar day) pick a character by their own hash instead of the daily rotation
    if (seed >= 50000) return ORDER[Math.floor(mulberry32((Math.imul(seed >>> 0, 0x9E3779B1) ^ lvl) >>> 0)() * ORDER.length)];
    const day = Math.max(0, Math.floor(seed));
    while (DAYS.length <= day) {
      const t = DAYS.length, rnd = mulberry32((Math.imul(t + 1, 0x2C1B3C6D) ^ 0x51ED27) >>> 0), today = [], prev = DAYS[t - 1] || [];
      for (let L = 0; L < 3; L++) {
        const last = LASTL[L], free = ORDER.map((_, i) => i).filter(i => !today.includes(i)).sort((a, b) => last[a] - last[b] || a - b);
        const fresh = free.filter(i => !prev.includes(i)), from = fresh.length >= 3 ? fresh : free, i = from[Math.floor(rnd() * 3)];
        last[i] = t; today.push(i);
      }
      DAYS.push(today);
    }
    return ORDER[DAYS[day][lvl - 1]];
  }
  function wearables(C) {
    const out = [];
    if (C.wears.includes('crown')) out.push('crown');
    if (C.wears.includes('hat')) out.push('tophat', 'partyhat');
    if (C.wears.includes('sunglasses')) out.push('sunglasses');
    if (C.wears.includes('bowtie')) out.push('bowtie');
    return out;
  }
  function chooseRecipe(rnd, lvl, ch) {
    const C = CHARACTERS[ch], wear = wearables(C), r = { character: ch, level: lvl, pose: 'stand', wear: null, extra: null, hold: null, ride: null, scenery: [] };
    const dress = () => (wear.length ? pick(wear, rnd) : null);
    if (lvl === 1) return r;
    if (lvl === 2) {
      const opts = wear.concat(wear);
      if (C.holdWith === 'hand') opts.push('balloon', 'umbrella');
      if (C.poses.includes('wave')) opts.push('wave');
      if (C.poses.includes('dance')) opts.push('dance');
      const o = pick(opts, rnd);
      if (o === 'balloon' || o === 'umbrella') { r.hold = o; r.pose = 'hold'; }
      else if (o === 'wave') r.pose = 'wave';
      else if (o === 'dance') { r.pose = 'dance'; r.scenery = ['notes']; }
      else r.wear = o;
      return r;
    }
    const opts = C.rides.slice();
    if (C.holdWith === 'hand') opts.push('umbrella');
    if (C.holdWith) opts.push('balloon');
    if (C.poses.includes('sit')) opts.push('bench');
    if (C.poses.includes('jump')) opts.push('jump');
    if (C.poses.includes('dance')) opts.push('dance');
    if (C.scenes.length) opts.push('scene');
    const o = pick(opts, rnd);
    if (RIDES[o]) { r.ride = o; r.pose = 'ride'; r.extra = rnd() < 0.6 ? dress() : null; }
    else if (o === 'umbrella') { r.hold = 'umbrella'; r.pose = 'hold'; r.scenery = ['rain']; }
    else if (o === 'balloon') { r.hold = 'balloon'; r.pose = C.holdWith === 'hand' ? 'hold' : 'stand'; r.scenery = ['cloud']; r.extra = dress(); }
    else if (o === 'bench') { r.pose = 'sit'; r.scenery = ['bench']; r.extra = dress(); }
    else if (o === 'jump') { r.pose = 'jump'; r.scenery = ['jumplines']; r.extra = dress(); }
    else if (o === 'dance') { r.pose = 'dance'; r.scenery = ['notes']; r.extra = dress(); }
    else { r.extra = dress(); r.scenery = [pick(C.scenes, rnd)]; }
    return r;
  }

  // ---------- the composer
  const FREE = ['tree', 'house', 'sun', 'cloud', 'rain'];
  // character, accessories, ride and attached scenery, in drawing order (back to front); free scenery is placed later
  function compose(rec, v, facing, rnd) {
    const C = CHARACTERS[rec.character], ch = buildPiece('character', rec.character, v, rec.pose), A = ch.anchors, pieces = [ch], rel = [];
    if (rec.level === 1) ch.parts = ch.parts.filter(p => p.need <= 2);
    const wear = rec.wear || rec.extra;
    if (wear) {
      const acc = ACCESSORIES[wear], at = acc.kind === 'hat' ? A.headTop : acc.kind === 'face' ? A.eyes : A.neck;
      if (acc.kind === 'face') ch.parts = ch.parts.filter(p => !/(eye|pupil)$/.test(p.part));
      if (acc.kind === 'hat' && C.underHat) ch.parts = ch.parts.filter(p => !C.underHat.includes(p.part));
      const piece = buildPiece('accessory', wear, null, null, at[2] || 2);
      translate(piece, at[0], at[1]);
      if (acc.kind === 'hat' && C.view === 'side') turnBy(piece, 12, at[0], at[1]);
      pieces.push(piece);
      rel.push({ type: 'wears', a: rec.character, b: wear, on: acc.kind === 'hat' ? 'head' : acc.kind === 'face' ? 'eyes' : 'neck', contact: true });
    }
    if (rec.hold) {
      const byHand = C.holdWith === 'hand', at = byHand ? A.hand : A.tail, piece = buildPiece('accessory', rec.hold, null, null, 0);
      translate(piece, at[0], at[1]);
      // an umbrella leans so the canopy shelters the head; a balloon on a tail floats up and back
      if (rec.hold === 'umbrella') turnBy(piece, deg(Math.asin(Math.max(-0.5, Math.min(0.5, (A.headTop[0] - at[0]) / 4.3)))), at[0], at[1]);
      else if (!byHand) turnBy(piece, -18, at[0], at[1]);
      pieces.push(piece);
      rel.push({ type: byHand ? 'holds' : 'tied to tail', a: rec.character, b: rec.hold, on: byHand ? 'hand' : 'tail', contact: true });
    }
    if (rec.ride) {
      const cb = boundsOf(ch.parts), piece = buildPiece('ride', rec.ride, null, null, cb[2] - cb[0]), s = piece.anchors.seat;
      if (rec.ride === 'skateboard') translate(piece, (cb[0] + cb[2]) / 2 - s[0], -0.12 - s[1]);
      else translate(piece, A.seat[0] - s[0], A.seat[1] - 0.12 - s[1]);
      if (C.view === 'front' && rnd() < 0.5) mirror(piece, piece.anchors.seat[0]);
      const lift = -boundsOf(piece.parts)[3];
      pieces.forEach(pc => translate(pc, 0, lift)); translate(piece, 0, lift);
      pieces.unshift(piece);
      rel.push({ type: 'rides', a: rec.character, b: rec.ride, on: 'seat', contact: true });
    }
    for (const sk of rec.scenery) {
      const piece = buildPiece('scenery', sk);
      if (sk === 'bench') {
        const dx = piece.anchors.seat[0] - A.seat[0], dy = piece.anchors.seat[1] - A.seat[1];
        pieces.forEach(pc => translate(pc, dx, dy));
        pieces.unshift(piece);
        rel.push({ type: 'sits on', a: rec.character, b: 'bench', on: 'seat', contact: true });
      } else pieces.push(piece);
    }
    if (rec.pose === 'jump') {
      pieces.forEach(pc => { if (pc.kind !== 'scenery') translate(pc, 0, -2.3); });
      const ml = pieces.find(pc => pc.key === 'jumplines'), cb = boundsOf(ch.parts);
      if (ml) { translate(ml, (cb[0] + cb[2]) / 2, cb[3] + 0.5); rel.push({ type: 'below', a: 'jumplines', b: rec.character, contact: false }); }
    }
    if (rec.pose === 'dance') {
      const tilt = rnd() < 0.5 ? -12 : 12;
      pieces.forEach(pc => { if (pc.kind !== 'scenery') turnBy(pc, tilt, 0, 0); });
      const note = pieces.find(pc => pc.key === 'notes'), cb = boundsOf(ch.parts);
      if (note) { translate(note, tilt > 0 ? cb[0] - 1.2 : cb[2] + 0.9, cb[1] + 2.4); rel.push({ type: tilt > 0 ? 'left of' : 'right of', a: 'notes', b: rec.character, contact: false }); }
    }
    if (facing === 'left') pieces.forEach(pc => { if (!FREE.includes(pc.key)) mirror(pc, 0); });
    return { pieces, rel };
  }
  // free scenery: beside the character on the ground, or above it
  function placeFree(pieces, rel, rec, facing, rnd) {
    const core = boundsOf([].concat(...pieces.filter(pc => !FREE.includes(pc.key)).map(pc => pc.parts)));
    const cx = (core[0] + core[2]) / 2, held = pieces.find(pc => pc.key === 'balloon');
    let side = facing === 'left' ? 1 : facing === 'right' ? -1 : rnd() < 0.5 ? 1 : -1;
    if (held) { const hb = boundsOf(held.parts); side = (hb[0] + hb[2]) / 2 > cx ? -1 : 1; }
    for (const pc of pieces) {
      if (!FREE.includes(pc.key)) continue;
      const b = boundsOf(pc.parts);
      if (pc.key === 'tree' || pc.key === 'house') { translate(pc, side > 0 ? core[2] + 1.0 - b[0] : core[0] - 1.0 - b[2], Math.max(0, core[3]) - b[3]); rel.push({ type: side > 0 ? 'right of' : 'left of', a: pc.key, b: rec.character, contact: false }); }
      else if (pc.key === 'sun') { translate(pc, side > 0 ? core[2] + 0.5 - b[0] : core[0] - 0.5 - b[2], core[1] - 0.6 - b[1]); rel.push({ type: 'above ' + (side > 0 ? 'right' : 'left'), a: 'sun', b: rec.character, contact: false }); }
      else if (pc.key === 'cloud') { const hb = boundsOf(pieces.find(q => q.kind === 'character').parts), hx = (hb[0] + hb[2]) / 2; translate(pc, hx + side * (hb[2] - hb[0]) * 0.45 - (b[0] + b[2]) / 2, hb[1] - 0.9 - b[3]); rel.push({ type: 'above', a: 'cloud', b: rec.character, contact: false }); }
      else if (pc.key === 'rain') {
        const um = pieces.find(q => q.key === 'umbrella'), tb = um ? boundsOf(um.parts.filter(p => p.part === 'canopy')) : core;
        translate(pc, (tb[0] + tb[2]) / 2 - (b[0] + b[2]) / 2, tb[1] - 0.5 - b[3]);
        rel.push({ type: 'above', a: 'rain', b: um ? 'umbrella' : rec.character, contact: false });
      }
    }
  }
  // drop parts of one need level, the last drawn first and left/right pairs together, until the doodle fits
  const STEM = /^(left|right|upper|lower|front|back|top|bottom|small|big|middle) /;
  function trimTo(pieces, max, need) {
    const total = () => pieces.reduce((n, pc) => n + pc.parts.length, 0), cand = [];
    pieces.forEach(pc => pc.parts.forEach(p => { if (p.need === need) cand.push([pc, p]); }));
    while (total() > max && cand.length) {
      const [pc, p] = cand.pop(), stem = p.part.replace(STEM, '');
      const drop = [[pc, p]].concat(cand.filter(([qc, q]) => qc === pc && q.part.replace(STEM, '') === stem));
      for (const t of drop) { const i = cand.indexOf(t); if (i >= 0) cand.splice(i, 1); t[0].parts.splice(t[0].parts.indexOf(t[1]), 1); }
    }
    return total();
  }
  // scale and centre a set of pieces on the board, keeping a margin; a little low, as if standing on the ground
  function fitPieces(pieces, maxScale, margin) {
    const all = [].concat(...pieces.map(pc => pc.parts));
    let [x0, y0, x1, y1] = boundsOf(all);
    const room = BOARD - 2 * margin, s = Math.min(room / (x1 - x0), room / (y1 - y0), maxScale);
    pieces.forEach(pc => scaleBy(pc, s, 0, 0));
    [x0, y0, x1, y1] = boundsOf(all);
    const dx = BOARD / 2 - (x0 + x1) / 2, dy = BOARD / 2 - (y0 + y1) / 2 + Math.min(1.0, (room - (y1 - y0)) / 2);
    pieces.forEach(pc => translate(pc, dx, dy));
    return s;
  }

  function makeDoodle(seed, level, force) {
    const lvl = [1, 2, 3].includes(level) ? level : 2, ch = (force && force.character) || characterFor(seed, lvl);
    let first = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const d = attemptDoodle(seed, lvl, ch, attempt, force);
      if (!first) first = d;
      if (d.validation.ok) return d;
    }
    return first;
  }
  function attemptDoodle(seed, lvl, ch, attempt, force) {
    const rnd = mulberry32((Math.imul(seed >>> 0, 2654435761) ^ Math.imul(lvl, 0x9E3779B9) ^ Math.imul(attempt + 1, 0x85EBCA6B)) >>> 0);
    const C = CHARACTERS[ch], rec = Object.assign(chooseRecipe(rnd, lvl, ch), force || {}), max = BUDGET[lvl][1];
    const v = { fat: 0.92 + rnd() * 0.18, coat: pick(['orange', 'grey', 'tan'], rnd) };
    const facing = C.view === 'side' ? (rnd() < 0.5 ? 'right' : 'left') : null, sub = (rnd() * 4294967296) >>> 0;
    let { pieces, rel } = compose(rec, v, facing, mulberry32(sub));
    let n = trimTo(pieces, max, 4);
    if (n > max && rec.extra) { rec.extra = null; ({ pieces, rel } = compose(rec, v, facing, mulberry32(sub))); n = trimTo(pieces, max, 4); }
    if (n > max) trimTo(pieces, max, 3);
    rec.wear = rec.wear || rec.extra; delete rec.extra;
    placeFree(pieces, rel, rec, facing, mulberry32(sub + 1));
    const scale = fitPieces(pieces, lvl === 1 ? 1.75 : 1.6, 1.2);
    return finish(seed, lvl, attempt, rec, facing, pieces, rel, scale);
  }

  // ids, rounding, groups, captions, key details, attachments and complexity
  function finish(seed, lvl, attempt, rec, facing, pieces, rel, scale) {
    const C = CHARACTERS[rec.character], parts = [];
    let n = 0;
    for (const pc of pieces) for (const p of pc.parts) {
      p.id = `c${++n}`; p.group = `${pc.key}/${p.part}`; p.role = pc.kind;
      for (const k of ['x', 'y', 'w', 'h', 'r', 'x1', 'y1', 'x2', 'y2', 'a0', 'a1']) if (p[k] !== undefined) p[k] = r2(p[k]);
      if (p.kind !== 'line') p.r = r2((((p.r % 360) + 540) % 360) - 180);
      parts.push(p);
    }
    const groups = pieces.map(pc => ({ id: pc.key, kind: pc.kind, name: pc.name, parts: pc.parts.map(p => p.id), bounds: boundsOf(pc.parts).map(r2) }));
    for (const g of groups) {
      const [gx0, gy0, gx1, gy1] = g.bounds, own = parts.filter(p => g.parts.includes(p.id));
      for (const p of own) {
        p.rel = [r2((p.x - gx0) / Math.max(0.01, gx1 - gx0)), r2((p.y - gy0) / Math.max(0.01, gy1 - gy0))];
        // attached to: the nearest bigger filled component of the same object that it touches
        let best = null, bd = Infinity;
        for (const q of own) {
          if (q === p || !['ellipse', 'rect', 'tri', 'semi'].includes(q.kind) || q.w * q.h <= p.w * p.h * 1.05) continue;
          const dd = Math.hypot(q.x - p.x, q.y - p.y) / Math.max(q.w, q.h);
          if (dd < bd && touches(p, q)) { bd = dd; best = q; }
        }
        p.attachedTo = best ? best.id : null;
      }
    }
    const d = { seed, level: lvl, attempt, caption: captionOf(rec, C), recipe: rec, facing, scale: r2(scale), parts, groups, relations: rel, keyDetails: detailsOf(rec, C, parts, facing) };
    d.complexity = complexityOf(d);
    d.validation = validate(d);
    return d;
  }
  function touches(p, q) {
    const pts = outline(p, 24);
    if (pts.some(([x, y]) => inside(q, x, y))) return true;
    const qs = outline(q, 24);
    for (const [x, y] of pts) for (const [u, w] of qs) if (Math.hypot(x - u, y - w) < 0.3) return true;
    return false;
  }
  const article = w => (/^[aeiou]/.test(w) ? 'an' : 'a');
  function captionOf(rec, C) {
    const acts = [];
    if (rec.ride) acts.push(RIDES[rec.ride].phrase);
    if (rec.pose === 'sit') acts.push('sitting on a bench');
    if (rec.pose === 'dance') acts.push('dancing');
    if (rec.pose === 'jump') acts.push('jumping');
    if (rec.pose === 'wave') acts.push('waving');
    if (rec.hold) acts.push(C.holdWith === 'tail' ? 'with a balloon tied to its tail' : ACCESSORIES[rec.hold].phrase);
    let s = `${article(C.name)} ${C.name}`;
    if (acts.length) s += ' ' + acts.join(' and ');
    if (rec.wear) s += (acts.length ? ', ' : ' ') + ACCESSORIES[rec.wear].phrase;
    const set = rec.scenery.map(k => SCENERY[k].setting).filter(Boolean);
    if (set.length) s += (rec.wear && acts.length ? ', ' : ' ') + set.join(' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function detailsOf(rec, C, parts, facing) {
    const out = C.details.slice();
    if (facing) out.push(`facing ${facing}`);
    if (rec.wear) out.push(ACCESSORIES[rec.wear].detail);
    if (rec.hold) out.push(C.holdWith === 'tail' ? 'a balloon tied to its tail' : ACCESSORIES[rec.hold].detail);
    if (rec.ride) out.push(RIDES[rec.ride].detail);
    if (rec.pose === 'wave') out.push('one arm up, waving');
    if (rec.pose === 'jump') out.push('in the air, with motion lines under it');
    if (rec.pose === 'dance') out.push('leaning over, arms up, a music note');
    if (rec.pose === 'sit') out.push('sitting on a long bench');
    if (rec.scenery.includes('rain')) out.push('raindrops falling on the umbrella');
    for (const k of ['tree', 'house', 'sun', 'cloud']) if (rec.scenery.includes(k)) out.push(`${article(SCENERY[k].name)} ${SCENERY[k].name} ${k === 'sun' || k === 'cloud' ? 'up in the sky' : 'beside it'}`);
    return out;
  }

  // ---------- complexity: how much there is to remember
  // Each component counts by kind (a dot is a small thing to remember, a turned shape a bigger one); each object and
  // each contact between objects adds to it.
  const KIND_INFO = { ellipse: 1, rect: 1, tri: 1.2, semi: 1.2, line: 0.7, arc: 1.1, dot: 0.4 };
  function complexityOf(d) {
    let info = 0;
    for (const p of d.parts) { const m = ((p.r % 90) + 90) % 90; info += KIND_INFO[p.kind] + (p.kind !== 'dot' && p.kind !== 'line' && m > 8 && m < 82 ? 0.3 : 0); }
    const contacts = d.relations.filter(r => r.contact).length;
    info += d.groups.length * 0.75 + contacts;
    return { components: d.parts.length, objects: d.groups.length, contacts, info: r2(info) };
  }

  // ---------- validation
  // Shapes are rasterised on a 0.1-unit grid: filled shapes by their area; lines, arcs and outline-only shapes as a band.
  const GRID = 200, CELL = BOARD / GRID;
  function inside(p, X, Y) {
    const c = Math.cos(rad(p.r)), s = Math.sin(rad(p.r)), dx = X - p.x, dy = Y - p.y, x = dx * c + dy * s, y = -dx * s + dy * c, a = p.w / 2, b = p.h / 2;
    if (p.kind === 'ellipse' || p.kind === 'dot') return (x * x) / (a * a) + (y * y) / (b * b) <= 1;
    if (p.kind === 'rect') return Math.abs(x) <= a && Math.abs(y) <= b;
    if (p.kind === 'tri') return y >= -b && y <= b && Math.abs(x) <= (a * (y + b)) / (2 * b);
    if (p.kind === 'semi') return y <= b && (x * x) / (a * a) + ((y - b) * (y - b)) / (p.h * p.h) <= 1;
    return false;
  }
  function segDist(px, py, ax, ay, bx, by) { const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0; return Math.hypot(px - ax - t * vx, py - ay - t * vy); }
  const isStroke = p => p.kind === 'line' || p.kind === 'arc' || (p.fill === null && p.kind !== 'dot');
  function mask(p) {
    const m = new Uint8Array(GRID * GRID), [x0, y0, x1, y1] = boundsOf([p]), band = 0.12;
    const c0 = Math.max(0, Math.floor((x0 - band) / CELL)), c1 = Math.min(GRID - 1, Math.ceil((x1 + band) / CELL)), r0 = Math.max(0, Math.floor((y0 - band) / CELL)), r1 = Math.min(GRID - 1, Math.ceil((y1 + band) / CELL));
    const pts = isStroke(p) ? outline(p, 64) : null;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const X = (c + 0.5) * CELL, Y = (r + 0.5) * CELL;
      let on = false;
      if (pts) { for (let i = 1; i < pts.length && !on; i++) on = segDist(X, Y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= band; }
      else on = inside(p, X, Y);
      if (on) m[r * GRID + c] = 1;
    }
    return m;
  }
  const count = m => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]; return n; };
  const INFO = { 1: [4.5, 10.5], 2: [7.5, 17.5], 3: [10.5, 22] };
  function validate(d) {
    const issues = [], add = (check, msg) => issues.push({ check, msg }), M = 0.3;
    const masks = d.parts.map(mask), byId = {};
    d.parts.forEach((p, i) => { byId[p.id] = i; });
    // 1. clipping: every component stays on the board with a 0.3-unit margin
    for (const p of d.parts) { const [x0, y0, x1, y1] = boundsOf([p]); if (x0 < M || y0 < M || x1 > BOARD - M || y1 > BOARD - M) add('clipping', `${p.group} runs off the board`); }
    // 2. overlap: objects that are not meant to touch may not cover more than 3% of the smaller one
    const om = {};
    for (const g of d.groups) { const m = new Uint8Array(GRID * GRID); for (const id of g.parts) { const pm = masks[byId[id]]; for (let i = 0; i < m.length; i++) if (pm[i]) m[i] = 1; } om[g.id] = m; }
    const contact = (a, b) => d.relations.some(r => r.contact && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    for (let i = 0; i < d.groups.length; i++) for (let j = i + 1; j < d.groups.length; j++) {
      const a = d.groups[i].id, b = d.groups[j].id;
      if (contact(a, b)) continue;
      const A = om[a], Bm = om[b]; let both = 0; for (let k = 0; k < A.length; k++) if (A[k] && Bm[k]) both++;
      const small = Math.min(count(A), count(Bm));
      if (small && both / small > 0.03) add('overlap', `${a} and ${b} overlap (${Math.round((100 * both) / small)}% of the smaller)`);
    }
    // 3. sense: what is worn, held, ridden or sat on touches the character where it should
    for (const r of d.relations) {
      if (!r.contact) continue;
      const A = om[r.a], Bm = om[r.b];
      let touch = false; for (let k = 0; k < A.length && !touch; k++) if (A[k] && Bm[k]) touch = true;
      if (!touch) add('sense', `the ${r.b} does not touch the ${r.a}'s ${r.on}`);
    }
    // 4. readability: the main character is the biggest thing and fills a good part of the board; nothing is too small
    //    to see or draw; dots are not crowded; every remembered part shows at least 40% when shapes are filled in order
    const chg = d.groups.find(g => g.kind === 'character'), [cx0, cy0, cx1, cy1] = chg.bounds, big = Math.max(cx1 - cx0, cy1 - cy0);
    if (big < (d.level === 3 ? 7 : 9.5)) add('readability', `the ${chg.name} is only ${r2(big)} units across`);
    for (const g of d.groups) { if (g === chg || g.id === 'bench') continue; const [x0, y0, x1, y1] = g.bounds; if ((x1 - x0) * (y1 - y0) > 1.15 * (cx1 - cx0) * (cy1 - cy0)) add('readability', `the ${g.name} is bigger than the ${chg.name}`); }
    for (const p of d.parts) {
      if (p.kind === 'dot' && p.w / 2 < 0.17) add('readability', `${p.group} is a dot under 0.17 units`);
      if ((p.kind === 'line' || p.kind === 'arc') && p.w < 0.5) add('readability', `${p.group} is shorter than 0.5 units`);
      if (['ellipse', 'rect', 'tri', 'semi'].includes(p.kind) && Math.min(p.w, p.h) < 0.3) add('readability', `${p.group} is thinner than 0.3 units`);
    }
    const dots = d.parts.filter(p => p.kind === 'dot');
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) { const g = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y) - dots[i].w / 2 - dots[j].w / 2; if (g < 0.3) add('readability', `${dots[i].group} and ${dots[j].group} are crowded`); }
    const top = new Int16Array(GRID * GRID).fill(-1);
    d.parts.forEach((p, k) => { const m = masks[k]; for (let i = 0; i < m.length; i++) if (m[i]) top[i] = k; });
    const largest = {};
    d.parts.forEach(p => { if (!isStroke(p) && (!largest[p.object] || p.w * p.h > largest[p.object].w * largest[p.object].h)) largest[p.object] = p; });
    d.parts.forEach((p, k) => {
      if (p.need > 2 || largest[p.object] === p) return;
      const m = masks[k]; let own = 0, shown = 0; for (let i = 0; i < m.length; i++) if (m[i]) { own++; if (top[i] === k) shown++; }
      if (own && shown / own < 0.4) add('readability', `${p.group} is mostly hidden (${Math.round((100 * shown) / own)}% shows)`);
    });
    // 5. complexity: components and the amount to remember suit the level; a hard doodle has an action, object or scene
    const [lo, hi] = BUDGET[d.level], c = d.complexity;
    if (c.components < lo || c.components > hi) add('complexity', `${c.components} components (level ${d.level} wants ${lo}-${hi})`);
    if (c.info < INFO[d.level][0] || c.info > INFO[d.level][1]) add('complexity', `information ${c.info} (level ${d.level} wants ${INFO[d.level].join('-')})`);
    if (d.level === 1 && d.groups.length !== 1) add('complexity', 'an easy doodle is one character alone');
    if (d.level === 3 && d.groups.length < 2 && d.recipe.pose === 'stand') add('complexity', 'a hard doodle needs an action, an object or a scene');
    return { ok: !issues.length, issues };
  }

  // ---------- grading view: the components in the freehand grader's own shape format
  // Lines become thin bars, which one drawn line matches; arcs and dots have no grader kind yet and are listed apart.
  function gradeScene(d) {
    const shapes = [], unsupported = [];
    for (const p of d.parts) {
      if (p.grade === 'arc' || p.grade === 'dot') { unsupported.push(p.id); continue; }
      const base = { id: p.id, part: p.part, object: p.object };
      shapes.push(Object.assign(base, p.kind === 'line' ? { t: 'square', x: p.x, y: p.y, w: p.w, h: 0.3, r: p.r } : { t: p.grade, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r }));
    }
    return { shapes, unsupported };
  }

  // one template on its own, fitted to the board, for the catalog
  function templateDoodle(type, key, pose) {
    const piece = buildPiece(type, key, { fat: 1, coat: 'orange' }, pose || 'stand', type === 'accessory' ? 2.4 : 4);
    fitPieces([piece], type === 'character' ? 1.75 : 2.6, 2);
    let n = 0;
    piece.parts.forEach(p => { p.id = `c${++n}`; p.group = `${key}/${p.part}`; });
    return { key, type, name: piece.name, parts: piece.parts };
  }

  const api = { inside, isStroke, BOARD, GRADE, NEED, CHARACTERS, ACCESSORIES, RIDES, SCENERY, TEMPLATE_COUNT, BUDGET, INFO, makeDoodle, attemptDoodle, characterFor, validate, outline, boundsOf, gradeScene, templateDoodle, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AfterimageDoodles = api;
})(this);
