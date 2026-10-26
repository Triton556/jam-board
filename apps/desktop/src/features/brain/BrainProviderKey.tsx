import { useState } from "react";
import { Button } from "../../components/ui";

export function BrainProviderKey({
  keySet,
  busy,
  save,
  clear,
}: {
  keySet: boolean;
  busy: boolean;
  save(key: string): Promise<void>;
  clear(): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
      setEditing(false);
    } catch {
      setError("Could not update the key. Enter it again to retry.");
    } finally {
      setKey("");
    }
  };
  return (
    <div className="brain-provider-key">
      <span role="status">API key: {keySet ? "Set" : "Not set"}</span>
      {editing ? (
        <>
          <label>
            API key
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="button-row">
            <Button
              disabled={busy || !key.trim()}
              onClick={() => {
                const value = key;
                setKey("");
                void run(() => save(value));
              }}
            >
              Save key
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setKey("");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="button-row">
          <Button disabled={busy} onClick={() => setEditing(true)}>
            {keySet ? "Replace" : "Add"}
          </Button>
          {keySet && (
            <Button disabled={busy} onClick={() => void run(clear)}>
              Clear
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
