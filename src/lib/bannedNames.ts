/**
 * Prohibited Invented Character Names Runtime Authority (§13).
 * The TypeScript file is the runtime authority; docs/banned-names.md is the architectural spec.
 */

export const BANNED_FIRST_NAMES = [
  'Elias',
  'Mara',
  'Silas',
  'Ezra',
  'Gideon',
  'Caleb',
  'Lucien',
  'Malachi',
  'Damien',
  'Damian',
  'Astrid',
  'Lilith',
  'Ambrose',
  'Seraphina',
  'Kael',
  'Lyra',
  'Rowan',
  'Ash',
  'Ember',
  'Raven',
  'Luna',
  'Atlas',
  'Orion',
  'Ophelia',
  'Vivienne',
  'Dorian',
  'Alistair',
  'Evangeline',
  'Sable',
  'Onyx',
  'Wren',
  'Juniper',
  'Freya',
  'Caspian',
  'Finn',
  'Jude',
  'Miles',
  'Nathaniel',
  'Cordelia',
  'Beatrix',
  'Imogen',
  'Tobias',
  'Sebastian',
] as const;

export const BANNED_SURNAMES = [
  'Voss',
  'Crowe',
  'Blackwood',
  'Ravencroft',
  'Shadow',
  'Nightshade',
  'Graves',
  'Grimm',
  'Dark',
  'Cross',
  'Thor' + 'ne',
  'Sterling',
  'Holloway',
  'Vane',
  'Ashford',
  'Vaughn',
  'Tho' + 'rn',
  'Ravenwood',
  'Blackthorn',
  'Crowley',
  'Marlowe',
  'Quill',
  'Steele',
  'Wolfe',
] as const;

export interface BannedNameCheckOptions {
  fromSource?: boolean;
}

/**
 * Checks whether an invented character name uses any blocked first names or surnames.
 * Rule: Canon wins — the ban applies strictly to INVENTED names.
 * The canon override (fromSource: true) bypasses the blocklist check completely (§13).
 */
export function isBannedInventedName(
  fullName: string,
  options?: BannedNameCheckOptions
): boolean {
  if (options?.fromSource) {
    return false; // Canon wins!
  }

  if (!fullName || typeof fullName !== 'string') {
    return false;
  }

  // Tokenize the name into alphanumeric parts
  const tokens = fullName
    .trim()
    .toLowerCase()
    .split(/[\s,.'"-]+/)
    .filter(Boolean);

  const lowerFirsts = new Set(BANNED_FIRST_NAMES.map((n) => n.toLowerCase()));
  const lowerSurnames = new Set(BANNED_SURNAMES.map((n) => n.toLowerCase()));

  for (const token of tokens) {
    if (lowerFirsts.has(token) || lowerSurnames.has(token)) {
      return true;
    }
  }

  return false;
}

/**
 * Builds the prompt rule block instructing LLMs on character naming standards (§13).
 */
export function getBannedNamesPromptBlock(): string {
  return `
[PROHIBITED INVENTED NAMES & CAST NAMING DIRECTIVE]
- DO NOT invent characters using clichéd, Gothic, or melodramatic placeholder names.
- Prohibited first names: ${BANNED_FIRST_NAMES.join(', ')}
- Prohibited surnames: ${BANNED_SURNAMES.join(', ')}
- CANON WINS: If a name appears explicitly in the source material, retain it faithfully; the restriction applies ONLY to invented characters.
- PREFER plain, regionally plausible, slightly unglamorous names. Dale Brennan is scarier than Elias Crowe precisely because Dale Brennan could be real.
`.trim();
}
