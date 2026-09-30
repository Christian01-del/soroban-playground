with open("frontend/src/app/PlaygroundClient.tsx", "r") as f:
    content = f.read()

# Fix the one in the object literal (line ~765)
content = content.replace("args as Record<string, string>,", "args: args as Record<string, string>,", 1)

# Fix the one in the function call (line ~773)
content = content.replace("args: args: args as Record<string, string>,", "args as Record<string, string>,")
content = content.replace("args: args as Record<string, string>,", "args as Record<string, string>,")

with open("frontend/src/app/PlaygroundClient.tsx", "w") as f:
    f.write(content)
