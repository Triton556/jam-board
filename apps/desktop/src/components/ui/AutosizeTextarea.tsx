import {
  type ComponentPropsWithRef,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

/** Native content sizing avoids the write/read layout flush on every edit. */
export function AutosizeTextarea({
  ref,
  value,
  className = "",
  ...props
}: ComponentPropsWithRef<"textarea">) {
  const element = useRef<HTMLTextAreaElement | null>(null);
  const setRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      element.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const native =
    typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");
  // biome-ignore lint/correctness/useExhaustiveDependencies: Controlled updates and RHF resets must resize the unsupported-browser fallback too.
  useLayoutEffect(() => {
    if (native) return;
    const node = element.current;
    if (!node) return;
    const drawer = node.closest(".drawer");
    const resize = () => {
      if (drawer && !drawer.classList.contains("open")) return;
      node.style.height = "auto";
      node.style.height = `calc(${node.scrollHeight}px + 2 * var(--stroke))`;
    };
    resize();
    node.addEventListener("input", resize);
    // Older engines wait until the shell is fully open before measuring.
    const observer = drawer ? new MutationObserver(resize) : null;
    if (drawer)
      observer?.observe(drawer, {
        attributes: true,
        attributeFilter: ["class"],
      });
    return () => {
      node.removeEventListener("input", resize);
      observer?.disconnect();
    };
  }, [native, value]);
  return (
    <textarea
      {...props}
      ref={setRef}
      value={value}
      className={`autosize-textarea ${className}`}
    />
  );
}
