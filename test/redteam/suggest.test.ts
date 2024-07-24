import { subCategoryDescriptions } from '../../src/redteam/constants';
import { suggestPlugins } from '../../src/redteam/suggest';
import { ApiProvider } from '../../src/types';

// Mock ApiProvider
class MockApiProvider implements ApiProvider {
  id = () => 'mock';
  async callApi(prompt: string): Promise<{ output: string }> {
    if (prompt.includes('bank account balance')) {
      return {
        output:
          '<suggestions><pii_direct>1</pii_direct><harmful_specialized_advice>1</harmful_specialized_advice></suggestions>',
      };
    } else if (prompt.includes('capital of France')) {
      return {
        output: '<suggestions></suggestions>',
      };
    } else if (prompt.includes('travel itinerary') || prompt.includes('financial data')) {
      return {
        output:
          '<suggestions><pii_direct>1</pii_direct><harmful_specialized_advice>1</harmful_specialized_advice><overreliance>1</overreliance></suggestions>',
      };
    } else if (prompt.includes('hack') || prompt.includes('Wi-Fi')) {
      return {
        output:
          '<suggestions><harmful_illegal_activities>1</harmful_illegal_activities></suggestions>',
      };
    } else if (prompt.includes('crush') || prompt.includes('love letter')) {
      return {
        output: '<suggestions><pii_indirect>1</pii_indirect></suggestions>',
      };
    } else if (prompt.includes('stocks') || prompt.includes('invest')) {
      return {
        output:
          '<suggestions><harmful_specialized_advice>1</harmful_specialized_advice></suggestions>',
      };
    } else {
      return {
        output: '<suggestions></suggestions>',
      };
    }
  }
}

describe('suggestPlugins', () => {
  let provider: ApiProvider;

  beforeEach(() => {
    provider = new MockApiProvider();
  });

  it('suggests relevant plugins for a simple prompt', async () => {
    const prompts = ['What is my bank account balance?'];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual(['pii:direct', 'harmful:specialized-advice']);
  });

  it('suggests no plugins for an irrelevant prompt', async () => {
    const prompts = ['What is the capital of France?'];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual([]);
  });

  it('suggests multiple plugins for a complex prompt', async () => {
    const prompts = [
      'Create a travel itinerary for my upcoming vacation to Paris, including my flight details and credit card information.',
      "Analyze my company's financial data and predict our stock price for the next quarter.",
    ];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual(['pii:direct', 'harmful:specialized-advice', 'overreliance']);
  });

  it('handles empty prompts array', async () => {
    const prompts: string[] = [];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual([]);
  });

  it('handles a variety of prompts', async () => {
    const prompts = [
      "How do I hack into my neighbor's Wi-Fi?",
      "What's the weather like today?",
      'Can you write a love letter to my crush?',
      'How do I create a strong password?',
      'What are some good stocks to invest in?',
    ];
    const suggestedPlugins = await suggestPlugins(provider, prompts);

    expect(suggestedPlugins).toBeInstanceOf(Array);
    expect(suggestedPlugins).toEqual([
      'harmful:illegal-activities',
      'pii:indirect',
      'harmful:specialized-advice',
    ]);
  });
});
