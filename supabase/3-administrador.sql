-- Rol administrador: el único que elimina marcadores y rubros.
-- Editores: cargan, editan y cierran marcadores; agregan y editan rubros. Lectores: miran y dejan consultas en los comentarios.
-- Correr una vez en Supabase → SQL Editor → Run (se puede repetir sin problema).
-- Después, en Table Editor → miembros, poner rol = admin a quien administra la obra.

-- (incluye lo de 2-editar-rubros.sql, por si no se corrió)
alter table public.rubros add column if not exists eliminado boolean not null default false;
alter table public.rubros add column if not exists actualizado timestamptz;

alter table public.miembros drop constraint if exists miembros_rol_check;
alter table public.miembros add constraint miembros_rol_check check (rol in ('admin', 'editor', 'lector'));

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
drop policy if exists "editores cargan" on public.marcadores;
create policy "editores cargan" on public.marcadores for insert to authenticated
  with check (public.mi_rol() in ('admin', 'editor'));
drop policy if exists "editores modifican" on public.marcadores;
create policy "editores modifican" on public.marcadores for update to authenticated
  using (public.mi_rol() in ('admin', 'editor')) with check (public.mi_rol() in ('admin', 'editor'));
drop policy if exists "editores agregan rubros" on public.rubros;
create policy "editores agregan rubros" on public.rubros for insert to authenticated
  with check (public.mi_rol() in ('admin', 'editor'));
drop policy if exists "editores cambian rubros" on public.rubros;
create policy "editores cambian rubros" on public.rubros for update to authenticated
  using (public.mi_rol() in ('admin', 'editor')) with check (public.mi_rol() in ('admin', 'editor'));
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
