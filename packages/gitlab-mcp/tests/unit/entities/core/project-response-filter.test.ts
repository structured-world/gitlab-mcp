import {
  stripProjectSecrets,
  withSafeProjectResponse,
} from '../../../../src/entities/core/project-response';

describe('Project response filtering', () => {
  // Preserve absent responses and scalar metadata without converting their types or values.
  it.each([null, undefined, false, 0, '', 'text'])('preserves scalar %p', (value) => {
    expect(stripProjectSecrets(value)).toBe(value);
  });

  // Filtering owns parsed response objects and must not clone or drop unknown non-secret fields.
  it('retains object and array identity while filtering nested credentials', () => {
    const nested = { runners_token: null, import_url: null, description: 'unchanged' };
    const result = [nested, null, 'text', 0];
    expect(stripProjectSecrets(result)).toBe(result);
    expect(result[0]).toBe(nested);
    expect(result).toStrictEqual([{ description: 'unchanged' }, null, 'text', 0]);
  });

  // An attacker-controlled nesting depth must not consume the JavaScript call stack.
  it('filters deeply nested JSON iteratively', () => {
    const leaf = { runners_token: 'secret', name: 'deep' };
    let data: unknown = leaf;
    for (let depth = 0; depth < 20000; depth++) data = { project: data };
    expect(stripProjectSecrets(data)).toBe(data);
    expect(leaf).toStrictEqual({ name: 'deep' });
  });

  // Only own JSON properties belong to this response, never objects supplied by its prototype.
  it('does not traverse inherited objects', () => {
    const inherited = { runners_token: 'outside-response' };
    const data: unknown = Object.assign(Object.create({ inherited }), { name: 'own' });
    expect(stripProjectSecrets(data)).toBe(data);
    expect(inherited.runners_token).toBe('outside-response');
  });

  // Failed operations must preserve their error identity and never become successful empty responses.
  it('propagates the original handler rejection and arguments', async () => {
    const error = new Error('GitLab API error: 403 Forbidden');
    const handler = jest.fn().mockRejectedValue(error);
    const args = { action: 'get', project_id: 'test/project' };
    await expect(withSafeProjectResponse(handler)(args)).rejects.toBe(error);
    expect(handler).toHaveBeenCalledWith(args);
    expect(args).toStrictEqual({ action: 'get', project_id: 'test/project' });
  });
});
