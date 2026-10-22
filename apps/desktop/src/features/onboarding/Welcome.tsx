import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import boardImage from "../../assets/chibi/duo-board-512.webp";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { acceptProjectSelection } from "../../lib/project-selection";
import {
  localDate,
  type Template,
  templateInfo,
  templates,
} from "../../lib/project-template";
import { appQuery } from "../../lib/queries";
export const welcomeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give your project a name")
      .max(60, "Use at most 60 characters"),
    theme: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    timezone: z.string().min(1),
    yourName: z
      .string()
      .trim()
      .min(1, "Tell us your name")
      .max(40, "Use at most 40 characters"),
    template: z.enum(["game_jam", "gamedev", "webapp", "custom"]).optional(),
    milestoneAt: z.string().optional(),
  })
  .superRefine((v, c) => {
    if (
      (v.template ?? "game_jam") === "game_jam" &&
      !(Date.parse(v.endsAt) > Date.parse(v.startsAt))
    )
      c.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End must be later than start",
      });
    if (v.milestoneAt && Number.isNaN(Date.parse(v.milestoneAt)))
      c.addIssue({
        code: "custom",
        path: ["milestoneAt"],
        message: "Choose a valid milestone",
      });
  });
type Fields = z.infer<typeof welcomeSchema>;
export function Welcome() {
  const client = useQueryClient(),
    navigate = useNavigate();
  const app = useQuery(appQuery);
  const [step, setStep] = useState(1),
    [template, setTemplate] = useState<Template>("game_jam");
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Fields>({
    resolver: zodResolver(welcomeSchema),
    defaultValues: {
      name: "",
      theme: "",
      startsAt: localDate(new Date().toISOString()),
      endsAt: localDate(new Date(Date.now() + 48 * 3600000).toISOString()),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      yourName: app.data?.currentMember?.name ?? "",
      template: "game_jam",
      milestoneAt: "",
    },
  });
  const finish = async (state: Awaited<ReturnType<typeof api.appState>>) => {
    await acceptProjectSelection(client, state);
    await navigate({ to: "/board", ignoreBlocker: true });
  };
  const create = useMutation({
    mutationFn: (v: Fields) =>
      api.createJam({
        ...v,
        template,
        theme: v.theme.trim() || null,
        startsAt:
          template === "game_jam" ? new Date(v.startsAt).toISOString() : "",
        endsAt: template === "game_jam" ? new Date(v.endsAt).toISOString() : "",
        milestoneAt:
          (template === "gamedev" || template === "webapp") && v.milestoneAt
            ? new Date(v.milestoneAt).toISOString()
            : null,
      }),
    onSuccess: finish,
  });
  const demo = useMutation({
    mutationFn: () => api.loadDemoJam(),
    onSuccess: finish,
  });
  const busy = create.isPending || demo.isPending;
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: busy });
  const info = templateInfo(template);
  return (
    <main className={`welcome ${step === 1 ? "welcome-templates" : ""}`}>
      <div className="welcome-art">
        <img
          src={boardImage}
          width={220}
          height={220}
          alt="Two teammates planning a project"
        />
        <svg className="welcome-arrow" viewBox="0 0 150 65" aria-hidden="true">
          <path
            d="M3 8 Q75 60 144 29 M127 22 L145 29 L131 43"
            fill="none"
            stroke="var(--line)"
            strokeWidth="1.5"
          />
        </svg>
        <span className="hand-note">we'll keep the board tidy</span>
      </div>
      <div className="welcome-content">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void navigate({ to: "/projects" })}
        >
          ← Your projects
        </Button>
        <span className="eyebrow">JAM BOARD · STEP {step} OF 2</span>
        <h1>
          {step === 1
            ? "What are we making?"
            : template === "game_jam"
              ? "Let's plan a jam"
              : "Let's plan a project"}
        </h1>
        <p className="muted">A cozy space for you and your AI teammates.</p>
        {step === 1 ? (
          <div className="template-grid">
            {templates.map((t) => (
              <button
                type="button"
                className="template-card"
                key={t.value}
                aria-label={t.label}
                onClick={() => {
                  setTemplate(t.value);
                  setValue("template", t.value);
                  setStep(2);
                }}
              >
                <span
                  aria-hidden="true"
                  className={`template-symbol template-${t.value}`}
                >
                  {t.icon}
                </span>
                <strong>{t.label}</strong>
                <span>{t.description}</span>
                <small>{t.detail}</small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(1)}>
              ← Change template · {info.label}
            </Button>
            <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
              <label>
                {template === "game_jam" ? "Jam name" : "Project name"}
                <input
                  {...register("name")}
                  placeholder={info.placeholder}
                  aria-invalid={!!errors.name}
                />
              </label>
              {errors.name && (
                <p role="alert" className="field-error">
                  {errors.name.message}
                </p>
              )}
              <label>
                Theme <span className="optional">optional</span>
                <input
                  {...register("theme")}
                  placeholder="Small lights, big ideas…"
                />
              </label>
              {template === "game_jam" ? (
                <>
                  <div className="form-row">
                    <label>
                      Start
                      <input type="datetime-local" {...register("startsAt")} />
                    </label>
                    <label>
                      End
                      <input
                        type="datetime-local"
                        {...register("endsAt")}
                        aria-invalid={!!errors.endsAt}
                      />
                    </label>
                  </div>
                  {errors.endsAt && (
                    <p role="alert" className="field-error">
                      {errors.endsAt.message}
                    </p>
                  )}
                  <label>
                    Timezone
                    <input {...register("timezone")} />
                  </label>
                </>
              ) : template !== "custom" ? (
                <>
                  <label>
                    Milestone (optional)
                    <input type="datetime-local" {...register("milestoneAt")} />
                  </label>
                  {errors.milestoneAt && (
                    <p role="alert" className="field-error">
                      {errors.milestoneAt.message}
                    </p>
                  )}
                </>
              ) : null}
              <label>
                Your name
                <input
                  {...register("yourName")}
                  placeholder="How should we call you?"
                  aria-invalid={!!errors.yourName}
                />
              </label>
              {errors.yourName && (
                <p role="alert" className="field-error">
                  {errors.yourName.message}
                </p>
              )}
              <Button variant="primary" type="submit" disabled={busy}>
                {create.isPending
                  ? "Making room…"
                  : template === "game_jam"
                    ? "Create jam"
                    : "Create project"}
              </Button>
            </form>
          </>
        )}
        {(create.error || demo.error) && (
          <p role="alert" className="field-error">
            {(create.error ?? demo.error)?.message}
          </p>
        )}
        <div className="welcome-or">
          <span>or</span>
        </div>
        <Button
          className="demo-link"
          disabled={busy}
          onClick={() => demo.mutate()}
        >
          Load demo jam
        </Button>
        <p className="welcome-connect muted small">
          Connect an AI agent later in Settings → Agents
        </p>
      </div>
    </main>
  );
}
