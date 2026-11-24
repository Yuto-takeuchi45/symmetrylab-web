// 案B 背景アニメーション：1 屈折グリッド ＋ 2 コースティクス（光の模様）
// （比較用の pattern-b-bg/bg.js から、採用した組み合わせだけを固定で使う）
const MODES = [
  { id: '0', label: 'なし' },
  { id: '1', label: '1 屈折グリッド' },
  { id: '2', label: '2 光の模様' },
  { id: '3', label: '3 ドットグリッド' },
  { id: '4', label: '4 グラデーション' },
  { id: '5', label: '5 対称軸' },
  { id: '12', label: '1＋2' }
];
const DEFAULT = '12';

// 画面全体を覆う板（行列を使わず、常に一番奥に描く）
const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }`;

const GRID_FRAG = /* glsl */`
  uniform vec2 uRes; uniform float uScroll, uPix;
  void main() {
    vec2 p = gl_FragCoord.xy; p.y += uScroll * .35 * uPix;
    float s = 64. * uPix;
    vec2 g = abs(mod(p + s * .5, s) - s * .5);
    float line = step(min(g.x, g.y), .6 * uPix);
    vec2 G = abs(mod(p + s * 2., s * 4.) - s * 2.);
    float major = step(min(G.x, G.y), .9 * uPix);
    if (line + major < .5) discard;
    gl_FragColor = vec4(mix(vec3(.86, .9, .92), vec3(.74, .81, .85), major), 1.);
  }`;

const FX_FRAG = /* glsl */`
  uniform vec2 uRes, uMouse, uLogo; uniform float uTime, uPix, uScroll, uVel, uLogoR;
  uniform float uCaustic, uDots, uGrad;
  varying vec2 vUv;
  float caustic(vec2 uv, float time) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.;
    vec2 i = p; float c = 1.; float inten = .005;
    for (int n = 0; n < 5; n++) {
      float t = time * (1. - (3.5 / float(n + 1)));
      i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
      c += 1. / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
    }
    c /= 5.; c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.), 0., 1.);
  }
  vec3 tif = vec3(.212, .788, .902);
  void main() {
    vec2 frag = gl_FragCoord.xy / uPix;
    vec2 res = uRes;
    float asp = res.x / res.y;
    vec4 col = vec4(0.);

    // 4 にじむグラデーション（ゆっくり流れる色の溜まり）
    if (uGrad > .5) {
      vec2 q = vUv; q.x *= asp;
      float t = uTime * .06 + uScroll * .0002;
      vec2 c1 = vec2(asp * (.75 + .18 * sin(t * 1.3)), .7 + .2 * cos(t * 1.1));
      vec2 c2 = vec2(asp * (.2 + .15 * cos(t * .9)), .25 + .2 * sin(t * 1.4));
      vec2 c3 = vec2(asp * (.5 + .3 * sin(t * .7 + 2.)), .5 + .3 * cos(t * .8 + 1.));
      vec2 w = q + .08 * vec2(sin(q.y * 3. + t * 4.), cos(q.x * 3. - t * 3.));
      float b1 = exp(-pow(length(w - c1) / .55, 2.));
      float b2 = exp(-pow(length(w - c2) / .5, 2.));
      float b3 = exp(-pow(length(w - c3) / .4, 2.));
      vec3 g = vec3(.965, .973, .976);
      g = mix(g, vec3(.70, .92, .96), b1 * .85);
      g = mix(g, vec3(.80, .85, .88), b2 * .8);
      g = mix(g, vec3(.85, .96, .98), b3 * .7);
      col = vec4(g, 1.);
    }

    // 3 マウスに反応するドットグリッド
    if (uDots > .5) {
      float s = 24.;
      vec2 cell = floor(frag / s) * s + s * .5;
      vec2 m = vec2(uMouse.x, res.y - uMouse.y);
      float d = length(cell - m);
      float near = exp(-d / 140.);
      float ripple = sin(d * .045 - uTime * 3.2) * exp(-d / 320.) * (.35 + uVel * 3.);
      float r = .9 + near * 2.4 + max(ripple, 0.) * 1.4;
      vec2 off = normalize(cell - m + .001) * near * 6.;
      float dd = length(frag - cell - off);
      float a = smoothstep(r + .6, r - .4, dd);
      vec3 c = mix(vec3(.12, .16, .22), tif, clamp(near * 1.6 + max(ripple, 0.) * .6, 0., 1.));
      float alpha = a * (.16 + near * .6 + max(ripple, 0.) * .25);
      col.rgb = col.a > 0. ? mix(col.rgb, c, alpha) : c; col.a = max(col.a, alpha);
    }

    // 2 ロゴが落とす光の模様（ロゴの右下に揺らめく）
    if (uCaustic > .5) {
      vec2 lp = uLogo + vec2(.05, -.12);
      vec2 dv = (vUv - lp) * vec2(asp, 1.);
      float mask = exp(-pow(length(dv * vec2(.8, 1.25)) / uLogoR, 2.));
      vec2 cuv = vUv * vec2(asp, 1.) * 1.6;
      float c = caustic(cuv, uTime * .55);
      float c2 = caustic(cuv * 1.3 + 3.1, uTime * .4 + 2.);
      float k = pow(clamp(c * 1.1 + c2 * .7, 0., 1.), 2.6) * mask * 1.4;
      float glow = mask * .1;
      float alpha = clamp(k * .95 + glow, 0., .9);
      // 計算が破綻した（NaN になった）画素は描かない。GPUによっては NaN が「最大の濃さ」として扱われ、
      // 画面全体が一瞬水色に塗られるため
      if (!(alpha >= 0.) || !(mask >= 0.)) alpha = 0.;
      vec3 cc = mix(vec3(.55, .9, .97), tif, .6);
      col.rgb = col.a > 0. ? mix(col.rgb, cc, alpha) : cc; col.a = max(col.a, alpha);
    }
    if (col.a < .002) discard;
    gl_FragColor = col;
  }`;

export function initBg({ THREE, renderer, scene, camera, mark, matT, fixed = null }) {
  const pix = () => renderer.getPixelRatio();
  const quad = new THREE.PlaneGeometry(2, 2);
  const res = new THREE.Vector2(innerWidth, innerHeight);
  const mouse = new THREE.Vector2(innerWidth * .7, innerHeight * .5);
  addEventListener('pointermove', e => mouse.set(e.clientX, e.clientY));
  addEventListener('resize', () => res.set(innerWidth, innerHeight));

  const gridMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: GRID_FRAG, uniforms: { uRes: { value: res }, uScroll: { value: 0 }, uPix: { value: pix() } }, depthWrite: false });
  const grid = new THREE.Mesh(quad, gridMat); grid.frustumCulled = false; grid.renderOrder = -10;

  const fxMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uRes: { value: res }, uMouse: { value: mouse }, uLogo: { value: new THREE.Vector2(.5, .5) }, uLogoR: { value: .3 },
      uTime: { value: 0 }, uPix: { value: pix() }, uScroll: { value: 0 }, uVel: { value: 0 },
      uCaustic: { value: 0 }, uDots: { value: 0 }, uGrad: { value: 0 }
    }
  });
  const fx = new THREE.Mesh(quad, fxMat); fx.frustumCulled = false; fx.renderOrder = -5;
  scene.add(grid, fx);

  // 1：帯もガラスにして、背景の線がロゴ越しに曲がって見えるようにする
  const orig = { transmission: matT.transmission, thickness: matT.thickness, roughness: matT.roughness, ior: matT.ior };
  const glassT = on => {
    matT.transmission = on ? .6 : orig.transmission;
    matT.thickness = on ? 3.2 : orig.thickness;
    matT.ior = on ? 1.75 : orig.ior;
    matT.roughness = on ? .08 : orig.roughness;
    matT.needsUpdate = true;
  };

  // 5：点対称の軸線・切り替えバー（比較用。fixed 指定時は作らない）
  let mode = '';
  const axis = document.createElement('div');
  axis.className = 'bg-axis';
  axis.innerHTML = '<i class="ax-line"></i><i class="ax-head"></i><i class="ax-pair"><b></b><b></b></i>';
  const axLine = axis.querySelector('.ax-line'), axHead = axis.querySelector('.ax-head'), axPair = axis.querySelector('.ax-pair');
  const bar = document.createElement('div');
  bar.className = 'bg-switch';
  bar.innerHTML = '<span>背景</span>' + MODES.map(m => `<button type="button" data-bg="${m.id}">${m.label}</button>`).join('');
  const setMode = id => {
    if (!MODES.some(m => m.id === id)) id = DEFAULT;
    mode = id;
    bar.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.bg === id));
    grid.visible = id.includes('1');
    fxMat.uniforms.uCaustic.value = id.includes('2') ? 1 : 0;
    fxMat.uniforms.uDots.value = id === '3' ? 1 : 0;
    fxMat.uniforms.uGrad.value = id === '4' ? 1 : 0;
    fx.visible = /[234]/.test(id);
    glassT(id.includes('1'));
    axis.classList.toggle('is-on', id === '5');
  };
  if (fixed) setMode(fixed);
  else {
    document.body.append(axis, bar);
    const fromHash = () => setMode((location.hash.match(/^#bg-(\d+)$/) || [])[1] || DEFAULT);
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      history.replaceState(null, '', '#bg-' + b.dataset.bg);
      setMode(b.dataset.bg);
    });
    addEventListener('hashchange', fromHash);
    fromHash();
  }

  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  return (t, vel) => {
    const u = fxMat.uniforms;
    u.uTime.value = t; u.uScroll.value = scrollY; u.uVel.value = Math.min(Math.abs(vel) * 4, 1);
    u.uPix.value = gridMat.uniforms.uPix.value = pix();
    gridMat.uniforms.uScroll.value = scrollY;
    // ロゴの画面上の位置と大きさ
    v.copy(mark.position).project(camera);
    v2.copy(mark.position).add(new THREE.Vector3(mark.scale.x * 1.2, 0, 0)).project(camera);
    const logoR = Math.abs(v2.x - v.x) * .5 * (innerWidth / innerHeight) * 1.25;
    // 画面サイズが一時的に0になる瞬間などは計算結果が数値にならない。その場合は前の値のまま描く
    // （Math.max は NaN をそのまま返すため、ここで弾かないと光の模様が画面全体に広がる）
    if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(logoR)) {
      u.uLogo.value.set(v.x * .5 + .5, v.y * .5 + .5);
      u.uLogoR.value = Math.max(.12, logoR);
    }
    if (mode === '5') {
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? scrollY / max : 0;
      axLine.style.transform = `scaleY(${p})`;
      axHead.style.top = `${p * 100}%`;
      axPair.style.transform = `translate(-50%, -50%) rotate(${p * 540 + t * 6}deg)`;
    }
  };
}
