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

describe('Cap-semantics documentation table coverage (Item 2)', () => {
  it('asserts 1:1 coverage between scanExportedCapConstants and table rows in docs/cap-semantics.md', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const docPath = path.join(repoRoot, 'docs', 'cap-semantics.md');
    expect(fs.existsSync(docPath)).toBe(true);

    const content = fs.readFileSync(docPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    interface TableRow {
      constantName: string;
      declarationFile: string;
      value: string;
      enforcementSites: string;
      overflowBehavior: string;
    }

    const tableRows: TableRow[] = [];
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const cells = trimmed
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim().replace(/^`|`$/g, ''));
        if (cells[0] === 'Constant Name') {
          inTable = true;
          continue;
        }
        if (cells[0].startsWith('---')) {
          continue;
        }
        if (inTable) {
          tableRows.push({
            constantName: cells[0],
            declarationFile: cells[1],
            value: cells[2],
            enforcementSites: cells[3],
            overflowBehavior: cells[4],
          });
        }
      } else if (inTable && trimmed.length === 0) {
        inTable = false;
      }
    }

    const scanned = scanExportedCapConstants(repoRoot);
    expect(tableRows.length).toBe(scanned.length);
    expect(tableRows.length).toBe(40);

    const allowedBehaviors = new Set(['clamp', 'reject', 'truncate', 'ignore']);

    for (const item of scanned) {
      const matchingRow = tableRows.find(
        (r) => r.constantName === item.name && r.declarationFile === item.file
      );
      expect(
        matchingRow,
        `Expected row in docs/cap-semantics.md for scanned constant ${item.name} (${item.file})`
      ).toBeDefined();

      if (matchingRow) {
        expect(matchingRow.value).toBe(item.value);
        expect(allowedBehaviors.has(matchingRow.overflowBehavior)).toBe(true);
        expect(matchingRow.enforcementSites.length).toBeGreaterThan(0);
      }
    }

    // Bi-directional check: every table row must correspond to a scanned constant
    for (const row of tableRows) {
      const matchingScanned = scanned.find(
        (s) => s.name === row.constantName && s.file === row.declarationFile
      );
      expect(
        matchingScanned,
        `Found extra row in docs/cap-semantics.md not in scanned constants: ${row.constantName} (${row.declarationFile})`
      ).toBeDefined();
    }
  });
});

