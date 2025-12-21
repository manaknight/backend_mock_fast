const fs = require('fs');
const path = require('path');

/**
 * Dump Context Script
 * Exports the entire API structure and schemas into a text format
 * that can be pasted into an LLM (Cursor, ChatGPT, etc.)
 */

const output = [];
output.push("# API STRUCTURE CONTEXT");
output.push("This file contains the current route definitions, request/response schemas, and mock logic.\n");

// 1. Shared Routes
const sharedPath = path.join(process.cwd(), 'routes');
if (fs.existsSync(sharedPath)) {
  const files = fs.readdirSync(sharedPath).filter(f => f.endsWith('Routes.js'));
  files.forEach(file => {
    output.push(`## FILE: routes/${file} (SHARED)`);
    output.push("```javascript");
    output.push(fs.readFileSync(path.join(sharedPath, file), 'utf8'));
    output.push("```\n");
  });
}

// 2. Project Routes (Tenant System)
const projectsPath = path.join(process.cwd(), 'projects');
if (fs.existsSync(projectsPath)) {
  const projects = fs.readdirSync(projectsPath).filter(f => fs.statSync(path.join(projectsPath, f)).isDirectory());

  projects.forEach(projectId => {
    const projectRoutesPath = path.join(projectsPath, projectId, 'routes');
    if (fs.existsSync(projectRoutesPath)) {
      const files = fs.readdirSync(projectRoutesPath).filter(f => f.endsWith('Routes.js'));
      files.forEach(file => {
        output.push(`## FILE: projects/${projectId}/routes/${file} (PROJECT: ${projectId})`);
        output.push("```javascript");
        output.push(fs.readFileSync(path.join(projectRoutesPath, file), 'utf8'));
        output.push("```\n");
      });
    }
  });
}

const outputPath = path.join(process.cwd(), 'api_context_for_ai.txt');
fs.writeFileSync(outputPath, output.join('\n'));

console.log(`✅ AI Context dumped to: ${outputPath}`);
console.log(`You can now attach this file to your chat with an AI to help write 'real' implementations.`);

