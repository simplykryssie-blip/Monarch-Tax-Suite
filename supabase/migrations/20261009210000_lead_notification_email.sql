-- Optional notification email per license (additive, non-destructive).
-- Not applied automatically: apply after owner approval. The app works without
-- it (the field is only written when set).
alter table public.crm_lead_settings
  add column if not exists notification_email text
  check (notification_email is null or (char_length(notification_email) <= 254 and notification_email ~* '^[^@[:space:]<>",;:]+@[^@[:space:]<>",;:]+\.[a-z]{2,}$'));
