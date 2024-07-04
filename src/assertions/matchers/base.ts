import { distance as levenshtein } from 'fastest-levenshtein';
import { type Option as sqlParserOption } from 'node-sql-parser';
import util from 'node:util';
import rouge from 'rouge';
import invariant from 'tiny-invariant';
import { BaseAssertion, coerceString } from '.';
import { GradingResult } from '../../types';

export function equalsAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  let pass: boolean;
  const outputString = coerceString(output);
  if (typeof renderedValue === 'object') {
    pass = util.isDeepStrictEqual(renderedValue, JSON.parse(outputString)) !== inverse;
    renderedValue = JSON.stringify(renderedValue);
  } else {
    pass = (renderedValue == outputString) !== inverse;
  }

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output "${renderedValue}" to ${inverse ? 'not ' : ''}equal "${outputString}"`,
    assertion,
  };
}

export function containsAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"contains" assertion type must have a string or number value');
  invariant(
    typeof renderedValue === 'string' || typeof renderedValue === 'number',
    '"contains" assertion type must have a string or number value',
  );
  const outputString = coerceString(output);
  const pass = outputString.includes(String(renderedValue)) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain "${renderedValue}"`,
    assertion,
  };
}

export function icontainsAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"icontains" assertion type must have a string or number value');
  invariant(
    typeof renderedValue === 'string' || typeof renderedValue === 'number',
    '"icontains" assertion type must have a string or number value',
  );
  const outputString = coerceString(output);
  const pass = outputString.toLowerCase().includes(String(renderedValue).toLowerCase()) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain "${renderedValue}"`,
    assertion,
  };
}

export function containsAnyAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"contains-any" assertion type must have a value');
  if (typeof renderedValue === 'string') {
    renderedValue = renderedValue.split(',').map((v) => v.trim());
  }
  invariant(Array.isArray(renderedValue), '"contains-any" assertion type must have an array value');
  const outputString = coerceString(output);
  const pass = renderedValue.some((value) => outputString.includes(String(value))) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain one of "${renderedValue.join(', ')}"`,
    assertion,
  };
}

export function icontainsAnyAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"icontains-any" assertion type must have a value');
  if (typeof renderedValue === 'string') {
    renderedValue = renderedValue.split(',').map((v) => v.trim());
  }
  invariant(
    Array.isArray(renderedValue),
    '"icontains-any" assertion type must have an array value',
  );
  const outputString = coerceString(output);
  const pass =
    renderedValue.some((value) =>
      outputString.toLowerCase().includes(String(value).toLowerCase()),
    ) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain one of "${renderedValue.join(', ')}"`,
    assertion,
  };
}

export function containsAllAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"contains-all" assertion type must have a value');
  if (typeof renderedValue === 'string') {
    renderedValue = renderedValue.split(',').map((v) => v.trim());
  }
  invariant(Array.isArray(renderedValue), '"contains-all" assertion type must have an array value');
  const outputString = coerceString(output);
  const pass = renderedValue.every((value) => outputString.includes(String(value))) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain all of "${renderedValue.join(', ')}"`,
    assertion,
  };
}

export function icontainsAllAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"icontains-all" assertion type must have a value');
  if (typeof renderedValue === 'string') {
    renderedValue = renderedValue.split(',').map((v) => v.trim());
  }
  invariant(
    Array.isArray(renderedValue),
    '"icontains-all" assertion type must have an array value',
  );
  const outputString = coerceString(output);
  const pass =
    renderedValue.every((value) =>
      outputString.toLowerCase().includes(String(value).toLowerCase()),
    ) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}contain all of "${renderedValue.join(', ')}"`,
    assertion,
  };
}

export function regexAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"regex" assertion type must have a string value');
  invariant(typeof renderedValue === 'string', '"regex" assertion type must have a string value');
  const regex = new RegExp(renderedValue);
  const outputString = coerceString(output);
  const pass = regex.test(outputString) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}match regex "${renderedValue}"`,
    assertion,
  };
}

export function rougeScoreAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(typeof renderedValue === 'string', '"rouge" assertion type must be a string value');
  const rougeMethod = rouge['n'];
  const outputString = coerceString(output);
  const score = rougeMethod(outputString, renderedValue);
  const pass = score >= (assertion.threshold || 0.75) != inverse;

  return {
    pass,
    score: inverse ? 1 - score : score,
    reason: pass
      ? `ROUGE-N score ${score.toFixed(
          2,
        )} is greater than or equal to threshold ${assertion.threshold || 0.75}`
      : `ROUGE-N score ${score.toFixed(2)} is less than threshold ${assertion.threshold || 0.75}`,
    assertion,
  };
}

export function startsWithAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(renderedValue, '"starts-with" assertion type must have a string value');
  invariant(
    typeof renderedValue === 'string',
    '"starts-with" assertion type must have a string value',
  );
  const outputString = coerceString(output);
  const pass = outputString.startsWith(String(renderedValue)) !== inverse;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Expected output to ${inverse ? 'not ' : ''}start with "${renderedValue}"`,
    assertion,
  };
}

export async function isSqlAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): Promise<GradingResult> {
  const outputString = coerceString(output);
  let pass = false;
  let parsedSql;
  let databaseType: string = 'MySQL';
  let whiteTableList: string[] | undefined;
  let whiteColumnList: string[] | undefined;

  if (renderedValue && typeof renderedValue === 'object') {
    const value = renderedValue as {
      database?: string;
      allowedTables?: string[];
      allowedColumns?: string[];
    };

    databaseType = value.database || 'MySQL';
    whiteTableList = value.allowedTables;
    whiteColumnList = value.allowedColumns;
  }

  if (renderedValue && typeof renderedValue !== 'object') {
    throw new Error('is-sql assertion must have a object value.');
  }

  const { Parser: SqlParser } = await import('node-sql-parser').catch(() => {
    throw new Error('node-sql-parser is not installed. Please install it first');
  });

  const sqlParser = new SqlParser();

  const opt: sqlParserOption = { database: databaseType };

  const failureReasons: string[] = [];

  try {
    parsedSql = sqlParser.astify(outputString, opt);
    pass = !inverse;
  } catch (err) {
    pass = inverse;
    failureReasons.push(
      `SQL statement does not conform to the provided ${databaseType} database syntax.`,
    );
  }

  if (whiteTableList) {
    opt.type = 'table';
    try {
      sqlParser.whiteListCheck(outputString, whiteTableList, opt);
    } catch (err) {
      pass = inverse;
      const error = err as Error;
      failureReasons.push(`SQL validation failed: ${error.message}.`);
    }
  }

  if (whiteColumnList) {
    opt.type = 'column';
    try {
      sqlParser.whiteListCheck(outputString, whiteColumnList, opt);
    } catch (err) {
      pass = inverse;
      const error = err as Error;
      failureReasons.push(`SQL validation failed: ${error.message}.`);
    }
  }

  if (inverse && pass === false && failureReasons.length === 0) {
    failureReasons.push('The output SQL statement is valid');
  }

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass ? 'Assertion passed' : failureReasons.join(' '),
    assertion,
  };
}

export async function containsSqlAssertion({
  output,
  renderedValue,
  inverse,
  assertion,
}: BaseAssertion): Promise<GradingResult> {
  const outputString = coerceString(output);
  const match = outputString.match(/```(?:sql)?([^`]+)```/);
  if (match) {
    const sqlCode = match[1].trim();
    return isSqlAssertion({ output: sqlCode, renderedValue, inverse, assertion });
  } else {
    return isSqlAssertion({ output, renderedValue, inverse, assertion });
  }
}

export function levenshteinAssertion({
  output,
  renderedValue,
  assertion,
}: BaseAssertion): GradingResult {
  invariant(
    typeof renderedValue === 'string',
    '"levenshtein" assertion type must have a string value',
  );
  const outputString = coerceString(output);
  const levDistance = levenshtein(outputString, renderedValue);
  const pass = levDistance <= (assertion.threshold || 5);
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'Assertion passed'
      : `Levenshtein distance ${levDistance} is greater than threshold ${assertion.threshold || 5}`,
    assertion,
  };
}
