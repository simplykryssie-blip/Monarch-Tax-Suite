type Tone = "neutral" | "accent" | "warning" | "danger" | "success";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-muted text-accent",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
  success: "bg-success-muted text-success",
};

// Maps the engagements.status free-text values to a visual tone so staff
// get a quick read without memorizing the exact wording.
const STATUS_TONE: Record<string, Tone> = {
  New: "neutral",
  "Waiting On Client": "warning",
  "Waiting On Staff": "warning",
  "In Progress": "accent",
  "Waiting On Review": "accent",
  "Corrections Requested": "danger",
  Approved: "success",
  "Waiting On Signature": "warning",
  "Waiting On Payment": "warning",
  "Ready To Release": "success",
  Completed: "success",
  Archived: "neutral",
  pending: "neutral",
  in_progress: "accent",
  completed: "success",
  blocked: "danger",
};

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${toneClasses[tone]}`}
    >
      {status}
    </span>
  );
}
