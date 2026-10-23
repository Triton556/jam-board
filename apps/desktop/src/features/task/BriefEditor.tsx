import type { Acceptance, BriefTest, Change, TaskBrief } from "../../bindings";
import { Stamp, Tooltip } from "../../components/ui";
import { ListEditor } from "../../components/ui/ListEditor";
import { MarkdownField } from "../../components/ui/MarkdownField";
import { Switch } from "../../components/ui/m5";
export const briefMeanings = {
  goalMd: "The observable outcome, and who it helps.",
  contextMd: "What already exists and why the work is needed.",
  whereMd: "The exact files, routes or objects to change.",
  boundariesMd: "What must not change; permissions and limits.",
  resultMd: "The report format and evidence the reviewer needs.",
  userQuotesMd: "The user's exact words that constrain this task.",
};
export function ChangesEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Change[];
  onChange(v: Change[]): void;
  disabled?: boolean;
}) {
  return (
    <ListEditor
      label="Change"
      value={value}
      onChange={onChange}
      disabled={disabled}
      create={() => ({
        title: "",
        now: "",
        cause: "",
        required: "",
        where: "",
        follow: "",
        keep: "",
      })}
    >
      {(row, index, patch) => (
        <>
          <label>
            Title
            <input
              aria-label={`Change ${index + 1} title`}
              value={row.title}
              required
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label>
            Required <span aria-hidden="true">*</span>
            <textarea
              aria-label={`Change ${index + 1} required`}
              value={row.required}
              required
              aria-required="true"
              onChange={(e) => patch({ required: e.target.value })}
            />
          </label>
          {(!row.title.trim() || !row.required.trim()) && (
            <p role="alert" className="field-error">
              Each change needs Title and Required.
            </p>
          )}
          <details
            open={
              !!(row.now || row.cause || row.where || row.follow || row.keep)
            }
          >
            <summary>Context and guardrails</summary>
            {(["now", "cause", "where", "follow", "keep"] as const).map(
              (field) => (
                <label key={field}>
                  <span>
                    {field.charAt(0).toUpperCase() + field.slice(1)}{" "}
                    <Tooltip
                      text={
                        field === "follow"
                          ? "An existing place in the code that already does it this way."
                          : field === "keep"
                            ? "Existing behavior and material that must survive."
                            : field === "cause"
                              ? "Why the current behavior needs to change."
                              : field === "where"
                                ? "The exact place for this change."
                                : "What happens today."
                      }
                    >
                      <button
                        type="button"
                        aria-label="Field help"
                        tabIndex={0}
                        className="help-mark"
                      >
                        ?
                      </button>
                    </Tooltip>
                  </span>
                  <textarea
                    aria-label={`Change ${index + 1} ${field}`}
                    value={row[field]}
                    onChange={(e) => patch({ [field]: e.target.value })}
                  />
                </label>
              ),
            )}
          </details>
        </>
      )}
    </ListEditor>
  );
}
export function TestsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: BriefTest[];
  onChange(v: BriefTest[]): void;
  disabled?: boolean;
}) {
  return (
    <ListEditor
      label="Test"
      value={value}
      onChange={onChange}
      disabled={disabled}
      create={() => ({ setup: "", expected: "" })}
    >
      {(row, index, patch) => (
        <>
          <label>
            Setup
            <textarea
              aria-label={`Test ${index + 1} setup`}
              value={row.setup}
              required
              onChange={(e) => patch({ setup: e.target.value })}
            />
          </label>
          <span className="muted">→</span>
          <label>
            Expected result
            <textarea
              aria-label={`Test ${index + 1} expected`}
              value={row.expected}
              required
              onChange={(e) => patch({ expected: e.target.value })}
            />
          </label>
          {(!row.setup.trim() || !row.expected.trim()) && (
            <p role="alert" className="field-error">
              Each test needs setup and expected result.
            </p>
          )}
        </>
      )}
    </ListEditor>
  );
}
export function AcceptanceEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Acceptance[];
  onChange(v: Acceptance[]): void;
  disabled?: boolean;
}) {
  return (
    <ListEditor
      label="Criterion"
      value={value}
      onChange={onChange}
      disabled={disabled}
      create={() => ({
        id: crypto.randomUUID(),
        criterion: "",
        mandatory: true,
        check: "",
      })}
    >
      {(row, index, patch) => (
        <>
          <label>
            Criterion
            <input
              aria-label={`Criterion ${index + 1}`}
              value={row.criterion}
              required
              onChange={(e) => patch({ criterion: e.target.value })}
            />
          </label>
          <Switch
            label={`Mandatory ${index + 1}`}
            checked={row.mandatory}
            onChange={(mandatory) => patch({ mandatory })}
          />
          {row.mandatory && <Stamp>mandatory</Stamp>}
          <label>
            How it is checked
            <input
              aria-label={`Criterion ${index + 1} check`}
              value={row.check}
              required
              onChange={(e) => patch({ check: e.target.value })}
            />
          </label>
          {(!row.criterion.trim() || !row.check.trim()) && (
            <p role="alert" className="field-error">
              Add the criterion and how it is checked.
            </p>
          )}
        </>
      )}
    </ListEditor>
  );
}
export function BriefEditor({
  value,
  onChange,
  onSave,
  disabled = false,
}: {
  value: TaskBrief;
  onChange(v: TaskBrief): void;
  onSave(nextFocus?: EventTarget | null): void;
  disabled?: boolean;
}) {
  const field = (key: keyof typeof briefMeanings, label: string) => (
    <MarkdownField
      key={key}
      field={key.replace("Md", "")}
      label={label}
      value={value[key] ?? ""}
      onChange={(text) => onChange({ ...value, [key]: text })}
      onSave={onSave}
      meaning={briefMeanings[key]}
      disabled={disabled}
    />
  );
  return (
    <section
      className="brief-editor"
      aria-label="Task brief"
      data-testid="task-brief"
    >
      {field("goalMd", "Goal")}
      {field("contextMd", "Context")}
      {field("whereMd", "Where")}
      <section data-brief-field="change">
        <h3>
          Changes{" "}
          <Tooltip text="Concrete changes with current behavior, cause, required result and preservation.">
            <button
              type="button"
              aria-label="Field help"
              tabIndex={0}
              className="help-mark"
            >
              ?
            </button>
          </Tooltip>
        </h3>
        <ChangesEditor
          value={value.changes ?? []}
          onChange={(changes) => onChange({ ...value, changes })}
          disabled={disabled}
        />
      </section>
      <section data-brief-field="test">
        <h3>
          Tests{" "}
          <Tooltip text="A reproducible setup and an observable expected result.">
            <button
              type="button"
              aria-label="Field help"
              tabIndex={0}
              className="help-mark"
            >
              ?
            </button>
          </Tooltip>
        </h3>
        <TestsEditor
          value={value.tests ?? []}
          onChange={(tests) => onChange({ ...value, tests })}
          disabled={disabled}
        />
      </section>
      {field("boundariesMd", "Boundaries")}
      {field("resultMd", "Result")}
      {field("userQuotesMd", "User quotes")}
    </section>
  );
}
