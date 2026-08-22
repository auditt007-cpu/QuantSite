(function () {
  const toggle = document.getElementById("navToggle");
  const bar = document.querySelector(".topbar");
  if (!toggle || !bar) return;
  toggle.addEventListener("click", () => {
    bar.classList.toggle("nav-open");
  });
  document.querySelectorAll(".nav-actions a, .nav-actions button").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.closest(".lang-wrap")) return;
      if (window.matchMedia("(max-width: 768px)").matches) bar.classList.remove("nav-open");
    });
  });
})();
