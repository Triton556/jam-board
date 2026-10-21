import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`settings-card ${className}`}>
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
