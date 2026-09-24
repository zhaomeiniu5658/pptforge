// Adapted from screenshot-to-html shot.mjs at 7b5469b; MIT notice in third_party.
export function interactionAudit() {
  const interactiveSel =
    'a[href],button,input,select,textarea,[role="button"],[role="link"],' +
    '[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],[tabindex]:not([tabindex="-1"]),' +
    '[onclick],summary,label[for],[contenteditable="true"]';
  const clsOf = (el) =>
    typeof el.className === "string"
      ? el.className
      : (el.className && el.className.baseVal) || "";
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const c = clsOf(el).trim().split(/\s+/).filter(Boolean)[0];
    const cls = c ? `.${c}` : "";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `${tag}${id}${cls}${txt ? ` "${txt}"` : ""}`;
  };

  const interactive = Array.from(document.querySelectorAll(interactiveSel));
  // Real controls (excluding text inputs) that forgot cursor:pointer.
  const noPointer = [];
  for (const el of interactive) {
    const tag = el.tagName.toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) continue;
    if (el.getAttribute("role") === "tab") continue; // tabs sometimes use default cursor
    if (getComputedStyle(el).cursor !== "pointer") noPointer.push(describe(el));
  }

  // Clickable-LOOKING elements that are not real controls (the "dead button" bug).
  const suspectRe =
    /(^|[-_ ])(btn|button|link|tab|cta|toggle|chip|pill|nav-?item|menu-?item|clickable|action)([-_ \d]|$)/i;
  const dead = [];
  for (const el of Array.from(
    document.querySelectorAll("div,span,li,p,img,svg"),
  )) {
    if (el.closest(interactiveSel)) continue; // inside a real control → fine
    const looksClickable =
      getComputedStyle(el).cursor === "pointer" ||
      suspectRe.test(clsOf(el)) ||
      suspectRe.test(el.id || "");
    if (!looksClickable) continue;
    if (el.getAttribute("onclick")) continue; // has an inline handler
    dead.push(describe(el));
  }

  // Are there any :hover / :focus rules at all?
  let hoverRules = 0,
    focusRules = 0;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    for (const r of Array.from(rules)) {
      const t = (r && r.selectorText) || "";
      if (t.includes(":hover")) hoverRules++;
      if (t.includes(":focus")) focusRules++;
    }
  }
  return {
    interactiveCount: interactive.length,
    noPointer,
    hoverRules,
    focusRules,
    dead: dead.slice(0, 30),
    deadTotal: dead.length,
  };
}
