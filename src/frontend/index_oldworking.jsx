import React, { useState } from 'react';
import ForgeReconciler, { Text, TextArea, Button, ButtonGroup, SectionMessage, Strong, Em, Heading, Tag, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [userInput, setUserInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const handleGenerate = async () => {
    if (status === "loading") return;

    setStatus("loading");
    setResult(null);
    setErrorMessage("");

    try {
      const response = await invoke("generateTestCases", { userInput });

      if (response.success) {
        setResult(response);
        setStatus("success");
      } else {
        setErrorMessage(response.error || "Unknown error from resolver.");
        setStatus("error");
      }
    } catch (err) {
      setErrorMessage(err.message || "Failed to invoke resolver.");
      setStatus("error");
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setResult(null);
    setErrorMessage("");
    setUserInput("");
  };

  return (
    <Stack space="space.100">
      <Heading as="h3">🤖 Apporto - QA Test Case Generator</Heading>
      <Text>
        Claude will analyze this issue's description and generate structured test cases,
        then create them as linked Jira issues automatically.
      </Text>

      {status !== "success" && (
        <Stack space="space.100">
          <TextArea
            label="Additional context (optional)"
            description="Paste a Loom transcript, acceptance criteria, or any notes that aren't in the description."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="e.g. 'The checkout flow must work on mobile Safari...'"
            isDisabled={status === "loading"}
          />
          <ButtonGroup>
            <Button
              appearance="primary"
              onClick={handleGenerate}
              isLoading={status === "loading"}
            >
              Generate TCs
            </Button>
          </ButtonGroup>
        </Stack>
      )}

      {status === "loading" && (
        <SectionMessage appearance="information" title="Working…">
          <Text>
            Claude is analyzing the issue and writing test cases. This usually takes
            10–20 seconds. Jira issues will be created automatically once Claude responds.
          </Text>
        </SectionMessage>
      )}

      {status === "error" && (
        <Stack space="space.100">
          <SectionMessage appearance="error" title="Something went wrong">
            <Text>{errorMessage}</Text>
          </SectionMessage>
          <ButtonGroup>
            <Button appearance="default" onClick={handleReset}>↩ Try again</Button>
          </ButtonGroup>
        </Stack>
      )}

      {status === "success" && result && (
        <Stack space="space.100">
          <SectionMessage appearance="success" title="Test cases created!">
            <Text>
              <Strong>{result.count} test case issues</Strong> were created and linked to this issue.
            </Text>
          </SectionMessage>

          <Heading as="h5">Created issues</Heading>
          <Stack space="space.050" alignInline="start">
            {result.createdKeys.map((key, i) => (
              <Tag key={i} text={key} color="blue" />
            ))}
          </Stack>

          <Text>
            Find them via the <Strong>Issue Links</Strong> section on this issue, or
            search for them in your project board.
          </Text>

          <ButtonGroup>
            <Button appearance="primary" onClick={handleReset}>
              ✨ Generate more test cases
            </Button>
          </ButtonGroup>
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<App />);