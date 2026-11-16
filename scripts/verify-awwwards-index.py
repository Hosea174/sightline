#!/usr/bin/env python3
"""Check candidate Awwwards live URLs over HTTP; emit verified rows and an audit report."""
import argparse
import concurrent.futures
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHALLENGE = re.compile(r"(captcha|verify you are human|checking your browser|security challenge|enable javascript and cookies|attention required.{0,30}cloudflare|just a moment\.\.\.)", re.I)
PARKED = re.compile(r"(domain (is )?(for sale|parked)|buy this domain|this domain may be for sale|website coming soon|default web site page|future home of something quite cool)", re.I)
ERROR = re.compile(r"(404.{0,30}(not found|page)|page not found|website is unavailable|account has been suspended|502 bad gateway|503 service unavailable)", re.I)

class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(); self.hidden = 0; self.parts = []; self.title = False; self.titles = []
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg"): self.hidden += 1
        if tag == "title": self.title = True
    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg") and self.hidden: self.hidden -= 1
        if tag == "title": self.title = False
    def handle_data(self, data):
        if self.title: self.titles.append(data)
        elif not self.hidden: self.parts.append(data)

def host(url):
    try: return (urllib.parse.urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError: return ""

def check(row, timeout, retries):
    original = row.get("liveUrl") or row.get("url") or ""
    result = {"inputUrl": original, "resolvedUrl": None, "statusCode": None, "classification": "unverified", "reason": "invalid or missing URL", "attempts": 0}
    if urllib.parse.urlsplit(original).scheme not in ("http", "https") or not host(original): return result
    for attempt in range(retries + 1):
        result["attempts"] = attempt + 1
        try:
            req = urllib.request.Request(original, headers={"User-Agent":"Mozilla/5.0 (compatible; AwwwardsIndexVerifier/1.0)","Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read(250_000)
                final = response.geturl(); status = response.status
                ctype = response.headers.get_content_type()
            result.update(resolvedUrl=final, statusCode=status)
            if host(final) != host(original): result["reason"] = "redirected to unrelated host"
            elif not 200 <= status < 300: result["reason"] = "non-success HTTP status"
            elif ctype not in ("text/html", "application/xhtml+xml"): result["reason"] = "response is not HTML"
            else:
                text = body.decode("utf-8", "replace")
                visible = VisibleText(); visible.feed(text)
                title_text = re.sub(r"\s+", " ", " ".join(visible.titles)).strip()
                body_text = re.sub(r"\s+", " ", " ".join(visible.parts)).strip()
                evidence = (title_text + " " + body_text[:12000])
                if CHALLENGE.search(evidence): result["reason"] = "anti-bot or signup challenge detected in visible page text"
                elif PARKED.search(evidence): result["reason"] = "parked or placeholder page detected in visible page text"
                elif ERROR.search(title_text + " " + body_text[:12000]): result["reason"] = "error page detected in visible page text"
                elif not re.search(r"<(html|body|main|article|header|nav|div|section)\b", text, re.I): result["reason"] = "no recognizable HTML document structure"
                elif not body_text: result["reason"] = "HTML response has no visible body text"
                else:
                    result.update(classification="verified", reason="successful HTML response with visible content", pageTitle=title_text)
            return result
        except urllib.error.HTTPError as e:
            result.update(resolvedUrl=e.geturl(), statusCode=e.code, reason=f"HTTP {e.code}; response not verified")
            if e.code not in (408, 425, 429, 500, 502, 503, 504) or attempt == retries: return result
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            result["reason"] = f"network error or timeout: {str(getattr(e, 'reason', e))[:180]}"
            if attempt == retries: return result
        time.sleep(min(.25 * (2 ** attempt), 1.0))
    return result

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=ROOT / "awwwards-index-seed.json")
    ap.add_argument("--verified", type=Path, default=ROOT / "awwwards-index-verified.json")
    ap.add_argument("--report", type=Path, default=ROOT / "awwwards-index-verification-report.json")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--timeout", type=float, default=10)
    ap.add_argument("--retries", type=int, default=1)
    a = ap.parse_args()
    rows = json.loads(a.input.read_text(encoding="utf-8"))
    if not isinstance(rows, list): raise SystemExit("Input must be a JSON array")
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.workers)) as pool:
        checks = list(pool.map(lambda row: check(row, a.timeout, max(0, a.retries)), rows))
    verified = []
    for row, audit in zip(rows, checks):
        if audit["classification"] == "verified":
            verified.append({**row, "resolvedUrl": audit["resolvedUrl"], "checkStatus": audit["statusCode"]})
    counts = {key: sum(x["classification"] == key for x in checks) for key in ("verified", "unverified")}
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "input": str(a.input), "counts": {"total":len(rows), **counts}, "settings":{"workers":max(1,a.workers),"timeoutSeconds":a.timeout,"retries":max(0,a.retries)}, "limitations":"HTTP checks cannot confirm browser rendering, JavaScript interactions, content freshness, or full usability. Anti-bot pages may evade text heuristics; HTTP 403, timeouts, and transient failures are unverified rather than treated as dead.", "results":[{**({"slug":r.get("slug"),"title":r.get("title")}), **c} for r,c in zip(rows,checks)]}
    a.verified.write_text(json.dumps(verified, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    a.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"total":len(rows), **counts}))
if __name__ == "__main__": main()
