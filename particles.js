// 案B（粒子版）のロゴ：案Aの粒子の仕組みを、案Bのレイアウト（ロゴが画面の右側に寄る）に合わせて小さくまとめたもの
// 粒子が「ばらばら → ロゴ」に集まり、スクロールで場面ごとの形へ移り変わる
import { MARK } from './mark-data.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createParticleLogo(THREE, { mobile }) {
  const N = mobile ? 24000 : 16000;
  const make = fn => {
    const pos = new Float32Array(N * 3), col = new Float32Array(N);
    for (let i = 0; i < N; i++) { const [x, y, z, c] = fn(i); pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; col[i] = c; }
    return { pos: new THREE.BufferAttribute(pos, 3), col: new THREE.BufferAttribute(col, 1) };
  };

  // どの形も原点を中心に、ロゴと同じくらいの大きさ（およそ ±1.2）に収める
  const states = {
    chaos: make(() => [gauss() * 3 + 1, gauss() * 2, gauss() * 2.5, Math.random() < .3 ? 1 : .2]),
    // ロゴ：水色の帯とグレーの三角を、ロゴの形のまま粒子で埋める
    mark: make(i => {
      if (i % 14 === 0) return [gauss() * 1.6, gauss() * 1.4, gauss() * 1.2, .15];
      for (;;) {
        const x = rnd(-.9, .9), y = rnd(-1.02, 1.02);
        for (const p of MARK.tiffany) if (inPoly(x, y, p)) return [x, y, gauss() * .05, 1];
        for (const p of MARK.grey) if (inPoly(x, y, p)) return [x, y, gauss() * .05, 0];
      }
    }),
    // Mission：左はばらばら、右はそれを鏡に映して格子にそろえた秩序
    split: make(i => {
      const x = -Math.abs(gauss() * .7) - .15, y = gauss() * .6 + Math.sin(x * 3) * .15, z = gauss() * .5;
      return i % 2 ? [x - Math.random() * .3, y, z * .6, .3] : [Math.round(-x * 6) / 6 + .15, Math.round(y * 6) / 6, Math.round(z * 3) / 6, 1];
    }),
    // 事業の導入：3つの事業を表す、傾きの違う3つの輪
    three: make(i => {
      const k = i % 3, a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2;
      const R = .62, r = .03 + Math.abs(gauss()) * .03;
      const x = (R + r * Math.cos(b)) * Math.cos(a), y = (R + r * Math.cos(b)) * Math.sin(a), z = r * Math.sin(b);
      const tilt = [.35, .55, .75][k], y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
      return [x, y2 + (1 - k) * .95, z2, k === 1 ? 1 : .55];
    }),
    // 経営・戦略：枝分かれする論点ツリー
    strategy: (() => {
      const nodes = [[-1.2, 0, 0, -1]];
      const grow = (pi, lv) => {
        if (lv > 3) return;
        const [px, py, pz] = nodes[pi], spread = [.8, .45, .25][lv - 1];
        for (let c = 0; c < 2; c++) { nodes.push([px + .72, py + (c ? 1 : -1) * spread, pz + (c ? .2 : -.2) * (4 - lv) * .35, pi]); grow(nodes.length - 1, lv + 1); }
      };
      grow(0, 1);
      const edges = nodes.slice(1);
      return make(i => {
        if (i % 4 === 0) { const n = nodes[i % nodes.length]; return [n[0] + gauss() * .03, n[1] + gauss() * .03, n[2] + gauss() * .03, 1]; }
        const e = edges[i % edges.length], p = nodes[e[3]], t = Math.random(), s = t * t * (3 - 2 * t);
        return [p[0] + (e[0] - p[0]) * t, p[1] + (e[1] - p[1]) * s, p[2] + (e[2] - p[2]) * s, .35 + t * .3];
      });
    })(),
    // システム開発：ノードと配線でできた立方格子
    tech: make(i => {
      const n = 4, sp = .5, c = (n - 1) / 2;
      const gx = Math.floor(Math.random() * n), gy = Math.floor(Math.random() * n), gz = Math.floor(Math.random() * n);
      const P = [(gx - c) * sp, (gy - c) * sp, (gz - c) * sp];
      if (i % 3 === 0) { const hot = (gx + gy * 2 + gz * 3) % 5 === 0; return [P[0] + (Math.random() - .5) * .09, P[1] + (Math.random() - .5) * .09, P[2] + (Math.random() - .5) * .09, hot ? 1 : .6]; }
      const ax = i % 3 === 1 ? 0 : (Math.random() < .5 ? 1 : 2), q = [...P];
      if (P[ax] / sp + c < n - 1) q[ax] += Math.random() * sp; else q[ax] -= Math.random() * sp;
      return [q[0], q[1], q[2], .25];
    }),
    // 転職支援：上へ伸びていく螺旋階段
    career: make(i => {
      const steps = 14, k = i % steps, a = k * .52, y = -1.3 + k * .19;
      if (i % 9 === 0) return [Math.cos(a) * .06 * gauss(), -1.3 + Math.random() * 2.8, Math.sin(a) * .06 * gauss(), .25];
      const t = Math.random() - .5, d = Math.random() - .5, r = .8 + d * .3, aa = a + t * .42;
      return [Math.cos(aa) * r, y + (Math.random() - .5) * .04, Math.sin(aa) * r, .35 + k / steps * .65];
    }),
    // 講座：ふたつのプログラムを表す、左右の球
    twin: make(i => {
      const k = i % 2, n = Math.floor(i / 2), M = N / 2;
      const phi = Math.acos(1 - 2 * (n + .5) / M), th = Math.PI * (1 + Math.sqrt(5)) * n;
      const r = .62 + (Math.random() < .1 ? Math.random() * .3 : 0), cx = mobile ? 0 : (k ? 1.2 : -1.2), cy = mobile ? (k ? -.8 : .8) : 0;
      return [cx + r * Math.sin(phi) * Math.cos(th), cy + r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th), k ? .55 : 1];
    }),
    // 選ばれる理由：二重螺旋
    helix: make(i => {
      const k = i % 2, t = Math.random(), a = t * Math.PI * 5 + k * Math.PI, r = .55 + gauss() * .03, h = 2.8;
      if (Math.random() < .12) { const tt = Math.floor(t * 20) / 20, aa = tt * Math.PI * 5, s = Math.random() * 2 - 1; return [Math.cos(aa) * r * s, (tt - .5) * h, Math.sin(aa) * r * s, .4]; }
      return [Math.cos(a) * r, (t - .5) * h, Math.sin(a) * r, k ? 1 : .55];
    }),
    // 支援実績：球殻
    sphere: make(i => {
      const phi = Math.acos(1 - 2 * (i + .5) / N), th = Math.PI * (1 + Math.sqrt(5)) * i, r = 1.1 + gauss() * .03;
      return [r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th), Math.random() < .3 ? 1 : .35];
    })
  };

  const geo = new THREE.BufferGeometry();
  const rand = new Float32Array(N); for (let i = 0; i < N; i++) rand[i] = Math.random();
  geo.setAttribute('position', states.mark.pos);
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  let pairKey = '';
  const setPair = (a, b) => {
    const k = a + '>' + b; if (k === pairKey) return; pairKey = k;
    geo.setAttribute('aFrom', states[a].pos); geo.setAttribute('aFromC', states[a].col);
    geo.setAttribute('aTo', states[b].pos); geo.setAttribute('aToC', states[b].col);
  };
  setPair('chaos', 'mark');

  // 明るい背景の上に置くので、加算ではなく通常の重ね方で、ロゴの色そのものを出す
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uT: { value: 0 }, uTime: { value: 0 }, uPix: { value: 1 }, uSize: { value: mobile ? 24 : 42 }, uVel: { value: 0 },
      uA: { value: new THREE.Color(0x36C9E6) }, uB: { value: new THREE.Color(0x9AAFBA) }
    },
    vertexShader: /* glsl */`
      attribute vec3 aFrom; attribute vec3 aTo; attribute float aFromC; attribute float aToC; attribute float aRand;
      uniform float uT, uTime, uPix, uSize, uVel;
      varying float vC; varying float vA;
      void main() {
        float d = aRand * .35;
        float t = smoothstep(d, d + .65, uT);
        vec3 p = mix(aFrom, aTo, t);
        float burst = sin(t * 3.14159);
        vec3 swirl = vec3(sin(aRand * 40. + uTime * .8), cos(aRand * 23. + uTime * .6), sin(aRand * 17. + uTime * .5));
        p += swirl * (burst * 1.6 + .05 + uVel * 1.4);
        vC = mix(aFromC, aToC, t);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uPix * (.45 + aRand * .9) / -mv.z;
        vA = .7 + .3 * sin(uTime * 1.5 + aRand * 60.);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA, uB; varying float vC; varying float vA;
      void main() {
        float r = length(gl_PointCoord - .5);
        if (r > .5) discard;
        float a = smoothstep(.5, .15, r);
        vec3 c = mix(uB, uA, smoothstep(.0, 1., vC));
        gl_FragColor = vec4(c, a * vA * (.7 + vC * .25));
      }`
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  // from→to を t で。粒子の大きさは画面の解像度に合わせる
  function update(from, to, t, time, vel, pix) {
    setPair(from, to);
    const u = mat.uniforms;
    u.uT.value = from === to ? 1 : t; u.uTime.value = time; u.uVel.value = Math.min(Math.abs(vel) * 10, 1); u.uPix.value = pix;
  }
  return { points, update };
}
