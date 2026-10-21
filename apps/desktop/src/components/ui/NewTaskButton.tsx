import { Plus } from "lucide-react";
import { Button, Kbd } from "./index";

export function NewTaskButton({ onClick }: { onClick(): void }) {
  return (
    <Button variant="primary" className="new-task-button" onClick={onClick}>
      <Plus size={16} />
      New task<Kbd>N</Kbd>
    </Button>
  );
}
