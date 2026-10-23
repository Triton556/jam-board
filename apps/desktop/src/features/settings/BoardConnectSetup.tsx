import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  type BoardConnectionSetup,
  boardConnectionPrompt,
} from "../../lib/brain-handoff";

export function BoardConnectSetup({
  setup,
  disabled = false,
}: {
  setup: Omit<BoardConnectionSetup, "projectFolder">;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", setup.project.id],
    queryFn: async () => {
      const result = await api.getSettings();
      if (result.projectId !== setup.project.id)
        throw new Error(
          "Project changed. Reload this board before connecting.",
        );
      return result;
    },
    staleTime: 0,
  });
  const [pending, setPending] = useState<"copy" | "folder" | null>(null);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    queryClient.getQueryData<Awaited<ReturnType<typeof api.appState>>>(["app"])
      ?.jam?.id === setup.project.id;
  const run = async (kind: "copy" | "folder", action: () => Promise<void>) => {
    if (locked.current || disabled || !current()) return;
    locked.current = true;
    setPending(kind);
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (current())
        setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      locked.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const chooseFolder = () =>
    run("folder", async () => {
      const folder = await api.pickFolder();
      if (!folder || !current()) return;
      await api.setSettings({
        projectFolder: folder,
        expectedProjectId: setup.project.id,
      });
      if (!current()) return;
      await settings.refetch();
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (current())
        setNotice(
          "Project folder saved for this board. No files were created.",
        );
    });
  const copy = () =>
    run("copy", async () => {
      if (settings.isPending || settings.isError) return;
      const prompt = boardConnectionPrompt({
        ...setup,
        projectFolder: settings.data?.projectFolder,
      });
      await navigator.clipboard.writeText(prompt);
      if (current())
        setNotice(
          "Connection prompt copied. Paste it into your agent chat; nothing has connected yet.",
        );
    });
  return (
    <SettingsSection
      title="Connect an agent to this board"
      description="One prompt helps your agent check or set up MCP, verify this project and read the board instructions."
    >
      <SettingsRow
        label="Agent connection"
        hint={`${setup.client === "codex" ? "Codex" : "Claude Code"} · ${setup.transport}. Change the client and transport in the configuration section below.`}
      >
        <Button
          variant="primary"
          disabled={
            disabled ||
            pending !== null ||
            settings.isPending ||
            settings.isError
          }
          onClick={() => void copy()}
        >
          {pending === "copy" ? "Copying…" : "Copy agent connection prompt"}
        </Button>
        <p className="small">
          No token is copied. Connecting does not appoint a brain or start work.
        </p>
      </SettingsRow>
      <SettingsRow
        label="Project folder"
        hint="An optional code folder for this board, not its identity or permission to change files."
      >
        {settings.isPending && !settings.isFetching ? (
          <span>Reading saved folder…</span>
        ) : settings.isError || (settings.isPending && settings.isFetching) ? (
          <>
            <span role={settings.isError ? "alert" : "status"}>
              {settings.isError
                ? "Could not read the saved folder."
                : "Reading saved folder…"}
            </span>
            <Button
              disabled={disabled || settings.isFetching}
              aria-busy={settings.isFetching}
              onClick={() => void settings.refetch({ cancelRefetch: false })}
            >
              {settings.isFetching ? "Reading folder…" : "Retry folder"}
            </Button>
          </>
        ) : (
          <span className="path-value">
            {settings.data?.projectFolder ||
              "Not set. The agent will ask where the project lives."}
          </span>
        )}
        <Button
          disabled={
            disabled ||
            pending !== null ||
            settings.isPending ||
            settings.isError
          }
          onClick={() => void chooseFolder()}
        >
          {pending === "folder" ? "Saving folder…" : "Choose code folder…"}
        </Button>
      </SettingsRow>
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </SettingsSection>
  );
}
