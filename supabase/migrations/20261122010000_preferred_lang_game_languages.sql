-- The web UI now ships the languages the game-string pipeline serves
-- (public/i18n/<code>.json, APP_LANGUAGES in src/app/core/locale/locale.types.ts).
-- profiles.preferred_lang and set_preferred_lang() accepted only the old
-- seven-language dropdown (de/en/fr/es/pt/ru/zh), so a signed-in user who picks
-- Italian, Japanese, pt-BR or zh-Hant could not save the choice.
--
-- The legacy codes pt and zh stay valid: rows written by the old dropdown keep
-- passing the check, and normalizeLanguage() maps them to pt-BR / zh-Hans.
-- Nothing is dropped.

alter table public.profiles drop constraint if exists profiles_preferred_lang_check;

alter table public.profiles
  add constraint profiles_preferred_lang_check
    check (
      preferred_lang is null
      or preferred_lang in (
        'de', 'en', 'es', 'es-419', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant',
        'pt', 'zh'
      )
    );

comment on column public.profiles.preferred_lang is
  'Explicit UI language preference set via set_preferred_lang() (one of APP_LANGUAGES; legacy pt/zh still accepted). NULL = no preference, detect from the browser.';

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
    'de', 'en', 'es', 'es-419', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant'
  ) then
    raise exception 'preferred_lang_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set preferred_lang = lang
  where id = caller;
end;
$$;

grant execute on function public.set_preferred_lang(text) to authenticated;
