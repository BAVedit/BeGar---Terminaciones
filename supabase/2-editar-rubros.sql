-- Editar y eliminar rubros desde la app (correr una vez en Supabase → SQL Editor → Run).
-- Se puede correr de nuevo sin problema.
alter table public.rubros add column if not exists eliminado boolean not null default false;
alter table public.rubros add column if not exists actualizado timestamptz;
do $$ begin
  alter publication supabase_realtime add table public.rubros;
exception when duplicate_object then null; end $$;
