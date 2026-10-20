import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type Range,
  Virtualizer,
} from "@tanstack/react-virtual";
import {
  type RefObject,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

// A fixed-height flow window needs a commit only when its block changes.
// The stock React adapter also commits for intermediate visible-row crossings.
export function tableRange(range: Range) {
  // Ten-row blocks amortize style/paint commits during wheel scrolling while
  // retaining ten overscan rows and fewer than sixty mounted desktop rows.
  const block = 10;
  const start = Math.max(
    0,
    Math.floor((range.startIndex - range.overscan) / block) * block,
  );
  const length =
    Math.ceil(
      (range.endIndex - range.startIndex + 1 + range.overscan * 2 + block - 1) /
        block,
    ) * block;
  return Array.from(
    { length: Math.min(length, range.count - start) },
    (_, index) => start + index,
  );
}
export function useTableVirtualizer(
  scroll: RefObject<HTMLDivElement | null>,
  count: number,
  getItemKey: (index: number) => string | number,
) {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const signature = useRef("");
  const options = {
    count,
    getItemKey,
    getScrollElement: () => scroll.current,
    estimateSize: () => 44,
    overscan: 10,
    rangeExtractor: tableRange,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: (
      instance: Virtualizer<HTMLDivElement, HTMLTableRowElement>,
      sync: boolean,
    ) => {
      // Avoid repainting a different hover stripe on every wheel event. The
      // normal hover returns as soon as TanStack reports scrolling has stopped.
      scroll.current?.toggleAttribute("data-scrolling", instance.isScrolling);
      const indexes = instance.getVirtualIndexes();
      const next = `${indexes[0]}:${indexes.at(-1)}:${count}:${instance.scrollRect?.width}:${instance.scrollRect?.height}`;
      if (next === signature.current) return;
      signature.current = next;
      if (sync) flushSync(render);
      else render();
    },
  };
  const [instance] = useState(
    () => new Virtualizer<HTMLDivElement, HTMLTableRowElement>(options),
  );
  instance.setOptions(options);
  // Use the same mount/update lifecycle as TanStack's React adapter.
  useLayoutEffect(() => instance._didMount(), [instance]);
  useLayoutEffect(() => {
    instance._willUpdate();
  });
  return instance;
}
