-- App de terminaciones Codesarrollos: esquema para Supabase.
-- Se pega una sola vez en Supabase → SQL Editor → New query → Run.
-- Quién entra y con qué permiso se maneja en la tabla "miembros" (ver el final).

-- 1. Miembros: solo estos mails pueden ver o editar.
--    rol = 'admin'  (edita y elimina todo: marcadores y rubros)
--        | 'editor' (carga, edita y cierra marcadores; agrega y edita rubros; no elimina)
--        | 'lector' (mira y deja consultas en los comentarios).
create table if not exists public.miembros (
  email  text primary key,
  nombre text not null,
  rol    text not null constraint miembros_rol_check check (rol in ('admin', 'editor', 'lector'))
);

-- bases creadas antes del rol administrador (mismo contenido que 3-administrador.sql)
alter table public.miembros drop constraint if exists miembros_rol_check;
alter table public.miembros add constraint miembros_rol_check check (rol in ('admin', 'editor', 'lector'));

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.miembros where lower(email) = lower(auth.jwt() ->> 'email')
$$;

-- 2. Marcadores (cada observación sobre el plano).
create table if not exists public.marcadores (
  id           text primary key,
  proyecto     text not null,
  n            integer,
  nivel        text not null,
  unidad       text,
  rubro        text,
  estado       text not null,
  responsable  text,
  datos        jsonb not null,           -- el marcador completo (descripción, ubicación, fotos, historial)
  creado_por   text,                     -- mail de quien lo cargó
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  actualizado_por text,
  borrado      boolean not null default false
);
create index if not exists marcadores_proyecto on public.marcadores (proyecto, actualizado);

-- Número correlativo por proyecto, asignado por la base (dos editores no pueden repetir el #).
create or replace function public.numerar_marcador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.proyecto));
  select coalesce(max(n), 0) + 1 into new.n from public.marcadores where proyecto = new.proyecto;
  new.datos := jsonb_set(new.datos, '{n}', to_jsonb(new.n));
  new.creado_por := auth.jwt() ->> 'email';
  return new;
end $$;
drop trigger if exists marcadores_numerar on public.marcadores;
create trigger marcadores_numerar before insert on public.marcadores
  for each row execute function public.numerar_marcador();

create or replace function public.sellar_marcador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado := now();
  new.actualizado_por := auth.jwt() ->> 'email';
  new.n := old.n; new.creado_por := old.creado_por; new.creado := old.creado;
  -- eliminar marcadores es sólo del administrador
  if new.borrado and not old.borrado and public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede eliminar marcadores' using errcode = '42501';
  end if;
  -- el historial no se pisa: se suman los comentarios que ya estaban (p. ej. consultas de un lector)
  if not new.borrado then
    new.datos := jsonb_set(new.datos, '{comentarios}', coalesce((
      select jsonb_agg(c order by c ->> 'fecha') from (
        select distinct c from jsonb_array_elements(coalesce(old.datos -> 'comentarios', '[]') || coalesce(new.datos -> 'comentarios', '[]')) c
      ) x), '[]'));
  end if;
  new.datos := jsonb_set(new.datos, '{n}', to_jsonb(old.n));
  return new;
end $$;
drop trigger if exists marcadores_sellar on public.marcadores;
create trigger marcadores_sellar before update on public.marcadores
  for each row execute function public.sellar_marcador();

alter table public.marcadores enable row level security;
alter table public.miembros enable row level security;

drop policy if exists "miembros ven marcadores" on public.marcadores;
create policy "miembros ven marcadores" on public.marcadores for select to authenticated
  using (public.mi_rol() is not null);
drop policy if exists "editores cargan" on public.marcadores;
create policy "editores cargan" on public.marcadores for insert to authenticated
  with check (public.mi_rol() in ('admin', 'editor'));
drop policy if exists "editores modifican" on public.marcadores;
create policy "editores modifican" on public.marcadores for update to authenticated
  using (public.mi_rol() in ('admin', 'editor')) with check (public.mi_rol() in ('admin', 'editor'));

drop policy if exists "cada uno ve su fila" on public.miembros;
create policy "cada uno ve su fila" on public.miembros for select to authenticated
  using (public.mi_rol() is not null);

-- Cambios en vivo: los demás teléfonos ven los marcadores nuevos sin recargar.
do $$ begin
  alter publication supabase_realtime add table public.marcadores;
exception when duplicate_object then null; end $$;

-- 2b. Rubros que el equipo agrega desde la app (quedan para todos).
create table if not exists public.rubros (
  id           text primary key,
  proyecto     text not null,
  nombre       text not null,
  responsables jsonb not null default '[]',
  eliminado    boolean not null default false,
  actualizado  timestamptz,
  creado       timestamptz not null default now()
);
-- Para bases creadas antes de "editar rubros" (mismo contenido que 2-editar-rubros.sql).
alter table public.rubros add column if not exists eliminado boolean not null default false;
alter table public.rubros add column if not exists actualizado timestamptz;
-- Rubros: los editores los agregan y editan; eliminarlos es sólo del administrador.
create or replace function public.cuidar_rubro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.eliminado and (tg_op = 'INSERT' or not old.eliminado) and public.mi_rol() is distinct from 'admin' then
    raise exception 'Solo el administrador puede eliminar rubros' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists rubros_cuidar on public.rubros;
create trigger rubros_cuidar before insert or update on public.rubros
  for each row execute function public.cuidar_rubro();
do $$ begin
  alter publication supabase_realtime add table public.rubros;
exception when duplicate_object then null; end $$;
alter table public.rubros enable row level security;
drop policy if exists "miembros ven rubros" on public.rubros;
create policy "miembros ven rubros" on public.rubros for select to authenticated
  using (public.mi_rol() is not null);
drop policy if exists "editores agregan rubros" on public.rubros;
create policy "editores agregan rubros" on public.rubros for insert to authenticated
  with check (public.mi_rol() in ('admin', 'editor'));
drop policy if exists "editores cambian rubros" on public.rubros;
create policy "editores cambian rubros" on public.rubros for update to authenticated
  using (public.mi_rol() in ('admin', 'editor')) with check (public.mi_rol() in ('admin', 'editor'));

-- 3. Fotos: carpeta privada "fotos"; las ven los miembros y las suben los editores.
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false)
  on conflict (id) do nothing;
drop policy if exists "miembros ven fotos" on storage.objects;
create policy "miembros ven fotos" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.mi_rol() is not null);
drop policy if exists "editores suben fotos" on storage.objects;
create policy "editores suben fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.mi_rol() in ('admin', 'editor'));

drop policy if exists "editores reemplazan fotos" on storage.objects;
create policy "editores reemplazan fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.mi_rol() in ('admin', 'editor'));

-- Consultas: cualquier miembro (también un lector) puede dejar un comentario en un marcador.
create or replace function public.comentar(marcador text, texto text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  r jsonb;
begin
  if public.mi_rol() is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if length(trim(coalesce(texto, ''))) = 0 or length(texto) > 2000 then raise exception 'Comentario vacío o demasiado largo'; end if;
  c := jsonb_build_object(
    'texto', trim(texto),
    'autor', (select nombre from public.miembros where lower(email) = lower(auth.jwt() ->> 'email')),
    'fecha', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'consulta', public.mi_rol() = 'lector');
  update public.marcadores set datos = jsonb_set(datos, '{comentarios}', coalesce(datos -> 'comentarios', '[]') || c)
    where id = marcador and not borrado
    returning datos -> 'comentarios' into r;
  if r is null then raise exception 'Marcador no encontrado'; end if;
  return r;
end $$;
revoke execute on function public.comentar(text, text) from public;
grant execute on function public.comentar(text, text) to authenticated;

-- Permisos de la API (las reglas de arriba deciden qué fila ve o cambia cada uno).
grant select, insert, update on public.marcadores, public.rubros to authenticated;
grant select on public.miembros to authenticated;

-- 4. Quién entra. Cambiá los mails y nombres; agregá una línea por persona.
--    Para sumar a alguien después: Table Editor → miembros → Insert row.
insert into public.miembros (email, nombre, rol) values
  ('tu-mail@ejemplo.com', 'Bruno', 'admin')
  -- ,('companero@ejemplo.com', 'Nombre del compañero', 'editor')
  -- ,('jefe@ejemplo.com', 'Nombre del jefe', 'lector')
on conflict (email) do update set nombre = excluded.nombre, rol = excluded.rol;
