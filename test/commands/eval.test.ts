import { Command } from 'commander';
import { doEval, evalCommand } from '../../src/commands/eval';
import { resolveConfigs } from '../../src/config';
import { evaluate } from '../../src/evaluator';
import { createShareableUrl } from '../../src/share';
import telemetry from '../../src/telemetry';
import { writeResultsToDatabase } from '../../src/util';

// Mock dependencies
jest.mock('../../src/config');
jest.mock('../../src/evaluator');
jest.mock('../../src/util');
jest.mock('../../src/share');
jest.mock('../../src/telemetry');

describe('eval command', () => {
  let mockCommand: Command;
  const defaultConfig = {};
  const defaultConfigPath = 'path/to/config';
  const evaluateOptions = {};

  beforeEach(() => {
    mockCommand = new Command();
    jest.clearAllMocks();
  });

  describe('doEval', () => {
    it('should run evaluation with default settings', async () => {
      const cmdObj = {
        verbose: false,
        cache: true,
        table: true,
        write: true,
      };

      jest.mocked(resolveConfigs).mockResolvedValue({
        config: {},
        testSuite: { tests: [], providers: [] },
        basePath: '/test/path',
      });

      jest.mocked(evaluate).mockResolvedValue({
        stats: {
          successes: 5,
          failures: 0,
          tokenUsage: { total: 100, prompt: 50, completion: 50, cached: 0 },
        },
        results: [],
        table: {
          head: { prompts: [], vars: [] },
          body: [],
        },
      });

      await doEval(cmdObj as any, defaultConfig, defaultConfigPath, evaluateOptions);

      expect(resolveConfigs).toHaveBeenCalledWith(cmdObj, defaultConfig);
      expect(evaluate).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
      expect(writeResultsToDatabase).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
      expect(telemetry.record).toHaveBeenCalledWith('command_used', expect.any(Object));
    });

    it('should handle evaluation failures', async () => {
      const cmdObj = {
        verbose: false,
        cache: true,
        table: true,
        write: true,
      };

      jest.mocked(resolveConfigs).mockResolvedValue({
        config: {},
        testSuite: { tests: [], providers: [] },
        basePath: '/test/path',
      });

      jest.mocked(evaluate).mockResolvedValue({
        stats: {
          successes: 3,
          failures: 2,
          tokenUsage: { total: 100, prompt: 50, completion: 50, cached: 0 },
        },
        results: [],
        table: {
          head: { prompts: [], vars: [] },
          body: [],
        },
      });

      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await doEval(cmdObj as any, defaultConfig, defaultConfigPath, evaluateOptions);

      expect(exitSpy).toHaveBeenCalledWith(100);
      exitSpy.mockRestore();
    });

    it('should create shareable URL when share option is true', async () => {
      const cmdObj = {
        verbose: false,
        cache: true,
        table: true,
        write: true,
        share: true,
      };

      jest.mocked(resolveConfigs).mockResolvedValue({
        config: { sharing: true },
        testSuite: { tests: [], providers: [] },
        basePath: '/test/path',
      });

      jest.mocked(evaluate).mockResolvedValue({
        stats: {
          successes: 5,
          failures: 0,
          tokenUsage: { total: 100, prompt: 50, completion: 50, cached: 0 },
        },
        results: [],
        table: {
          head: { prompts: [], vars: [] },
          body: [],
        },
      });

      jest.mocked(createShareableUrl).mockResolvedValue('https://example.com/share');

      await doEval(cmdObj as any, defaultConfig, defaultConfigPath, evaluateOptions);

      expect(createShareableUrl).toHaveBeenCalled();
    });
  });

  describe('evalCommand', () => {
    it('should add eval command to the program', () => {
      const addCommandSpy = jest.spyOn(mockCommand, 'command').mockReturnThis();
      const descriptionSpy = jest.spyOn(mockCommand, 'description').mockReturnThis();
      const optionSpy = jest.spyOn(mockCommand, 'option').mockReturnThis();
      const actionSpy = jest.spyOn(mockCommand, 'action').mockReturnThis();

      evalCommand(mockCommand, defaultConfig, defaultConfigPath, evaluateOptions);

      expect(addCommandSpy).toHaveBeenCalledWith('eval');
      expect(descriptionSpy).toHaveBeenCalled();
      expect(optionSpy).toHaveBeenCalled();
      expect(actionSpy).toHaveBeenCalled();
    });
  });
});
