import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import async from 'async';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import Clone from 'rfdc';
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
import { runPython } from '../python/wrapper';
import telemetry from '../telemetry';
import {
  type ApiProvider,
  type Assertion,
  type AssertionType,
  type AtomicTestCase,
  type GradingResult,
  type TestCase,
  AssertionValue,
} from '../types';
import { transformOutput, getNunjucksEngine } from '../util';
import { AssertionsResult } from './AssertionsResult';
import { BaseAssertion, coerceString } from './matchers';
import {
  containsAllAssertion,
  containsAnyAssertion,
  containsAssertion,
  containsSqlAssertion,
  equalsAssertion,
  icontainsAllAssertion,
  icontainsAnyAssertion,
  icontainsAssertion,
  isSqlAssertion,
  levenshteinAssertion,
  regexAssertion,
  rougeScoreAssertion,
  startsWithAssertion,
} from './matchers/base';
import {
  ModelGradedAssertion,
  answerRelevanceAssertion,
  classifierAssertion,
  contextFaithfulnessAssertion,
  contextRecallAssertion,
  contextRelevanceAssertion,
  factualityAssertion,
  llmRubricAssertion,
  modelGradedClosedQaAssertion,
  moderationAssertion,
  similarAssertion,
} from './matchers/modelGraded';
import {
  isValidOpenAiFunctionCallAssertion,
  isValidOpenAiToolsCallAssertion,
  OpenAiAssertion,
} from './matchers/openai';
import {
  containsJsonAssertion,
  isJsonAssertion,
  javascriptAssertion,
  pythonAssertion,
  ScriptedAssertion,
} from './matchers/scripted';

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
    'rouge-n': rougeScoreAssertion,
    'starts-with': startsWithAssertion,
  };

  if (baseAssertionMap[baseType]) {
    return baseAssertionMap[baseType]({ output, renderedValue, inverse, assertion });
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
      renderedValue,
      inverse,
      assertion,
      test,
      output,
      provider,
    });
  }

  const ModelGradedAssertionMap: {
    [key: string]: (options: ModelGradedAssertion) => GradingResult | Promise<GradingResult>;
  } = {
    'answer-relevance': answerRelevanceAssertion,
    classifier: classifierAssertion,
    'context-faithfulness': contextFaithfulnessAssertion,
    'context-recall': contextRecallAssertion,
    'context-relevance': contextRelevanceAssertion,
    factuality: factualityAssertion,
    'llm-rubric': llmRubricAssertion,
    'model-graded-closedqa': modelGradedClosedQaAssertion,
    'model-graded-factuality': factualityAssertion,
    moderation: moderationAssertion,
    similar: similarAssertion,
  };

  if (ModelGradedAssertionMap[baseType]) {
    return ModelGradedAssertionMap[baseType]({
      renderedValue,
      inverse,
      assertion,
      test,
      prompt,
      output,
    });
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
