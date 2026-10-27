import { filesToolRegistry } from '../../../../src/entities/files/registry';
import { formatToolResult } from '../../../../src/utils/tool-result';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

describe('browse_files content encoding', () => {
  // Invalid UTF-8 must survive the JSON MCP envelope without replacement characters.
  it.each([
    ['PDF bytes', Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80])],
    ['truncated sequence', Buffer.from([0xe2, 0x82])],
    ['overlong sequence', Buffer.from([0xc0, 0xaf])],
    ['encoded surrogate', Buffer.from([0xed, 0xa0, 0x80])],
  ])('preserves %s as base64', async (_name, bytes) => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
    );
    const tool = filesToolRegistry.get('browse_files')!;
    const result = await tool.handler({
      action: 'content',
      project_id: 'test/project',
      file_path: 'report.pdf',
      ref: 'main',
    });
    const formatted = formatToolResult(result, tool);
    expect(formatted.content).toHaveLength(1);
    const block = formatted.content[0];
    expect(block.type).toBe('text');
    if (block.type !== 'text') throw new Error('Expected a text MCP result');
    const payload = JSON.parse(block.text);
    expect(Buffer.from(payload.content, 'base64')).toEqual(bytes);
    expect(payload).toEqual({
      file_path: 'report.pdf',
      ref: 'main',
      content: bytes.toString('base64'),
      encoding: 'base64',
      size: bytes.byteLength,
      content_type: 'application/pdf',
    });
  });

  // Count source bytes, preserve the existing text/BOM behavior, and do not use MIME as a detector.
  it.each([
    ['Unicode', Buffer.from('caf\u00e9 \u{1f680}'), 'caf\u00e9 \u{1f680}'],
    ['empty file', Buffer.alloc(0), ''],
    ['UTF-8 BOM', Buffer.from('\ufeffhello'), 'hello'],
    ['replacement character', Buffer.from('\ufffd'), '\ufffd'],
    ['embedded NUL', Buffer.from('a\0b'), 'a\0b'],
  ])('returns %s as UTF-8 with byte size', async (_name, bytes, content) => {
    mockEnhancedFetch.mockResolvedValueOnce(
      new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }),
    );
    const tool = filesToolRegistry.get('browse_files')!;
    await expect(
      tool.handler({ action: 'content', project_id: 'test/project', file_path: 'example.txt' }),
    ).resolves.toEqual({
      file_path: 'example.txt',
      ref: 'HEAD',
      content,
      encoding: 'utf8',
      size: bytes.byteLength,
      content_type: 'application/octet-stream',
    });
  });

  // A failed body read is an I/O error, never a successful binary response.
  it('propagates response body failures', async () => {
    const failure = new TypeError('Response body failed');
    const response = new Response('unavailable');
    jest.spyOn(response, 'arrayBuffer').mockRejectedValueOnce(failure);
    jest.spyOn(response, 'text').mockRejectedValueOnce(failure);
    mockEnhancedFetch.mockResolvedValueOnce(response);
    await expect(
      filesToolRegistry.get('browse_files')!.handler({
        action: 'content',
        project_id: 'test/project',
        file_path: 'example.txt',
      }),
    ).rejects.toBe(failure);
  });

  // Unexpected decoder failures must not be mislabeled as malformed file bytes.
  it.each([new Error('Decoder unavailable'), new TypeError('Unexpected decoder error'), null])(
    'propagates unexpected decoder failure %s',
    async (failure) => {
      mockEnhancedFetch.mockResolvedValueOnce(new Response('hello'));
      const decode = jest.spyOn(TextDecoder.prototype, 'decode').mockImplementationOnce(() => {
        throw failure;
      });
      try {
        await expect(
          filesToolRegistry.get('browse_files')!.handler({
            action: 'content',
            project_id: 'test/project',
            file_path: 'example.txt',
          }),
        ).rejects.toBe(failure);
      } finally {
        decode.mockRestore();
      }
    },
  );

  // Preserve the existing MIME default when GitLab omits Content-Type.
  it('uses the existing text content type when the header is missing', async () => {
    mockEnhancedFetch.mockResolvedValueOnce(new Response(new Uint8Array([0x61])));
    await expect(
      filesToolRegistry.get('browse_files')!.handler({
        action: 'content',
        project_id: 'test/project',
        file_path: 'example.txt',
      }),
    ).resolves.toMatchObject({
      content: 'a',
      encoding: 'utf8',
      size: 1,
      content_type: 'text/plain',
    });
  });
});
