import React, { useState } from 'react';
import ForgeReconciler, {
  Text, TextArea, Button, ButtonGroup, Box, SectionMessage,
  Strong, Heading, Tag, Stack
} from '@forge/react';
import { invoke, view } from '@forge/bridge';

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
      const context = await view.getContext();
      const issueKey =
        context?.extension?.issue?.key ||
        context?.extension?.issueKey ||
        context?.jira?.issue?.key ||
        context?.issue?.key;

      if (!issueKey) {
        throw new Error(`Could not read issue key. Context: ${JSON.stringify(context)}`);
      }

      const response = await invoke("generateTestCases", { issueKey, userInput });

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
      <Text>Analyze this issue and generate structured QA test cases, automatically created as linked Jira AgileTest Test Case issues.</Text>

      {status !== "success" && (
        <Stack space="space.100">
          <TextArea
            label="Requirements & context (optional)"
            description="Share your requirements as text and/or a video transcript. Claude will use these as the primary source for generating test cases."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="e.g. 'Teacher should access CoTutor from D2L. Login must work with SSO. Generate 3 TCs.' Or paste a video transcript."
            isDisabled={status === "loading"}
          />
          <ButtonGroup>
            <Button
              appearance="primary"
              onClick={handleGenerate}
              isLoading={status === "loading"}
            >
              Generate Test Cases
            </Button>
          </ButtonGroup>
        </Stack>
      )}

      {status === "loading" && (
        <SectionMessage appearance="information" title="Working…">
          <Text>
            Claude is analyzing the issue and writing test cases. This usually takes
            10–20 seconds. Jira AgileTest test case tickets will be created automatically once Claude responds.
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

          <Heading as="h5">Summary</Heading>
          <Text>{result.summary}</Text>

          <Heading as="h5">Created issues</Heading>
          <Stack space="space.050" alignInline="start">
            {result.createdKeys.map((key, i) => (
              <Tag key={i} text={key} color="blue" />
            ))}
          </Stack>

          <Text>
            Find them via the <Strong>Issue Links</Strong> section on this issue,
            or search for them in your project board.
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