// 下層ページの背景：トップページと同じガラスのロゴと光の模様を、画面の右側に控えめに置く（グリッド線なし）
// スクロールに合わせて、ロゴ → 分解図 → 2つに分かれる → ロゴ と組み替わる
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createGlassLogo } from './glass-logo.js?v=20261126-01';
import { initBg } from './bg.js?v=20261124-04';

// 幕が開く演出（トップ・サービスページ）は、サイトを最初に開いたときだけにする。
// 下層ページから入った人がトップへ移動したときにも幕が出ないよう、ここでも「表示済み」を記録する
try { sessionStorage.setItem('slab-intro-done', '1'); } catch (e) { /* 保存できない環境では、トップを開くたびに幕が出る */ }

// 共通ヘッダー：ハンバーガーでボタンの下に小さなメニューを開閉
const menuBtn = document.getElementById('menuBtn'), nav = document.getElementById('nav');
if (menuBtn && nav) {
  const setOpen = open => { menuBtn.setAttribute('aria-expanded', open); nav.classList.toggle('is-open', open); };
  menuBtn.addEventListener('click', () => setOpen(menuBtn.getAttribute('aria-expanded') !== 'true'));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  addEventListener('click', e => { if (!nav.contains(e.target) && !menuBtn.contains(e.target)) setOpen(false); });
}

const canvas = document.getElementById('gl');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = () => innerWidth < 900;
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { canvas.remove(); }
// 背景の描画が始まった直後の数コマは、光の模様の計算が落ち着かず画面全体が水色に塗られることがある（実機のGPUで確認）。
// 最初は背景を透明にしておき、数コマ描いてからふわっと表示して、読み込み時の「一瞬青くなる」ちらつきを防ぐ
let shownFrames = 0;
if (renderer) { canvas.style.opacity = '0'; canvas.style.transition = 'opacity .8s ease'; }
const revealCanvas = () => { if (++shownFrames === 4) canvas.style.opacity = '1'; };

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // ガラスの質感を出すための映り込みと照明（トップページと同じ設定）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  camera.position.set(0, 0, 12);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 6); scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, .3));

  const logo = createGlassLogo(THREE);
  const mark = logo.group; scene.add(mark);
  // 背景はグリッド線なし、光の模様だけ（fixed: '2'）
  const bgUpdate = initBg({ THREE, renderer, scene, camera, mark, matT: logo.matT, fixed: '2' });

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - .5; mouse.y = e.clientY / innerHeight - .5; });

  // スクロールに合わせた組み替えの順番（glass-logo.js の pieceState の名前）
  const SEQ = ['none', 'exploded', 'split', 'none'];
  let intro = reduceMotion ? 1 : 0, cur = 0, vel = 0, spin = 0, lastY = scrollY;
  const clock = new THREE.Clock();
  const frame = () => {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    intro = Math.min(1, intro + dt / 2.4);
    const max = document.documentElement.scrollHeight - innerHeight;
    const target = (max > 0 ? scrollY / max : 0) * (SEQ.length - 1);
    cur += (target - cur) * (reduceMotion ? 1 : .06);
    const a = Math.floor(cur), b = Math.min(a + 1, SEQ.length - 1), f = cur - a;
    vel += ((scrollY - lastY) / innerHeight - vel) * .1; lastY = scrollY; spin += vel * 1;

    // PCは右側、スマホは右上に小さく（本文の読みやすさを優先）
    const m = isMobile();
    mark.position.set((m ? 1.15 : 3.9) + mouse.x * .3, (m ? 2.4 : .3) - mouse.y * .2 + Math.sin(t * .6) * .1, 0);
    mark.rotation.set(mouse.y * .3 + Math.sin(t * .4) * .1, -.25 + mouse.x * .6 + Math.sin(t * .3) * .25 + spin, 0);
    mark.scale.setScalar((m ? .6 : .9) * (.7 + .3 * intro));

    // 登場時は「ばらばらのピース → ロゴに組み上がる」、その後はスクロールに合わせて組み替える
    logo.update(SEQ[a], SEQ[b], f, 1 - Math.pow(1 - intro, 4));
    bgUpdate(t, vel);
    renderer.render(scene, camera);
    revealCanvas();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
