/** An exercise's name in the viewer's language; English falls back to Greek when there is none. */
export function exerciseName(
  e: { nameEl: string; nameEn: string | null },
  lang: 'el' | 'en',
): string {
  return lang === 'en' && e.nameEn ? e.nameEn : e.nameEl;
}

/** i18next may report 'en-GB' or 'el-GR': only the language part decides. */
export function viewerLanguage(language: string): 'el' | 'en' {
  return language.startsWith('en') ? 'en' : 'el';
}
