/** Prevents operational DOM/portals from receiving demo input. Background services remain untouched. */
export function isolateOnboardingDom(root: HTMLElement) {
  const document = root.ownerDocument;
  const saved = new Map<HTMLElement, { inert: boolean; aria: string | null }>();
  const previousFocus = document.activeElement as HTMLElement | null;
  const protect = () => {
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement) || child === root || child.contains(root)) continue;
      if (!saved.has(child))
        saved.set(child, { inert: child.inert, aria: child.getAttribute("aria-hidden") });
      child.inert = true;
      child.setAttribute("aria-hidden", "true");
    }
  };
  const inside = (event: Event) => event.composedPath().includes(root);
  const block = (event: Event) => {
    if (inside(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "focusin") root.focus();
  };
  const trap = (event: KeyboardEvent) => {
    // Operational window hotkeys must never receive keyboard actions from demo controls.
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"],a[href]',
      ),
    ).filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
    const first = items[0],
      last = items.at(-1);
    if (!first) {
      event.preventDefault();
      root.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === root)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const events = [
    "click",
    "dblclick",
    "auxclick",
    "submit",
    "pointerdown",
    "keydown",
    "focusin",
    "drop",
    "change",
    "input",
    "contextmenu",
  ];
  for (const event of events) document.addEventListener(event, block, true);
  root.addEventListener("keydown", trap);
  protect();
  const observer = new MutationObserver(protect);
  observer.observe(document.body, { childList: true });
  root.tabIndex = -1;
  root.focus();
  return () => {
    observer.disconnect();
    for (const event of events) document.removeEventListener(event, block, { capture: true });
    root.removeEventListener("keydown", trap);
    for (const [element, value] of saved) {
      element.inert = value.inert;
      if (value.aria === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", value.aria);
    }
    if (previousFocus?.isConnected) previousFocus.focus();
  };
}
