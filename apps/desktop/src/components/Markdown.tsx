import { lazy, Suspense } from "react";

const Content = lazy(() =>
  import("./MarkdownContent").then((m) => ({ default: m.MarkdownContent })),
);
export function Markdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<p>{children}</p>}>
      <Content>{children}</Content>
    </Suspense>
  );
}
