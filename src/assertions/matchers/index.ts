import { Assertion, AssertionValue } from "../../types";

export interface BaseAssertion {
    outputString: string;
    renderedValue: AssertionValue | undefined;
    inverse: boolean;
    assertion: Assertion;
  }

