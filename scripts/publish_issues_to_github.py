#!/usr/bin/env python3
"""
Publish issues to GitHub directly from data/production_130_issues.json using gh CLI.
Automatically creates any missing labels on the GitHub repository.
Usage:
  python3 scripts/publish_issues_to_github.py --start 1 --count 50
  python3 scripts/publish_issues_to_github.py --all
"""

import argparse
import json
import subprocess
import time
import sys

def get_existing_labels():
    try:
        res = subprocess.run(
            ["gh", "label", "list", "--limit", "300", "--json", "name"],
            capture_output=True, text=True, check=True
        )
        data = json.loads(res.stdout)
        return {item["name"].lower(): item["name"] for item in data}
    except Exception as e:
        print(f"Warning: Could not fetch labels: {e}", file=sys.stderr)
        return {}

def ensure_label_exists(label_name, existing_labels):
    norm = label_name.strip().lower()
    # Normalize common aliases
    alias_map = {
        "contracts": "contract",
        "ci-cd": "devops",
        "docker": "devops",
        "infrastructure": "backend",
        "state": "architecture: state-management",
        "ui": "module: editor-ui",
        "nextjs": "frontend"
    }
    target_label = alias_map.get(norm, label_name.strip())
    target_norm = target_label.lower()

    if target_norm in existing_labels:
        return existing_labels[target_norm]

    # Create missing label on GitHub
    print(f"  + Creating missing label '{target_label}' on repository...")
    try:
        subprocess.run(
            ["gh", "label", "create", target_label, "--color", "E99695", "--description", "Automated production label"],
            capture_output=True, text=True, check=True
        )
        existing_labels[target_norm] = target_label
        return target_label
    except Exception as e:
        # Fallback to existing or skip
        return None

def publish_issue(issue, existing_labels):
    title = issue["title"]
    
    # Resolve and ensure all labels exist
    resolved_labels = []
    for raw_label in issue["labels"]:
        ensured = ensure_label_exists(raw_label, existing_labels)
        if ensured:
            resolved_labels.append(ensured)
    
    labels_str = ",".join(resolved_labels)
    
    body = f"""## Description
{issue['description']}

## Location
`{issue['location']}`:
```javascript
{issue['code']}
```

## Impact
{issue['impact']}

## Required Fix
"""
    for fix in issue['fix']:
        body += f"- {fix}\n"
        
    body += "\n## Reference\nIdentified during full codebase production readiness audit of soroban-playground."
    
    cmd = [
        "gh", "issue", "create",
        "--title", title,
        "--body", body
    ]
    if labels_str:
        cmd.extend(["--label", labels_str])
    
    print(f"Creating issue #{issue['id']}: {title}...")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"  ✓ {res.stdout.strip()}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ✗ Failed to create issue: {e.stderr.strip()}", file=sys.stderr)
        return False

def main():
    parser = argparse.ArgumentParser(description="Publish production issues to GitHub")
    parser.add_argument("--start", type=int, default=1, help="Starting issue ID (1-130)")
    parser.add_argument("--count", type=int, default=50, help="Number of issues to publish")
    parser.add_argument("--all", action="store_true", help="Publish all 130 issues")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between issue creation in seconds")
    args = parser.parse_args()

    with open("data/production_130_issues.json", "r") as f:
        issues = json.load(f)

    existing_labels = get_existing_labels()

    if args.all:
        selected = issues
    else:
        start_idx = max(0, args.start - 1)
        end_idx = min(len(issues), start_idx + args.count)
        selected = issues[start_idx:end_idx]

    print(f"Publishing {len(selected)} issues to GitHub...")
    for idx, issue in enumerate(selected):
        success = publish_issue(issue, existing_labels)
        if success and idx < len(selected) - 1:
            time.sleep(args.delay)

    print("All requested issues processed!")

if __name__ == "__main__":
    main()
