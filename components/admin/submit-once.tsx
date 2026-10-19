"use client";

import { useFormStatus } from "react-dom";

/** A submit button that disables itself while its form is being sent, so a double click can't send it twice. */
export function SubmitOnce({ children, busy = "Saving…", className, disabled }: { children: React.ReactNode; busy?: string; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={disabled || pending} aria-busy={pending}>{pending ? busy : children}</button>;
}
