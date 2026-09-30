const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.startsWith("ISSUE_") && f.endsWith(".md"));

console.log(`Found ${files.length} issue files.`);

for (const file of files) {
  const content = fs.readFileSync(path.join(__dirname, file), "utf-8");

  // Extract title using regex
  const titleMatch = content.match(/title:\s*"?(.*?)"?\s*\n/);
  const title = titleMatch ? titleMatch[1] : `Issue from ${file}`;

  // Extract labels using regex
  const labelsMatch = content.match(/labels:\s*(.*?)\s*\n/);
  const labelsStr = labelsMatch ? labelsMatch[1].replace(/['"]/g, "") : "";
  const labelsArg = labelsStr ? `--label "${labelsStr}"` : "";

  // Remove frontmatter
  const body = content.replace(/^---[\s\S]*?---\n*/, "");

  // Save body to a temp file
  const tempFile = path.join(__dirname, `temp_body_${file}`);
  fs.writeFileSync(tempFile, body);

  try {
    console.log(`Creating issue: ${title}`);
    const cmd = `gh issue create --title "${title}" --body-file "${tempFile}" ${labelsArg}`;
    const output = execSync(cmd, { encoding: "utf-8" });
    console.log(`Success: ${output.trim()}`);
  } catch (error) {
    console.error(`Failed to create issue for ${file}:`, error.message);
  } finally {
    fs.unlinkSync(tempFile);
  }
}
