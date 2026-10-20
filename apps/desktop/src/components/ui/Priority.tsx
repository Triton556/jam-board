import { ChevronDown, ChevronsUp, ChevronUp, Equal } from "lucide-react";
export const priorities = ["low", "medium", "high", "critical"] as const;
export function Priority({
  value,
  text = false,
}: {
  value: string;
  text?: boolean;
}) {
  const Icon =
    value === "low"
      ? ChevronDown
      : value === "high"
        ? ChevronUp
        : value === "critical"
          ? ChevronsUp
          : Equal;
  return (
    <span className={`priority priority-${value}`}>
      <Icon size={16} aria-label={`${value} priority`} />
      {text && (
        <span>
          {value[0]?.toUpperCase()}
          {value.slice(1)}
        </span>
      )}
    </span>
  );
}
