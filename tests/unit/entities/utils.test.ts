/**
 * Unit tests for entity utilities
 * Tests flexible boolean parsing and validation
 */

import { flexibleBoolean, flexibleBooleanNullable } from '../../../src/entities/utils';
import {
  setupMockFetch,
  resetMocks
} from '../../utils/testHelpers';

setupMockFetch();

describe('entity utilities', () => {
  beforeEach(() => {
    resetMocks();
    delete process.env.DEFAULT_NULL;
  });

  describe('flexibleBoolean', () => {
    it('should handle boolean values directly', () => {
      expect(flexibleBoolean.parse(true)).toBe(true);
      expect(flexibleBoolean.parse(false)).toBe(false);
    });

    it('should handle string representations of true', () => {
      expect(flexibleBoolean.parse('true')).toBe(true);
      expect(flexibleBoolean.parse('TRUE')).toBe(true);
      expect(flexibleBoolean.parse('True')).toBe(true);
      expect(flexibleBoolean.parse('t')).toBe(true);
      expect(flexibleBoolean.parse('T')).toBe(true);
      expect(flexibleBoolean.parse('1')).toBe(true);
    });

    it('should handle string representations of false', () => {
      expect(flexibleBoolean.parse('false')).toBe(false);
      expect(flexibleBoolean.parse('FALSE')).toBe(false);
      expect(flexibleBoolean.parse('False')).toBe(false);
      expect(flexibleBoolean.parse('f')).toBe(false);
      expect(flexibleBoolean.parse('F')).toBe(false);
      expect(flexibleBoolean.parse('0')).toBe(false);
      expect(flexibleBoolean.parse('')).toBe(false);
      expect(flexibleBoolean.parse('random')).toBe(false);
    });

    it('should handle numeric values', () => {
      expect(flexibleBoolean.parse(1)).toBe(true);
      expect(flexibleBoolean.parse(0)).toBe(false);
      expect(flexibleBoolean.parse(-1)).toBe(false);
      expect(flexibleBoolean.parse(42)).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(flexibleBoolean.parse(null)).toBe(false);
      expect(flexibleBoolean.parse(undefined)).toBe(false);
    });

    it('should handle arrays and objects by converting to string', () => {
      expect(flexibleBoolean.parse([])).toBe(false);
      expect(flexibleBoolean.parse({})).toBe(false);
      expect(flexibleBoolean.parse([1, 2, 3])).toBe(false);
      expect(flexibleBoolean.parse({ key: 'value' })).toBe(false);
    });

    it('should handle values that throw when converted to string', () => {
      const problematicValue = {
        toString: () => {
          throw new Error('Cannot convert to string');
        }
      };

      expect(flexibleBoolean.parse(problematicValue)).toBe(false);
    });

    it('should be case insensitive', () => {
      const trueVariants = ['true', 'TRUE', 'True', 'TrUe', 't', 'T'];
      const falseVariants = ['false', 'FALSE', 'False', 'FaLsE', 'f', 'F'];

      trueVariants.forEach(variant => {
        expect(flexibleBoolean.parse(variant)).toBe(true);
      });

      falseVariants.forEach(variant => {
        expect(flexibleBoolean.parse(variant)).toBe(false);
      });
    });

    it('should handle edge cases', () => {
      expect(flexibleBoolean.parse('yes')).toBe(false); // Not in the true list
      expect(flexibleBoolean.parse('no')).toBe(false);
      expect(flexibleBoolean.parse('on')).toBe(false);
      expect(flexibleBoolean.parse('off')).toBe(false);
      expect(flexibleBoolean.parse('truthy')).toBe(false); // Starts with 'true' but not exact
      expect(flexibleBoolean.parse(' true ')).toBe(false); // Has whitespace
    });
  });

  describe('flexibleBooleanNullable without DEFAULT_NULL', () => {
    beforeEach(() => {
      delete process.env.DEFAULT_NULL;
      // Re-require the module to get fresh instance without DEFAULT_NULL
      jest.resetModules();
    });

    it('should handle null values', () => {
      const { flexibleBooleanNullable } = require('../../../src/entities/utils');

      expect(flexibleBooleanNullable.parse(null)).toBe(null);
      expect(flexibleBooleanNullable.parse(undefined)).toBe(false);
    });

    it('should handle boolean values', () => {
      const { flexibleBooleanNullable } = require('../../../src/entities/utils');

      expect(flexibleBooleanNullable.parse(true)).toBe(true);
      expect(flexibleBooleanNullable.parse(false)).toBe(false);
      expect(flexibleBooleanNullable.parse('true')).toBe(true);
      expect(flexibleBooleanNullable.parse('false')).toBe(false);
    });

    it('should not have a default value', () => {
      const { flexibleBooleanNullable } = require('../../../src/entities/utils');

      // When no value is provided, it should be false (due to preprocessing)
      expect(flexibleBooleanNullable.parse(undefined)).toBe(false);
    });
  });

  describe('flexibleBooleanNullable with DEFAULT_NULL=true', () => {
    beforeEach(() => {
      process.env.DEFAULT_NULL = 'true';
      // Re-require the module to pick up the environment variable
      jest.resetModules();
    });

    afterEach(() => {
      delete process.env.DEFAULT_NULL;
    });

    it('should have null as default value', () => {
      const { flexibleBooleanNullable } = require('../../../src/entities/utils');

      expect(flexibleBooleanNullable.parse(undefined)).toBe(null);
    });

    it('should still handle explicit values', () => {
      const { flexibleBooleanNullable } = require('../../../src/entities/utils');

      expect(flexibleBooleanNullable.parse(true)).toBe(true);
      expect(flexibleBooleanNullable.parse(false)).toBe(false);
      expect(flexibleBooleanNullable.parse('1')).toBe(true);
      expect(flexibleBooleanNullable.parse('0')).toBe(false);
    });
  });

  describe('schema validation behavior', () => {
    it('should work with zod validation context', () => {
      // Test that it behaves correctly as a zod schema
      const result = flexibleBoolean.safeParse('true');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('should handle validation errors appropriately', () => {
      // This should not fail since flexibleBoolean accepts any input
      const result = flexibleBoolean.safeParse('invalid-value');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('should work with nullable schema validation', () => {
      const result = flexibleBooleanNullable.safeParse(null);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(null);
      }
    });
  });

  describe('preprocessing behavior', () => {
    it('should apply preprocessing before zod boolean validation', () => {
      // The preprocess function should convert strings to booleans
      // before the zod boolean schema validates them

      const testCases = [
        { input: 'true', expected: true },
        { input: 'false', expected: false },
        { input: '1', expected: true },
        { input: '0', expected: false },
        { input: 't', expected: true },
        { input: 'random', expected: false }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = flexibleBoolean.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe(expected);
        }
      });
    });

    it('should handle preprocessing errors gracefully', () => {
      // Test the catch block in the preprocessing function
      const problematicValue = {
        toString: () => {
          throw new Error('Conversion error');
        },
        valueOf: () => {
          throw new Error('Value error');
        }
      };

      const result = flexibleBoolean.safeParse(problematicValue);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });
  });

  describe('integration with different data types', () => {
    it('should handle form data style inputs', () => {
      // Common form input scenarios
      expect(flexibleBoolean.parse('on')).toBe(false); // HTML checkbox 'on' is not in true list
      expect(flexibleBoolean.parse('checked')).toBe(false);
      expect(flexibleBoolean.parse('')).toBe(false); // Empty string from unchecked input
    });

    it('should handle API response style inputs', () => {
      // Common API boolean representations
      expect(flexibleBoolean.parse(1)).toBe(true);
      expect(flexibleBoolean.parse(0)).toBe(false);
      expect(flexibleBoolean.parse('Y')).toBe(false); // Not in the true list
      expect(flexibleBoolean.parse('N')).toBe(false);
    });

    it('should handle configuration file style inputs', () => {
      // Common config file boolean representations
      expect(flexibleBoolean.parse('TRUE')).toBe(true);
      expect(flexibleBoolean.parse('FALSE')).toBe(false);
      expect(flexibleBoolean.parse('true')).toBe(true);
      expect(flexibleBoolean.parse('false')).toBe(false);
    });
  });

  describe('consistency with GitLab API expectations', () => {
    it('should handle GitLab-style boolean parameters', () => {
      // GitLab API commonly uses these boolean representations
      expect(flexibleBoolean.parse(true)).toBe(true);
      expect(flexibleBoolean.parse(false)).toBe(false);
      expect(flexibleBoolean.parse('true')).toBe(true);
      expect(flexibleBoolean.parse('false')).toBe(false);
    });

    it('should work for GitLab merge request options', () => {
      // Common MR boolean options
      const mrOptions = {
        squash: flexibleBoolean.parse('true'),
        deleteSourceBranch: flexibleBoolean.parse(true),
        skipCi: flexibleBoolean.parse('1'),
        allowCollaboration: flexibleBoolean.parse(false)
      };

      expect(mrOptions.squash).toBe(true);
      expect(mrOptions.deleteSourceBranch).toBe(true);
      expect(mrOptions.skipCi).toBe(true);
      expect(mrOptions.allowCollaboration).toBe(false);
    });
  });
});