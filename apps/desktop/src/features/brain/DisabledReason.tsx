import { type ReactNode, useId } from "react";
import { Tooltip } from "../../components/ui";

/** Disabled buttons cannot receive focus; their explanation can. */
export function DisabledReason({
  reason,
  label,
  children,
}: {
  reason?: string;
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  if (!reason) return children;
  return (
    <Tooltip text={reason}>
      {/* biome-ignore lint/a11y/useSemanticElements: An inline disabled-control explanation is not a form fieldset. */}
      <span
        className="brain-disabled-reason"
        role="group"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Disabled buttons cannot receive focus, so their explanation must.
        tabIndex={0}
        aria-label={label}
        aria-describedby={id}
      >
        {children}
        <span id={id} className="brain-reason-text">
          {reason}
        </span>
      </span>
    </Tooltip>
  );
}
