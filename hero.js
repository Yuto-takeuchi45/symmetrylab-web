// ファーストビュー見出し（ミッション）をタイピングで表示（GSAP TextPlugin）
// 比較用の pattern-b-hero/hero.js から、採用したタイピングだけを使う
const L1 = '複雑で非対称な社会に、', L2 = '意思決定の公平性をもたらす。';
const SPEED = .11;   // 1文字あたりの秒数
const START = 1.35;  // 幕が開き切るまで待つ秒数
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initHero() {
  const { gsap, TextPlugin } = window;
  const h1 = document.querySelector('.hero-title');
  if (!h1) return () => {};
  h1.setAttribute('aria-label', `${L1}${L2}`);
  h1.innerHTML = `<span class="hl1">${L1}</span><br><em class="hl2">${L2}</em>`;
  const show = () => { h1.style.visibility = 'visible'; };
  if (!gsap || !TextPlugin || reduce) return show;
  gsap.registerPlugin(TextPlugin);

  // 幕が開いた後に呼ばれる
  return () => document.fonts.ready.then(() => {
    const l1 = h1.querySelector('.hl1'), l2 = h1.querySelector('.hl2');
    l1.textContent = ''; l2.textContent = '';
    show();
    h1.classList.add('is-typing');
    const caret = document.createElement('i'); caret.className = 'caret';
    l1.after(caret);
    gsap.timeline()
      .to(l1, { duration: L1.length * SPEED, text: { value: L1 }, ease: 'none', delay: START })
      .add(() => l2.after(caret))
      .to(l2, { duration: L2.length * SPEED, text: { value: L2 }, ease: 'none' }, '+=.4')
      .add(() => h1.classList.remove('is-typing'), '+=1.6');
  });
}
