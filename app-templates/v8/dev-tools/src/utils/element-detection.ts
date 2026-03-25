/** Check if an element is interactive (clicks should pass through) */
export function isClickable(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "a" || tag === "button") return true;
  if (element.getAttribute("role") === "button") return true;
  if (element.onclick || element.hasAttribute("onclick")) return true;
  if (element.closest("a, button, [role='button']")) return true;
  return false;
}

/** Check if an element is suitable for inline text editing */
export function isTextEditable(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const textContent = element.textContent?.trim() || "";

  const textTags = [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "span", "a", "button", "label", "li",
  ];
  const hasText = textContent.length > 0;
  const hasOnlyText =
    element.children.length === 0 ||
    Array.from(element.children).every((child) => {
      const tag = child.tagName.toLowerCase();
      return tag === "br" || tag === "span" || tag === "strong" || tag === "em" || tag === "b" || tag === "i";
    });

  return textTags.includes(tagName) && hasText && hasOnlyText;
}

/** Check if an element has child elements with styles/classes that would be
 *  destroyed if we made the parent contentEditable and sent textContent. */
export function hasStyledChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) => {
    const el = child as HTMLElement;
    return el.getAttribute("style") || (el.className && el.className.length > 0);
  });
}

/** Single-line elements where Enter should save instead of newline */
export function isSingleLineElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return ["h1", "h2", "h3", "h4", "h5", "h6", "span", "button", "label", "a"].includes(tag);
}

/** Check if an element is a leaf content element worth targeting for AI edit */
export function isContentElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();

  const contentTags = [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "span", "a", "button", "label", "li",
    "img", "video", "svg", "canvas", "picture",
    "input", "textarea", "select",
    "blockquote", "code", "pre", "figcaption",
  ];
  if (contentTags.includes(tag)) return true;

  const rect = element.getBoundingClientRect();
  const isSmall = rect.width < 400 && rect.height < 300;
  const hasFewChildren = element.children.length <= 3;
  const hasDirectText = Array.from(element.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length || 0) > 0,
  );

  return isSmall || (hasFewChildren && hasDirectText);
}

/** Check if an element is inside the dev-tools overlay */
export function isDevToolsElement(element: HTMLElement): boolean {
  return (
    !!element.closest("#dev-mode-overlay") ||
    !!element.closest("[data-dev-tools]") ||
    !!element.closest(".edit-mode-hover-bar")
  );
}

/** Generate a basic CSS selector for an element */
export function generateSelector(element: HTMLElement): string {
  if (element.id) return `#${element.id}`;

  let selector = element.tagName.toLowerCase();
  if (element.className && typeof element.className === "string") {
    const classes = element.className
      .split(" ")
      .filter((c) => c.trim() && !c.includes(":"))
      .map((c) => c.replace(/[^\w-]/g, ""))
      .filter((c) => c.length > 0);
    if (classes.length > 0) {
      selector += "." + classes.join(".");
    }
  }
  return selector;
}

/** Check if an element is an image or contains/wraps an image */
export function detectImage(element: HTMLElement): {
  isImage: boolean;
  imageUrl: string | null;
  imageElement: HTMLElement | null;
  type: "img" | "background" | null;
} {
  const none = { isImage: false, imageUrl: null, imageElement: null, type: null } as const;

  if (element.tagName.toLowerCase() === "img") {
    const img = element as HTMLImageElement;
    return {
      isImage: true,
      imageUrl: img.src || img.currentSrc || null,
      imageElement: element,
      type: "img",
    };
  }

  const bg = window.getComputedStyle(element).backgroundImage;
  if (bg && bg !== "none") {
    const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
    if (match?.[1])
      return { isImage: true, imageUrl: match[1], imageElement: element, type: "background" };
  }

  const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
  const candidates = [
    ...Array.from(element.children),
    ...siblings,
  ];
  for (const candidate of candidates) {
    if (candidate === element) continue;
    if (candidate.tagName.toLowerCase() === "img") {
      const img = candidate as HTMLImageElement;
      return {
        isImage: true,
        imageUrl: img.src || img.currentSrc || null,
        imageElement: candidate as HTMLElement,
        type: "img",
      };
    }
  }

  for (const sibling of siblings) {
    if (sibling === element) continue;
    const nestedImg = sibling.querySelector("img") as HTMLImageElement | null;
    if (nestedImg) {
      return {
        isImage: true,
        imageUrl: nestedImg.src || nestedImg.currentSrc || null,
        imageElement: nestedImg,
        type: "img",
      };
    }
  }

  return none;
}

/** Check if a URL is a media slot and extract the slot path */
export function getMediaSlotPath(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/airo-assets\/images\/(.+?)(?:\?|$)/);
  return match ? match[1] : null;
}
