import html.parser
import sys
import urllib.parse
import urllib.request

LIMIT = 1024 * 1024


class Icons(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        rel = (attrs.get("rel") or "").lower().split()
        if tag.lower() == "link" and any(item in ("icon", "apple-touch-icon", "apple-touch-icon-precomposed") for item in rel) and attrs.get("href"):
            self.urls.append(attrs["href"])


def fetch(url, allow_truncated=False):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Sightline/1.0"})
    with urllib.request.urlopen(request, timeout=12) as response:
        if urllib.parse.urlsplit(response.url).scheme not in ("http", "https"):
            raise ValueError("Unsupported redirect")
        data = response.read(LIMIT + 1)
        if len(data) > LIMIT and not allow_truncated:
            raise ValueError("Response too large")
        return response.url, data[:LIMIT]


def image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return "png"
    if data.startswith(b"\x00\x00\x01\x00"): return "ico"
    if data.startswith(b"\xff\xd8\xff"): return "jpg"
    if data.startswith(b"GIF8"): return "gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP": return "webp"
    return None


def main(url, destination):
    candidates = []
    try:
        page_url, html = fetch(url, allow_truncated=True)
        parser = Icons()
        parser.feed(html.decode("utf-8", errors="replace"))
        candidates.extend(urllib.parse.urljoin(page_url, item) for item in parser.urls)
    except (OSError, ValueError):
        pass
    candidates.append(urllib.parse.urljoin(locals().get("page_url", url), "/favicon.ico"))
    for candidate in candidates[:10]:
        if urllib.parse.urlsplit(candidate).scheme not in ("http", "https"):
            continue
        try:
            _, data = fetch(candidate)
            extension = image_type(data)
            if extension:
                with open(destination, "wb") as output:
                    output.write(data)
                print(extension)
                return
        except (OSError, ValueError):
            continue
    raise SystemExit("Favicon unavailable")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
