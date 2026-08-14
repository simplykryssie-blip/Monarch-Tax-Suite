import { toggleTaskComplete } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

export type TaskRowData = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString();
}

export function TaskRow({ task, showStatus = true }: { task: TaskRowData; showStatus?: boolean }) {
  const isComplete = task.status === "completed";

  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className={`text-sm font-medium ${isComplete ? "line-through text-muted" : ""}`}>{task.title}</p>
        <p className="text-xs text-muted">{formatDate(task.due_date)}</p>
      </div>
      <div className="flex items-center gap-3">
        {showStatus && <StatusPill status={task.status} />}
        <form action={toggleTaskComplete}>
          <input type="hidden" name="task_id" value={task.id} />
          <input type="hidden" name="next_status" value={isComplete ? "pending" : "completed"} />
          <Button type="submit" size="sm" variant="secondary">
            {isComplete ? "Reopen" : "Mark done"}
          </Button>
        </form>
      </div>
    </div>
  );
}
