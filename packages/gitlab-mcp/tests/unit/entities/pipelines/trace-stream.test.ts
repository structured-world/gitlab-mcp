import { pipelinesToolRegistry } from '../../../../src/entities/pipelines/registry';
import { installFetchMock, mockEnhancedFetch } from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const logs = (start?: number, per_page = 200) =>
  pipelinesToolRegistry.get('browse_pipelines')!.handler({
    action: 'logs', project_id: 'test/project', job_id: '1', start, per_page,
  });

function streamed(text: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  }));
  // A small returned page must never materialize the complete response body.
  response.text = jest.fn().mockRejectedValue(new Error('Unbounded trace read'));
  return response;
}

describe('streamed job trace pagination', () => {
  it('reads a requested page without the whole-body text reader', async () => {
    // Prevent full trace buffering even when the result contains just two lines.
    mockEnhancedFetch.mockResolvedValueOnce(streamed('first\nsecond\nthird\nfourth'));
    await expect(logs(1, 2)).resolves.toEqual({
      trace: '[LOG TRUNCATED: Showing lines 1-2 of 4]\nsecond\nthird',
      totalLines: 4, shownLines: 2, startLine: 1, hasMore: true, nextStart: 3,
    });
  });

  it('preserves a UTF-8 character divided between network chunks', async () => {
    // Network boundaries must not introduce replacement characters into complete lines.
    mockEnhancedFetch.mockResolvedValueOnce(streamed('naïve\n日本語\n', 1));
    await expect(logs()).resolves.toEqual({
      trace: 'naïve\n日本語\n', totalLines: 3, shownLines: 3,
      startLine: 0, hasMore: false, nextStart: null,
    });
  });
});
