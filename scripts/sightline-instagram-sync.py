"""Enumerate saved Instagram collection posts into a local, incremental queue.

Uses gallery-dl's existing local configuration only. It does not download media,
log in, or write credentials. Run with --help for collection argument format.
"""
import argparse
import atexit
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def parse_dump(raw, include_owner=False):
    """Return discovered post IDs/URLs and whether gallery-dl reported an error."""
    messages = json.loads(raw)
    if not isinstance(messages, list):
        raise ValueError("gallery-dl JSON root is not a list")
    posts, errors = {}, []
    for message in messages:
        if not isinstance(message, list) or not message:
            raise ValueError("unexpected gallery-dl message")
        kind = message[0]
        if kind == -1:
            errors.append(message[1] if len(message) > 1 else {})
            continue
        if kind == 2 and len(message) == 2 and isinstance(message[1], dict):
            meta = message[1]
        elif kind in (2, 3, 6) and len(message) >= 3 and isinstance(message[2], dict):
            meta = message[2]
        else:
            continue
        shortcode = meta.get("post_shortcode") or meta.get("shortcode")
        post_id = str(meta.get("post_id") or shortcode or "")
        url = meta.get("post_url") or (f"https://www.instagram.com/p/{shortcode}/" if shortcode else None)
        if post_id and url and url.startswith("https://www.instagram.com/"):
            owner_data = meta.get("owner")
            owner = meta.get("username") or (owner_data.get("username") if isinstance(owner_data, dict) else None)
            username = owner if isinstance(owner, str) and re.fullmatch(r"[A-Za-z0-9._]{1,30}", owner) else None
            value = {"url": url, "username": username} if include_owner else url
            if post_id not in posts or include_owner and username and not posts[post_id].get("username"):
                posts[post_id] = value
    return posts, errors


def scan(url, retries, timeout, browser=None, known=None):
    """Check a recent page first; backfill fully only if its known boundary is absent."""
    last = "gallery-dl did not complete"
    for attempt in range(retries + 1):
        try:
            gallery_dl_bin = os.environ.get("SIGHTLINE_GALLERY_DL", "").strip()
            command = [gallery_dl_bin] if gallery_dl_bin else [sys.executable, "-m", "gallery_dl"]
            if browser: command += ["--cookies-from-browser", browser + "/instagram.com"]
            def run(recent):
                args = command + (["--post-range", "1-50"] if recent else []) + ["--dump-json", url]
                result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
                posts, errors = parse_dump(result.stdout, include_owner=True)
                if result.returncode or errors:
                    raise ValueError("gallery-dl reported an incomplete scan")
                return posts
            posts = run(bool(known))
            # If a whole page is new, older unseen saves may have fallen beyond it.
            if known and len(posts) >= 50 and not (set(posts) & set(known)):
                posts = run(False)
            return posts, None
        except (OSError, subprocess.TimeoutExpired, ValueError, json.JSONDecodeError) as exc:
            last = type(exc).__name__
        if attempt < retries:
            time.sleep(min(2 ** attempt, 8))
    return {}, last


def self_test():
    posts, errors = parse_dump(json.dumps([
        [2, "unused", {"collection_id": "c1"}],
        [2, {"post_id": "41", "post_shortcode": "First"}],
        [3, "https://cdn.test/media.jpg", {"post_id": "42", "post_shortcode": "AbC"}],
        [6, "https://www.instagram.com/p/Def/", {"post_id": "43", "post_url": "https://www.instagram.com/p/Def/"}],
        [3, "https://cdn.test/dup.jpg", {"post_id": "42", "post_shortcode": "AbC"}],
    ]))
    assert posts == {"41": "https://www.instagram.com/p/First/", "42": "https://www.instagram.com/p/AbC/", "43": "https://www.instagram.com/p/Def/"}
    assert not errors
    _, errors = parse_dump('[[ -1, {"error":"AuthError"} ]]')
    assert errors
    print("Self-test passed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", action="append", default=[], metavar="NAME=CATEGORY=URL",
                        help="Repeat for each selected saved collection URL")
    parser.add_argument("--state", type=Path, default=Path("instagram-sync-state.json"))
    parser.add_argument("--browser", choices=["brave", "chrome", "edge", "firefox"], help="Use the existing browser session; omit to use gallery-dl configuration")
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.retries < 0 or args.timeout < 1:
        parser.error("retries must be nonnegative and timeout positive")
    collections = []
    for value in args.collection:
        parts = value.split("=", 2)
        if len(parts) != 3 or not all(parts) or not parts[2].startswith("https://www.instagram.com/"):
            parser.error(f"invalid collection {value!r}; expected NAME=CATEGORY=https://www.instagram.com/...")
        collections.append(dict(zip(("name", "category", "url"), parts)))
    if not collections:
        parser.error("provide at least one --collection")

    args.state.parent.mkdir(parents=True, exist_ok=True)
    lock_file = open(args.state.with_suffix('.lock'), 'a+b')
    lock_file.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock_file.close()
        raise SystemExit('Another Instagram sync is running')
    atexit.register(lock_file.close)
    state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {"version": 1, "posts": {}, "collections": {}}
    if not isinstance(state.get("posts"), dict) or not isinstance(state.get("collections"), dict):
        parser.error("state file has an unsupported format")
    for collection in collections:
        status = {"url": collection["url"], "category": collection["category"],
                  "checked_at": datetime.now(timezone.utc).isoformat()}
        known = {key.rsplit(":", 1)[0] for key, post in state["posts"].items() if post.get("collection_url") == collection["url"]}
        found, error = scan(collection["url"], args.retries, args.timeout, args.browser, known)
        if error:
            status.update(status="incomplete", error=error)
        else:
            status.update(status="complete", discovered=len(found))
        state["collections"][collection["name"]] = status
        for post_id, details in found.items():
            url = details["url"] if isinstance(details, dict) else details
            # One post can belong to collections mapped to different categories.
            key = post_id + ":" + collection["category"]
            post = state["posts"].setdefault(key, {"url": url, "category": collection["category"], "collection": collection["name"],
                                                   "collection_url": collection["url"], "status": "pending", "attempts": 0})
            if isinstance(details, dict) and details.get("username"):
                post["username"] = details["username"]
            if post.get("status") == "pending":
                post["collection"] = collection["name"]
                post["collection_url"] = collection["url"]
        atomic_json(args.state, state)
        print(f"{collection['name']}: {status['status']} ({len(found)} posts)")
    print(f"Queue: {sum(p.get('status') == 'pending' for p in state['posts'].values())} pending; state: {args.state}")
    lock_file.close()


if __name__ == "__main__":
    main()
