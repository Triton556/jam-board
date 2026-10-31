import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { projectFolders } from "../../lib/project-folder-api";
import { acceptProjectSelection } from "../../lib/project-selection";
import { BoardRecovery } from "./BoardRecovery";

/** Reopening, activity, window focus and periodic comparison also catch external edits. */
export function GlobalBoardRecovery() {
  const client = useQueryClient();
  const info = useQuery({
    queryKey: ["folder-info"],
    queryFn: () => projectFolders.info(),
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const comparison = useQuery({
    queryKey: ["board-snapshot", info.data?.context],
    queryFn: () => {
      if (!info.data) throw new Error("No folder selected");
      return projectFolders.compare(info.data.context);
    },
    enabled: !!info.data,
    retry: false,
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  });
  if (!info.data) return null;
  const missing = /recoveryRequired|Local DB is absent/i.test(
    String(info.error),
  );
  if (
    !missing &&
    (!comparison.data ||
      comparison.data.liveHash === comparison.data.externalHash)
  )
    return null;
  return (
    <BoardRecovery
      key={`${info.data.databaseGeneration}:${missing}`}
      folder={info.data.folder}
      info={missing ? undefined : info.data}
      missingState={missing}
      onRecovered={async () => {
        await acceptProjectSelection(client, await api.appState());
      }}
    />
  );
}
