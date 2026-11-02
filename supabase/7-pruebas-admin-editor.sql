-- Pruebas de dptos: cargan los administradores y los editores (marcar ✓, ✕, N/A, revisiones, observaciones y sus fotos).
-- Los lectores siguen viendo todo sin cargar. Correr una vez en Supabase → SQL Editor → Run (se puede repetir).
-- Reemplaza a 6-pruebas-solo-admin.sql.

drop policy if exists "miembros cargan pruebas" on public.pruebas;
drop policy if exists "admin carga pruebas" on public.pruebas;
drop policy if exists "admin y editores cargan pruebas" on public.pruebas;
create policy "admin y editores cargan pruebas" on public.pruebas for insert to authenticated
  with check (public.mi_rol() in ('admin', 'editor'));

drop policy if exists "miembros suben fotos de pruebas" on storage.objects;
drop policy if exists "admin sube fotos de pruebas" on storage.objects;
drop policy if exists "admin y editores suben fotos de pruebas" on storage.objects;
create policy "admin y editores suben fotos de pruebas" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[2] = 'pruebas' and public.mi_rol() in ('admin', 'editor'));
