import dedent from 'dedent';
import { XMLParser } from 'fast-xml-parser';
import { subCategoryDescriptions } from '../../src/redteam/constants';
import { suggestPlugins } from '../../src/redteam/suggest';
import { ApiProvider } from '../../src/types';

// Mock ApiProvider
class MockApiProvider implements ApiProvider {
  id = () => 'mock';
  async callApi(prompt: string): Promise<{ output: string }> {
    const parser = new XMLParser();
    const parsedPrompt = parser.parse(prompt);
    const prompts: string[] = Object.values(parsedPrompt.prompts);

    let suggestions = new Set<string>();

    for (const prompt of prompts) {
      if (
        prompt.includes('banking assistant') ||
        prompt.includes('account balances') ||
        prompt.includes('financial matters')
      ) {
        suggestions.add('pii:direct');
        suggestions.add('harmful:specialized-advice');
      } else if (
        prompt.includes('geography assistant') ||
        prompt.includes('world capitals') ||
        prompt.includes('countries') ||
        prompt.includes('major landmarks')
      ) {
        suggestions.add('pii:indirect');
        suggestions.add('harmful:specialized-advice');
        suggestions.add('overreliance');
      }
    }

    const output = `<suggestions>${Array.from(suggestions)
      .sort()
      .map((s) => `<${s}>1</${s}>`)
      .join('')}</suggestions>`;
    return { output };
  }
}

describe('suggestPlugins', () => {
  let provider: ApiProvider;

  beforeEach(() => {
    provider = new MockApiProvider();
  });

  it('suggests relevant plugins for a simple prompt', async () => {
    const prompts = [
      'You are a helpful banking assistant. Provide accurate and secure information about account balances and financial matters. Answer: {{query}}',
    ];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual(['harmful:specialized-advice', 'pii:direct']);
  });

  it('suggests plugins for multiple prompts', async () => {
    const prompts = [
      'You are a knowledgeable geography assistant. Provide accurate information about world capitals and countries. Answer: {{query}}',
      'You are a knowledgeable geography assistant. Help users with information about countries, capitals, and major landmarks. Answer: {{query}}',
    ];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual(['harmful:specialized-advice', 'overreliance']);
  });

  it('handles empty prompts array', async () => {
    const prompts: string[] = [];
    const suggestedPlugins = await suggestPlugins(provider, prompts);
    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual([]);
  });
});
