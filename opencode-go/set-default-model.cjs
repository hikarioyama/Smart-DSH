// agent-default-model だけ差し替える (YAML 1.2 の DSH と同じ yaml npm を使用)
// 使い方: node set-default-model.cjs <settings.yaml> <provider> <model>
// PATH 上の `dsh` 実行体から DSH 同梱の yaml を解決する
const fs = require('node:fs'), path = require('node:path');
let yaml = null;
for (const dir of (process.env.PATH ?? '').split(':')) {
	try {
		const root = path.dirname(path.dirname(fs.realpathSync(path.join(dir, 'dsh'))));
		yaml = require(path.join(root, 'node_modules', 'yaml'));
		break;
	} catch {}
}
if (!yaml) throw new Error('yaml module not found via dsh on PATH (set-default-model.cjs)');
const [, , file, prov, mod] = process.argv;
const doc = yaml.parseDocument(fs.readFileSync(file, 'utf8'));
doc.setIn(['agent-default-model'], { provider: prov, model: mod });
fs.writeFileSync(file, doc.toString());
