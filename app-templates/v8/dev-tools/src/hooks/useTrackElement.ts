import { useEffect, useRef } from "react";

const EDGE_MARGIN = 0.1;

export function useTrackElement(
  element: HTMLElement,
  toolbarEl: React.RefObject<HTMLDivElement | null>,
  editorEl: React.RefObject<HTMLDivElement | null>,
  onOffScreen: () => void,
): void {
  const rafRef = useRef<number>(0);

  useEffect(() => {
    let mounted = false;

    const update = () => {
      const r = element.getBoundingClientRect();
      if (toolbarEl.current) {
        toolbarEl.current.style.top = Math.max(0, r.top - 40) + 'px';
        toolbarEl.current.style.left = r.left + 'px';
      }
      if (editorEl.current) {
        editorEl.current.style.top = r.top + 'px';
        editorEl.current.style.left = r.left + 'px';
        editorEl.current.style.width = r.width + 'px';
        editorEl.current.style.minHeight = r.height + 'px';
      }

      if (mounted) {
        const centerY = (r.top + r.bottom) / 2;
        const vh = window.innerHeight;
        if (centerY < vh * EDGE_MARGIN || centerY > vh * (1 - EDGE_MARGIN)) {
          onOffScreen();
        }
      }
    };

    const onEvent = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    update();
    mounted = true;
    window.addEventListener('scroll', onEvent, { passive: true, capture: true });
    window.addEventListener('resize', onEvent, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', onEvent, { capture: true });
      window.removeEventListener('resize', onEvent);
    };
  }, [element, toolbarEl, editorEl, onOffScreen]);
}
