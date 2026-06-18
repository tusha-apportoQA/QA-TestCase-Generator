import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";

const resolver = new Resolver();

// ─── System Prompt ────────────────────────────────────────────────────────────
const QA_SYSTEM_PROMPT = `You are a senior QA Engineer. Your job is to analyse a Jira issue description
and any supplementary context (e.g. a Loom transcript or additional notes) provided by the requester,
then generate a comprehensive set of test cases.

Return ONLY a valid JSON object — no markdown fences, no prose before or after — matching this schema:

{
  "summary": "<one-sentence description of what is being tested>",
  "testCases": [
    {
      "title": "<concise test case title, ≤80 chars>",
      "description": "<full description of what this test case covers>",
      "preconditions": "<any setup required before executing this test>",
      "steps": [
        "<step 1>",
        "<step 2>"
      ],
      "expectedResult": "<what should happen when the steps are executed correctly>",
      "priority": "High | Medium | Low",
      "type": "Functional | Edge Case | Negative | Performance | Security | Accessibility"
    }
  ]
}

Rules:
- Produce between 5 and 15 test cases depending on complexity.
- Always include at least one Negative test case and one Edge Case.
- Be specific — avoid vague steps like "click around" or "test the feature".
- If a Loom link is provided (but no transcript), note in the description that manual review of the recording is advised.
- Do NOT wrap the JSON in backticks or add any explanation outside the JSON object.`;

// ─── Helper: fetch issue details ─────────────────────────────────────────────
async function getIssueDetails(issueKey) {
  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,issuetype,project`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch issue ${issueKey}: ${response.status} – ${body}`);
  }

  return response.json();
}

// ─── Helper: convert Atlassian Document Format → plain text ──────────────────
function adfToPlainText(adf) {
  if (!adf || !adf.content) return "";

  function extractText(node) {
    if (!node) return "";
    if (node.type === "text") return node.text || "";
    if (node.content) return node.content.map(extractText).join(" ");
    return "";
  }

  return adf.content.map(extractText).join("\n").trim();
}

// ─── Helper: call Anthropic Claude ───────────────────────────────────────────
async function callClaude(issueDescription, userInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Run: forge variables set --encrypt ANTHROPIC_API_KEY <your-key>"
    );
  }

  const userMessage = [
    "## Jira Issue Description",
    issueDescription || "(No description provided)",
    "",
    "## Additional Context from Requester",
    userInput?.trim() || "(None provided)",
  ].join("\n");

  // Changed from raw fetch to Forge's api.fetch to work within the Forge environment correctly
  const response = await api.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text;

  if (!rawText) throw new Error("Claude returned an empty response.");

  try {
    return JSON.parse(rawText);
  } catch {
    // Fallback: strip accidental markdown fences if model misbehaves
    const cleaned = rawText.replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(cleaned);
  }
}

// ─── Resolver Exports ────────────────────────────────────────────────────────
resolver.define("generateTests", async (req) => {
  const { issueKey, userInput } = req.payload;
  
  if (!issueKey) {
    throw new Error("issueKey is required.");
  }
  
  const issue = await getIssueDetails(issueKey);
  const description = adfToPlainText(issue.fields.description);
  
  return await callClaude(description, userInput);
});

export const handler = resolver.getDefinitions();