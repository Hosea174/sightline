import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("favicon", Path(__file__).parent / "scripts/fetch-favicon.py")
favicon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(favicon)
parser = favicon.Icons()
parser.feed('<link rel="shortcut icon" href="/actual.png"><link rel="stylesheet" href="/style.css">')
assert parser.urls == ["/actual.png"]
parser.feed('<link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href>')
assert parser.urls == ["/actual.png", "/apple.png"]
assert favicon.image_type(b"\x89PNG\r\n\x1a\nrest") == "png"
assert favicon.image_type(b"<html>not an icon</html>") is None
print("Favicon checks passed")
