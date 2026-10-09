// agent-default-model だけ差し替える (YAML 1.2 の DSH と同じ yaml npm を使用)
// 使い方: node set-default-model.cjs <settings.yaml> <provider> <model>
// Resolve DSH's YAML parser even when rdsh shadows dsh on PATH.
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const { resolveDshPackage } = require('../scripts/dsh-package.cjs');
const yaml = createRequire(path.join(resolveDshPackage('@deepseek-ai/dsh-plugin-manager'), 'package.json'))('yaml');
const [, , file, prov, mod] = process.argv;
const doc = yaml.parseDocument(fs.readFileSync(file, 'utf8'));
if (doc.errors.length) throw doc.errors[0];
doc.setIn(['agent-default-model'], { provider: prov, model: mod });
fs.writeFileSync(file, doc.toString());
