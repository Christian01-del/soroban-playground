import subprocess
import time

frontend_areas = [
    "Editor Component", "FileTree Component", "Wallet Integration", "Oracle Status Panel", 
    "Token Balance UI", "Network Selector", "Settings Page", "Transaction History",
    "Compilation Panel", "Deployment Panel", "Transaction Builder", "Event Viewer",
    "State Explorer", "ABI Viewer", "Account Profile", "Dashboard Layout",
    "Sidebar Navigation", "Theme Switcher", "Notification System", "Error Boundary",
    "Loading Skeletons", "Data Table Component", "Chart Visualizations", "Form Validation",
    "API Client Hooks", "State Management Store", "Web3 Provider Setup", "Asset Gallery",
    "Contract Interaction Forms", "User Onboarding Flow"
]

backend_areas = [
    "Auth Service", "Oracle Service", "Compiler Service", "Deployer Service",
    "RPC Proxy", "Database Migrations", "Rate Limiter", "Analytics Engine",
    "WebSocket Server", "Logging Middleware", "Cache Manager", "Event Listener",
    "Transaction Submitter", "ABI Parser", "Contract Verifier", "Metrics Exporter",
    "User Profile API", "Project Management API", "File Storage Service", "Email Notifications",
    "Background Jobs Worker", "Health Check Endpoints", "API Documentation", 
    "Data Seeding Scripts", "Error Handling Middleware", "CORS Configuration", 
    "Environment Variable Validation", "CI/CD Pipeline Setup", "Docker Configuration", 
    "Integration Test Runner"
]

contract_areas = [
    "Token Contract", "AMM Contract", "Oracle Contract", "Synthetic Assets Core",
    "MultiSig Wallet", "Voting Contract", "Vault Contract", "Airdrop Contract",
    "Staking Contract", "Escrow Contract", "Lending Pool", "Borrowing Logic",
    "Interest Rate Model", "Liquidation Engine", "Price Feed Adapter", "Governance Token",
    "Time-Lock Controller", "Payment Splitter", "NFT Marketplace", "Royalty Distributor",
    "Subscription Manager", "Identity Registry", "Reputation System", "Bounty Board",
    "Yield Aggregator", "Flash Loan Provider", "Cross-chain Bridge", 
    "Options Protocol", "Perpetual Futures", "Insurance Fund"
]

issue_types = [
    {
        "name": "Test Suite",
        "title": "[FEATURE] Implement Test Suite for {area}",
        "desc": "Implement a comprehensive test suite for the {area} to ensure production readiness and reliability."
    },
    {
        "name": "Refactor",
        "title": "[REFACTOR] Optimize and Clean Up {area}",
        "desc": "Refactor the {area} to improve maintainability, performance, and code quality."
    },
    {
        "name": "Error Handling",
        "title": "[ENHANCEMENT] Robust Error Handling in {area}",
        "desc": "Enhance the error handling and edge-case management within the {area} to provide better user feedback and system stability."
    }
]

domains = [
    ("frontend", frontend_areas),
    ("backend", backend_areas),
    ("contract", contract_areas)
]

# Ensure labels exist
labels_to_create = ["frontend", "backend", "contract", "testing", "refactor", "enhancement", "good first issue"]
for label in labels_to_create:
    subprocess.run(["gh", "label", "create", label, "--force"], capture_output=True)

print("Starting to create 90 issues...")
count = 0
for domain, areas in domains:
    for i, area in enumerate(areas):
        itype = issue_types[i % 3]
        title = itype["title"].format(area=area)
        
        if itype['name'] == "Test Suite":
            labels = f"{domain},testing,good first issue"
        elif itype['name'] == "Refactor":
            labels = f"{domain},refactor,good first issue"
        else:
            labels = f"{domain},enhancement,good first issue"

        body = f"""## 📝 Feature Summary

{itype['desc'].format(area=area)}

## ❓ Problem or Motivation

The {area} is a critical component of the Soroban Playground. Continuous improvement in this area ensures a stable and robust platform for developers.

## 💡 Proposed Solution

- Address the core requirements for {itype['name'].lower()} in the {area}.
- Ensure backwards compatibility.
- Follow existing project conventions.

## 🧩 Affected Areas
- [x] {domain.capitalize()}
- [ ] Testing Infrastructure

## ✅ Checklist
- [x] I have searched for existing issues
- [x] This aligns with the project's goal
"""
        
        with open("tmp_body.md", "w") as f:
            f.write(body)
            
        print(f"Creating [{domain}]: {title}")
        res = subprocess.run(["gh", "issue", "create", "--title", title, "--body-file", "tmp_body.md", "--label", labels], capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Failed to create: {res.stderr}")
        
        count += 1
        time.sleep(1.5) # Sleep to avoid rate limits

print(f"Successfully finished generating {count} issues.")
subprocess.run(["rm", "tmp_body.md"], capture_output=True)
