/**
 * Unit tests for merge request handlers
 * Tests all handler functions in src/entities/mrs/handlers.ts
 */

// Mock enhancedFetch at the module level
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
  DEFAULT_HEADERS: {
    'User-Agent': 'GitLab MCP Server',
    'Accept': 'application/json'
  },
  createFetchOptions: jest.fn()
}));

// Mock environment variables
const mockEnv = {
  GITLAB_API_URL: 'https://gitlab.example.com',
  GITLAB_TOKEN: 'test-token'
};

// Set up environment
Object.assign(process.env, mockEnv);

import { enhancedFetch } from '../../../../src/utils/fetch';
import {
  handleGetBranchDiffs,
  handleGetMergeRequest,
  handleGetMergeRequestDiffs,
  handleListMergeRequestDiffs,
  handleListMergeRequestDiscussions,
  handleGetDraftNote,
  handleListDraftNotes,
  handleListMergeRequests,
  handleCreateMergeRequest,
  handleUpdateMergeRequest,
  handleMergeMergeRequest,
  handleCreateNote,
  handleCreateMergeRequestThread,
  handleUpdateMergeRequestNote,
  handleCreateMergeRequestNote,
  handleCreateDraftNote,
  handleUpdateDraftNote,
  handleDeleteDraftNote,
  handlePublishDraftNote,
  handleBulkPublishDraftNotes
} from '../../../../src/entities/mrs/handlers';

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock data
const mockMergeRequest = {
  id: 123,
  iid: 1,
  title: 'Test MR',
  state: 'opened',
  web_url: 'https://gitlab.example.com/test-project/-/merge_requests/1'
};

const mockDiff = {
  old_path: 'file.txt',
  new_path: 'file.txt',
  diff: '@@ -1,3 +1,4 @@'
};

const mockNote = {
  id: 456,
  body: 'Test note',
  author: { username: 'testuser' }
};

const mockDraftNote = {
  id: 789,
  note: 'Test draft note',
  position: { new_line: 10 }
};

describe('Merge Request Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnhancedFetch.mockClear();
    // Reset to throw error by default - individual tests will override
    mockEnhancedFetch.mockRejectedValue(new Error('No mock set up'));
  });

  // Helper function to create mock response
  function createMockResponse(data: any, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: jest.fn().mockResolvedValue(data),
      text: jest.fn().mockResolvedValue(JSON.stringify(data)),
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      headers: new Headers({ 'content-type': 'application/json' })
    } as any;
  }

  describe('handleGetBranchDiffs', () => {
    it('should call branch comparison API', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse({ diffs: [mockDiff] }));

      const params = { project_id: '123', from: 'main', to: 'feature' };
      await handleGetBranchDiffs(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/repository/compare?from=main&to=feature&',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should return diff data', async () => {
      const diffData = { diffs: [mockDiff] };
      mockEnhancedFetch.mockResolvedValue(createMockResponse(diffData));

      const result = await handleGetBranchDiffs({ project_id: '123', from: 'main', to: 'feature' });

      expect(result).toEqual(diffData);
    });

    it('should handle straight parameter', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse({ diffs: [mockDiff] }));

      const params = { project_id: '123', from: 'main', to: 'feature', straight: true };
      await handleGetBranchDiffs(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        expect.stringContaining('straight=true'),
        expect.any(Object)
      );
    });
  });

  describe('handleGetMergeRequest', () => {
    it('should call API with merge request IID', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const params = { project_id: '123', merge_request_iid: '1' };
      await handleGetMergeRequest(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1',
        expect.any(Object)
      );
    });

    it('should return merge request data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const result = await handleGetMergeRequest({ project_id: '123', merge_request_iid: '1' });

      expect(result).toEqual(mockMergeRequest);
    });
  });

  describe('handleListMergeRequests', () => {
    it('should call API with project ID', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockMergeRequest]));

      const params = { project_id: '123', state: 'opened' };
      await handleListMergeRequests(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests?state=opened',
        expect.any(Object)
      );
    });

    it('should return merge requests list', async () => {
      const mergeRequests = [mockMergeRequest];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mergeRequests));

      const result = await handleListMergeRequests({ project_id: '123' });

      expect(result).toEqual(mergeRequests);
    });
  });

  describe('handleGetMergeRequestDiffs', () => {
    it('should call diffs API', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockDiff]));

      const params = { project_id: '123', merge_request_iid: '1' };
      await handleGetMergeRequestDiffs(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/changes?',
        expect.any(Object)
      );
    });

    it('should return diffs data', async () => {
      const diffs = [mockDiff];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(diffs));

      const result = await handleGetMergeRequestDiffs({ project_id: '123', merge_request_iid: '1' });

      expect(result).toEqual(diffs);
    });
  });

  describe('handleListMergeRequestDiscussions', () => {
    const mockDiscussion = {
      id: 'discussion123',
      notes: [mockNote]
    };

    it('should call discussions API', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockDiscussion]));

      const params = { project_id: '123', merge_request_iid: '1' };
      await handleListMergeRequestDiscussions(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/discussions?',
        expect.any(Object)
      );
    });

    it('should return discussions data', async () => {
      const discussions = [mockDiscussion];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(discussions));

      const result = await handleListMergeRequestDiscussions({ project_id: '123', merge_request_iid: '1' });

      expect(result).toEqual(discussions);
    });
  });

  describe('handleCreateMergeRequest', () => {
    it('should call API with POST method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const params = {
        project_id: '123',
        source_branch: 'feature',
        target_branch: 'main',
        title: 'Test MR'
      };
      await handleCreateMergeRequest(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return created merge request data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const result = await handleCreateMergeRequest({
        project_id: '123',
        source_branch: 'feature',
        target_branch: 'main',
        title: 'Test MR'
      });

      expect(result).toEqual(mockMergeRequest);
    });
  });

  describe('handleUpdateMergeRequest', () => {
    it('should call API with PUT method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const params = {
        project_id: '123',
        merge_request_iid: '1',
        title: 'Updated MR'
      };
      await handleUpdateMergeRequest(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return updated merge request data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockMergeRequest));

      const result = await handleUpdateMergeRequest({
        project_id: '123',
        merge_request_iid: '1',
        title: 'Updated MR'
      });

      expect(result).toEqual(mockMergeRequest);
    });
  });

  describe('handleMergeMergeRequest', () => {
    it('should call merge API with PUT method', async () => {
      const mergedMR = { ...mockMergeRequest, state: 'merged' };
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mergedMR));

      const params = { project_id: '123', merge_request_iid: '1' };
      await handleMergeMergeRequest(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/merge',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return merged merge request data', async () => {
      const mergedMR = { ...mockMergeRequest, state: 'merged' };
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mergedMR));

      const result = await handleMergeMergeRequest({ project_id: '123', merge_request_iid: '1' });

      expect(result).toEqual(mergedMR);
    });
  });

  describe('handleCreateNote', () => {
    it('should call notes API with POST method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNote));

      const params = {
        project_id: '123',
        noteable_type: 'merge_request' as const,
        noteable_id: '1',
        body: 'Test note'
      };
      await handleCreateNote(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/notes',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return created note data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNote));

      const result = await handleCreateNote({
        project_id: '123',
        noteable_type: 'merge_request',
        noteable_id: '1',
        body: 'Test note'
      });

      expect(result).toEqual(mockNote);
    });
  });

  describe('handleListDraftNotes', () => {
    it('should call draft notes API', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockDraftNote]));

      const params = { project_id: '123', merge_request_iid: '1' };
      await handleListDraftNotes(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/draft_notes',
        expect.any(Object)
      );
    });

    it('should return draft notes data', async () => {
      const draftNotes = [mockDraftNote];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(draftNotes));

      const result = await handleListDraftNotes({ project_id: '123', merge_request_iid: '1' });

      expect(result).toEqual(draftNotes);
    });
  });

  describe('handleCreateDraftNote', () => {
    it('should call draft notes API with POST method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockDraftNote));

      const params = {
        project_id: '123',
        merge_request_iid: '1',
        note: 'Test draft note'
      };
      await handleCreateDraftNote(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/draft_notes',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return created draft note data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockDraftNote));

      const result = await handleCreateDraftNote({
        project_id: '123',
        merge_request_iid: '1',
        note: 'Test draft note'
      });

      expect(result).toEqual(mockDraftNote);
    });
  });

  describe('handleUpdateDraftNote', () => {
    it('should call draft note update API with PUT method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockDraftNote));

      const params = {
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789',
        note: 'Updated draft note'
      };
      await handleUpdateDraftNote(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/draft_notes/789',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return updated draft note data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockDraftNote));

      const result = await handleUpdateDraftNote({
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789',
        note: 'Updated draft note'
      });

      expect(result).toEqual(mockDraftNote);
    });
  });

  describe('handleDeleteDraftNote', () => {
    it('should call draft note delete API with DELETE method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(null, 204));

      const params = {
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789'
      };
      await handleDeleteDraftNote(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/draft_notes/789',
        expect.objectContaining({
          method: 'DELETE'
        })
      );
    });

    it('should return success for delete operation', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(null, 204));

      const result = await handleDeleteDraftNote({
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789'
      });

      expect(result).toEqual({ deleted: true });
    });
  });

  describe('handlePublishDraftNote', () => {
    it('should call publish API with PUT method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNote));

      const params = {
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789'
      };
      await handlePublishDraftNote(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/merge_requests/1/draft_notes/789/publish',
        expect.objectContaining({
          method: 'PUT'
        })
      );
    });

    it('should return published note data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNote));

      const result = await handlePublishDraftNote({
        project_id: '123',
        merge_request_iid: '1',
        draft_note_id: '789'
      });

      expect(result).toEqual(mockNote);
    });
  });

  describe('error handling', () => {
    it('should handle API errors', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(null, 404));

      await expect(handleGetMergeRequest({ project_id: '123', merge_request_iid: '999' }))
        .rejects.toThrow('GitLab API error: 404 Error');
    });

    it('should handle network errors', async () => {
      mockEnhancedFetch.mockRejectedValue(new Error('Network error'));

      await expect(handleGetMergeRequest({ project_id: '123', merge_request_iid: '1' }))
        .rejects.toThrow('Network error');
    });
  });
});