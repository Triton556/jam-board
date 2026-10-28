import { LoaderCircle } from "lucide-react";

export function BrainProgress({ children }: { children: string }) {
  return (
    <span className="brain-progress" role="status">
      <LoaderCircle size={14} aria-hidden="true" />
      {children}
    </span>
  );
}
