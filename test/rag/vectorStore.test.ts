import * as fs from 'fs';
import { VectorStore, VectorMetadata } from '../../src/rag/vectorStore';

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('VectorStore', () => {
  const mockDbPath = 'mock_vector_store.json';
  let vectorStore: VectorStore;

  beforeEach(() => {
    vectorStore = new VectorStore(mockDbPath);
    jest.clearAllMocks();
  });

  describe('loadDb', () => {
    it('should load the database from a file', async () => {
      const mockData = JSON.stringify({
        vectors: [[1, 2, 3]],
        metadata: [{ fileName: 'file1', filePath: '/path/file1', contentSnippet: 'snippet1' }],
      });
      jest.mocked(fs.readFileSync).mockReturnValue(mockData);

      await vectorStore.loadDb();

      expect(fs.readFileSync).toHaveBeenCalledWith(mockDbPath, 'utf8');
      expect(vectorStore['db_']).toEqual(JSON.parse(mockData));
    });

    it('should throw other errors', async () => {
      const error = new Error('Some other error');
      jest.mocked(fs.readFileSync).mockImplementation(() => {
        throw error;
      });

      await expect(vectorStore.loadDb()).rejects.toThrow(error);
    });
  });

  describe('saveDb', () => {
    it('should save the database to a file', async () => {
      vectorStore['db_'] = {
        vectors: [[1, 2, 3]],
        metadata: [{ fileName: 'file1', filePath: '/path/file1', contentSnippet: 'snippet1' }],
      };

      await vectorStore.saveDb();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockDbPath,
        JSON.stringify(vectorStore['db_'], null, 2),
        'utf8',
      );
    });
  });

  describe('addVector', () => {
    it('should add a vector and its metadata to the database', async () => {
      const vector = [1, 2, 3];
      const metadata: VectorMetadata = {
        fileName: 'file1',
        filePath: '/path/file1',
        contentSnippet: 'snippet1',
      };

      await vectorStore.addVector(vector, metadata);

      expect(vectorStore['db_']).toEqual({
        vectors: expect.arrayContaining([vector]),
        metadata: expect.arrayContaining([metadata]),
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockDbPath,
        JSON.stringify(vectorStore['db_'], null, 2),
        'utf8',
      );
    });
  });

  describe('search', () => {
    it('should return the top k most similar vectors and their metadata', () => {
      const vectors = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const metadataList: VectorMetadata[] = [
        { fileName: 'file1', filePath: '/path/file1', contentSnippet: 'snippet1' },
        { fileName: 'file2', filePath: '/path/file2', contentSnippet: 'snippet2' },
        { fileName: 'file3', filePath: '/path/file3', contentSnippet: 'snippet3' },
      ];
      vectorStore['db_'] = { vectors, metadata: metadataList };
      expect(vectorStore.search([1, 0, 0], 2)).toEqual([
        { metadata: metadataList[0], similarity: expect.any(Number) },
        { metadata: metadataList[1], similarity: expect.any(Number) },
      ]);
    });

    it('should return an empty array if the database is empty', () => {
      expect(vectorStore.search([1, 0, 0], 2)).toEqual([]);
    });
  });

  describe('updateIndex', () => {
    it('should update the entire index with new vectors and metadata', async () => {
      const vectors = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      const metadataList: VectorMetadata[] = [
        { fileName: 'file1', filePath: '/path/file1', contentSnippet: 'snippet1' },
        { fileName: 'file2', filePath: '/path/file2', contentSnippet: 'snippet2' },
      ];

      await vectorStore.updateIndex(vectors, metadataList);

      expect(vectorStore['db_']).toEqual({
        vectors: expect.arrayContaining(vectors),
        metadata: expect.arrayContaining(metadataList),
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockDbPath,
        JSON.stringify(vectorStore['db_'], null, 2),
        'utf8',
      );
    });
  });
});
