import dotenv from 'dotenv';
dotenv.config({ override: true });

import fs from 'fs';
import path from 'path';
import { getEngineProvider } from '../server/ai/modelPolicy';
import { getLocalForgeModel, getLocalVoiceBaseUrl } from '../server/ai/voiceProviderPolicy';
import {
  runStage1,
  runStage2,
  type ExtractionCallMeta,
} from '../server/ai/extractionPipeline';
import { EXTRACTION_BATTERIES } from '../server/ai/extractionBatteries';

interface BatteryMetrics {
  stage1Calls: number;
  stage2Calls: number;
  firstAttemptTruncations: number;
  retryRescues: number;
  hardFailures: number;
}

interface DiagnosticReport {
  provider: string;
  model: string;
  baseUrl: string;
  source: string;
  sourceLengthChars: number;
  timestamp: string;
  totalCalls: number;
  firstAttemptTruncations: number;
  retryRescues: number;
  hardFailures: number;
  finishReasonHistogram: Record<string, number>;
  byBattery: Record<string, BatteryMetrics>;
  success: boolean;
  error: string | null;
}

function parseCliArgs(): { sourcePath: string; families?: string[]; outPath?: string } {
  const args = process.argv.slice(2);
  let sourcePath = '';
  let families: string[] | undefined = undefined;
  let outPath: string | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && i + 1 < args.length) {
      sourcePath = args[++i];
    } else if (args[i] === '--families' && i + 1 < args.length) {
      families = args[++i]
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
    } else if (args[i] === '--out' && i + 1 < args.length) {
      outPath = args[++i];
    }
  }

  return { sourcePath, families, outPath };
}

export async function runDiagnostic(): Promise<void> {
  const { sourcePath, families, outPath } = parseCliArgs();

  if (!sourcePath) {
    console.error(
      'Usage: tsx scripts/questionnaire_truncation_diagnostic.ts --source <path> [--families <csv>] [--out <path>]'
    );
    process.exit(1);
  }

  const resolvedSourcePath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSourcePath)) {
    console.error(`Error: Source file does not exist: "${resolvedSourcePath}".`);
    process.exit(1);
  }

  const provider = getEngineProvider();
  if (provider !== 'local') {
    console.error(
      `Error: Questionnaire truncation diagnostic requires engine provider "local", but detected "${provider}".`
    );
    process.exit(1);
  }

  const model = getLocalForgeModel();
  const baseUrl = getLocalVoiceBaseUrl();
  const sourceText = fs.readFileSync(resolvedSourcePath, 'utf-8');

  const targetBatteries =
    families && families.length > 0
      ? EXTRACTION_BATTERIES.filter((b) => families.includes(b.family))
      : EXTRACTION_BATTERIES;

  if (targetBatteries.length === 0) {
    console.error('Error: No matching extraction batteries found for the specified families.');
    process.exit(1);
  }

  const byBattery: Record<string, BatteryMetrics> = {};
  for (const b of targetBatteries) {
    byBattery[b.family] = {
      stage1Calls: 0,
      stage2Calls: 0,
      firstAttemptTruncations: 0,
      retryRescues: 0,
      hardFailures: 0,
    };
  }

  let totalCalls = 0;
  let firstAttemptTruncations = 0;
  let retryRescues = 0;
  let hardFailures = 0;
  const finishReasonHistogram: Record<string, number> = {};

  const metaListener = (meta: ExtractionCallMeta): void => {
    totalCalls++;

    const reasonKey = meta.finish_reason ?? 'null';
    finishReasonHistogram[reasonKey] = (finishReasonHistogram[reasonKey] || 0) + 1;

    if (!byBattery[meta.family]) {
      byBattery[meta.family] = {
        stage1Calls: 0,
        stage2Calls: 0,
        firstAttemptTruncations: 0,
        retryRescues: 0,
        hardFailures: 0,
      };
    }
    const bStats = byBattery[meta.family];

    if (meta.stage === 1) {
      bStats.stage1Calls++;
    } else {
      bStats.stage2Calls++;
    }

    if (meta.attempt === 1) {
      if (meta.finish_reason === 'length') {
        firstAttemptTruncations++;
        bStats.firstAttemptTruncations++;
      }
    } else if (meta.attempt === 2) {
      if (meta.finish_reason === 'length') {
        hardFailures++;
        bStats.hardFailures++;
      } else {
        retryRescues++;
        bStats.retryRescues++;
      }
    }
  };

  const wordCount = sourceText.split(/\s+/).filter(Boolean).length;
  console.log('========================================================================================');
  console.log('[QUESTIONNAIRE TRUNCATION DIAGNOSTIC]');
  console.log(`Engine Provider: ${provider}`);
  console.log(`Model:           ${model || '(default local model)'}`);
  console.log(`Endpoint:        ${baseUrl}`);
  console.log(`Source File:     ${resolvedSourcePath} (${sourceText.length} chars, ~${wordCount} words)`);
  console.log(`Batteries:       ${targetBatteries.map((b) => b.family).join(', ')}`);
  console.log('========================================================================================\n');

  let executionError: Error | null = null;
  try {
    console.log(`[Stage 1] Executing Q&A Extraction...`);
    const stage1Responses = await runStage1(sourceText, {
      families: families,
      metaListener,
    });
    console.log(`✓ Stage 1 completed: ${stage1Responses.length} answers extracted.\n`);

    console.log(`[Stage 2] Compiling Candidate Structures...`);
    const stage2Result = await runStage2(stage1Responses, {
      metaListener,
    });
    console.log(
      `✓ Stage 2 completed: ${Object.keys(stage2Result.compiledCandidates).length} candidate targets compiled.`
    );
    if (stage2Result.failedBatteries.length > 0) {
      console.warn(`⚠ Failed batteries in Stage 2: ${stage2Result.failedBatteries.join(', ')}`);
    }
    console.log('');
  } catch (err: unknown) {
    executionError = err instanceof Error ? err : new Error(String(err));
    console.error(`\n! Execution stopped with error: ${executionError.message}\n`);
  }

  // Print Summary Table
  console.log('========================================================================================');
  console.log('SUMMARY METRICS TABLE');
  console.log('========================================================================================');
  console.log(
    '| ' +
      'Battery'.padEnd(14) +
      ' | ' +
      'Stage 1'.padStart(8) +
      ' | ' +
      'Stage 2'.padStart(8) +
      ' | ' +
      'Trunc (Att 1)'.padStart(14) +
      ' | ' +
      'Rescues'.padStart(8) +
      ' | ' +
      'Hard Failures'.padStart(14) +
      ' |'
  );
  console.log(
    '| :' +
      '-'.repeat(13) +
      ' | ' +
      '-'.repeat(7) +
      ': | ' +
      '-'.repeat(7) +
      ': | ' +
      '-'.repeat(13) +
      ': | ' +
      '-'.repeat(7) +
      ': | ' +
      '-'.repeat(13) +
      ': |'
  );

  let totalStage1 = 0;
  let totalStage2 = 0;
  for (const b of targetBatteries) {
    const stats = byBattery[b.family] || {
      stage1Calls: 0,
      stage2Calls: 0,
      firstAttemptTruncations: 0,
      retryRescues: 0,
      hardFailures: 0,
    };
    totalStage1 += stats.stage1Calls;
    totalStage2 += stats.stage2Calls;
    console.log(
      '| ' +
        b.family.padEnd(14) +
        ' | ' +
        String(stats.stage1Calls).padStart(8) +
        ' | ' +
        String(stats.stage2Calls).padStart(8) +
        ' | ' +
        String(stats.firstAttemptTruncations).padStart(14) +
        ' | ' +
        String(stats.retryRescues).padStart(8) +
        ' | ' +
        String(stats.hardFailures).padStart(14) +
        ' |'
    );
  }

  console.log(
    '| ' +
      'TOTAL'.padEnd(14) +
      ' | ' +
      String(totalStage1).padStart(8) +
      ' | ' +
      String(totalStage2).padStart(8) +
      ' | ' +
      String(firstAttemptTruncations).padStart(14) +
      ' | ' +
      String(retryRescues).padStart(8) +
      ' | ' +
      String(hardFailures).padStart(14) +
      ' |'
  );
  console.log('========================================================================================\n');

  console.log('Finish Reason Histogram:');
  const reasons = Object.keys(finishReasonHistogram).sort();
  if (reasons.length === 0) {
    console.log('  (no calls recorded)');
  } else {
    for (const r of reasons) {
      console.log(`  ${r.padEnd(12)}: ${finishReasonHistogram[r]}`);
    }
  }

  console.log(`\nTotal Dispatched Calls:       ${totalCalls}`);
  console.log(`First Attempt Truncations:    ${firstAttemptTruncations}`);
  console.log(`Retry Rescues:                ${retryRescues}`);
  console.log(`Hard Failures:                ${hardFailures}`);
  console.log(
    `Verdict:                      ${
      !executionError && hardFailures === 0 ? 'SUCCESS (Budget Sufficient)' : 'FAILURE'
    }`
  );

  const isSuccess = !executionError && hardFailures === 0;

  if (outPath) {
    const report: DiagnosticReport = {
      provider,
      model,
      baseUrl,
      source: resolvedSourcePath,
      sourceLengthChars: sourceText.length,
      timestamp: new Date().toISOString(),
      totalCalls,
      firstAttemptTruncations,
      retryRescues,
      hardFailures,
      finishReasonHistogram,
      byBattery,
      success: isSuccess,
      error: executionError ? executionError.message : null,
    };
    const resolvedOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n[Diagnostic Report Saved]: ${resolvedOut}`);
  }

  if (!isSuccess) {
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('questionnaire_truncation_diagnostic.ts')) {
  runDiagnostic().catch((e: unknown) => {
    console.error('Fatal diagnostic error:', e);
    process.exit(1);
  });
}
