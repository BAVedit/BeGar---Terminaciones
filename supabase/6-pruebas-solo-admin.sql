-- Pruebas de dptos: solo los administradores cargan (marcar ✓, ✕, N/A, revisiones, observaciones y sus fotos).
-- Los demás miembros siguen viendo todo. Correr una vez en Supabase → SQL Editor → Run (se puede repetir).
-- Para volver a abrirlo a todos los miembros, correr de nuevo 5-pruebas.sql.

drop policy if exists "miembros cargan pruebas" on public.pruebas;
drop policy if exists "admin carga pruebas" on public.pruebas;
create policy "admin carga pruebas" on public.pruebas for insert to authenticated
  with check (public.mi_rol() = 'admin');

drop policy if exists "miembros suben fotos de pruebas" on storage.objects;
drop policy if exists "admin sube fotos de pruebas" on storage.objects;
create policy "admin sube fotos de pruebas" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[2] = 'pruebas' and public.mi_rol() = 'admin');
