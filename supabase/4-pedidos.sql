-- Pedido de materiales: pedidos (PM) con sus renglones, remisiones recibidas y comentarios.
-- Correr una vez en Supabase → SQL Editor → Run (se puede repetir sin problema). Solo crea cosas nuevas:
-- no cambia marcadores, rubros ni miembros.
-- Permisos: el administrador carga y edita pedidos y remisiones; el resto de los miembros los ve y comenta.

-- Un pedido por fila. "datos" lleva el pedido completo: cabecera, renglones, remisiones (con las rutas de
-- sus fotos en la carpeta "fotos") y comentarios, igual que los marcadores.
create table if not exists public.pedidos (
  id              text primary key,
  proyecto        text not null,
  n               integer,                  -- número de PM (BEGAR-PM-15, 16…), lo pone la base
  fecha           date,
  prioridad       text,
  estado          text,
  datos           jsonb not null,
  creado_por      text,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  borrado         boolean not null default false
);
create index if not exists pedidos_proyecto on public.pedidos (proyecto, actualizado);

-- Numeración: sigue la planilla en papel, que llegó hasta el PM-14.
create or replace function public.numerar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('pedidos-' || new.proyecto));
  select coalesce(max(n), 14) + 1 into new.n from public.pedidos where proyecto = new.proyecto;
  new.datos := jsonb_set(new.datos, '{n}', to_jsonb(new.n));
  new.creado_por := auth.jwt() ->> 'email';
  return new;
end $$;
drop trigger if exists pedidos_numerar on public.pedidos;
create trigger pedidos_numerar before insert on public.pedidos
  for each row execute function public.numerar_pedido();

create or replace function public.sellar_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actualizado := now();
  new.actualizado_por := auth.jwt() ->> 'email';
  new.n := old.n; new.creado_por := old.creado_por; new.creado := old.creado;
  -- los comentarios no se pisan: se suman los que ya estaban (p. ej. de un lector)
  new.datos := jsonb_set(new.datos, '{comentarios}', coalesce((
    select jsonb_agg(c order by c ->> 'fecha') from (
      select distinct c from jsonb_array_elements(coalesce(old.datos -> 'comentarios', '[]') || coalesce(new.datos -> 'comentarios', '[]')) c
    ) x), '[]'));
  new.datos := jsonb_set(new.datos, '{n}', to_jsonb(old.n));
  return new;
end $$;
drop trigger if exists pedidos_sellar on public.pedidos;
create trigger pedidos_sellar before update on public.pedidos
  for each row execute function public.sellar_pedido();

alter table public.pedidos enable row level security;
drop policy if exists "miembros ven pedidos" on public.pedidos;
create policy "miembros ven pedidos" on public.pedidos for select to authenticated
  using (public.mi_rol() is not null);
drop policy if exists "admin carga pedidos" on public.pedidos;
create policy "admin carga pedidos" on public.pedidos for insert to authenticated
  with check (public.mi_rol() = 'admin');
drop policy if exists "admin modifica pedidos" on public.pedidos;
create policy "admin modifica pedidos" on public.pedidos for update to authenticated
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');
grant select, insert, update on public.pedidos to authenticated;

-- Comentarios: cualquier miembro puede comentar un pedido.
create or replace function public.comentar_pedido(pedido text, texto text) returns jsonb
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
    'fecha', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  update public.pedidos set datos = jsonb_set(datos, '{comentarios}', coalesce(datos -> 'comentarios', '[]') || c)
    where id = pedido and not borrado
    returning datos -> 'comentarios' into r;
  if r is null then raise exception 'Pedido no encontrado'; end if;
  return r;
end $$;
revoke execute on function public.comentar_pedido(text, text) from public;
grant execute on function public.comentar_pedido(text, text) to authenticated;

-- Cambios en vivo: los demás teléfonos ven el pedido o la remisión apenas se cargan.
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; end $$;
