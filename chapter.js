// チャプター：画面を固定し、スクロール量に応じて項目を1つずつ切り替える（1ページに複数置ける）
// 参考：Apple製品ページ（1画面1メッセージ）、Lusion（3Dシーンがスクロールで変形）、Epic / Mat Voyce（文字主体のモーション）
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * チャプター1つ分を初期化する。
 * @param {Element} root [data-chapter] の要素。中の .ch-item / .ch-tab / .stop を同じ並び順で対応させる。
 * 高さ（.ch-pin）を項目数で等分し、スクロール位置に応じて表示中の項目とタブを切り替える。
 * スクロール監視はチャプターごとに登録する。GSAP が使えるときは html に has-gsap を付けて文字アニメーションを行う。
 */
export function initChapter(root = document.querySelector('[data-chapter]')) {
  if (!root) return;
  const items = [...root.querySelectorAll('.ch-item')];
  const tabs = [...root.querySelectorAll('.ch-tab')];
  const stops = [...root.querySelectorAll('.stop')];
  const { gsap, SplitText } = window;
  let current = -1;
  const splits = items.map(it => (gsap && SplitText && !reduce)
    ? SplitText.create(it.querySelector('.ch-title'), { type: 'lines,chars', mask: 'lines' }) : null);
  if (gsap && SplitText && !reduce) {
    document.documentElement.classList.add('has-gsap');
    splits.forEach((sp, k) => { if (k) { gsap.set(sp.chars, { yPercent: 110 }); gsap.set(items[k].querySelectorAll('.ch-body > *'), { opacity: 0 }); gsap.set(items[k], { autoAlpha: 0 }); } });
  }

  const show = (i, dir) => {
    if (i === current) return;
    const prev = current; current = i;
    items.forEach((it, k) => it.classList.toggle('is-active', k === i));
    tabs.forEach((t, k) => t.classList.toggle('is-active', k === i));
    if (!gsap || reduce) return;
    // 途中の位置で開いた場合は、表示中以外の事業をすべて隠してから始める（文字の重なり防止）
    if (prev < 0) items.forEach((it, k) => { if (k !== i) { gsap.set(it, { autoAlpha: 0 }); if (splits[k]) gsap.set(splits[k].chars, { yPercent: 110 }); gsap.set(it.querySelectorAll('.ch-body > *'), { opacity: 0 }); } });
    if (prev >= 0 && splits[prev]) {
      gsap.to(splits[prev].chars, { yPercent: dir > 0 ? -110 : 110, duration: .55, ease: 'power3.in', stagger: .012, overwrite: true });
      gsap.to(items[prev].querySelectorAll('.ch-body > *'), { y: dir > 0 ? -20 : 20, opacity: 0, duration: .4, overwrite: true });
      gsap.to(items[prev], { autoAlpha: 0, duration: .2, delay: .45, overwrite: true });
    }
    gsap.set(items[i], { autoAlpha: 1, overwrite: true });
    if (splits[i]) {
      gsap.fromTo(splits[i].chars, { yPercent: dir > 0 ? 110 : -110 }, { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: .022, delay: prev >= 0 ? .25 : 0, overwrite: true });
      gsap.fromTo(items[i].querySelectorAll('.ch-body > *'), { y: dir > 0 ? 30 : -30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'expo.out', stagger: .07, delay: prev >= 0 ? .4 : .1, overwrite: true });
    }
  };

  const absTop = el => el.getBoundingClientRect().top + scrollY;
  const update = () => {
    const top = absTop(root), h = root.offsetHeight - innerHeight;
    const p = Math.min(.9999, Math.max(0, (scrollY - top) / h));
    const i = Math.floor(p * items.length);
    root.style.setProperty('--ch-p', p);
    tabs.forEach((t, k) => t.style.setProperty('--fill', Math.min(1, Math.max(0, p * items.length - k))));
    show(i, i > current ? 1 : -1);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();

  tabs.forEach((t, k) => t.addEventListener('click', () => {
    const y = absTop(stops[k] || root) + 2;
    window.__lenis ? window.__lenis.scrollTo(y, { duration: 1.4 }) : scrollTo({ top: y, behavior: 'smooth' });
  }));
}
