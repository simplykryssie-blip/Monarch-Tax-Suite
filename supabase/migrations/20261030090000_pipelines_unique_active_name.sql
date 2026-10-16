-- A double-sent "create" can't make two pipelines: among a tenant's active pipelines of one kind, names are unique
-- (ignoring case). Archived pipelines don't count, so an archived duplicate can keep its name.
create unique index if not exists pipelines_active_name_key on public.pipelines (tenant_id, kind, lower(name)) where archived_at is null;
