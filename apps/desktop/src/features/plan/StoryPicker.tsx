import { useQuery } from "@tanstack/react-query";
import { CustomSelect } from "../../components/ui/CustomSelect";
import { epicsQuery, storiesQuery } from "../../lib/planning-queries";

export function StoryPicker({
  value,
  onChange,
  label = "Story",
  epicKey,
  epicKeys,
  disabled = false,
  remember = false,
}: {
  value: string;
  onChange(key: string): void;
  label?: string;
  epicKey?: string;
  epicKeys?: string[];
  disabled?: boolean;
  remember?: boolean;
}) {
  const stories = useQuery(storiesQuery),
    epics = useQuery(epicsQuery);
  const allowedKeys = epicKeys ?? (epicKey ? [epicKey] : []);
  const allowedIds = new Set(
    (epics.data ?? [])
      .filter((epic) => allowedKeys.includes(epic.key))
      .map((epic) => epic.id),
  );
  return (
    <CustomSelect
      label={label}
      value={value}
      disabled={disabled}
      searchable
      onChange={(key) => {
        onChange(key);
        if (remember)
          try {
            localStorage.setItem("jam.lastStory", key);
          } catch {}
      }}
      options={[
        { value: "", label: "Choose a story" },
        ...(stories.data ?? [])
          .filter((s) => !allowedKeys.length || allowedIds.has(s.epicId))
          .map((s) => ({
            value: s.key,
            label: `${s.key} · ${s.title}`,
            group:
              epics.data?.find((e) => e.id === s.epicId)?.title ?? "Stories",
          })),
      ]}
    />
  );
}
