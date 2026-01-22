/**
 * Manual mock for @clack/prompts
 * Required because @clack/prompts 1.0.0-alpha.9+ is ESM-only
 * and Jest uses CommonJS by default
 */

export const intro = jest.fn();
export const outro = jest.fn();
export const log = {
  message: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  step: jest.fn(),
  warn: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
};
export const note = jest.fn();
export const cancel = jest.fn();
export const isCancel = jest.fn().mockReturnValue(false);
export const text = jest.fn().mockResolvedValue("");
export const password = jest.fn().mockResolvedValue("");
export const confirm = jest.fn().mockResolvedValue(true);
export const select = jest.fn().mockResolvedValue("");
export const multiselect = jest.fn().mockResolvedValue([]);
export const spinner = jest.fn().mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  message: jest.fn(),
  cancel: jest.fn(),
  error: jest.fn(),
  clear: jest.fn(),
  isCancelled: false,
});

// Default export as well for `import * as p from "@clack/prompts"`
const prompts = {
  intro,
  outro,
  log,
  note,
  cancel,
  isCancel,
  text,
  password,
  confirm,
  select,
  multiselect,
  spinner,
};

export default prompts;
