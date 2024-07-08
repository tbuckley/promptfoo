import fs from 'fs';

/**
 * Interface representing metadata for a vector.
 */
interface VectorMetadata {
  fileName: string;
  filePath: string;
  contentSnippet: string;
}

/**
 * Calculates the cosine similarity between two vectors.
 * @param a - The first vector.
 * @param b - The second vector.
 * @returns The cosine similarity between the two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, _, i) => sum + a[i] * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Gets the indices of the top k values in an array.
 * @param arr - The array to get the top k indices from.
 * @param k - The number of top indices to return.
 * @returns An array of the indices of the top k values.
 */
function getTopKIndices(arr: number[], k: number): number[] {
  return arr
    .map((value, index) => ({ value, index }))
    .sort((a, b) => b.value - a.value)
    .slice(0, k)
    .map((item) => item.index);
}

/**
 * Class representing a vector store with methods to manage and query vectors.
 */
class VectorStore {
  private dbPath_: string;
  private db_: { vectors: number[][]; metadata: VectorMetadata[] };

  /**
   * Creates an instance of VectorStore.
   * @param dbPath - The path to the database file.
   */
  constructor(dbPath: string = 'vector_store.json') {
    this.dbPath_ = dbPath;
    this.db_ = { vectors: [], metadata: [] };
  }

  /**
   * Loads the database from a file.
   */
  async loadDb(): Promise<void> {
    try {
      const data = fs.readFileSync(this.dbPath_, 'utf8');
      this.db_ = JSON.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // File doesn't exist, use empty DB
    }
  }

  /**
   * Saves the database to a file.
   */
  async saveDb(): Promise<void> {
    fs.writeFileSync(this.dbPath_, JSON.stringify(this.db_, null, 2), 'utf8');
  }

  /**
   * Adds a vector and its metadata to the database.
   * @param vector - The vector to add.
   * @param metadata - The metadata associated with the vector.
   */
  async addVector(vector: number[], metadata: VectorMetadata): Promise<void> {
    this.db_.vectors.push(vector);
    this.db_.metadata.push(metadata);
    await this.saveDb();
  }

  /**
   * Searches the database for the most similar vectors to a query vector.
   * @param queryVector - The vector to search for.
   * @param k - The number of top results to return.
   * @returns An array of the top k most similar vectors and their metadata.
   */
  search(
    queryVector: number[],
    k: number = 5,
  ): Array<{ metadata: VectorMetadata; similarity: number }> {
    if (this.db_.vectors.length === 0) return [];

    const similarities = this.db_.vectors.map((vec) => cosineSimilarity(queryVector, vec));

    const topKIndices = getTopKIndices(similarities, k);

    return topKIndices.map((idx) => ({
      metadata: this.db_.metadata[idx],
      similarity: similarities[idx],
    }));
  }

  /**
   * Updates the entire index with new vectors and metadata.
   * @param vectors - The new vectors to set in the database.
   * @param metadataList - The new metadata to set in the database.
   */
  async updateIndex(vectors: number[][], metadataList: VectorMetadata[]): Promise<void> {
    this.db_.vectors = vectors;
    this.db_.metadata = metadataList;
    await this.saveDb();
  }
}

export { VectorStore, VectorMetadata };
