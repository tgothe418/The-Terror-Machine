import * as fs from 'fs';
import * as path from 'path';
import { CharacterSeedSchema } from '../src/types/forge';
import { createNeutralSeed } from '../src/lib/neutralSeed';

const TARGET_FILES = [
  path.resolve(__dirname, '../src/data/blueprints/black_iron_mortuary.json'),
  path.resolve(__dirname, '../src/data/blueprints/silver_rest_lodge.json'),
  path.resolve(__dirname, '../src/data/blueprints/the_refinement.json'),
  path.resolve(__dirname, '../server/data/scenarios/black_iron_mortuary.json'),
];

export function backfillSeedsForFile(filePath: string): { modified: boolean; memberCount: number } {
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return { modified: false, memberCount: 0 };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const blueprint = JSON.parse(raw);

  if (!Array.isArray(blueprint.cast) || blueprint.cast.length === 0) {
    console.log(`No cast array found in ${path.basename(filePath)}`);
    return { modified: false, memberCount: 0 };
  }

  let modified = false;
  let memberCount = 0;

  for (const member of blueprint.cast) {
    memberCount++;
    if (!member.seed) {
      member.seed = createNeutralSeed(member, blueprint);
      modified = true;
    } else {
      const parsed = CharacterSeedSchema.safeParse(member.seed);
      if (!parsed.success) {
        console.warn(`Invalid seed found on ${member.id} in ${path.basename(filePath)}, regenerating.`);
        member.seed = createNeutralSeed(member, blueprint);
        modified = true;
      }
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(blueprint, null, 2) + '\n', 'utf-8');
    console.log(`Updated ${path.basename(filePath)} (${memberCount} cast members backfilled).`);
  } else {
    console.log(`Already up to date: ${path.basename(filePath)}`);
  }

  return { modified, memberCount };
}

export function runBackfill(): void {
  console.log('Running Seed State v1 blueprint backfill...');
  for (const file of TARGET_FILES) {
    backfillSeedsForFile(file);
  }
  console.log('Backfill complete.');
}

if (require.main === module) {
  runBackfill();
}
