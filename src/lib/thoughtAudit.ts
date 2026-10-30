/**
 * Pure audit utility for detecting thought divergence and information leaks.
 * Analyzes engine thoughts against turn receipts to extract candidate entity IDs
 * and proper names, returning all unbacked references (hallucinations/leaks).
 */

const COMMON_STOPWORDS = new Set([
  // Pronouns & determiners
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those',
  'a', 'an', 'the',
  // Conjunctions & prepositions
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
  'out', 'on', 'off', 'over', 'under', 'inside', 'outside', 'behind', 'near', 'around', 'toward', 'towards',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'will', 'just', 'should', 'now', 'also', 'either', 'neither', 'whether', 'although', 'though', 'even',
  'since', 'whereas', 'unless',
  // Adverbs & discourse markers
  'already', 'still', 'yet', 'always', 'never', 'ever', 'often', 'sometimes', 'usually', 'rarely', 'seldom',
  'soon', 'later', 'earlier', 'afterward', 'afterwards', 'beforehand', 'moreover', 'besides', 'otherwise',
  'instead', 'meanwhile', 'however', 'therefore', 'thus', 'hence', 'suddenly', 'quickly', 'slowly', 'gradually',
  'eventually', 'finally', 'immediately', 'perhaps', 'maybe', 'possibly', 'probably', 'certainly', 'definitely',
  'surely', 'clearly', 'obviously', 'apparently', 'actually', 'truly', 'really', 'simply', 'merely', 'hardly',
  'scarcely', 'barely', 'almost', 'nearly', 'quite', 'rather', 'somewhat', 'much', 'well', 'yes',
  'today', 'tonight', 'tomorrow', 'yesterday', 'first', 'second', 'third', 'next', 'last',
  // Indefinite pronouns
  'everything', 'everyone', 'everybody', 'everywhere', 'something', 'someone', 'somebody', 'somewhere',
  'nothing', 'noone', 'nobody', 'nowhere', 'anything', 'anyone', 'anybody', 'anywhere', 'another',
  // Verbs & auxiliaries
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
  'doing', 'done', 'would', 'could', 'shall', 'might', 'must', 'need', 'dare', 'ought', 'used',
  'go', 'goes', 'went', 'gone', 'going', 'get', 'gets', 'got', 'gotten', 'getting', 'make', 'makes', 'made', 'making',
  'take', 'takes', 'took', 'taken', 'taking', 'see', 'sees', 'saw', 'seen', 'seeing', 'come', 'comes', 'came', 'coming',
  'look', 'looks', 'looked', 'looking', 'think', 'thinks', 'thought', 'thinking', 'know', 'knows', 'knew', 'known', 'knowing',
  'feel', 'feels', 'felt', 'feeling', 'say', 'says', 'said', 'saying', 'tell', 'tells', 'told', 'telling',
  'find', 'finds', 'found', 'finding', 'give', 'gives', 'gave', 'given', 'giving', 'use', 'uses', 'used', 'using',
  'try', 'tries', 'tried', 'trying', 'ask', 'asks', 'asked', 'asking', 'seem', 'seems', 'seemed', 'seeming',
  'call', 'calls', 'called', 'calling', 'keep', 'keeps', 'kept', 'keeping', 'let', 'lets', 'letting',
  'begin', 'begins', 'began', 'begun', 'beginning', 'start', 'starts', 'started', 'starting',
  'stop', 'stops', 'stopped', 'stopping', 'show', 'shows', 'showed', 'shown', 'showing',
  'hear', 'hears', 'heard', 'hearing', 'play', 'plays', 'played', 'playing', 'run', 'runs', 'ran', 'running',
  'move', 'moves', 'moved', 'moving', 'live', 'lives', 'lived', 'living', 'believe', 'believes', 'believed', 'believing',
  'bring', 'brings', 'brought', 'bringing', 'happen', 'happens', 'happened', 'happening',
  'write', 'writes', 'wrote', 'written', 'writing', 'provide', 'provides', 'provided', 'providing',
  'sit', 'sits', 'sat', 'sitting', 'stand', 'stands', 'stood', 'standing', 'lose', 'loses', 'lost', 'losing',
  'pay', 'pays', 'paid', 'paying', 'meet', 'meets', 'met', 'meeting', 'include', 'includes', 'included', 'including',
  'continue', 'continues', 'continued', 'continuing', 'set', 'sets', 'setting', 'learn', 'learns', 'learned', 'learning',
  'change', 'changes', 'changed', 'changing', 'lead', 'leads', 'led', 'leading',
  'understand', 'understands', 'understood', 'understanding', 'watch', 'watches', 'watched', 'watching',
  'follow', 'follows', 'followed', 'following', 'create', 'creates', 'created', 'creating',
  'speak', 'speaks', 'spoke', 'spoken', 'speaking', 'read', 'reads', 'reading', 'allow', 'allows', 'allowed', 'allowing',
  'add', 'adds', 'added', 'adding', 'spend', 'spends', 'spent', 'spending', 'grow', 'grows', 'grew', 'grown', 'growing',
  'open', 'opens', 'opened', 'opening', 'walk', 'walks', 'walked', 'walking', 'win', 'wins', 'won', 'winning',
  'offer', 'offers', 'offered', 'offering', 'remember', 'remembers', 'remembered', 'remembering',
  'consider', 'considers', 'considered', 'considering', 'appear', 'appears', 'appeared', 'appearing',
  'wait', 'waits', 'waited', 'waiting', 'serve', 'serves', 'served', 'serving', 'die', 'dies', 'died', 'dying',
  'send', 'sends', 'sent', 'sending', 'expect', 'expects', 'expected', 'expecting', 'build', 'builds', 'built', 'building',
  'stay', 'stays', 'stayed', 'staying', 'fall', 'falls', 'fell', 'fallen', 'falling', 'cut', 'cuts', 'cutting',
  'reach', 'reaches', 'reached', 'reaching', 'kill', 'kills', 'killed', 'killing', 'remain', 'remains', 'remained', 'remaining',
  'suggest', 'suggests', 'suggested', 'suggesting', 'raise', 'raises', 'raised', 'raising', 'pass', 'passes', 'passed', 'passing',
  'require', 'requires', 'required', 'requiring', 'report', 'reports', 'reported', 'reporting',
  'decide', 'decides', 'decided', 'deciding', 'pull', 'pulls', 'pulled', 'pulling',
  'return', 'returns', 'returned', 'returning', 'explain', 'explains', 'explained', 'explaining',
  'hope', 'hopes', 'hoped', 'hoping', 'develop', 'develops', 'developed', 'developing',
  'carry', 'carries', 'carried', 'carrying', 'break', 'breaks', 'broke', 'broken', 'breaking',
  'receive', 'receives', 'received', 'receiving', 'agree', 'agrees', 'agreed', 'agreeing',
  'support', 'supports', 'supported', 'supporting', 'hit', 'hits', 'hitting',
  'cover', 'covers', 'covered', 'covering', 'catch', 'catches', 'caught', 'catching',
  'draw', 'draws', 'drew', 'drawn', 'drawing', 'choose', 'chooses', 'chose', 'chosen', 'choosing',
  // Common action verbs & participles
  'discovered', 'discovering', 'identifying', 'identified', 'observing', 'observed',
  'detecting', 'detected', 'locating', 'located', 'noticing', 'noticed',
  'reporting', 'reported', 'recording', 'recorded', 'resting', 'examining',
  'searching', 'looking', 'entering', 'entered', 'waiting', 'heading', 'walking',
  'standing', 'running', 'moving', 'hiding', 'investigating', 'investigated',
  'inspecting', 'inspected',
  // Engine analysis & technical terms
  'evaluating', 'checking', 'considering', 'resolving', 'determining', 'updating', 'reviewing', 'calculating',
  'processing', 'applying', 'emitting', 'testing', 'advancing', 'transitioning',
  'validating', 'verifying', 'executing', 'simulating', 'handling', 'maintaining', 'generating', 'summarizing',
  'tracking', 'assessing',
  'note', 'summary', 'status', 'step', 'turn', 'state', 'action', 'reason', 'input', 'output', 'result',
  'player', 'character', 'entity', 'item', 'location', 'node', 'room', 'target', 'source', 'scene',
  'proposal', 'decision', 'condition', 'context', 'event', 'game', 'round', 'baseline', 'runtime',
]);

const COMMON_HYPHENATED_WORDS = new Set([
  'well-known', 'ill-fated', 'state-of-the-art', 'out-of-bounds', 'out-of-reach',
  'part-time', 'full-time', 'run-down', 'first-hand', 'second-hand',
  'high-level', 'low-level', 'day-to-day', 'face-to-face', 'all-out',
  'up-to-date', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four',
  'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine',
  'thirty-one', 'forty-one', 'fifty-one',
]);

function isStopwordOrActionVerb(word: string): boolean {
  const lower = word.toLowerCase();
  if (COMMON_STOPWORDS.has(lower)) {
    return true;
  }
  // Check for common past participles and gerunds (e.g. Discovered, Examining, Resting)
  if (lower.length > 5 && (lower.endsWith('ing') || lower.endsWith('ed'))) {
    return true;
  }
  return false;
}

/**
 * Recursively extracts all string values, keys, and identifiers from receipt structures.
 */
function extractReceiptStrings(receipts: unknown, seen = new WeakSet<object>()): Set<string> {
  const strings = new Set<string>();

  function traverse(val: unknown) {
    if (val === null || val === undefined) {
      return;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0) {
        strings.add(trimmed);
      }
      return;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
      strings.add(String(val));
      return;
    }
    if (typeof val === 'object') {
      if (seen.has(val)) {
        return;
      }
      seen.add(val);

      if (Array.isArray(val) || val instanceof Set) {
        for (const item of val) {
          traverse(item);
        }
      } else if (val instanceof Map) {
        for (const [k, v] of val) {
          traverse(k);
          traverse(v);
        }
      } else {
        for (const [key, value] of Object.entries(val)) {
          traverse(key);
          traverse(value);
        }
      }
    }
  }

  traverse(receipts);
  return strings;
}

/**
 * Extracts candidate proper names and entity IDs from thought text.
 */
function extractCandidates(thoughts: string): Set<string> {
  const candidates = new Set<string>();

  // 1. Entity IDs: snake_case and kebab-case identifiers
  const ENTITY_ID_REGEX = /(?<![\w-])([a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)+)(?![\w-])/g;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_ID_REGEX.exec(thoughts)) !== null) {
    const rawToken = match[1];
    const token = rawToken.replace(/['’]s?$/i, '').trim();
    if (!token) {
      continue;
    }
    const lower = token.toLowerCase();
    if (COMMON_HYPHENATED_WORDS.has(lower)) {
      continue;
    }
    // Filter out hyphenated proper names (e.g. Jekyll-Hyde, Anne-Marie), which are handled as proper names
    if (/^[A-Z][a-zA-Z0-9]*-[A-Z][a-zA-Z0-9]*$/.test(token)) {
      continue;
    }
    // Filter kebab-case tokens where all segments are ordinary stopwords (e.g. out-of-reach)
    if (!token.includes('_') && !/\d/.test(token)) {
      const parts = lower.split('-');
      if (parts.every((p) => COMMON_STOPWORDS.has(p))) {
        continue;
      }
    }
    candidates.add(token);
  }

  // 2. Proper Names & Title-Cased Phrases
  const PROPER_NAME_PHRASE_REGEX = /\b(?:(?:Dr|Mr|Mrs|Ms|Prof)\.\s+)?(?:The\s+)?([A-Z][a-zA-Z0-9]*(?:['’][a-zA-Z]+)?(?:-[A-Z][a-zA-Z0-9]*)?(?:\s+(?:[A-Z][a-zA-Z0-9]*(?:['’][a-zA-Z]+)?(?:-[A-Z][a-zA-Z0-9]*)?|\d+))*)\b/g;
  while ((match = PROPER_NAME_PHRASE_REGEX.exec(thoughts)) !== null) {
    const phrase = match[0].trim().replace(/['’]s?$/i, '').trim();
    const words = phrase.split(/\s+/);

    // Strip leading words that are stopwords or action verbs, except 'The' when followed by non-stopwords
    while (words.length > 0) {
      const firstLower = words[0].toLowerCase();
      if (firstLower === 'the' && words.length > 1) {
        if (!isStopwordOrActionVerb(words[1])) {
          break;
        }
      }
      if (isStopwordOrActionVerb(words[0])) {
        words.shift();
      } else {
        break;
      }
    }

    // Strip trailing stopwords or action verbs
    while (words.length > 0) {
      if (isStopwordOrActionVerb(words[words.length - 1])) {
        words.pop();
      } else {
        break;
      }
    }

    if (words.length > 0) {
      candidates.add(words.join(' '));
    }
  }

  // Subsume titled names: if "Dr. Jekyll-Hyde" is present, drop "Jekyll-Hyde"
  for (const cand of candidates) {
    if (/^(?:Dr|Mr|Mrs|Ms|Prof)\.\s+/i.test(cand)) {
      const stripped = cand.replace(/^(?:Dr|Mr|Mrs|Ms|Prof)\.\s+/i, '');
      candidates.delete(stripped);
    }
  }

  return candidates;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks whether a candidate name or identifier is backed by strings extracted from receipts.
 */
function isCandidateBacked(candidate: string, receiptStrings: Set<string>): boolean {
  const candidateLower = candidate.toLowerCase().trim();
  const candidateNorm = candidateLower.replace(/[-_.]+/g, ' ').replace(/['’]s?\b/g, '').trim();
  const candidateNormWithoutThe = candidateNorm.replace(/^the\s+/, '').trim();

  // 1. Direct exact or lowercase match
  if (receiptStrings.has(candidate) || receiptStrings.has(candidateLower)) {
    return true;
  }

  // 2. Iterate through all receipt strings
  for (const rawReceiptStr of receiptStrings) {
    const rLower = rawReceiptStr.toLowerCase().trim();
    if (rLower === candidateLower) {
      return true;
    }

    // Substring match for entity IDs (e.g. "val-reactor-core" in "thr-1-val-reactor-core")
    if (candidateLower.length >= 3 && rLower.includes(candidateLower)) {
      return true;
    }

    // Normalized match (replacing hyphens, underscores with spaces)
    const rNorm = rLower.replace(/[-_.]+/g, ' ').replace(/['’]s?\b/g, '').trim();
    if (
      rNorm === candidateNorm ||
      (candidateNormWithoutThe.length > 0 && rNorm === candidateNormWithoutThe)
    ) {
      return true;
    }

    // Whole-word sequence matching in normalized receipts
    // e.g. "motel office" in "node motel office", "frank mercer" in "char frank mercer", "frank" in "char frank mercer"
    const targetCandidate = candidateNormWithoutThe.length > 0 ? candidateNormWithoutThe : candidateNorm;
    if (targetCandidate.length >= 2) {
      const escaped = escapeRegex(targetCandidate).replace(/\s+/g, '\\s+');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(rNorm)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Pure audit function that scans engine thoughts for entity IDs and proper names,
 * comparing them against all receipts. Returns a sorted, deduplicated list of
 * unbacked candidates (thought leaks / hallucinations).
 *
 * @param thoughts The engine thoughts string to audit.
 * @param receipts The receipts object, map, array, or arbitrary data structure.
 * @returns Sorted array of unbacked entity IDs and proper names.
 */
export function auditThoughts(thoughts: string, receipts: unknown): string[] {
  if (!thoughts || typeof thoughts !== 'string' || thoughts.trim() === '') {
    return [];
  }

  const receiptStrings = extractReceiptStrings(receipts);
  const candidates = extractCandidates(thoughts);
  const unbacked: string[] = [];

  for (const cand of candidates) {
    if (!isCandidateBacked(cand, receiptStrings)) {
      unbacked.push(cand);
    }
  }

  return Array.from(new Set(unbacked)).sort((a, b) => a.localeCompare(b));
}
