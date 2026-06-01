jest.mock('../../../src/config', () => ({
  isActionDenied: jest.fn(),
}));

import { assertActionAllowed } from '../../../src/entities/utils';
import { isActionDenied } from '../../../src/config';

const mockIsActionDenied = isActionDenied as jest.MockedFunction<typeof isActionDenied>;

describe('assertActionAllowed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not throw when the action is allowed', () => {
    mockIsActionDenied.mockReturnValue(false);
    expect(() => assertActionAllowed('browse_example', 'list')).not.toThrow();
    expect(mockIsActionDenied).toHaveBeenCalledWith('browse_example', 'list');
  });

  it('throws a descriptive error when the action is denied', () => {
    mockIsActionDenied.mockReturnValue(true);
    expect(() => assertActionAllowed('manage_example', 'delete')).toThrow(
      "Action 'delete' is not allowed for manage_example tool",
    );
  });
});
