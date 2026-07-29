// The font families Roblox ships with the client, verbatim from Roblox's own
// Font datatype reference (creator-docs content/en-us/reference/engine/datatypes/Font.yaml).
// Nothing here is recalled — a family that is not on this list has no
// rbxasset://fonts/families/<name>.json file and renders as the fallback font.

export const FONT_FAMILY_PREFIX = 'rbxasset://fonts/families/'

export const FONT_FAMILIES = [
  'AccanthisADFStd',
  'AmaticSC',
  'Arimo',
  'Balthazar',
  'Bangers',
  'BuilderExtended',
  'BuilderMono',
  'BuilderSans',
  'ComicNeueAngular',
  'Creepster',
  'DenkOne',
  'Fondamento',
  'FredokaOne',
  'GrenzeGotisch',
  'Guru',
  'HighwayGothic',
  'Inconsolata',
  'IndieFlower',
  'JosefinSans',
  'Jura',
  'Kalam',
  'LegacyArial',
  'LuckiestGuy',
  'Merriweather',
  'Michroma',
  'Montserrat',
  'Nunito',
  'Oswald',
  'PatrickHand',
  'PermanentMarker',
  'PressStart2P',
  'Roboto',
  'RobotoCondensed',
  'RobotoMono',
  'RomanAntique',
  'Sarpanch',
  'SourceSansPro',
  'SpecialElite',
  'TitilliumWeb',
  'Ubuntu',
  'Zekton',
] as const

/** Roblox's own default UI font. */
export const DEFAULT_FONT_FAMILY = 'BuilderSans'

const BY_LOWER = new Map(FONT_FAMILIES.map((name) => [name.toLowerCase(), name]))

/**
 * Accepts a short family name ("BuilderSans"), a full rbxasset family uri, or
 * an uploaded rbxassetid:// font. Returns null when the name is not a real
 * Roblox family — better a clear error than a silent fallback font.
 */
export function resolveFontFamily(raw: string): string | null {
  const value = raw.trim()
  if (value.startsWith('rbxassetid://')) return value
  if (value.startsWith(FONT_FAMILY_PREFIX)) {
    const base = value.slice(FONT_FAMILY_PREFIX.length).replace(/\.json$/, '')
    const known = BY_LOWER.get(base.toLowerCase())
    return known ? `${FONT_FAMILY_PREFIX}${known}.json` : null
  }
  const known = BY_LOWER.get(value.toLowerCase().replace(/\.json$/, ''))
  return known ? `${FONT_FAMILY_PREFIX}${known}.json` : null
}
