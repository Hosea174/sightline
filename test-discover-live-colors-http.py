import importlib.util
import unittest

SCRIPT = __import__('pathlib').Path(__file__).resolve().parent / 'scripts' / 'discover-live-colors-http.py'
spec = importlib.util.spec_from_file_location('http_colors', SCRIPT)
colors = importlib.util.module_from_spec(spec)
spec.loader.exec_module(colors)


class HttpColorTest(unittest.TestCase):
    def test_parser_finds_variables_and_interactive_css(self):
        page = colors.PageParser()
        page.feed('<title>Brand</title><link rel="stylesheet" href="/a.css"><style>:root{--brand-primary:#1266dd}.button:hover{background-color:#e94433}</style><button style="color:rgb(20, 30, 40)">Go</button>')
        self.assertEqual(page.title, 'Brand')
        self.assertEqual(page.links, ['/a.css'])
        found = colors.colors_in(page.styles[0])
        self.assertIn(('#1266dd', 5), found)
        self.assertIn(('#e94433', 3), found)
        self.assertEqual(page.interactive, ['color:rgb(20, 30, 40)'])

    def test_large_brace_free_css_finishes_and_style_tags_close(self):
        import time
        started = time.monotonic()
        self.assertEqual(colors.colors_in('x' * 1_000_000), [])
        self.assertLess(time.monotonic() - started, 1.0)
        page = colors.PageParser()
        page.feed('<style>:root{--primary:#123456}</style><script>const x="not css"</script>')
        self.assertEqual(page.styles, [':root{--primary:#123456}'])
        self.assertIn(('#123456', 5), colors.colors_in(page.styles[0]))

    def test_shades_group_and_select_representatives(self):
        self.assertEqual(colors.estimate([(':root{--brand:#1266dd;--primary:#2879eb;--accent:#e94433}', 0)]), ['#1266dd', '#e94433'])

    def test_cli_resume_reconciles_checkpoint_without_losing_output(self):
        import json, os, subprocess, sys, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            catalog, output = base / 'catalog.json', base / 'colors.json'
            checkpoint = output.with_suffix(output.suffix + '.checkpoint.json')
            catalog.write_text('[]', encoding='utf8')
            old = {'url':'https://old.test','title':'Ancien','colors':['#123456'],'colorSource':'live-dom-computed'}
            missing = {'url':'https://new.test','title':'Caf?','colors':['#abcdef'],'colorSource':'http-css-estimate'}
            output.write_text(json.dumps([old]),encoding='utf8')
            checkpoint.write_text(json.dumps({old['url']:old,missing['url']:missing}),encoding='utf8')
            env = os.environ.copy();env['PYTHONIOENCODING'] = 'cp1252'
            run = subprocess.run([sys.executable,str(SCRIPT),str(catalog),'--output',str(output),'--limit','0'],capture_output=True,env=env,timeout=5)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertEqual(json.loads(output.read_text(encoding='utf8')),[old,missing])

    def test_output_and_checkpoint_existing_values_remain_untouched(self):
        old_output = [{'url': 'https://old.test', 'colors': ['#123456'], 'colorSource': 'awwwards'}]
        old_checkpoint = {'https://old.test': {'url': 'https://old.test', 'colorSource': 'live-dom-computed'}}
        self.assertFalse(colors.append_result(old_output, old_checkpoint, {'url': 'https://old.test', 'colors': ['#ffffff']}))
        self.assertTrue(colors.append_result(old_output, old_checkpoint, {'url': 'https://new.test', 'colors': ['#ff0000']}))
        self.assertEqual(old_output, [
            {'url': 'https://old.test', 'colors': ['#123456'], 'colorSource': 'awwwards'},
            {'url': 'https://new.test', 'colors': ['#ff0000']},
        ])
        self.assertEqual(old_checkpoint['https://old.test'], {'url': 'https://old.test', 'colorSource': 'live-dom-computed'})


if __name__ == '__main__':
    unittest.main()
