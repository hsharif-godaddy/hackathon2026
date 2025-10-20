#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
const TOOLS_DIR = path.join(__dirname, '../agents/src/tools');

const DANGEROUS_PATTERNS = [
  {
    pattern: /child_process/i,
    message: 'child_process module usage detected',
  },
  {
    pattern: /\.exec\(/,
    message: 'exec() call detected',
    allowedContexts: ['devSupervisor!', 'devSupervisor?', 'pattern'],
  },
  {
    pattern: /\.execSync\(/,
    message: 'execSync() call detected',
  },
  {
    pattern: /\.spawn\(/,
    message: 'spawn() call detected',
  },
  {
    pattern: /\.spawnSync\(/,
    message: 'spawnSync() call detected',
  },
  {
    pattern: /\.fork\(/,
    message: 'fork() call detected',
  },
  {
    pattern: /\.execFile\(/,
    message: 'execFile() call detected',
  },
  {
    pattern: /\.execFileSync\(/,
    message: 'execFileSync() call detected',
  },
];

const ALLOWED_EXCEPTIONS = [];

function checkFile(filePath) {
  const fileName = path.basename(filePath);
  
  if (ALLOWED_EXCEPTIONS.includes(fileName)) {
    console.log(`⏭️  Skipping ${fileName} (allowed exception)`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const violations = [];

  DANGEROUS_PATTERNS.forEach(({ pattern, message, allowedContexts }) => {
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      const match = pattern.exec(line);
      if (match) {
        if (allowedContexts) {
          const matchIndex = match.index;
          const isAllowed = allowedContexts.some(context => {
            const contextStart = matchIndex - context.length;
            if (contextStart < 0) return false;
            const potentialContext = line.substring(contextStart, matchIndex);
            return potentialContext === context;
          });
          if (isAllowed) {
            pattern.lastIndex = 0;
            return;
          }
        }
        
        violations.push({
          file: path.relative(process.cwd(), filePath),
          line: index + 1,
          message,
          code: line.trim(),
        });
        pattern.lastIndex = 0;
      }
    });
  });

  return violations;
}

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (file !== '__tests__' && file !== 'node_modules') {
        getAllFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function main() {
  console.log('🔍 Checking tools directory for dangerous process execution...\n');

  const files = getAllFiles(TOOLS_DIR);

  let allViolations = [];

  files.forEach((file) => {
    const violations = checkFile(file);
    allViolations = allViolations.concat(violations);
  });

  if (allViolations.length > 0) {
    console.error('❌ Security violations found:\n');
    allViolations.forEach((violation) => {
      console.error(`  ${violation.file}:${violation.line}`);
      console.error(`    ${violation.message}`);
      console.error(`    ${violation.code}\n`);
    });
    process.exit(1);
  }

  console.log('✅ No security violations found in tools directory');
  process.exit(0);
}

main();
