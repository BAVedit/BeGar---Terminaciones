-- Cada persona ve solo su propia fila de "miembros" (antes cualquier miembro veía los mails y roles de todos).
-- Correr una vez en Supabase → SQL Editor → Run. Se puede correr de nuevo sin problema.
drop policy if exists "cada uno ve su fila" on public.miembros;
create policy "cada uno ve su fila" on public.miembros for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
