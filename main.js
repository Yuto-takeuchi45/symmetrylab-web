// Pattern B — Point Symmetry
// ロゴマーク（ティファニーの帯×2 + グレーの三角×2）を3D化。
// スクロールで「組み上がる → 180°回転（点対称） → 2つに分かれる（2プログラム） → 分解図 → 再結合」
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createParticleLogo } from './particles.js';
import { WORKS } from './works-data.js';
import { initFx, splitReveal, magnetic, textRoll, highlightOnScroll } from './fx.js';
import { initChapter } from './chapter.js';
import { initBg } from './bg.js?v=20261124-04';
import { initHero } from './hero.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// 開いたときは必ずページの一番上から始める（ブラウザのスクロール位置の復元を止める）
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!(location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))))) scrollTo(0, 0);
// プレビュー画面などが読み込み後に前回の位置へ戻す場合に備え、操作されるまでは一番上に戻し続ける。
// ただし services.html#career のようにページ内の見出しを指定して開いた場合は、その位置へ移動させたいので戻さない
const hashTarget = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
let userMoved = Boolean(hashTarget);
['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(ev => addEventListener(ev, () => { userMoved = true; }, { once: true, passive: true }));
const toTop = () => { if (userMoved) return; if (window.__lenis) window.__lenis.scrollTo(0, { immediate: true, force: true }); scrollTo(0, 0); };
addEventListener('pageshow', toTop);
addEventListener('load', () => [0, 150, 500, 1200, 2500, 4000].forEach(t => setTimeout(toTop, t)));
const isMobile = () => innerWidth < 900;
const lerp = THREE.MathUtils.lerp;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ======================= UI ======================= */
const header = document.querySelector('.header');
const menuBtn = document.getElementById('menuBtn'), nav = document.getElementById('nav');
menuBtn.addEventListener('click', () => {
  const open = menuBtn.getAttribute('aria-expanded') !== 'true';
  menuBtn.setAttribute('aria-expanded', open); nav.classList.toggle('is-open', open);
});
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { menuBtn.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); }));
// メニューの外を押す・Escキーで閉じる
const closeMenu = () => { menuBtn.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); };
addEventListener('click', e => { if (!nav.contains(e.target) && !menuBtn.contains(e.target)) closeMenu(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

const track = document.getElementById('worksTrack');
const catName = { strategy: '戦略コンサルティング', dx: 'ITコンサルティング' };
if (track) track.innerHTML = WORKS.map((w, i) => `
  <article class="wcard">
    <div class="wcard-top"><span class="wcat">${catName[w.cat]}</span><span class="wno">${String(i + 1).padStart(2, '0')}</span></div>
    <h3>${w.title}</h3>
    <div class="wtags">${w.tags.map(t => `<span>${t}</span>`).join('')}</div>
    <dl><dt>課題</dt><dd>${w.issue}</dd><dt>支援内容</dt><dd>${w.support}</dd><dt>成果</dt><dd>${w.result}</dd></dl>
  </article>`).join('');
document.querySelectorAll('[data-goto-cat]').forEach(a => a.addEventListener('click', e => {
  const idx = WORKS.findIndex(w => w.cat === a.dataset.gotoCat);
  if (isMobile() || idx < 0 || !track) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const dist = track.scrollWidth - innerWidth, card = track.children[idx];
  const p = Math.min(1, Math.max(0, (card.offsetLeft - 56) / dist));
  const y = worksSec.offsetTop + p * (worksSec.offsetHeight - innerHeight);
  window.__lenis ? window.__lenis.scrollTo(y, { duration: 1.8 }) : scrollTo({ top: y, behavior: 'smooth' });
}, true));
const workAll = document.getElementById('workAll'); if (workAll) workAll.textContent = String(WORKS.length).padStart(2, '0');

const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: .2 });
document.querySelectorAll('.reveal, .reveal-lines').forEach(el => io.observe(el));

const worksSec = document.getElementById('works'), worksBar = document.getElementById('worksBar'), workNow = document.getElementById('workNow');
function updateWorks() {
  if (!track || !worksSec) return;
  if (isMobile()) { track.style.transform = ''; return; }
  const r = worksSec.getBoundingClientRect();
  const p = clamp(-r.top / (worksSec.offsetHeight - innerHeight), 0, 1);
  const dist = track.scrollWidth - innerWidth;
  track.style.transform = `translate3d(${-p * dist}px,0,0)`;
  worksBar.style.transform = `scaleX(${p})`;
  workNow.textContent = String(Math.min(WORKS.length, 1 + Math.floor(p * WORKS.length * .999))).padStart(2, '0');
}

/* ======================= Three.js ======================= */
const canvas = document.getElementById('gl');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { canvas.remove(); }
// 背景の描画が始まった直後の数コマは、光の模様の計算が落ち着かず画面全体が水色に塗られることがある（実機のGPUで確認）。
// 最初は背景を透明にしておき、数コマ描いてからふわっと表示して、読み込み時の「一瞬青くなる」ちらつきを防ぐ
let shownFrames = 0;
if (renderer) { canvas.style.opacity = '0'; canvas.style.transition = 'opacity .8s ease'; }
const revealCanvas = () => { if (++shownFrames === 4) canvas.style.opacity = '1'; };

// 3Dロゴの形が切り替わる地点（main 内の data-stop 付きセクション。数は PAGE_KEYS のページごとの要素数と一致させる）
const sections = [...document.querySelectorAll('main [data-stop]')];
const degEl = document.getElementById('deg');

if (renderer) {
  // スマホは画面の画素密度が高い（3倍など）ので、上限を3にして粒子をくっきり描く
  renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile() ? 3 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  camera.position.set(0, 0, 12);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 6); scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, .3));

  const mark = new THREE.Group(); scene.add(mark);
  const logo = createParticleLogo(THREE, { mobile: isMobile() });
  mark.add(logo.points);

  // セクションごとの全体キー（デスクトップ）
  const PI = Math.PI;
  // ページごとの形の流れ（各セクション＝data-stop の順）。トップ：ヒーロー → 事業 → よくある質問 → お問い合わせ
  const PAGE_KEYS = {
    top: [
      { p: [.3, .05, 0], r: [0, -.2, 0], s: 2.1, st: 'mark' },
      { p: [2.7, .7, 0], r: [.08, .3, 0], s: 1.6, st: 'split' },
      { p: [3.3, .1, 0], r: [.2, -.4, 0], s: 1.5, st: 'helix' },
      { p: [3.2, 0, 0], r: [.1, -.3, 0], s: 1.8, st: 'mark' }
    ],
    // サービス：見出し → キャリア形成支援 → 講座 → コンサルティング → 実績 → 選ばれる理由
    services: [
      { p: [2.6, -.1, 0], r: [.08, .3, 0], s: 2.0, st: 'mark' },
      { p: [2.7, 0, 0], r: [.2, -.3, 0], s: 1.9, st: 'career' },
      { p: [0, .9, 0], r: [0, 0, 0], s: 1.8, st: 'twin' },
      { p: [2.6, 0, 0], r: [.1, -.35, 0], s: 2.0, st: 'strategy' },
      { p: [3.0, 0, 0], r: [.25, -.4, 0], s: 2.2, st: 'helix' },
      { p: [-2.6, 0, 0], r: [.1, .45, 0], s: 2.3, st: 'sphere' }
    ]
  };
  const PAGE_MOBILE_Y = { top: [1.2, 1.3, 1.4, 1.5], services: [1.3, 1.35, 1.15, 1.35, 1.4, 1.5] };
  const page = PAGE_KEYS[document.body.dataset.page] ? document.body.dataset.page : 'top';
  const keys = PAGE_KEYS[page];
  const mobileY = PAGE_MOBILE_Y[page];
  const keyFor = i => {
    const k = keys[i];
    if (!isMobile()) return k;
    return { ...k, p: [0, mobileY[i], 0], s: k.s * .4 };
  };

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - .5; mouse.y = e.clientY / innerHeight - .5; });

  let intro = reduceMotion ? 1 : 0, introStarted = reduceMotion, cur = 0, vel = 0, spin = 0, lastY = scrollY;
  window.__startIntro = () => { introStarted = true; };
  const clock = new THREE.Clock();

  function targetS() {
    // ページ最上部では必ず最初の状態（正しい向きのロゴ）になるようにする
    const mid = scrollY + Math.min(innerHeight * .5, scrollY);
    const tops = sections.map(s => s.getBoundingClientRect().top + scrollY);
    let i = 0; while (i < tops.length - 1 && mid >= tops[i + 1]) i++;
    if (i === tops.length - 1) return i;
    return i + sstep(.25, .95, (mid - tops[i]) / (tops[i + 1] - tops[i]));
  }

  const bgUpdate = initBg({ THREE, renderer, scene, camera, mark, matT: new THREE.MeshPhysicalMaterial(), fixed: '2' });
  const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
  function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    if (introStarted && intro < 1) intro = Math.min(1, intro + dt / 2.4);
    const ie = 1 - Math.pow(1 - intro, 4);

    cur += (targetS() - cur) * (reduceMotion ? 1 : .075);
    const a = Math.floor(cur), b = Math.min(a + 1, keys.length - 1), f = cur - a;
    const A = keyFor(a), B = keyFor(b);

    vel += ((scrollY - lastY) / innerHeight - vel) * .1; lastY = scrollY; spin += vel * 2.0;
    mark.position.set(lerp(A.p[0], B.p[0], f) + mouse.x * .45 + Math.sin(t * .45) * .12, lerp(A.p[1], B.p[1], f) - mouse.y * .3 + Math.sin(t * .8) * .16, 0);
    const rz = lerp(A.r[2], B.r[2], f);
    mark.rotation.set(lerp(A.r[0], B.r[0], f) + mouse.y * .45 + Math.sin(t * .4) * .14, lerp(A.r[1], B.r[1], f) + mouse.x * .9 + Math.sin(t * .5) * .3 + spin + (1 - ie) * 2, rz + Math.sin(t * .3) * .06);
    mark.scale.setScalar(lerp(A.s, B.s, f) * (.6 + .4 * ie));

    // 登場時は「ばらばら → ロゴ」、その後は場面ごとの形へ
    if (intro < 1) logo.update('chaos', 'mark', intro, t, vel, renderer.getPixelRatio());
    else logo.update(A.st, B.st, f, t, vel, renderer.getPixelRatio());

    if (degEl) degEl.textContent = Math.round(clamp(rz / PI, 0, 1) * 180) + '°';
    bgUpdate(t, vel);
    renderer.render(scene, camera);
    revealCanvas();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ======================= Intro（DrawSVGでロゴ線画 → カーテンが開く） ======================= */
document.documentElement.classList.add('split-pending');
const start = () => {
  const curtain = document.getElementById('curtain'); if (curtain) curtain.classList.add('is-open');
  setTimeout(() => {
    document.body.classList.add('is-ready');
    document.documentElement.classList.remove('split-pending');
    splitReveal();
    window.__playHero && window.__playHero();
    highlightOnScroll();
    window.__startIntro && window.__startIntro();
  }, reduceMotion ? 0 : 450);
};
// 幕の演出は、画像や3D部品の読み込み完了（load）を待たずに始める。
// load まで待つと、その間は幕が色の板のまま止まって見え、開く直前だけ動くので「ちらつき」に見えてしまうため
const boot = () => {
  window.__lenis = initFx({ headerOffset: 70 }).lenis;
  window.__playHero = initHero();
  // チャプターはページ内に複数置けるので、[data-chapter] ごとに初期化する（サービスページは2つ）
  document.querySelectorAll('[data-chapter]').forEach(el => initChapter(el));
  magnetic(); textRoll();
  const g = window.gsap;
  // 同じタブで2回目以降（幕を出さない）か、動きを減らす設定・GSAPが使えないときは、すぐに本文を表示する
  if (!g || reduceMotion || document.documentElement.classList.contains('intro-done')) return start();
  try { sessionStorage.setItem('slab-intro-done', '1'); } catch (e) { /* 保存できない環境では毎回幕を再生する */ }
  g.timeline({ onComplete: start })
    .from('.curtain-mark path', { drawSVG: '50% 50%', duration: 1.1, ease: 'power3.inOut', stagger: .1 })
    .to('.curtain-mark path', { fill: '#fff', duration: .35 }, '-=.2');
};
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();

addEventListener('scroll', () => { header.classList.toggle('is-scrolled', scrollY > 30); updateWorks(); }, { passive: true });
addEventListener('resize', updateWorks);
updateWorks();
