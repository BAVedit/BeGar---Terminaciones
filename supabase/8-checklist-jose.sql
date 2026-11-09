-- Checklist de Jose: planillas de inspección por dpto (por ahora, carpintería de aluminio).
-- Correr una vez en Supabase → SQL Editor → Run (se puede repetir sin problema). Solo crea cosas nuevas:
-- no cambia marcadores, rubros, pedidos ni miembros (salvo sumar la columna "checklists").
-- Permisos: verifican los administradores y los miembros habilitados para esa planilla; el resto mira.
-- Para habilitar a alguien: en la app, Checklist de Jose → el rubro → "Quién verifica" (solo admin),
-- o en Table Editor → miembros → columna checklists = {aluminio}.

-- Qué planillas puede verificar cada miembro (además de los administradores).
alter table public.miembros add column if not exists checklists text[] not null default '{}';

create or replace function public.verifica_checklist(pl text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros
    where lower(email) = lower(auth.jwt() ->> 'email') and (rol = 'admin' or pl = any(checklists)))
$$;

-- Una fila por dpto y planilla. "datos" lleva la planilla completa: fecha, quién inspeccionó, dictamen
-- y cada ítem (check / no check / N/A, ambientes, observación y rutas de sus fotos en la carpeta "fotos").
create table if not exists public.checklists (
  id              text primary key,
  proyecto        text not null,
  nivel           text not null,
  unidad          text not null,
  plantilla       text not null,
  controlados     integer,
  observados      integer,                  -- ítems con no check
  datos           jsonb not null,
  creado_por      text,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  borrado         boolean not null default false
);
create index if not exists checklists_proyecto on public.checklists (proyecto, plantilla);

create or replace function public.sellar_checklist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado := now();
  new.actualizado_por := auth.jwt() ->> 'email';
  if tg_op = 'INSERT' then new.creado_por := auth.jwt() ->> 'email';
  else new.creado_por := old.creado_por; new.creado := old.creado; new.plantilla := old.plantilla; end if;
  return new;
end $$;
drop trigger if exists checklists_sellar on public.checklists;
create trigger checklists_sellar before insert or update on public.checklists
  for each row execute function public.sellar_checklist();

alter table public.checklists enable row level security;
drop policy if exists "miembros ven checklists" on public.checklists;
create policy "miembros ven checklists" on public.checklists for select to authenticated
  using (public.mi_rol() is not null);
drop policy if exists "verificadores cargan checklists" on public.checklists;
create policy "verificadores cargan checklists" on public.checklists for insert to authenticated
  with check (public.verifica_checklist(plantilla));
drop policy if exists "verificadores modifican checklists" on public.checklists;
create policy "verificadores modifican checklists" on public.checklists for update to authenticated
  using (public.verifica_checklist(plantilla)) with check (public.verifica_checklist(plantilla));
grant select, insert, update on public.checklists to authenticated;

-- Fotos de los "no check": van a fotos/<proyecto>/checklists/<planilla>/…; las sube quien verifica,
-- aunque su rol general sea lector.
drop policy if exists "verificadores suben fotos de checklist" on storage.objects;
create policy "verificadores suben fotos de checklist" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[2] = 'checklists'
    and public.verifica_checklist((storage.foldername(name))[3]));
drop policy if exists "verificadores reemplazan fotos de checklist" on storage.objects;
create policy "verificadores reemplazan fotos de checklist" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[2] = 'checklists'
    and public.verifica_checklist((storage.foldername(name))[3]));

-- Solo el administrador habilita o quita a quién verifica cada planilla.
create or replace function public.permitir_checklist(correo text, plantilla text, permitir boolean) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  r text[];
begin
  if public.mi_rol() is distinct from 'admin' then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  update public.miembros set checklists = case
      when permitir then (select array(select distinct x from unnest(checklists || plantilla) x))
      else array_remove(checklists, plantilla) end
    where lower(email) = lower(correo)
    returning checklists into r;
  if r is null then raise exception 'Miembro no encontrado'; end if;
  return r;
end $$;
revoke execute on function public.permitir_checklist(text, text, boolean) from public;
grant execute on function public.permitir_checklist(text, text, boolean) to authenticated;

-- Cambios en vivo: lo que marca Jose aparece en los demás teléfonos.
do $$ begin
  alter publication supabase_realtime add table public.checklists;
exception when duplicate_object then null; end $$;
