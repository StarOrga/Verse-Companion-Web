-- Hindi joins the web UI languages (public/i18n/hi.json, APP_LANGUAGES in
-- src/app/core/locale/locale.types.ts), matching the desktop app's language set.
-- profiles.preferred_lang and set_preferred_lang() accept 'hi' from now on.
-- Legacy pt / zh stay valid as in 20261122010000. Nothing is dropped.

alter table public.profiles drop constraint if exists profiles_preferred_lang_check;

alter table public.profiles
  add constraint profiles_preferred_lang_check
    check (
      preferred_lang is null
      or preferred_lang in (
        'de', 'en', 'es', 'es-419', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant',
        'pt', 'zh'
      )
    );

create or replace function public.set_preferred_lang(lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if lang is not null and lang not in (
    'de', 'en', 'es', 'es-419', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant'
  ) then
    raise exception 'preferred_lang_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set preferred_lang = lang
  where id = caller;
end;
$$;

grant execute on function public.set_preferred_lang(text) to authenticated;
