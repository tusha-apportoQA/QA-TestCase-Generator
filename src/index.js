import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";

const resolver = new Resolver();

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
      "steps": ["<step 1>", "<step 2>"],
      "expectedResult": "<what should happen when the steps are executed correctly>",
      "priority": "High | Medium | Low",
      "type": "Functional | Edge Case | Negative | Performance | Security | Accessibility"
    }
  ]
}

Rules:
- If the requester specifies a number of test cases in their input (e.g. "generate 2 TCs", "only 3 test cases"), respect that number exactly.
- Otherwise, produce between 3 and 5 test cases depending on complexity. Never exceed 5.
- Keep each "steps" array to a maximum of 5 steps.
- Always include at least one Negative test case and one Edge Case.
- Be specific — avoid vague steps like "click around" or "test the feature".
- Do NOT wrap the JSON in backticks or add any explanation outside the JSON object.`;

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

async function callClaude(issueSummary, issueDescription, userInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  let enrichedInput = userInput?.trim() || "";

  /*const userMessage = [
    "## Jira Issue Description",
    issueDescription || "(No description provided)",
    "",
    "## Additional Context from Requester",
    userInput?.trim() || "(None provided)",
  ].join("\n");*/

   /*const userMessage = [
      "## Jira Issue Summary",
      issueSummary,
      "",
      "## Jira Issue Description (truncated)",
      issueDescription || "(No description provided)",
      "",
      "## Additional Context from Requester",
      userInput?.trim() || "(None provided)",
    ].join("\n");*/

    const userMessage = enrichedInput
    ? [
        "## Jira Issue Summary",
        issueSummary,
        "",
        "## Requirements from Requester (PRIMARY SOURCE — use this to generate test cases)",
        enrichedInput,
        "",
        "## Jira Description (supplementary context only)",
        issueDescription?.slice(0, 300) || "(none)",
      ].join("\n")
    : [
        "## Jira Issue Summary",
        issueSummary,
        "",
        "## Jira Issue Description",
        issueDescription || "(No description provided)",
    ].join("\n");

  const response = await api.fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      //model: "claude-haiku-4-5",  // much faster than sonnet
      max_tokens: 2000,
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
    const cleaned = rawText.replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
      try{
        return JSON.parse(cleaned);
      }catch {
      // Extract however many complete testCases were returned
      const match = cleaned.match(/"testCases"\s*:\s*(\[[\s\S]*)/);
      if (match) {
        const partial = match[1].replace(/,?\s*\{[^{}]*$/, "]"); // drop incomplete last item
        const recovered = `{"summary":"Partial results recovered","testCases":${partial}}`;
        return JSON.parse(recovered);
      }
      throw new Error("Claude returned malformed JSON that could not be recovered.");
    }
  }
}

async function createJiraTestIssue(projectKey, parentKey, testCase) {
  const body = {
    fields: {
      project: { key: projectKey },
      summary: testCase.title,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Type: ${testCase.type} | Priority: ${testCase.priority}` }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: testCase.description }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: `Preconditions: ${testCase.preconditions}` }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: `Steps:\n${testCase.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: `Expected Result: ${testCase.expectedResult}` }],
          },
        ],
      },
      issuetype: { name: "TestCase" },
    },
  };

  const response = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Failed to create issue: ${response.status} – ${errBody}`);
  }

  const created = await response.json();
  console.log(`Created issue: ${created.key}, now linking to parent: ${parentKey}`);


  // Link the new issue back to the parent
  const linkResponse = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: { name: "AgileTest" },
      inwardIssue: { key: created.key },
      outwardIssue: { key: parentKey },
    }),
  });

  const linkStatus = linkResponse.status;
  const linkBody = await linkResponse.text();
  console.log(`Link response for ${created.key} → ${parentKey}: status=${linkStatus}, body=${linkBody}`);

  return created.key;
}

// ── The resolver name must match what the frontend invokes ──────────────────
resolver.define("generateTestCases", async (req) => {
  const { issueKey, userInput } = req.payload;
  console.log("Parent issue key:", issueKey); // check forge logs


  if (!issueKey) throw new Error("issueKey is required.");

  const issue = await getIssueDetails(issueKey);
  //const description = adfToPlainText(issue.fields.description);
  // Truncate description to avoid timeout on long tickets
  const description = adfToPlainText(issue.fields.description).slice(0, 1000);
  const summary = issue.fields.summary || "";

  const projectKey = issue.fields.project.key;

  //const claudeResult = await callClaude(description, userInput);
  const claudeResult = await callClaude(summary, description, userInput);


  /*const createdKeys = [];
  for (const tc of claudeResult.testCases) {
    const key = await createJiraTestIssue(projectKey, issueKey, tc);
    createdKeys.push(key);
  }*/
  const createdKeys = await Promise.all(
    claudeResult.testCases.map(tc => createJiraTestIssue(projectKey, issueKey, tc))
  );

  return {
    success: true,
    count: createdKeys.length,
    summary: claudeResult.summary,
    createdKeys,
  };
});

export const handler = resolver.getDefinitions();