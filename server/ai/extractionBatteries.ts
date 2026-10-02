export interface ExtractionBattery {
  family: string;
  questions: string[];
  compileTarget: string;
  stage1Only?: boolean;
}

export const TOPOLOGY_BATTERY: ExtractionBattery = {
  family: 'TOPOLOGY',
  questions: [
    'What are the bounded spaces in this location? Name each chamber, room, or enclosed area.',
    'What edges connect these spaces? (doors, hallways, crawlspaces, windows)',
    'Which edges are locked, barred, or otherwise restricted?',
    'Are there any hidden spaces (secret rooms, crawlspaces, vents) mentioned?',
  ],
  compileTarget: 'topology',
};

export const SEED_BATTERY: ExtractionBattery = {
  family: 'SEED',
  questions: [
    'Where is each named character when the story starts? Name each character and state the room, space, or location they are in.',
    'What is each character doing in the opening moment? Describe the action. Is it an ongoing activity or an interrupted/frozen one?',
    'Is any character physically restrained, bound, trapped, or injured at the start? For each: who bound or injured them, and to what are they tied or confined?',
    'What is each character\u2019s emotional state at the start? Describe their fear or calm in plain words, and name what threatens them: their life, their freedom, or their identity.',
    'What does each character know at the start? List facts, secrets, and prior events each character is aware of, per character.',
    'What does each character want right now? State the immediate drive: an action they are about to take, or a state they want to reach.',
    'Who trusts or distrusts whom at the start? Name each relationship and whether it is trust, distrust, or unsure.',
    'Who makes the worst thing in the story happen? Who suffers it?',
    'Who speaks \u2014 every entity with dialogue or quoted thought, even a single line? List them.',
    'Who wants something incompatible with what someone else wants? Name both sides.',
    'Is there an entity the story treats as background \u2014 a system, machine, place, or force \u2014 that makes decisions, issues commands, or responds to the characters? Name it.',
    'Who is present in the most scenes without driving the action (bystanders, witnesses, functionaries)? They still count.',
    'Does anyone appear only in memory, recordings, or stories-within-the-story but still shape events? Name them.',
    'For each: what do they look like right now, how do they behave under stress, what do they want most, and what are they afraid of?',
  ],
  compileTarget: 'seed',
};

export const VILLAIN_BATTERY: ExtractionBattery = {
  family: 'VILLAIN',
  questions: [
    'What is the source of the harm in this story? If it isn\u2019t a person, what is it?',
    'Does the source speak, have a name, address victims directly, or tailor its cruelty to individuals?',
    'Is the story told from the perpetrator\u2019s point of view \u2014 first-person predator narration?',
    'What can the source do \u2014 at what scale, with what ease? What has it actually done on-page, versus only threatened?',
    'What does the source want? Not in the abstract \u2014 what does it do, repeatedly, to get it?',
  ],
  compileTarget: 'villain',
};

export const RELATIONSHIPS_BATTERY: ExtractionBattery = {
  family: 'RELATIONSHIPS',
  questions: [
    'Who depends on whom \u2014 for safety, money, approval, survival? Name the direction of dependence.',
    'Who fears whom? Who trusts whom, and is the trust reciprocated?',
    'What pair, if broken, would change the story\u2019s outcome? (The fracture point.)',
    'Is any character bound to a place \u2014 can\u2019t leave it, won\u2019t leave it, or is defined by it?',
    'What does each major character believe about each other major character that isn\u2019t true?',
  ],
  compileTarget: 'relationships',
};

export const OBJECTS_BATTERY: ExtractionBattery = {
  family: 'OBJECTS',
  questions: [
    'What physical things do characters use to hurt, restrain, free, hide, or communicate?',
    'Is there an object a character keeps returning to, or that changes hands? What does it let its holder do?',
    'Is there a record \u2014 tape, diary, footage, ledger \u2014 containing knowledge someone would kill to keep or to reveal?',
    'What object, if removed from the story, would collapse the plot?',
  ],
  compileTarget: 'objects',
  stage1Only: true,
};

export const PRESSURE_BATTERY: ExtractionBattery = {
  family: 'PRESSURE',
  questions: [
    'What does each major character stand to lose \u2014 life, freedom, identity, mind? Which matters most to each of them?',
    'What are the antagonist\u2019s demonstrated capabilities \u2014 what has it actually done on-page, vs. what\u2019s only threatened?',
    'Where does the antagonist\u2019s power stop \u2014 distance, daylight, rules, cost, attention?',
    'If someone dies in this story, what happens \u2014 mundane death, something worse, something stranger?',
    'How do characters cope \u2014 prayers, rituals, jokes, substances, routines? What actually relieves their tension?',
    'What breaks a character \u2014 at what point do they submit, beg, or collapse? Who breaks first?',
  ],
  compileTarget: 'pressure',
};

export const DEPICTION_BATTERY: ExtractionBattery = {
  family: 'DEPICTION',
  questions: [
    'How close does the narration get to violence or horror \u2014 explicit sensory detail, or cutaway and implication?',
    'What does the story show in full vs. leave off-page? Is that consistent, or does it vary?',
    'How does the story handle aftermath \u2014 bodies, grief, cleanup, trauma? Lingering or brisk?',
    'Is there anything the story conspicuously will not depict? What \u2014 and does the avoidance feel like taste, terror, or taboo?',
  ],
  compileTarget: 'depiction',
};

export const EXTRACTION_BATTERIES: ExtractionBattery[] = [
  SEED_BATTERY,
  TOPOLOGY_BATTERY,
  VILLAIN_BATTERY,
  RELATIONSHIPS_BATTERY,
  OBJECTS_BATTERY,
  PRESSURE_BATTERY,
  DEPICTION_BATTERY,
];

