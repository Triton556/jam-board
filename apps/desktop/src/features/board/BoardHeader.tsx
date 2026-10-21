import { useQuery } from "@tanstack/react-query";
import { SegmentedControl } from "../../components/ui";
import { NewTaskButton } from "../../components/ui/NewTaskButton";
import { templateInfo } from "../../lib/project-template";
import { appQuery, useBoardSettings } from "../../lib/queries";
import { useUiStore } from "../../lib/ui-store";

export function BoardHeader() {
  const { settings, update } = useBoardSettings();
  const app = useQuery(appQuery);
  const copy = templateInfo(app.data?.jam?.template);
  return (
    <div className="board-intro">
      <div>
        <span className="eyebrow">{copy.note}</span>
        <h1>
          {copy.heading}
          <span className="heading-star">✳</span>
        </h1>
      </div>
      <div className="board-actions">
        <span className="muted">Color by:</span>
        <SegmentedControl
          label="Color by"
          value={settings?.colorBy ?? "epic"}
          onChange={(v) => update({ colorBy: v })}
          options={[
            { value: "epic", label: "Epic" },
            { value: "none", label: "None" },
            { value: "assignee", label: "Assignee" },
          ]}
        />
        <NewTaskButton
          onClick={() => useUiStore.getState().setQuickColumn("backlog")}
        />
      </div>
    </div>
  );
}
