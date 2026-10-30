import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  auditConstants,
  formatConstantAuditReport,
  scanExportedCapConstants,
} from '../../scripts/audit-constants';

describe('Orphaned-constant audit script (Item 1)', () => {
  it('reports unreferenced MAX_* / *_LIMIT constants and excludes referenced ones on a synthetic fixture', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ttm-audit-constants-'));

    try {
      const libDir = path.join(tmpRoot, 'src', 'lib');
      const typesDir = path.join(tmpRoot, 'src', 'types');
      fs.mkdirSync(libDir, { recursive: true });
      fs.mkdirSync(typesDir, { recursive: true });

      fs.writeFileSync(
        path.join(typesDir, 'caps.ts'),
        [
          'export const MAX_REFERENCED_CAP = 5;',
          'export const ORPHANED_ITEM_LIMIT = 12;',
          'export const UNRELATED_CONSTANT = 99;',
        ].join('\n'),
        'utf-8'
      );

      fs.writeFileSync(
        path.join(libDir, 'consumer.ts'),
        [
          "import { MAX_REFERENCED_CAP } from '../types/caps';",
          'export function clampItems(items: string[]): string[] {',
          '  return items.slice(0, MAX_REFERENCED_CAP);',
          '}',
        ].join('\n'),
        'utf-8'
      );

      const scanned = scanExportedCapConstants(tmpRoot);
      expect(scanned.map((c) => c.name)).toEqual(['MAX_REFERENCED_CAP', 'ORPHANED_ITEM_LIMIT']);

      const report = auditConstants(tmpRoot);
      expect(report.orphaned.map((c) => c.name)).toEqual(['ORPHANED_ITEM_LIMIT']);
      expect(report.orphaned.some((c) => c.name === 'MAX_REFERENCED_CAP')).toBe(false);

      const formatted = formatConstantAuditReport(report);
      expect(formatted).toContain('ORPHANED_ITEM_LIMIT');
      expect(formatted).toContain('Orphaned constants (0 references outside declaration site): 1');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('scans the repository and finds all 39 unique exported MAX_* / *_LIMIT constants across 14 files', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const report = auditConstants(repoRoot);
    expect(report.uniqueConstantNames.length).toBe(39);
    expect(report.constants.length).toBe(40);
  });
});
