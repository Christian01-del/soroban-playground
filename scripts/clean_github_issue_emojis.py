#!/usr/bin/env python3
"""
Fast emoji cleaner for GitHub issue titles.
"""

import json
import re
import subprocess
import concurrent.futures
import sys

def strip_emojis(text):
    emoji_pattern = re.compile(
        "["
        "\U0001F1E0-\U0001F1FF"
        "\U0001F300-\U0001F5FF"
        "\U0001F600-\U0001F64F"
        "\U0001F680-\U0001F6FF"
        "\U0001F700-\U0001F77F"
        "\U0001F780-\U0001F7FF"
        "\U0001F800-\U0001F8FF"
        "\U0001F900-\U0001F9FF"
        "\U0001FA00-\U0001FA6F"
        "\U0001FA70-\U0001FAFF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U00002600-\U000026FF"
        "]+",
        flags=re.UNICODE,
    )
    cleaned = emoji_pattern.sub("", text)
    return re.sub(r"\s+", " ", cleaned).strip()

def update_single_issue(issue):
    num = issue["number"]
    orig_title = issue["title"]
    clean_title = strip_emojis(orig_title)

    if clean_title != orig_title:
        try:
            subprocess.run(
                ["gh", "issue", "edit", str(num), "--title", clean_title],
                capture_output=True, text=True, check=True
            )
            print(f"✓ #{num}: {clean_title}", flush=True)
            return True
        except Exception as e:
            print(f"✗ Failed #{num}: {e}", file=sys.stderr, flush=True)
            return False
    return None

def main():
    print("Fetching open issues...", flush=True)
    res = subprocess.run(
        ["gh", "issue", "list", "--state", "open", "--limit", "300", "--json", "number,title"],
        capture_output=True, text=True, check=True
    )
    issues = json.loads(res.stdout)
    to_update = [i for i in issues if strip_emojis(i["title"]) != i["title"]]
    print(f"Found {len(to_update)} issues to clean.", flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(update_single_issue, to_update))

    updated = sum(1 for r in results if r is True)
    print(f"Successfully cleaned emojis from {updated} issue titles on GitHub!", flush=True)

if __name__ == "__main__":
    main()
