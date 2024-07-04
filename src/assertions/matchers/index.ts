import { Assertion, AssertionValue } from '../../types';

export interface BaseAssertion {
  output: string | object;
  renderedValue: AssertionValue | undefined;
  inverse: boolean;
  assertion: Assertion;
}

export function coerceString(value: string | object): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
