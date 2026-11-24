// 共通モーション層：実績のあるライブラリで品質を担保する
//  - Lenis       : 慣性スムーススクロール（Awwwards受賞サイトの定番）
//  - GSAP        : ScrollTrigger / SplitText / DrawSVG（2025年から全プラグイン無償）
//  - Phosphor    : アイコン
const { gsap, ScrollTrigger, SplitText, Lenis } = window;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initFx({ headerOffset = 0 } = {}) {
  if (!gsap) return { lenis: null };
  gsap.registerPlugin(ScrollTrigger, SplitText, window.DrawSVGPlugin);

  // --- Lenis + ScrollTrigger 同期 ---
  let lenis = null;
  if (Lenis && !reduce) {
    lenis = new Lenis({ lerp: .09, wheelMultiplier: 1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      lenis.scrollTo(el, { offset: -headerOffset, duration: 1.6 });
    }));
  }
  return { lenis };
}

// 見出し：行マスク + 文字スタッガー（SplitText）
export function splitReveal(selector = '[data-split]') {
  if (!gsap || reduce) return;
  document.fonts.ready.then(() => {
    document.querySelectorAll(selector).forEach(el => {
      const mode = el.dataset.split || 'lines';
      SplitText.create(el, {
        type: mode === 'chars' ? 'lines,chars' : 'lines', mask: 'lines', autoSplit: true,
        onSplit(self) {
          const targets = mode === 'chars' ? self.chars : self.lines;
          return gsap.from(targets, {
            yPercent: 110, opacity: mode === 'chars' ? 0 : 1, rotate: mode === 'chars' ? 6 : 0,
            duration: 1.25, ease: 'expo.out', stagger: mode === 'chars' ? .025 : .1,
            scrollTrigger: el.dataset.splitNow !== undefined ? undefined : { trigger: el, start: 'top 85%', once: true },
            paused: el.dataset.splitNow !== undefined
          });
        }
      });
    });
  });
}

// ブロック要素のフェードアップ
export function fadeUp(selector, opts = {}) {
  if (!gsap || reduce) { document.querySelectorAll(selector).forEach(el => el.classList.add('is-in')); return; }
  ScrollTrigger.batch(selector, {
    start: 'top 88%', once: true,
    onEnter: els => gsap.fromTo(els, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, ease: 'expo.out', stagger: .08, overwrite: true, ...opts })
  });
  gsap.set(selector, { opacity: 0 });
}

// マグネティックボタン + テキストロール（受賞サイトで定番のホバー）
export function magnetic(selector = '[data-magnetic]') {
  if (!gsap || reduce || matchMedia('(hover: none)').matches) return;
  document.querySelectorAll(selector).forEach(el => {
    const xTo = gsap.quickTo(el, 'x', { duration: .6, ease: 'elastic.out(1, .4)' });
    const yTo = gsap.quickTo(el, 'y', { duration: .6, ease: 'elastic.out(1, .4)' });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * .3); yTo((e.clientY - r.top - r.height / 2) * .4);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

export function textRoll(selector = '[data-roll]') {
  if (!gsap || reduce) return;
  document.querySelectorAll(selector).forEach(el => {
    const label = el.querySelector('.roll') || el;
    const text = label.textContent.trim();
    label.innerHTML = `<span class="roll-wrap" style="display:inline-grid;overflow:hidden;vertical-align:top"><span class="roll-a" style="grid-area:1/1">${text}</span><span class="roll-b" aria-hidden="true" style="grid-area:1/1">${text}</span></span>`;
    const a = SplitText.create(label.querySelector('.roll-a'), { type: 'chars' }).chars;
    const b = SplitText.create(label.querySelector('.roll-b'), { type: 'chars' }).chars;
    gsap.set(b, { yPercent: 110 });
    const tl = gsap.timeline({ paused: true, defaults: { duration: .5, ease: 'power3.inOut', stagger: .015 } })
      .to(a, { yPercent: -110 }, 0).to(b, { yPercent: 0 }, 0);
    el.addEventListener('pointerenter', () => tl.play());
    el.addEventListener('pointerleave', () => tl.reverse());
  });
}

// スクロール量に合わせて文字が順に灯る（Osmo "Highlight Text on Scroll" の手法を参考に実装）
export function highlightOnScroll(selector = '[data-highlight]') {
  if (!gsap || reduce) return;
  document.fonts.ready.then(() => {
    document.querySelectorAll(selector).forEach(el => {
      SplitText.create(el, {
        type: 'chars', autoSplit: true,
        onSplit(self) {
          return gsap.from(self.chars, {
            opacity: .16, ease: 'none', stagger: .08,
            scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 45%', scrub: true }
          });
        }
      });
    });
  });
}

// 縦に重なっていくパネル（スタッキングカード）。前のパネルは奥へ下がる
export function stackPanels(selector = '[data-stack]', dim = .5) {
  if (!gsap || reduce) return;
  const panels = gsap.utils.toArray(selector);
  panels.forEach((p, i) => {
    const next = panels[i + 1];
    if (!next) return;
    gsap.to(p, {
      scale: .92, filter: `brightness(${dim})`, ease: 'none', transformOrigin: '50% 0%',
      scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 20%', scrub: true }
    });
  });
}

// 線画を描く（DrawSVG）
export function drawOnEnter(selector = '[data-draw]') {
  if (!gsap || reduce || !window.DrawSVGPlugin) return;
  document.querySelectorAll(selector).forEach(svg => {
    gsap.from(svg.querySelectorAll('path, line, circle, rect, polyline'), {
      drawSVG: 0, duration: 1.6, ease: 'power2.inOut', stagger: .06,
      scrollTrigger: { trigger: svg, start: 'top 75%', once: true }
    });
  });
}
