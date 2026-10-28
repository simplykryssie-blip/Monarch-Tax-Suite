/** Sign-in security changes that are written to the workspace's history, and how the Activity log says them. */
export const SECURITY_ACTIONS = {
  security_two_step_enabled: "Two-step sign-in turned on",
  security_two_step_removed: "Two-step sign-in turned off",
} as const;
export type SecurityAction = keyof typeof SECURITY_ACTIONS;
export const isSecurityAction = (v: unknown): v is SecurityAction => typeof v === "string" && Object.prototype.hasOwnProperty.call(SECURITY_ACTIONS, v);
