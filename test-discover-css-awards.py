import importlib.util, unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent / 'scripts' / 'discover-css-awards.py'
spec = importlib.util.spec_from_file_location('discover_css_awards', MODULE_PATH)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CSSAwardsTest(unittest.TestCase):
    def test_collects_only_until_latest_seed_url(self):
        seed = [{'url': 'https://old.example/', 'sources': [
            {'name': 'CSS Design Awards', 'url': 'https://www.cssdesignawards.com/sites/known/1/', 'date': '2026-11-10'}]}]
        candidate = {'title': 'New', 'url': 'https://new.example/path?keep=1', 'image': 'https://img.test/new.jpg',
                     'tags': ['WebGL'], 'sources': [{'name': 'CSS Design Awards',
                     'url': 'https://www.cssdesignawards.com/sites/new/2/', 'date': '2026-11-11',
                     'awards': ['Website of the Day']}]} 
        responses = iter([
            {'result': [candidate], 'errors': [], 'boundaryReached': False, 'pathCount': 2},
            {'result': [], 'errors': [], 'boundaryReached': True, 'pathCount': 1},
        ])
        calls = []

        def fake_runner(cli, session, *args, input=None):
            calls.append(args)
            return None if args[0] == 'open' else next(responses)

        rows, errors, latest = collector.collect(seed, 'agent-browser', 'test-session', fake_runner)
        self.assertEqual(rows, [candidate])
        self.assertEqual(errors, [])
        self.assertEqual(latest, '2026-11-10')
        self.assertEqual(sum(call[0] == 'eval' for call in calls), 2)
        self.assertEqual(rows[0]['url'], 'https://new.example/path?keep=1')

    def test_refuses_seed_without_a_safe_boundary(self):
        with self.assertRaisesRegex(ValueError, 'refusing a historical crawl'):
            collector.collect([], 'agent-browser', 'test-session', lambda *a, **k: None)


if __name__ == '__main__':
    unittest.main()
