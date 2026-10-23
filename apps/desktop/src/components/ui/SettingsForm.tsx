import type { ReactNode, Ref } from "react";

export function SettingsSection({
  title,
  description,
  children,
  className = "",
  ref,
}: {
  title: string;
  description?: string;
  className?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section
      className={`settings-card ${className}`}
      ref={ref}
      tabIndex={ref ? -1 : undefined}
      aria-label={ref ? title : undefined}
    >
      <h2>{title}</h2>
      {description && <p className="settings-description">{description}</p>}
      <div className="settings-rows">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-form-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}
