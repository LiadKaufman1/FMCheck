// Accessibility options (the round button at the bottom right), saved in this browser. Used on every page.
const A11Y_KEY = "fmcheck-a11y";
export function setupA11y() {
  const btn = document.getElementById("a11yBtn"), panel = document.getElementById("a11yPanel");
  let a11y = {};
  try { a11y = JSON.parse(localStorage.getItem(A11Y_KEY) || "{}") || {}; } catch { a11y = {}; }
  const apply = () => {
    for (const k of ["big", "still", "contrast", "links"]) document.documentElement.classList.toggle(`a11y-${k}`, !!a11y[k]);
    for (const box of document.querySelectorAll("[data-a11y]")) box.checked = !!a11y[box.dataset.a11y];
  };
  apply();
  if (!btn || !panel) return;
  btn.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) panel.querySelector("input").focus();
  });
  panel.addEventListener("change", (e) => {
    const k = e.target.dataset.a11y;
    if (!k) return;
    a11y[k] = e.target.checked;
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11y)); } catch { /* not saved, still applied */ }
    apply();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); }
  });
}
