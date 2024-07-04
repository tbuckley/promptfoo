import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import dedent from 'dedent';
import yaml from 'js-yaml';
import invariant from 'tiny-invariant';
import { BaseAssertion } from '.';
import { runPythonCode } from '../../python/wrapper';
import { AssertionValueFunctionContext, GradingResult, isGradingResult } from '../../types';
import { extractJsonObjects } from '../../util';

export interface ScriptedAssertion extends BaseAssertion {
  valueFromScript?: any;
  output?: string | object;
  context?: AssertionValueFunctionContext | undefined;
}

const ajv = new Ajv();
addFormats(ajv);

export function isJsonAssertion({
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

export function containsJsonAssertion({
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

export async function javascriptAssertion({
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
      reason: dedent`Custom function threw error: ${(err as Error).message}
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
      : dedent`Custom function returned ${inverse ? 'true' : 'false'}
             ${renderedValue}`,
    assertion,
  };
}
export async function pythonAssertion({
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
