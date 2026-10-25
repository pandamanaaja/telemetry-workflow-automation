const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('n8n Workflow Structure & Integrity Validation', () => {
  const workflowsDir = path.join(__dirname, '../n8n-workflows');
  const workflowFiles = [
    '01-industrial-telemetry-ocr.json',
    '02-site-visit-report-autocrat.json',
    '03-cleaning-report-generator.json',
    '04-pln-bill-ocr-extractor.json',
    '05-pln-gemini-ocr-sheet-builder.json',
    '06-pln-finalize-pdf-cloudconvert.json',
    '07-pln-finalize-pdf-local-pdflib.json'
  ];

  workflowFiles.forEach(fileName => {
    it(`Workflow ${fileName} is valid JSON with valid nodes and connections`, () => {
      const filePath = path.join(workflowsDir, fileName);
      assert.ok(fs.existsSync(filePath), `File exists: ${fileName}`);

      // Strip UTF-8 BOM if present and parse JSON
      const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      let parsed;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(raw);
      }, `Valid JSON: ${fileName}`);

      assert.ok(parsed.name, `Has name: ${fileName}`);
      assert.ok(Array.isArray(parsed.nodes), `Has nodes array: ${fileName}`);
      assert.ok(parsed.nodes.length > 0, `Nodes not empty: ${fileName}`);
      assert.strictEqual(typeof parsed.connections, 'object', `Has connections object: ${fileName}`);

      // Verify each node has id, name, and type
      parsed.nodes.forEach(node => {
        assert.ok(node.id, `Node has id in ${fileName}`);
        assert.ok(node.name, `Node has name in ${fileName}`);
        assert.ok(node.type, `Node has type in ${fileName}`);
      });
    });
  });
});
