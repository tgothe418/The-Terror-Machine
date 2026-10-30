import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface ScannedConstant {
  name: string;
  value: string;
  file: string;
  line: number;
}

export interface AuditedConstant extends ScannedConstant {
  totalReferences: number;
  sameFileReferences: number;
  externalReferences: number;
  referencingFiles: string[];
}

export interface ConstantAuditReport {
  constants: AuditedConstant[];
  uniqueConstantNames: string[];
  orphaned: AuditedConstant[];
  fileLocalOnly: AuditedConstant[];
}

export interface AuditConstantsOptions {
  scanSubdirs?: string[];
  searchSubdirs?: string[];
}

export function isCapConstantName(name: string): boolean {
  return name.startsWith('MAX_') || name.endsWith('_LIMIT');
}

function collectTypeScriptFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function stripLineComments(line: string): string {
  return line.replace(/\/\/.*$/, '');
}

export function scanExportedCapConstants(
  rootDir: string = process.cwd(),
  scanSubdirs: string[] = ['src/lib', 'src/types']
): ScannedConstant[] {
  const results: ScannedConstant[] = [];
  const declRegex = /^\s*export\s+const\s+([A-Z0-9_]+)\s*(?::[^=]+)?=\s*(.+?);?\s*$/;

  for (const subdir of scanSubdirs) {
    const absDir = path.resolve(rootDir, subdir);
    const files = collectTypeScriptFiles(absDir).filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')
    );

    for (const filePath of files) {
      const relFile = path.relative(rootDir, filePath).split(path.sep).join('/');
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);

      lines.forEach((rawLine, index) => {
        const line = stripLineComments(rawLine);
        const match = line.match(declRegex);
        if (!match) return;
        const [, name, value] = match;
        if (isCapConstantName(name)) {
          results.push({
            name,
            value: value.trim(),
            file: relFile,
            line: index + 1,
          });
        }
      });
    }
  }

  return results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function auditConstants(
  rootDir: string = process.cwd(),
  options: AuditConstantsOptions = {}
): ConstantAuditReport {
  const scanSubdirs = options.scanSubdirs ?? ['src/lib', 'src/types'];
  const searchSubdirs = options.searchSubdirs ?? ['src', 'server', 'scripts'];

  const scanned = scanExportedCapConstants(rootDir, scanSubdirs);
  const searchFileSet = new Set<string>();
  for (const subdir of searchSubdirs) {
    const absDir = path.resolve(rootDir, subdir);
    for (const file of collectTypeScriptFiles(absDir)) {
      searchFileSet.add(file);
    }
  }

  const parsedFiles = Array.from(searchFileSet)
    .sort()
    .map((absPath) => {
      const relFile = path.relative(rootDir, absPath).split(path.sep).join('/');
      const lines = fs
        .readFileSync(absPath, 'utf-8')
        .split(/\r?\n/)
        .map((line) => stripLineComments(line));
      return { relFile, lines };
    });

  const tokenRegex = /\b[A-Z0-9_]+\b/g;

  const audited: AuditedConstant[] = scanned.map((decl) => {
    let sameFileReferences = 0;
    let externalReferences = 0;
    const referencingFileSet = new Set<string>();

    for (const fileEntry of parsedFiles) {
      fileEntry.lines.forEach((line, idx) => {
        const lineNumber = idx + 1;
        if (fileEntry.relFile === decl.file && lineNumber === decl.line) {
          return;
        }
        const tokens = line.match(tokenRegex);
        if (!tokens) return;
        const matchCount = tokens.filter((t) => t === decl.name).length;
        if (matchCount > 0) {
          referencingFileSet.add(fileEntry.relFile);
          if (fileEntry.relFile === decl.file) {
            sameFileReferences += matchCount;
          } else {
            externalReferences += matchCount;
          }
        }
      });
    }

    return {
      ...decl,
      totalReferences: sameFileReferences + externalReferences,
      sameFileReferences,
      externalReferences,
      referencingFiles: Array.from(referencingFileSet).sort(),
    };
  });

  const uniqueConstantNames = Array.from(new Set(audited.map((c) => c.name))).sort();
  const orphaned = audited.filter((c) => c.totalReferences === 0);
  const fileLocalOnly = audited.filter((c) => c.externalReferences === 0);

  return {
    constants: audited,
    uniqueConstantNames,
    orphaned,
    fileLocalOnly,
  };
}

export function formatConstantAuditReport(report: ConstantAuditReport): string {
  const lines: string[] = [];
  lines.push('=== Exported MAX_* / *_LIMIT Constant Audit Report ===');
  lines.push(`Total declarations scanned: ${report.constants.length}`);
  lines.push(`Unique constant names: ${report.uniqueConstantNames.length}`);
  lines.push(`Orphaned constants (0 references outside declaration site): ${report.orphaned.length}`);

  if (report.orphaned.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of report.orphaned) {
      lines.push(`  - ${item.name} (${item.file}:${item.line})`);
    }
  }

  lines.push(
    `File-local-only exported constants (0 references outside declaring file): ${report.fileLocalOnly.length}`
  );
  if (report.fileLocalOnly.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of report.fileLocalOnly) {
      lines.push(
        `  - ${item.name} (${item.file}:${item.line}) [same-file refs: ${item.sameFileReferences}]`
      );
    }
  }

  return lines.join('\n');
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  const report = auditConstants(process.cwd());
  console.log(formatConstantAuditReport(report));
}
