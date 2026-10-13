import json
import subprocess
import unittest
from pathlib import Path


class AgentWorkbenchCoreModelOrderTests(unittest.TestCase):
    def test_auto_and_explicit_image_routes_follow_configured_order(self):
        source_path = Path("static/js/agent-workbench-core.js").resolve().as_posix()
        script = f"""
const fs = require('fs');
global.window = {{}};
eval(fs.readFileSync({json.dumps(source_path)}, 'utf8'));
const core = window.LingDrawAgentWorkbench;
const payload = {{providers:[
  {{id:'ordered', name:'Ordered', enabled:true, available:true, has_key:true,
    image_models:['preferred-image','fallback-image'], chat_models:['preferred-chat','fallback-chat']}},
  {{id:'alternate', name:'Alternate', enabled:true, available:true, has_key:true,
    image_models:['alternate-image'], chat_models:['alternate-chat']}}
]}};
const automatic = core.resolveGenerationRoute(payload);
const explicit = core.resolveGenerationRoute(payload, 'alternate::alternate-image');
process.stdout.write(JSON.stringify({{automatic, explicit}}));
"""
        result = subprocess.run(
            ["node", "-e", script],
            check=True,
            capture_output=True,
            text=True,
        )
        routes = json.loads(result.stdout)
        self.assertEqual(routes["automatic"]["image_model"], "preferred-image")
        self.assertEqual(routes["automatic"]["chat_model"], "preferred-chat")
        self.assertEqual(routes["explicit"]["image_provider"], "alternate")
        self.assertEqual(routes["explicit"]["image_model"], "alternate-image")


if __name__ == "__main__":
    unittest.main()
