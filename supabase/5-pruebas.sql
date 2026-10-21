-- Pruebas de dptos: checklist de puesta en marcha (Aprueba / No aprueba) con hilo de seguimiento.
-- Correr una vez en Supabase → SQL Editor → Run (se puede repetir sin problema). Solo crea cosas nuevas:
-- no cambia marcadores, pedidos, rubros ni miembros.
-- Cada fila es una entrada: un toque de Aprueba, un No aprueba o una actualización del hilo. Las filas solo se
-- agregan (no se editan ni se borran), así el registro de por qué algo no funcionaba no se pierde.
-- Permisos: cualquier miembro (también los lectores) carga pruebas y sus fotos.

create table if not exists public.pruebas (
  id          text primary key,
  proyecto    text not null,
  nivel       text not null,               -- N1…N5, o COM para las áreas comunes
  unidad      text not null,               -- 3B, o el espacio común (quincho, generador…)
  item        text not null,               -- id del ítem en visor/pruebas.json
  hilo        text,                        -- hilo de un No aprueba; vacío si aprobó de entrada
  estado      text not null check (estado in ('aprueba', 'no_aprueba', 'pendiente')),
  datos       jsonb not null,              -- locales, descripción, fotos, rubro, responsable, marcador, fecha del teléfono
  creado_por  text,                        -- mail de quien la cargó (lo pone la base)
  creado      timestamptz not null default now()
);
create index if not exists pruebas_proyecto on public.pruebas (proyecto, creado);

-- Quién y cuándo los sella la base; el nombre del autor sale de la tabla de miembros.
create or replace function public.sellar_prueba() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nom text;
begin
  new.creado := now();
  new.creado_por := auth.jwt() ->> 'email';
  select nombre into nom from public.miembros where lower(email) = lower(new.creado_por);
  if nom is not null then new.datos := jsonb_set(new.datos, '{autor}', to_jsonb(nom)); end if;
  return new;
end $$;
drop trigger if exists pruebas_sellar on public.pruebas;
create trigger pruebas_sellar before insert on public.pruebas
  for each row execute function public.sellar_prueba();

alter table public.pruebas enable row level security;
drop policy if exists "miembros ven pruebas" on public.pruebas;
create policy "miembros ven pruebas" on public.pruebas for select to authenticated
  using (public.mi_rol() is not null);
drop policy if exists "miembros cargan pruebas" on public.pruebas;
create policy "miembros cargan pruebas" on public.pruebas for insert to authenticated
  with check (public.mi_rol() is not null);
-- sin políticas de update ni delete: nadie puede cambiar ni borrar una entrada
grant select, insert on public.pruebas to authenticated;

-- Fotos de las pruebas (carpeta <proyecto>/pruebas/… dentro de "fotos"): las sube cualquier miembro.
drop policy if exists "miembros suben fotos de pruebas" on storage.objects;
create policy "miembros suben fotos de pruebas" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[2] = 'pruebas' and public.mi_rol() is not null);

-- Cambios en vivo: lo que se prueba en un teléfono aparece en los demás.
do $$ begin
  alter publication supabase_realtime add table public.pruebas;
exception when duplicate_object then null; end $$;
