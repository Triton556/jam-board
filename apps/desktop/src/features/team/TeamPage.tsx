import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import hello from "../../assets/chibi/duo-hello-256.webp";
import { Avatar, Button, Dialog, EmptyState, Stamp } from "../../components/ui";
import {
  ColorSwatches,
  memberColors,
  PageHeading,
  WorkloadBar,
} from "../../components/ui/m5";
import { api } from "../../lib/api";
import { membersQuery } from "../../lib/queries";
import { relativeTime } from "../../lib/time";
import type { Member } from "../../lib/types";
import { AgentStatusLine } from "./AgentStatus";
export function MemberDialog({
  member,
  close,
}: {
  member?: Member;
  close(): void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(member?.name ?? "");
  const [color, setColor] = useState(
    member?.color ?? memberColors[0] ?? "#5B8DEF",
  );
  const [avatar, setAvatar] = useState(member?.avatar ?? "");
  const valid = !!name.trim() && name.length <= 40 && avatar.length <= 16;
  const save = useMutation({
    mutationFn: () =>
      member
        ? api.updateMember({
            id: member.id,
            name: name.trim(),
            color,
            avatar: member.kind === "agent" ? null : avatar,
          })
        : api.createMember({
            name: name.trim(),
            color,
            avatar: avatar || null,
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["members"] });
      close();
    },
  });
  return (
    <Dialog title={member ? "Edit teammate" : "Add human"} onClose={close}>
      <form
        className="m5-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <label>
          Name
          <input
            value={name}
            maxLength={40}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <ColorSwatches value={color} onChange={setColor} />
        {member?.kind !== "agent" && (
          <label>
            Emoji avatar <span className="muted">optional</span>
            <input
              value={avatar}
              maxLength={16}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="🎮"
            />
          </label>
        )}
        {save.error && <p role="alert">{save.error.message}</p>}
        <div className="dialog-actions">
          <Button onClick={close}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!valid || save.isPending}
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
