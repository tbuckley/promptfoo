import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import async from 'async';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import Clone from 'rfdc';
import rouge from 'rouge';
import invariant from 'tiny-invariant';
import cliState from '../cliState';
import { importModule } from '../esm';
import { fetchWithRetries } from '../fetch';
import logger from '../logger';
import {
  matchesSimilarity,
  matchesLlmRubric,
  matchesFactuality,
  matchesClosedQa,
  matchesClassification,
  matchesAnswerRelevance,
  matchesContextRecall,
  matchesContextRelevance,
  matchesContextFaithfulness,
  matchesSelectBest,
  matchesModeration,
} from '../matchers';
import { OpenAiChatCompletionProvider } from '../providers/openai';
import { validateFunctionCall } from '../providers/openaiUtil';
import { parseChatPrompt } from '../providers/shared';
import { runPython, runPythonCode } from '../python/wrapper';
import telemetry from '../telemetry';
import {
  type ApiProvider,
  type Assertion,
  type AssertionType,
  type AtomicTestCase,
  type GradingResult,
  type TestCase,
  isGradingResult,
  AssertionValue,
  AssertionValueFunctionContext,
} from '../types';
import { transformOutput, getNunjucksEngine, extractJsonObjects } from '../util';
import { AssertionsResult } from './AssertionsResult';
import {
  containsAllAssertion,
  containsAnyAssertion,
  containsAssertion,
  equalsAssertion,
  icontainsAllAssertion,
  icontainsAnyAssertion,
  icontainsAssertion,
  levenshteinAssertion,
  regexAssertion,
  containsSqlAssertion,
  isSqlAssertion,
  startsWithAssertion,
} from './matchers/base';

const ASSERTIONS_MAX_CONCURRENCY = process.env.PROMPTFOO_ASSERTIONS_MAX_CONCURRENCY
  ? parseInt(process.env.PROMPTFOO_ASSERTIONS_MAX_CONCURRENCY, 10)
  : 3;

export const MODEL_GRADED_ASSERTION_TYPES = new Set<AssertionType>([
  'answer-relevance',
  'context-faithfulness',
  'context-recall',
  'context-relevance',
  'llm-rubric',
  'model-graded-closedqa',
  'factuality',
  'model-graded-factuality',
]);

const ajv = new Ajv();
addFormats(ajv);

const nunjucks = getNunjucksEngine();

const clone = Clone();

function getFinalTest(test: TestCase, assertion: Assertion) {
  // Deep copy
  const ret = clone(test);

  // Assertion provider overrides test provider
  ret.options = ret.options || {};
  ret.options.provider = assertion.provider || ret.options.provider;
  ret.options.rubricPrompt = assertion.rubricPrompt || ret.options.rubricPrompt;
  return Object.freeze(ret);
}

function coerceString(value: string | object): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

interface BaseAssertion {
  outputString: string;
  renderedValue: AssertionValue | undefined;
  inverse: boolean;
  assertion: Assertion;
}

interface ScriptedAssertion extends BaseAssertion {
  valueFromScript?: any;
  output?: string | object;
  context?: AssertionValueFunctionContext | undefined;
}

interface OpenAiAssertion extends BaseAssertion {
  test: AtomicTestCase;
  output: object | string;
  provider: ApiProvider | undefined;
}

interface ModelGradedAssertion extends BaseAssertion {
  test: AtomicTestCase;
  prompt: string | undefined;
}

function isJsonAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  valueFromScript,
}: ScriptedAssertion): GradingResult {
  let pass: boolean = false;
  let parsedJson;
  try {
    parsedJson = JSON.parse(outputString);
    pass = !inverse;
  } catch (err) {
    pass = inverse;
  }

  if (pass && renderedValue) {
    let validate: ValidateFunction;
    if (typeof renderedValue === 'string') {
      if (renderedValue.startsWith('file://')) {
        // Reference the JSON schema from external file
        const schema = valueFromScript;
        invariant(schema, 'is-json references a file that does not export a JSON schema');
        validate = ajv.compile(schema as object);
      } else {
        const scheme = yaml.load(renderedValue) as object;
        validate = ajv.compile(scheme);
      }
    } else if (typeof renderedValue === 'object') {
      // Value is JSON schema
      validate = ajv.compile(renderedValue);
    } else {
      throw new Error('is-json assertion must have a string or object value');
    }
    pass = validate(parsedJson);
    if (!pass) {
      return {
        pass,
        score: 0,
        reason: `JSON does not conform to the provided schema. Errors: ${ajv.errorsText(
          validate.errors,
        )}`,
        assertion,
      };
    }
  }

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? 'Assertion passed' : 'Expected output to be valid JSON',
    assertion,
  };
}

function containsJsonAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  valueFromScript,
}: ScriptedAssertion): GradingResult {
  let errorMessage = 'Expected output to contain valid JSON';
  const jsonObjects = extractJsonObjects(outputString);
  let pass = inverse ? jsonObjects.length === 0 : jsonObjects.length > 0;
  for (const jsonObject of jsonObjects) {
    if (renderedValue) {
      let validate: ValidateFunction;
      if (typeof renderedValue === 'string') {
        if (renderedValue.startsWith('file://')) {
          // Reference the JSON schema from external file
          const schema = valueFromScript;
          invariant(schema, 'contains-json references a file that does not export a JSON schema');
          validate = ajv.compile(schema as object);
        } else {
          const scheme = yaml.load(renderedValue) as object;
          validate = ajv.compile(scheme);
        }
      } else if (typeof renderedValue === 'object') {
        // Value is JSON schema
        validate = ajv.compile(renderedValue);
      } else {
        throw new Error('contains-json assertion must have a string or object value');
      }
      pass = validate(jsonObject);
      if (pass) {
        break;
      } else {
        errorMessage = `JSON does not conform to the provided schema. Errors: ${ajv.errorsText(
          validate.errors,
        )}`;
      }
    }
  }
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? 'Assertion passed' : errorMessage,
    assertion,
  };
}

async function javascriptAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  valueFromScript,
  output,
  context,
}: ScriptedAssertion): Promise<GradingResult> {
  invariant(context, 'javascript assertion must have a context');
  let pass: boolean = false;
  let score: number = 0.0;
  try {
    const validateResult = async (result: any): Promise<boolean | number | GradingResult> => {
      result = await Promise.resolve(result);
      if (typeof result === 'boolean' || typeof result === 'number' || isGradingResult(result)) {
        return result;
      } else {
        throw new Error(
          `Custom function must return a boolean, number, or GradingResult object. Got type ${typeof result}: ${JSON.stringify(
            result,
          )}`,
        );
      }
    };

    if (typeof assertion.value === 'function') {
      let ret = assertion.value(outputString, context);
      ret = await validateResult(ret);
      if (!ret.assertion) {
        // Populate the assertion object if the custom function didn't return it.
        const functionString = assertion.value.toString();
        ret.assertion = {
          type: 'javascript',
          value: functionString.length > 50 ? functionString.slice(0, 50) + '...' : functionString,
        };
      }
      return ret;
    }
    invariant(typeof renderedValue === 'string', 'javascript assertion must have a string value');
    let result: boolean | number | GradingResult;
    if (typeof valueFromScript !== 'undefined') {
      invariant(
        typeof valueFromScript === 'boolean' ||
          typeof valueFromScript === 'number' ||
          typeof valueFromScript === 'object',
        `Javascript assertion script must return a boolean, number, or object (${assertion.value})`,
      );
      result = await validateResult(valueFromScript);
    } else {
      const functionBody = renderedValue.includes('\n') ? renderedValue : `return ${renderedValue}`;
      const customFunction = new Function('output', 'context', functionBody);
      result = await validateResult(customFunction(output, context));
    }
    if (typeof result === 'boolean') {
      pass = result !== inverse;
      score = pass ? 1 : 0;
    } else if (typeof result === 'number') {
      pass = assertion.threshold ? result >= assertion.threshold : result > 0;
      score = result;
    } else if (typeof result === 'object') {
      return result;
    } else {
      throw new Error('Custom function must return a boolean or number');
    }
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Custom function threw error: ${(err as Error).message}
Stack Trace: ${(err as Error).stack}
${renderedValue}`,
      assertion,
    };
  }
  return {
    pass,
    score,
    reason: pass
      ? 'Assertion passed'
      : `Custom function returned ${inverse ? 'true' : 'false'}
${renderedValue}`,
    assertion,
  };
}

async function pythonAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  valueFromScript,
  output,
  context,
}: ScriptedAssertion): Promise<GradingResult> {
  invariant(context, 'python assertion must have a context');
  let pass: boolean = false;
  let score: number = 0.0;
  invariant(typeof renderedValue === 'string', 'python assertion must have a string value');
  try {
    let result: string | number | boolean | object | GradingResult | undefined;
    if (typeof valueFromScript !== 'undefined') {
      result = valueFromScript;
    } else {
      const isMultiline = renderedValue.includes('\n');
      let indentStyle = '    ';
      if (isMultiline) {
        // Detect the indentation style of the first indented line
        const match = renderedValue.match(/^(?!\s*$)\s+/m);
        if (match) {
          indentStyle = match[0];
        }
      }

      const pythonScript = `import json

def main(output, context):
${
  isMultiline
    ? renderedValue
        .split('\n')
        .map((line) => `${indentStyle}${line}`)
        .join('\n')
    : `    return ${renderedValue}`
}
`;
      result = await runPythonCode(pythonScript, 'main', [output, context]);
    }

    if (
      (typeof result === 'boolean' && result) ||
      (typeof result === 'string' && result.toLowerCase() === 'true')
    ) {
      pass = true;
      score = 1.0;
    } else if (
      (typeof result === 'boolean' && !result) ||
      (typeof result === 'string' && result.toLowerCase() === 'false')
    ) {
      pass = false;
      score = 0.0;
    } else if (typeof result === 'string' && result.startsWith('{')) {
      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (err) {
        throw new Error(`Invalid JSON: ${err} when parsing result: ${result}`);
      }
      if (!isGradingResult(parsed)) {
        throw new Error(
          `Python assertion must return a boolean, number, or {pass, score, reason} object. Got instead: ${result}`,
        );
      }
      return parsed;
    } else if (typeof result === 'object') {
      if (!isGradingResult(result)) {
        throw new Error(
          `Python assertion must return a boolean, number, or {pass, score, reason} object. Got instead:\n${JSON.stringify(
            result,
            null,
            2,
          )}`,
        );
      }
      const pythonGradingResult = result as Omit<GradingResult, 'assertion'>;
      if (assertion.threshold && pythonGradingResult.score < assertion.threshold) {
        pythonGradingResult.pass = false;
        pythonGradingResult.reason = `Python score ${pythonGradingResult.score} is less than threshold ${assertion.threshold}`;
      }
      return {
        ...pythonGradingResult,
        assertion,
      };
    } else {
      score = parseFloat(String(result));
      pass = assertion.threshold ? score >= assertion.threshold : score > 0;
      if (isNaN(score)) {
        throw new Error(
          `Python assertion must return a boolean, number, or {pass, score, reason} object. Instead got:\n${result}`,
        );
      }
      if (typeof assertion.threshold !== 'undefined' && score < assertion.threshold) {
        pass = false;
      }
    }
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Python code execution failed: ${(err as Error).message}`,
      assertion,
    };
  }
  return {
    pass,
    score,
    reason: pass
      ? 'Assertion passed'
      : `Python code returned ${pass ? 'true' : 'false'}\n${assertion.value}`,
    assertion,
  };
}

async function similarAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string' || Array.isArray(renderedValue),
    'Similarity assertion type must have a string or array of strings value',
  );

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

async function llmRubricAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
): Promise<GradingResult> {
  invariant(
    typeof renderedValue === 'string' || typeof renderedValue === 'undefined',
    '"llm-rubric" assertion type must have a string value',
  );

  if (test.options?.rubricPrompt) {
    if (typeof test.options.rubricPrompt === 'object') {
      test.options.rubricPrompt = JSON.stringify(test.options.rubricPrompt);
    }
  }

  // Update the assertion value. This allows the web view to display the prompt.
  assertion.value = assertion.value || test.options?.rubricPrompt;
  return {
    assertion,
    ...(await matchesLlmRubric(renderedValue || '', outputString, test.options, test.vars)),
  };
}

async function factualityAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
): Promise<GradingResult> {
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

  return {
    assertion,
    ...(await matchesFactuality(prompt, renderedValue, outputString, test.options, test.vars)),
  };
}

async function modelGradedClosedQaAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
): Promise<GradingResult> {
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

  return {
    assertion,
    ...(await matchesClosedQa(prompt, renderedValue, outputString, test.options, test.vars)),
  };
}

async function answerRelevanceAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  output: string | object,
  test: AtomicTestCase,
  prompt: string | undefined,
): Promise<GradingResult> {
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

async function contextRecallAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
): Promise<GradingResult> {
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

function rougeScoreAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  baseType: 'rouge-n' | 'rouge-l' | 'rouge-s',
): GradingResult {
  invariant(typeof renderedValue === 'string', '"rouge" assertion type must be a string value');
  const fnName = baseType[baseType.length - 1] as 'n' | 'l' | 's';
  const rougeMethod = rouge[fnName];
  const score = rougeMethod(outputString, renderedValue);
  const pass = score >= (assertion.threshold || 0.75) != inverse;

  return {
    pass,
    score: inverse ? 1 - score : score,
    reason: pass
      ? `${baseType.toUpperCase()} score ${score.toFixed(
          2,
        )} is greater than or equal to threshold ${assertion.threshold || 0.75}`
      : `${baseType.toUpperCase()} score ${score.toFixed(2)} is less than threshold ${
          assertion.threshold || 0.75
        }`,
    assertion,
  };
}

async function contextRelevanceAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
): Promise<GradingResult> {
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

async function contextFaithfulnessAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
  output: string | object,
): Promise<GradingResult> {
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

async function moderationAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
  output: string | object,
): Promise<GradingResult> {
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

async function webhookAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
  prompt: string | undefined,
  output: string | object,
): Promise<GradingResult> {
  let pass: boolean = false;
  let score: number = 0.0;

  invariant(renderedValue, '"webhook" assertion type must have a URL value');
  invariant(typeof renderedValue === 'string', '"webhook" assertion type must have a URL value');

  try {
    const context = {
      prompt,
      vars: test.vars || {},
    };
    const response = await fetchWithRetries(
      renderedValue,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ output, context }),
      },
      process.env.WEBHOOK_TIMEOUT ? parseInt(process.env.WEBHOOK_TIMEOUT, 10) : 5000,
    );

    if (!response.ok) {
      throw new Error(`Webhook response status: ${response.status}`);
    }

    const jsonResponse = await response.json();
    pass = jsonResponse.pass !== inverse;
    score =
      typeof jsonResponse.score === 'undefined'
        ? pass
          ? 1
          : 0
        : inverse
          ? 1 - jsonResponse.score
          : jsonResponse.score;

    const reason =
      jsonResponse.reason ||
      (pass ? 'Assertion passed' : `Webhook returned ${inverse ? 'true' : 'false'}`);

    return {
      pass,
      score,
      reason,
      assertion,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Webhook error: ${(err as Error).message}`,
      assertion,
    };
  }
}

async function classifierAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  test: AtomicTestCase,
) {
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

function latencyAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  latencyMs: number | undefined,
) {
  if (!assertion.threshold) {
    throw new Error('Latency assertion must have a threshold in milliseconds');
  }
  if (!latencyMs) {
    throw new Error(
      'Latency assertion does not support cached results. Rerun the eval with --no-cache',
    );
  }
  const pass = latencyMs <= assertion.threshold;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Latency ${latencyMs}ms is greater than threshold ${assertion.threshold}ms`,
    assertion,
  };
}

function perplexityAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  logProbs: number[] | undefined,
) {
  if (!logProbs || logProbs.length === 0) {
    throw new Error('Perplexity assertion does not support providers that do not return logProbs');
  }
  const sumLogProbs = logProbs.reduce((acc, logProb) => acc + logProb, 0);
  const avgLogProb = sumLogProbs / logProbs.length;
  const perplexity = Math.exp(-avgLogProb);

  const pass = assertion.threshold ? perplexity <= assertion.threshold : true;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Perplexity ${perplexity.toFixed(2)} is greater than threshold ${assertion.threshold}`,
    assertion,
  };
}

function perplexityScoreAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  logProbs: number[] | undefined,
) {
  if (!logProbs || logProbs.length === 0) {
    throw new Error(
      'perplexity-score assertion does not support providers that do not return logProbs',
    );
  }
  const sumLogProbs = logProbs.reduce((acc, logProb) => acc + logProb, 0);
  const avgLogProb = sumLogProbs / logProbs.length;
  const perplexity = Math.exp(-avgLogProb);
  const perplexityNorm = 1 / (1 + perplexity);

  const pass = assertion.threshold ? perplexityNorm >= assertion.threshold : true;
  return {
    pass,
    score: perplexityNorm,
    reason: pass
      ? 'Assertion passed'
      : `Perplexity score ${perplexityNorm.toFixed(2)} is less than threshold ${
          assertion.threshold
        }`,
    assertion,
  };
}

function costAssertion(
  outputString: string,
  renderedValue: AssertionValue | undefined,
  inverse: boolean,
  assertion: Assertion,
  cost: number | undefined,
) {
  if (!assertion.threshold) {
    throw new Error('Cost assertion must have a threshold');
  }
  if (typeof cost === 'undefined') {
    throw new Error('Cost assertion does not support providers that do not return cost');
  }

  const pass = cost <= assertion.threshold;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Cost ${cost.toPrecision(2)} is greater than threshold ${assertion.threshold}`,
    assertion,
  };
}

function isValidOpenAiToolsCallAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  test,
  output,
  provider,
}: OpenAiAssertion): GradingResult {
  const toolsOutput = output as {
    type: 'function';
    function: { arguments: string; name: string };
  }[];
  if (
    !Array.isArray(toolsOutput) ||
    toolsOutput.length === 0 ||
    typeof toolsOutput[0].function.name !== 'string' ||
    typeof toolsOutput[0].function.arguments !== 'string'
  ) {
    return {
      pass: false,
      score: 0,
      reason: `OpenAI did not return a valid-looking tools response: ${JSON.stringify(
        toolsOutput,
      )}`,
      assertion,
    };
  }

  try {
    toolsOutput.forEach((toolOutput) =>
      validateFunctionCall(
        toolOutput.function,
        (provider as OpenAiChatCompletionProvider).config.tools?.map((tool) => tool.function),
        test.vars,
      ),
    );
    return {
      pass: true,
      score: 1,
      reason: 'Assertion passed',
      assertion,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: (err as Error).message,
      assertion,
    };
  }
}

function isValidOpenAiFunctionCallAssertion({
  outputString,
  renderedValue,
  inverse,
  assertion,
  test,
  output,
  provider,
}: OpenAiAssertion): GradingResult {
  const functionOutput = output as { arguments: string; name: string };
  if (
    typeof functionOutput !== 'object' ||
    typeof functionOutput.name !== 'string' ||
    typeof functionOutput.arguments !== 'string'
  ) {
    return {
      pass: false,
      score: 0,
      reason: `OpenAI did not return a valid-looking function call: ${JSON.stringify(
        functionOutput,
      )}`,
      assertion,
    };
  }
  try {
    validateFunctionCall(
      functionOutput,
      (provider as OpenAiChatCompletionProvider).config.functions,
      test.vars,
    );
    return {
      pass: true,
      score: 1,
      reason: 'Assertion passed',
      assertion,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: (err as Error).message,
      assertion,
    };
  }
}

interface RunAssertionOptions {
  prompt?: string;
  provider?: ApiProvider;
  assertion: Assertion;
  test: AtomicTestCase;
  output: string | object;
  latencyMs?: number;
  logProbs?: number[];
  cost?: number;
}

export async function runAssertion({
  prompt,
  provider,
  assertion,
  test,
  output,
  latencyMs,
  logProbs,
  cost,
}: RunAssertionOptions): Promise<GradingResult> {
  invariant(assertion.type, `Assertion must have a type: ${JSON.stringify(assertion)}`);

  const inverse = assertion.type.startsWith('not-');
  const baseType = inverse ? assertion.type.slice(4) : assertion.type;

  telemetry.record('assertion_used', {
    type: baseType,
  });

  if (assertion.transform) {
    output = await transformOutput(assertion.transform, output, {
      vars: test.vars,
      prompt: { label: prompt },
    });
  }

  const context = {
    prompt,
    vars: test.vars || {},
    test,
    logProbs,
  };

  // Render assertion values
  let renderedValue = assertion.value;
  let valueFromScript: string | boolean | number | GradingResult | object | undefined;

  if (renderedValue && Array.isArray(renderedValue)) {
    // Unpack the array
    renderedValue = renderedValue.map((v) => nunjucks.renderString(String(v), test.vars || {}));
  } else if (typeof renderedValue === 'string' && renderedValue.startsWith('file://')) {
    const basePath = cliState.basePath || '';
    const filePath = path.resolve(basePath, renderedValue.slice('file://'.length));

    if (filePath.endsWith('.js') || filePath.endsWith('.cjs') || filePath.endsWith('.mjs')) {
      const requiredModule = await importModule(filePath);
      if (typeof requiredModule === 'function') {
        valueFromScript = await Promise.resolve(requiredModule(output, context));
      } else if (requiredModule.default && typeof requiredModule.default === 'function') {
        valueFromScript = await Promise.resolve(requiredModule.default(output, context));
      } else {
        throw new Error(
          `Assertion malformed: ${filePath} must export a function or have a default export as a function`,
        );
      }
      logger.debug(`Javascript script ${filePath} output: ${valueFromScript}`);
    } else if (filePath.endsWith('.py')) {
      try {
        const pythonScriptOutput = await runPython(filePath, 'get_assert', [output, context]);
        valueFromScript = pythonScriptOutput;
        logger.debug(`Python script ${filePath} output: ${valueFromScript}`);
      } catch (error) {
        // TODO: Should we remove this?
        return {
          pass: false,
          score: 0,
          reason: (error as Error).message,
          assertion,
        };
      }
    } else if (filePath.endsWith('.json')) {
      renderedValue = JSON.parse(fs.readFileSync(path.resolve(basePath, filePath), 'utf8'));
    } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      renderedValue = yaml.load(
        fs.readFileSync(path.resolve(basePath, filePath), 'utf8'),
      ) as object;
    } else if (filePath.endsWith('.txt')) {
      // Trim to remove trailing newline
      renderedValue = fs.readFileSync(path.resolve(basePath, filePath), 'utf8').trim();
    } else {
      throw new Error(`Unsupported file type: ${filePath}`);
    }
  } else if (typeof renderedValue === 'string') {
    // It's a normal string value
    renderedValue = nunjucks.renderString(renderedValue, test.vars || {});
  }

  const outputString = coerceString(output);

  const baseAssertionMap: {
    [key: string]: (options: BaseAssertion) => GradingResult | Promise<GradingResult>;
  } = {
    'contains-all': containsAllAssertion,
    'contains-any': containsAnyAssertion,
    'contains-sql': containsSqlAssertion,
    contains: containsAssertion,
    equals: equalsAssertion,
    'icontains-all': icontainsAllAssertion,
    'icontains-any': icontainsAnyAssertion,
    icontains: icontainsAssertion,
    'is-sql': isSqlAssertion,
    levenshtein: levenshteinAssertion,
    regex: regexAssertion,
    'starts-with': startsWithAssertion,
  };

  if (baseAssertionMap[baseType]) {
    return baseAssertionMap[baseType]({ outputString, renderedValue, inverse, assertion });
  }

  if (baseType === 'rouge-n') {
    return rougeScoreAssertion(outputString, renderedValue, inverse, assertion, baseType);
  }

  const scriptedAssertionMap: {
    [key: string]: (options: ScriptedAssertion) => GradingResult | Promise<GradingResult>;
  } = {
    'contains-json': containsJsonAssertion,
    'is-json': isJsonAssertion,
    javascript: javascriptAssertion,
    python: pythonAssertion,
  };

  if (scriptedAssertionMap[baseType]) {
    return scriptedAssertionMap[baseType]({
      outputString,
      renderedValue,
      inverse,
      assertion,
      valueFromScript,
      output,
      context,
    });
  }

  // Transform test
  test = getFinalTest(test, assertion);

  const openAiAssertionMap: {
    [key: string]: (options: OpenAiAssertion) => GradingResult;
  } = {
    'is-valid-openai-tools-call': isValidOpenAiToolsCallAssertion,
    'is-valid-openai-function-call': isValidOpenAiFunctionCallAssertion,
  };

  if (openAiAssertionMap[baseType]) {
    return openAiAssertionMap[baseType]({
      outputString,
      renderedValue,
      inverse,
      assertion,
      test,
      output,
      provider,
    });
  }

  if (baseType === 'similar') {
    return similarAssertion(outputString, renderedValue, inverse, assertion, test);
  }

  if (baseType === 'llm-rubric') {
    return llmRubricAssertion(outputString, renderedValue, inverse, assertion, test);
  }

  if (baseType === 'model-graded-factuality' || baseType === 'factuality') {
    return factualityAssertion(outputString, renderedValue, inverse, assertion, test, prompt);
  }

  if (baseType === 'model-graded-closedqa') {
    return modelGradedClosedQaAssertion(
      outputString,
      renderedValue,
      inverse,
      assertion,
      test,
      prompt,
    );
  }

  if (baseType === 'answer-relevance') {
    return answerRelevanceAssertion(
      outputString,
      renderedValue,
      inverse,
      assertion,
      output,
      test,
      prompt,
    );
  }

  if (baseType === 'context-recall') {
    return contextRecallAssertion(outputString, renderedValue, inverse, assertion, test, prompt);
  }

  if (baseType === 'context-relevance') {
    return contextRelevanceAssertion(outputString, renderedValue, inverse, assertion, test, prompt);
  }

  if (baseType === 'classifier') {
    return classifierAssertion(outputString, renderedValue, inverse, assertion, test);
  }

  if (baseType === 'context-faithfulness') {
    return contextFaithfulnessAssertion(
      outputString,
      renderedValue,
      inverse,
      assertion,
      test,
      prompt,
      output,
    );
  }

  if (baseType === 'moderation') {
    return moderationAssertion(
      outputString,
      renderedValue,
      inverse,
      assertion,
      test,
      prompt,
      output,
    );
  }

  if (baseType === 'webhook') {
    return webhookAssertion(outputString, renderedValue, inverse, assertion, test, prompt, output);
  }

  if (baseType === 'perplexity') {
    return perplexityAssertion(outputString, renderedValue, inverse, assertion, logProbs);
  }

  if (baseType === 'perplexity-score') {
    return perplexityScoreAssertion(outputString, renderedValue, inverse, assertion, logProbs);
  }

  if (baseType === 'cost') {
    return costAssertion(outputString, renderedValue, inverse, assertion, cost);
  }

  if (baseType === 'latency') {
    return latencyAssertion(outputString, renderedValue, inverse, assertion, latencyMs);
  }

  throw new Error('Unknown assertion type: ' + assertion.type);
}

export async function runAssertions({
  prompt,
  provider,
  test,
  output,
  latencyMs,
  logProbs,
  cost,
}: {
  prompt?: string;
  provider?: ApiProvider;
  test: AtomicTestCase;
  output: string | object;
  latencyMs?: number;
  logProbs?: number[];
  cost?: number;
}): Promise<GradingResult> {
  if (!test.assert || test.assert.length < 1) {
    return AssertionsResult.noAssertsResult();
  }

  const mainAssertResult = new AssertionsResult({
    threshold: test.threshold,
  });
  const subAssertResults: AssertionsResult[] = [];
  const asserts: {
    assertion: Assertion;
    assertResult: AssertionsResult;
    index: number;
  }[] = test.assert
    .map((assertion, i) => {
      if (assertion.type === 'assert-set') {
        const subAssertResult = new AssertionsResult({
          threshold: assertion.threshold,
          parentAssertionSet: {
            assertionSet: assertion,
            index: i,
          },
        });

        subAssertResults.push(subAssertResult);

        return assertion.assert.map((subAssert, j) => {
          return {
            assertion: subAssert,
            assertResult: subAssertResult,
            index: j,
          };
        });
      }

      return { assertion, assertResult: mainAssertResult, index: i };
    })
    .flat();

  await async.forEachOfLimit(
    asserts,
    ASSERTIONS_MAX_CONCURRENCY,
    async ({ assertion, assertResult, index }) => {
      if (assertion.type.startsWith('select-')) {
        // Select-type assertions are handled separately because they depend on multiple outputs.
        return;
      }

      const result = await runAssertion({
        prompt,
        provider,
        assertion,
        test,
        output,
        latencyMs,
        logProbs,
        cost,
      });

      assertResult.addResult({
        index,
        result,
        metric: assertion.metric,
        weight: assertion.weight,
      });
    },
  );

  subAssertResults.forEach((subAssertResult) => {
    const result = subAssertResult.testResult();
    const {
      index,
      assertionSet: { metric, weight },
    } = subAssertResult.parentAssertionSet!;

    mainAssertResult.addResult({
      index,
      result,
      metric,
      weight,
    });
  });

  return mainAssertResult.testResult();
}

export async function runCompareAssertion(
  test: AtomicTestCase,
  assertion: Assertion,
  outputs: string[],
): Promise<GradingResult[]> {
  invariant(typeof assertion.value === 'string', 'select-best must have a string value');
  test = getFinalTest(test, assertion);
  const comparisonResults = await matchesSelectBest(
    assertion.value,
    outputs,
    test.options,
    test.vars,
  );
  return comparisonResults.map((result) => ({
    ...result,
    assertion,
  }));
}

export async function readAssertions(filePath: string): Promise<Assertion[]> {
  try {
    const assertions = yaml.load(fs.readFileSync(filePath, 'utf-8')) as Assertion[];
    if (!Array.isArray(assertions) || assertions[0]?.type === undefined) {
      throw new Error('Assertions file must be an array of assertion objects');
    }
    return assertions;
  } catch (err) {
    throw new Error(`Failed to read assertions from ${filePath}:\n${err}`);
  }
}

// These exports are used by the node.js package (index.ts)
export default {
  runAssertion,
  runAssertions,
  matchesSimilarity,
  matchesClassification,
  matchesLlmRubric,
  matchesFactuality,
  matchesClosedQa,
  matchesAnswerRelevance,
  matchesContextRecall,
  matchesContextRelevance,
  matchesContextFaithfulness,
  matchesComparisonBoolean: matchesSelectBest,
  matchesModeration,
};
