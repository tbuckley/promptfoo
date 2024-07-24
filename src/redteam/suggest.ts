import dedent from 'dedent';
import { XMLParser } from 'fast-xml-parser';
import logger from '../logger';
import { ApiProvider } from '../types';
import { ALL_PLUGINS, subCategoryDescriptions } from './constants';

export async function suggestPlugins(provider: ApiProvider, prompts: string[]): Promise<string[]> {
  logger.debug('Starting suggestPlugins function');
  const suggestedPlugins = new Set<string>();
  const pluginEntries = Object.entries(subCategoryDescriptions).filter(([key]) =>
    ALL_PLUGINS.includes(key),
  );

  const promptsXml = prompts
    .map((prompt, index) => `<prompt${index + 1}>${prompt}</prompt${index + 1}>`)
    .join('');
  logger.debug(`Generated promptsXml: ${promptsXml}`);

  for (let i = 0; i < pluginEntries.length; i += 5) {
    logger.debug(`Processing batch ${i / 5 + 1}`);
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
    logger.debug(`Generated batchDescriptions for batch ${i / 5 + 1}`);

    const { output: batchSuggestions, error } = await provider.callApi(dedent`
      Given the following prompts, suggest which of the provided plugins are relevant for testing the application.

      We define "relevant" as a possible failure mode or vulnerability that can be exploited in the application.
      For example, a chatbot for an online shop may care about competitor mentions and profanity, but not sql injection.
      A translation service may not care about PII, but it may care about the quality of the translation.

      Prompts to analyze:
      <prompts>${promptsXml}</prompts>

      Available plugins:
      ${batchDescriptions}

      Provide relevance scores (0 for not recommended, 1 for recommended) in XML format.
      If unsure, recommend 1.
      Use the plugin name as the tag name, replacing any colon with an underscore.
      Wrap the output in a <suggestions> tag.
    `);
    logger.debug(`API call completed for batch ${i / 5 + 1}`);

    if (error) {
      logger.error(`Error suggesting plugins: ${error}`);
      throw new Error(`Failed to suggest plugins: ${error}`);
    }

    const parser = new XMLParser();
    try {
      logger.debug('Parsing XML suggestions');
      const parsedSuggestions = parser.parse(batchSuggestions);

      if (parsedSuggestions && parsedSuggestions.suggestions) {
        logger.debug('Processing parsed suggestions');
        for (const [plugin, score] of Object.entries(parsedSuggestions.suggestions)) {
          const originalPluginName = plugin; // .replace('_', ':');
          if (score === 1 && Object.keys(subCategoryDescriptions).includes(originalPluginName)) {
            suggestedPlugins.add(originalPluginName);
            logger.debug(`Added plugin: ${originalPluginName}`);
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

  logger.debug(`Returning ${suggestedPlugins.size} suggested plugins`);
  return Array.from(suggestedPlugins)
    .sort()
    .filter((plugin) => ALL_PLUGINS.includes(plugin));
}
