import fs from 'fs';
import path from 'path';
import glob from 'glob';
import { VectorStore, VectorMetadata } from './vectorStore'; // Assuming this is the file containing your VectorStore class
import { OpenAiEmbeddingProvider } from './openAiEmbedding'; // Adjust the import path as needed

// Initialize the VectorStore and OpenAiEmbeddingProvider
const vectorStore = new VectorStore();
const embeddingProvider = new OpenAiEmbeddingProvider({
  apiKey: process.env.OPENAI_API_KEY,
  modelName: 'text-embedding-ada-002', // Adjust as needed
});

async function readFileContent(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf8');
}

async function processFile(filePath: string): Promise<void> {
  const content = await readFileContent(filePath);
  const { embedding } = await embeddingProvider.callEmbeddingApi(content);

  const metadata: VectorMetadata = {
    fileName: path.basename(filePath),
    filePath: filePath,
    contentSnippet: content.substring(0, 100) + '...', // First 100 characters as a snippet
  };

  await vectorStore.addVector(embedding, metadata);
}

async function indexRepository(): Promise<void> {
  await vectorStore.loadDb();

  const files = [
    ...glob.sync('examples/**/*', { nodir: true }),
    ...glob.sync('**/*.md', { nodir: true }),
  ];

  console.log(`Found ${files.length} files to process.`);

  for (const file of files) {
    console.log(`Processing file: ${file}`);
    await processFile(file);
  }

  console.log('Indexing complete. Saving vector store...');
  await vectorStore.saveDb();
  console.log('Vector store saved successfully.');
}

// Run the indexing process
indexRepository().catch((error) => {
  console.error('Error during indexing:', error);
  process.exit(1);
});