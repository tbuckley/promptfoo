import dedent from 'dedent';
import { XMLParser } from 'fast-xml-parser';
import logger from '../logger';
import { ApiProvider } from '../types';
import { subCategoryDescriptions } from './constants';

export async function suggestPlugins(provider: ApiProvider, prompts: string[]): Promise<string[]> {
  const suggestedPlugins = new Set<string>();
  const pluginEntries = Object.entries(subCategoryDescriptions);

  const promptsXml = prompts
    .map((prompt, index) => `<prompt${index + 1}>${prompt}</prompt${index + 1}>`)
    .join('');

  for (let i = 0; i < pluginEntries.length; i += 5) {
    const batch = pluginEntries.slice(i, i + 5);
    const batchDescriptions = batch
      .map(
        ([key, value]) => dedent`
        <plugin>
          <name>${key}</name>
          <description>${value}</description>
        </plugin>
      `,
      )
      .join('\n');

    console.log(batchDescriptions);
    console.log(promptsXml);

    const { output: batchSuggestions, error } = await provider.callApi(dedent`
      Given the following prompts, suggest which of the provided plugins are relevant for testing the application.

      Prompts to analyze:
      <prompts>${promptsXml}</prompts>

      Available plugins:
      ${batchDescriptions}

      Provide relevance scores (0 for not recommended, 1 for recommended) in XML format.
      Use the plugin name as the tag name, replacing any colon with an underscore.
      Wrap the output in a <suggestions> tag.
    `);

    if (error) {
      logger.error(`Error suggesting plugins: ${error}`);
      throw new Error(`Failed to suggest plugins: ${error}`);
    }

    const parser = new XMLParser();
    try {
      const parsedSuggestions = parser.parse(batchSuggestions);

      if (parsedSuggestions && parsedSuggestions.suggestions) {
        for (const [plugin, score] of Object.entries(parsedSuggestions.suggestions)) {
          const originalPluginName = plugin; // .replace('_', ':');
          if (score === 1 && Object.keys(subCategoryDescriptions).includes(originalPluginName)) {
            suggestedPlugins.add(originalPluginName);
          }
        }
      }
    } catch (parseError) {
      logger.error(`Error parsing XML: ${parseError}`);
      throw new Error(`Failed to parse XML suggestions: ${parseError}`);
    }
  }

  if (suggestedPlugins.size === 0) {
    logger.warn('No plugins were suggested.');
  }

  return Array.from(suggestedPlugins).sort();
}
