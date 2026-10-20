import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import boardImage from "../../assets/chibi/duo-board-512.webp";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
export const welcomeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give your jam a name")
      .max(60, "Use at most 60 characters"),
    theme: z.string(),
    startsAt: z.string().min(1, "Choose a start time"),
    endsAt: z.string().min(1, "Choose an end time"),
    timezone: z.string().min(1),
    yourName: z
      .string()
      .trim()
      .min(1, "Tell us your name")
      .max(40, "Use at most 40 characters"),
  })
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    path: ["endsAt"],
    message: "End must be later than start",
  });
type Fields = z.infer<typeof welcomeSchema>;
function localDate(time: number) {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function Welcome() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields>({
    resolver: zodResolver(welcomeSchema),
    defaultValues: {
      name: "",
      theme: "",
      startsAt: localDate(Date.now()),
      endsAt: localDate(Date.now() + 48 * 3600000),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      yourName: "",
    },
  });
  const finish = async () => {
    await client.invalidateQueries();
    await navigate({ to: "/board" });
  };
  const create = useMutation({
    mutationFn: (values: Fields) =>
      api.createJam({
        ...values,
        theme: values.theme.trim() || null,
        startsAt: new Date(values.startsAt).toISOString(),
        endsAt: new Date(values.endsAt).toISOString(),
      }),
    onSuccess: finish,
  });
  const demo = useMutation({
    mutationFn: () => api.loadDemoJam(),
    onSuccess: finish,
  });
  const busy = create.isPending || demo.isPending;
  return (
    <main className="welcome">
      <div className="welcome-art">
        <img
          src={boardImage}
          width={220}
          height={220}
          alt="Two teammates planning a game jam"
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
        <span className="eyebrow">JAM BOARD</span>
        <h1>Let's plan a jam</h1>
        <p className="muted">A cozy space for you and your AI teammates.</p>
        <form
          onSubmit={handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <label>
            Jam name
            <input
              {...register("name")}
              placeholder="Our next little adventure"
              aria-invalid={!!errors.name}
            />
          </label>
          {errors.name && (
            <p className="field-error" role="alert">
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
            <p className="field-error" role="alert">
              {errors.endsAt.message}
            </p>
          )}
          <label>
            Timezone
            <input {...register("timezone")} />
          </label>
          <label>
            Your name
            <input
              {...register("yourName")}
              placeholder="How should we call you?"
              aria-invalid={!!errors.yourName}
            />
          </label>
          {errors.yourName && (
            <p className="field-error" role="alert">
              {errors.yourName.message}
            </p>
          )}
          {(create.error || demo.error) && (
            <p role="alert" className="field-error">
              {(create.error ?? demo.error)?.message}
            </p>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {create.isPending ? "Making room…" : "Create jam"}
          </Button>
          <div className="welcome-or">
            <span>or</span>
          </div>
          <Button
            type="button"
            className="demo-link"
            disabled={busy}
            onClick={() => demo.mutate()}
          >
            Load demo jam
          </Button>
        </form>
        <p className="welcome-connect muted small">
          Connect an AI agent later in Settings → MCP
        </p>
      </div>
    </main>
  );
}
