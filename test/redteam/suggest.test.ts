import { XMLParser } from 'fast-xml-parser';
import { suggestPlugins } from '../../src/redteam/suggest';
import { ApiProvider } from '../../src/types';

// Mock ApiProvider
class MockApiProvider implements ApiProvider {
  id = () => 'mock';
  async callApi(prompt: string): Promise<{ output: string }> {
    const parser = new XMLParser();
    const parsedPrompt = parser.parse(prompt);
    const prompts: string[] = Object.values(parsedPrompt.prompts);

    const suggestions = new Set<string>();

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

  it('handles API call error', async () => {
    const errorProvider: ApiProvider = {
      id: () => 'error',
      callApi: async () => ({ error: 'API call failed' }),
    };

    const prompts = ['You are a helpful assistant.'];
    await expect(suggestPlugins(errorProvider, prompts)).rejects.toThrow(
      'Failed to suggest plugins: API call failed',
    );
  });

  it('handles XML parsing error', async () => {
    const invalidXmlProvider: ApiProvider = {
      id: () => 'invalid',
      callApi: async () => ({ output: '<invalid_xml' }),
    };

    const prompts = ['You are a helpful assistant.'];
    await expect(suggestPlugins(invalidXmlProvider, prompts)).rejects.toThrow(
      'Failed to parse XML suggestions:',
    );
  });
});
