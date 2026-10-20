// Works filter
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.works-filter-btn');
  const cards = document.querySelectorAll('.works-card');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      buttons.forEach(b => b.classList.toggle('is-active', b === btn));
      cards.forEach(card => {
        card.hidden = filter !== 'all' && card.dataset.category !== filter;
      });
    });
  });
});
