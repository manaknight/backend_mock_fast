const fs = require('fs');
const path = require('path');

/**
 * Dump Context Script
 * Exports the entire API structure and schemas into a text format
 * that can be pasted into an LLM (Cursor, ChatGPT, etc.)
 */

const routesPath = path.join(process.cwd(), 'routes');
const output = [];

output.push("# API STRUCTURE CONTEXT");
output.push("This file contains the current route definitions, request/response schemas, and mock logic.\n");

if (fs.existsSync(routesPath)) {
  const files = fs.readdirSync(routesPath).filter(f => f.endsWith('Routes.js'));

  files.forEach(file => {
    output.push(`## FILE: routes/${file}`);
    const content = fs.readFileSync(path.join(routesPath, file), 'utf8');

    // Clean up content slightly for better readability
    const cleaned = content
      .replace(/\/\/.*$/gm, '') // Remove single-line comments
      .replace(/\s+/g, ' ')      // Collapse whitespace
      .replace(/require\(.*?\);?/g, ''); // Remove requires

    output.push("```javascript");
    output.push(content);
    output.push("```\n");
  });
}

const outputPath = path.join(process.cwd(), 'api_context_for_ai.txt');
fs.writeFileSync(outputPath, output.join('\n'));

console.log(`✅ AI Context dumped to: ${outputPath}`);
console.log(`You can now attach this file to your chat with an AI to help write 'real' implementations.`);

