import invariant from 'tiny-invariant';
import { BaseAssertion, coerceString } from '.';
import {
  matchesAnswerRelevance,
  matchesClassification,
  matchesClosedQa,
  matchesContextFaithfulness,
  matchesContextRecall,
  matchesContextRelevance,
  matchesFactuality,
  matchesLlmRubric,
  matchesModeration,
  matchesSimilarity,
} from '../../matchers';
import { parseChatPrompt } from '../../providers/shared';
import { AtomicTestCase, GradingResult } from '../../types';
import { getNunjucksEngine } from '../../util';

export interface ModelGradedAssertion extends BaseAssertion {
  test: AtomicTestCase;
  prompt: string | undefined;
}

const nunjucks = getNunjucksEngine();

export async function similarAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
  test,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string' || Array.isArray(renderedValue),
    'Similarity assertion type must have a string or array of strings value',
  );
  const outputString = coerceString(output);
  if (Array.isArray(renderedValue)) {
    let minScore = Infinity;
    for (const value of renderedValue) {
      const result = await matchesSimilarity(
        value,
        outputString,
        assertion.threshold || 0.75,
        inverse,
        test.options,
      );
      if (result.pass) {
        return {
          assertion,
          ...result,
        };
      }
      if (result.score < minScore) {
        minScore = result.score;
      }
    }
    return {
      assertion,
      pass: false,
      score: minScore,
      reason: `None of the provided values met the similarity threshold`,
    };
  } else {
    return {
      assertion,
      ...(await matchesSimilarity(
        renderedValue,
        outputString,
        assertion.threshold || 0.75,
        inverse,
        test.options,
      )),
    };
  }
}

export async function llmRubricAssertion({
  output,
  renderedValue,
  assertion,
  test,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string' || typeof renderedValue === 'undefined',
    '"llm-rubric" assertion type must have a string value',
  );

  if (test.options?.rubricPrompt) {
    if (typeof test.options.rubricPrompt === 'object') {
      test.options.rubricPrompt = JSON.stringify(test.options.rubricPrompt);
    }
  }
  const outputString = coerceString(output);

  // Update the assertion value. This allows the web view to display the prompt.
  assertion.value = assertion.value || test.options?.rubricPrompt;
  return {
    assertion,
    ...(await matchesLlmRubric(renderedValue || '', outputString, test.options, test.vars)),
  };
}

export async function factualityAssertion({
  output,
  renderedValue,
  assertion,
  test,
  prompt,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string',
    'factuality assertion type must have a string value',
  );
  invariant(prompt, 'factuality assertion type must have a prompt');

  if (test.options?.rubricPrompt) {
    // Substitute vars in prompt
    invariant(typeof test.options.rubricPrompt === 'string', 'rubricPrompt must be a string');
    test.options.rubricPrompt = nunjucks.renderString(test.options.rubricPrompt, test.vars || {});
  }
  const outputString = coerceString(output);

  return {
    assertion,
    ...(await matchesFactuality(prompt, renderedValue, outputString, test.options, test.vars)),
  };
}

export async function modelGradedClosedQaAssertion({
  output,
  renderedValue,
  assertion,
  test,
  prompt,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string',
    'model-graded-closedqa assertion type must have a string value',
  );
  invariant(prompt, 'model-graded-closedqa assertion type must have a prompt');

  if (test.options?.rubricPrompt) {
    // Substitute vars in prompt
    invariant(typeof test.options.rubricPrompt === 'string', 'rubricPrompt must be a string');
    test.options.rubricPrompt = nunjucks.renderString(test.options.rubricPrompt, test.vars || {});
  }
  const outputString = coerceString(output);

  return {
    assertion,
    ...(await matchesClosedQa(prompt, renderedValue, outputString, test.options, test.vars)),
  };
}

export async function answerRelevanceAssertion({
  assertion,
  output,
  test,
  prompt,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof output === 'string',
    'answer-relevance assertion type must evaluate a string output',
  );
  invariant(prompt, 'answer-relevance assertion type must have a prompt');

  const input = typeof test.vars?.query === 'string' ? test.vars.query : prompt;
  return {
    assertion,
    ...(await matchesAnswerRelevance(input, output, assertion.threshold || 0, test.options)),
  };
}

export async function contextRecallAssertion({
  renderedValue,
  assertion,
  test,
  prompt,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string',
    'context-recall assertion type must have a string value',
  );
  invariant(
    typeof renderedValue === 'string',
    'context-recall assertion type must have a string value',
  );
  invariant(prompt, 'context-recall assertion type must have a prompt');

  return {
    assertion,
    ...(await matchesContextRecall(
      typeof test.vars?.context === 'string' ? test.vars.context : prompt,
      renderedValue,
      assertion.threshold || 0,
      test.options,
      test.vars,
    )),
  };
}

export async function contextFaithfulnessAssertion({
  output,
  assertion,
  test,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(test.vars, 'context-faithfulness assertion type must have a vars object');
  invariant(
    typeof test.vars.query === 'string',
    'context-faithfulness assertion type must have a question var',
  );
  invariant(
    typeof test.vars.context === 'string',
    'context-faithfulness assertion type must have a context var',
  );
  invariant(
    typeof output === 'string',
    'context-faithfulness assertion type must have a string output',
  );

  return {
    assertion,
    ...(await matchesContextFaithfulness(
      test.vars.query,
      output,
      test.vars.context,
      assertion.threshold || 0,
      test.options,
    )),
  };
}

export async function moderationAssertion({
  output,
  assertion,
  test,
  prompt,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(prompt, 'moderation assertion type must have a prompt');
  invariant(typeof output === 'string', 'moderation assertion type must have a string output');
  invariant(
    !assertion.value || (Array.isArray(assertion.value) && typeof assertion.value[0] === 'string'),
    'moderation assertion value must be a string array if set',
  );

  if (prompt[0] === '[' || prompt[0] === '{') {
    // Try to extract the last user message from OpenAI-style prompts.
    try {
      const parsedPrompt = parseChatPrompt<null | { role: string; content: string }[]>(
        prompt,
        null,
      );
      if (parsedPrompt && parsedPrompt.length > 0) {
        prompt = parsedPrompt[parsedPrompt.length - 1].content;
      }
    } catch (err) {
      // Ignore error
    }
  }

  const moderationResult = await matchesModeration(
    {
      userPrompt: prompt,
      assistantResponse: output,
      categories: Array.isArray(assertion.value) ? assertion.value : [],
    },
    test.options,
  );
  return {
    pass: moderationResult.pass,
    score: moderationResult.score,
    reason: moderationResult.reason,
    assertion,
  };
}

export async function classifierAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
  test,
}: ModelGradedAssertion): Promise<GradingResult> {
  const outputString = coerceString(output);
  invariant(
    typeof renderedValue === 'string' || typeof renderedValue === 'undefined',
    '"classifier" assertion type must have a string value or be undefined',
  );

  // Assertion provider overrides test provider
  const classificationResult = await matchesClassification(
    renderedValue,
    outputString,
    assertion.threshold ?? 1,
    test.options,
  );

  if (inverse) {
    classificationResult.pass = !classificationResult.pass;
    classificationResult.score = 1 - classificationResult.score;
  }

  return {
    assertion,
    ...classificationResult,
  };
}

export async function contextRelevanceAssertion({
  assertion,
  test,
}: ModelGradedAssertion): Promise<GradingResult> {
  invariant(test.vars, 'context-relevance assertion type must have a vars object');
  invariant(
    typeof test.vars.query === 'string',
    'context-relevance assertion type must have a question var',
  );
  invariant(
    typeof test.vars.context === 'string',
    'context-relevance assertion type must have a context var',
  );

  return {
    assertion,
    ...(await matchesContextRelevance(
      test.vars.query,
      test.vars.context,
      assertion.threshold || 0,
      test.options,
    )),
  };
}
