export interface ExtractionBattery {
  family: string;
  questions: string[];
  compileTarget: string;
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
  ],
  compileTarget: 'seed',
};

export const EXTRACTION_BATTERIES: ExtractionBattery[] = [TOPOLOGY_BATTERY, SEED_BATTERY];
