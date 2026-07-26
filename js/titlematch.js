/* Conservative matching between scanner guesses and titles already in Linkflix.
   Exact display-title matches win. Wikipedia-style disambiguators are ignored only
   when that produces one unambiguous result, preventing accidental library merges. */

function baseKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exactTitleKey(value) {
  return baseKey(value);
}

export function mediaTitleKey(value) {
  const withoutDisambiguator = String(value || '').replace(
    /\s*\((?:(?:19|20)\d{2}\s+)?(?:film|movie|tv\s+series|television\s+series|series|miniseries)\)\s*$/i,
    ''
  );
  return baseKey(withoutDisambiguator);
}

export function findLibraryTitleMatch(library, type, candidateTitle) {
  const candidates = (Array.isArray(library) ? library : []).filter(item => item?.type === type);
  const exact = exactTitleKey(candidateTitle);
  const exactMatches = candidates.filter(item => exactTitleKey(item.title) === exact);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const canonical = mediaTitleKey(candidateTitle);
  if (!canonical) return null;
  const canonicalMatches = candidates.filter(item => mediaTitleKey(item.title) === canonical);
  return canonicalMatches.length === 1 ? canonicalMatches[0] : null;
}
