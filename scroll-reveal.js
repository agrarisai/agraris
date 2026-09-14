// ============================================
// Agraris — scroll reveal (Intersection Observer)
//
// Fades + slides in any ".reveal" element the first time it enters
// the viewport. Elements marked with "data-reveal-stagger" get a
// small incremental delay based on their order within a single
// observeReveal() call (used for the agent-row ledger list), capped
// so a long list doesn't take forever to finish revealing.
// ============================================

(function () {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const STAGGER_MS = 50;
  const STAGGER_MAX_INDEX = 10;

  let observer = null;

  function getObserver() {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
      );
    }
    return observer;
  }

  // Wires up every not-yet-seen ".reveal" element inside `root`.
  // Safe to call more than once (e.g. after re-rendering a list) —
  // already-bound elements are skipped.
  function observeReveal(root) {
    const scope = root || document;
    const els = scope.querySelectorAll(".reveal:not([data-reveal-bound])");

    els.forEach((el, i) => {
      el.setAttribute("data-reveal-bound", "");

      if (prefersReducedMotion) {
        el.classList.add("is-visible");
        return;
      }

      if (el.hasAttribute("data-reveal-stagger")) {
        const step = Math.min(i, STAGGER_MAX_INDEX);
        el.style.transitionDelay = `${step * STAGGER_MS}ms`;
      }

      getObserver().observe(el);
    });
  }

  window.observeReveal = observeReveal;

  observeReveal();
})();
