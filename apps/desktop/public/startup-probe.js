// Loaded only by the native opt-in initialization script. Loading/error shells do
// not contain these data-backed roots; empty successful boards still qualify.
export function contentRoute() {
  const path = window.location.pathname;
  if (path === "/board" && document.querySelector(".board-columns"))
    return "/board";
  if (path === "/plan" && document.querySelector(".plan-page")) return "/plan";
  if (path === "/welcome" && document.querySelector("main.welcome"))
    return "/welcome";
}

export function observeFirstPaint(invoke) {
  let pending = false;
  let done = false;
  const check = () => {
    if (pending || done) return;
    const route = contentRoute();
    if (!route) return;
    pending = true;
    // The window begins hidden. A DOM commit in that window is not a visible
    // first screen. Two rAFs let the committed content cross a paint boundary.
    void invoke("plugin:window|is_visible", { label: "main" })
      .then((visible) => {
        if (!visible) {
          pending = false;
          setTimeout(check, 16);
          return;
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            pending = false;
            if (contentRoute() !== route) {
              check();
              return;
            }
            done = true;
            observer.disconnect();
            performance.mark("jam:first-paint");
            const mark = performance.getEntriesByName("jam:first-paint").at(-1);
            void invoke("startup_first_paint", {
              route,
              paintEpochMs:
                performance.timeOrigin + (mark?.startTime ?? performance.now()),
            }).catch(console.error);
          });
        });
      })
      .catch(console.error);
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  check();
}
