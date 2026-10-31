import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { SettingsRow, SettingsSection } from "../../components/ui/SettingsForm";
import { api } from "../../lib/api";
import {
  type BoardConnectionSetup,
  boardConnectionPrompt,
} from "../../lib/brain-handoff";
import {
  readFolderSettings,
  useFolderGuard,
  writeFolderSettings,
} from "../../lib/project-folder-api";

export function BoardConnectSetup({
  setup,
  disabled = false,
}: {
  setup: Omit<BoardConnectionSetup, "projectFolder">;
  disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const capture = useFolderGuard();
  const settings = useQuery({
    queryKey: ["settings", setup.project.id],
    queryFn: async () => {
      const result = await readFolderSettings(setup.project.id);
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
      const check = await capture();
      const folder = await api.pickFolder();
      await check();
      if (!folder || !current()) return;
      await writeFolderSettings(
        setup.project.id,
        {
          workingDirectory: folder,
          expectedProjectId: setup.project.id,
        },
        check.context,
      );
      await check();
      if (!current()) return;
      await settings.refetch();
      await check();
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await check();
      if (current())
        setNotice(
          "Agent working directory saved. Board storage has not moved.",
        );
    });
  const copy = () =>
    run("copy", async () => {
      if (settings.isPending || settings.isError) return;
      const check = await capture();
      const prompt = boardConnectionPrompt({
        ...setup,
        projectFolder:
          settings.data?.workingDirectory ?? settings.data?.projectFolder,
      });
      await navigator.clipboard.writeText(prompt);
      await check();
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
        label="Agent working directory"
        hint="Optional code folder, such as your Unity project. Board storage is shown in Project settings → Folder."
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
            {settings.data?.workingDirectory ||
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
