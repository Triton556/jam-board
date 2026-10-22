import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import hello from "../../assets/chibi/duo-hello-256.webp";
import { Avatar, Button, Dialog, EmptyState, Stamp } from "../../components/ui";
import {
  ColorSwatches,
  memberColors,
  PageHeading,
  WorkloadBar,
} from "../../components/ui/m5";
import { ProjectWriteFeedback } from "../../components/ui/ProjectWriteFeedback";
import { api } from "../../lib/api";
import { membersQuery } from "../../lib/queries";
import { relativeTime } from "../../lib/time";
import type { Member } from "../../lib/types";
import { useProjectWrite } from "../../lib/use-project-write";
import { AgentStatusLine } from "./AgentStatus";
export function MemberDialog({
  member,
  close,
}: {
  member?: Member;
  close(): void;
}) {
  const client = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(member?.name ?? "");
  const [color, setColor] = useState(
    member?.color ?? memberColors[0] ?? "#5B8DEF",
  );
  const [avatar, setAvatar] = useState(member?.avatar ?? "");
  const valid = !!name.trim() && name.length <= 40 && avatar.length <= 16;
  const write = useProjectWrite(`member:${member?.id ?? "new"}`);
  const submit = () => {
    if (!valid || write.error) return;
    const input = { name: name.trim(), color, avatar: avatar || null };
    write.run(
      () =>
        member
          ? api.updateMember({
              ...input,
              id: member.id,
              avatar: member.kind === "agent" ? null : input.avatar,
            })
          : api.createMember(input),
      () => {
        void client.invalidateQueries({ queryKey: ["members"] });
        close();
      },
    );
  };
  return (
    <Dialog
      title={member ? "Edit teammate" : "Add human"}
      busy={write.pending}
      onClose={() => write.dismiss(close)}
    >
      <form
        className="m5-form"
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label>
          Name
          <input
            disabled={write.pending || write.checking}
            readOnly={!write.ready || !!write.error}
            value={name}
            maxLength={40}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset
          disabled={!write.ready || !!write.error}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <ColorSwatches value={color} onChange={setColor} />
        </fieldset>
        {member?.kind !== "agent" && (
          <label>
            Emoji avatar <span className="muted">optional</span>
            <input
              disabled={write.pending || write.checking}
              readOnly={!write.ready || !!write.error}
              value={avatar}
              maxLength={16}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="🎮"
            />
          </label>
        )}
        <ProjectWriteFeedback
          write={write}
          form={form}
          action="Saving teammate"
        />
        {write.error && (
          <p role="alert">
            The save outcome is unconfirmed. Your draft is retained. Close and
            inspect the team before submitting again; this request will not be
            replayed.
          </p>
        )}
        <div className="dialog-actions">
          <Button disabled={write.pending} onClick={() => write.dismiss(close)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!valid || !write.ready || !!write.error}
          >
            Save teammate
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function TeamPage({
  openTask,
  connect,
}: {
  openTask(key: string): void;
  connect(): void;
}) {
  const members = useQuery(membersQuery);
  const [edit, setEdit] = useState<Member | true | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      void members.refetch();
    }, 30000);
    return () => clearInterval(timer);
  }, [members.refetch]);
  return (
    <main className="feature-page">
      <div className="team-heading">
        <img src={hello} width={160} height={160} alt="Two teammates waving" />
        <PageHeading title="The team" note="humans and agents, side by side">
          <Button variant="primary" onClick={() => setEdit(true)}>
            Add human
          </Button>
        </PageHeading>
      </div>
      {members.error && <p role="alert">{members.error.message}</p>}
      {(["human", "agent"] as const).map((kind) => (
        <section className="team-section" key={kind}>
          <h2>{kind === "human" ? "Humans" : "Agents"}</h2>
          {kind === "agent" && (
            <p className="muted">
              Agents join automatically when they connect through MCP.{" "}
              <Button variant="ghost" onClick={connect}>
                How to connect →
              </Button>
            </p>
          )}
          <div className="team-grid">
            {members.data
              ?.filter((m) => m.kind === kind)
              .map((m) => (
                <article className="member-card" key={m.id}>
                  <div className="member-top">
                    <Avatar member={m} size={48} />
                    <div>
                      <h3>{m.name}</h3>
                      {kind === "agent" && <AgentStatusLine member={m} />}
                      <small className="mono muted">@{m.handle}</small>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${m.name}`}
                      onClick={() => setEdit(m)}
                    >
                      Edit
                    </Button>
                  </div>
                  {kind === "agent" && (
                    <div className="agent-presence">
                      <Stamp>{m.client}</Stamp>
                      {m.online ? (
                        <span>
                          <i className="online-dot" />
                          Online
                        </span>
                      ) : (
                        <small className="muted">
                          last seen{" "}
                          {m.lastSeenAt
                            ? relativeTime(m.lastSeenAt, now)
                            : "never"}
                        </small>
                      )}
                    </div>
                  )}
                  <div className="working-tasks">
                    {m.workingOn.map((t) => (
                      <button
                        type="button"
                        key={t.key}
                        onClick={() => openTask(t.key)}
                        title={t.title}
                      >
                        Working on <b className="mono">{t.key}</b> · {t.title}
                      </button>
                    ))}
                  </div>
                  <WorkloadBar counts={m.counts} />
                </article>
              ))}
          </div>
          {!members.data?.some((m) => m.kind === kind) && (
            <EmptyState
              text={
                kind === "agent"
                  ? "Your AI teammates will join here"
                  : "Every jam starts with a teammate"
              }
            />
          )}
        </section>
      ))}
      {edit && (
        <MemberDialog
          member={edit === true ? undefined : edit}
          close={() => setEdit(null)}
        />
      )}
    </main>
  );
}
