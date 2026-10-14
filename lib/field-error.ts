// Shows a problem right under the field it belongs to. Returns false when the field can't be found, so the caller can
// fall back to a banner. The message is plain text, set with textContent.

const MARK = "data-field-error";

export function clearFieldErrors(form: HTMLElement | null) {
  if (!form) return;
  form.querySelectorAll(`[${MARK}]`).forEach((el) => el.remove());
  form.querySelectorAll("[aria-invalid]").forEach((el) => { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); });
}

export function showFieldError(form: HTMLElement | null, name: string, message: string): boolean {
  const field = form?.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]:not([type="hidden"])`);
  if (!form || !field) return false;
  clearFieldErrors(form);
  const note = document.createElement("small");
  note.setAttribute(MARK, "true");
  note.id = `err-${name}`;
  note.className = "field-error";
  note.setAttribute("role", "alert");
  note.textContent = message;
  // After the labelled wrapper's input; formatted inputs sit in their own span, so go after the field itself.
  field.insertAdjacentElement("afterend", note);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", note.id);
  field.focus();
  return true;
}
