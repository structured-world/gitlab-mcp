/**
 * Tests for auto-discovery orchestrator
 */

import {
  autoDiscover,
  formatDiscoveryResult,
  AutoDiscoveryResult,
} from "../../../src/discovery/auto";
import * as gitRemote from "../../../src/discovery/git-remote";
import * as profileMatcher from "../../../src/discovery/profile-matcher";
import * as profiles from "../../../src/profiles";

// Mock dependencies
jest.mock("../../../src/discovery/git-remote");
jest.mock("../../../src/discovery/profile-matcher");
jest.mock("../../../src/profiles");
jest.mock("../../../src/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockGitRemote = gitRemote as jest.Mocked<typeof gitRemote>;
const mockProfileMatcher = profileMatcher as jest.Mocked<typeof profileMatcher>;
const mockProfiles = profiles as jest.Mocked<typeof profiles>;

describe("autoDiscover", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GITLAB_API_URL;
    delete process.env.GITLAB_DEFAULT_PROJECT;
    delete process.env.GITLAB_DEFAULT_NAMESPACE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const mockRemoteInfo: gitRemote.GitRemoteInfo = {
    host: "gitlab.company.com",
    projectPath: "myteam/backend",
    protocol: "ssh",
    url: "git@gitlab.company.com:myteam/backend.git",
    remoteName: "origin",
  };

  it("should return null when not in a git repository", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(null);

    const result = await autoDiscover({ repoPath: "/not-a-repo" });

    expect(result).toBeNull();
  });

  it("should discover host and project from git remote", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    const result = await autoDiscover({ repoPath: "/test/repo" });

    expect(result).not.toBeNull();
    expect(result?.host).toBe("gitlab.company.com");
    expect(result?.projectPath).toBe("myteam/backend");
    expect(result?.apiUrl).toBe("https://gitlab.company.com");
  });

  it("should match host to user profile", async () => {
    const matchResult: profileMatcher.ProfileMatchResult = {
      profileName: "work",
      profile: {
        name: "work",
        host: "gitlab.company.com",
        authType: "pat",
        readOnly: false,
        isBuiltIn: false,
        isPreset: false,
      },
      matchType: "exact",
    };

    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(matchResult);
    mockProfiles.findProjectConfig.mockResolvedValue(null);
    mockProfiles.loadAndApplyProfile.mockResolvedValue({
      success: true,
      profileName: "work",
      host: "gitlab.company.com",
      appliedSettings: [],
      validation: { valid: true, errors: [], warnings: [] },
    });

    const result = await autoDiscover({ repoPath: "/test/repo" });

    expect(result?.matchedProfile).toEqual(matchResult);
    expect(mockProfiles.loadAndApplyProfile).toHaveBeenCalledWith("work");
    expect(result?.profileApplied).toBe(true);
  });

  it("should load project configuration", async () => {
    const projectConfig: profiles.ProjectConfig = {
      configPath: "/test/repo/.gitlab-mcp",
      preset: {
        description: "Test preset",
        read_only: true,
      },
    };

    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(projectConfig);

    const result = await autoDiscover({ repoPath: "/test/repo" });

    expect(result?.projectConfig).toEqual(projectConfig);
    expect(result?.projectConfigApplied).toBe(true);
  });

  it("should skip project config when noProjectConfig is true", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);

    const result = await autoDiscover({
      repoPath: "/test/repo",
      noProjectConfig: true,
    });

    expect(mockProfiles.findProjectConfig).not.toHaveBeenCalled();
    expect(result?.projectConfig).toBeNull();
  });

  it("should not apply changes in dry-run mode", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue({
      profileName: "work",
      profile: {
        name: "work",
        host: "gitlab.company.com",
        authType: "pat",
        readOnly: false,
        isBuiltIn: false,
        isPreset: false,
      },
      matchType: "exact",
    });
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    const result = await autoDiscover({
      repoPath: "/test/repo",
      dryRun: true,
    });

    expect(mockProfiles.loadAndApplyProfile).not.toHaveBeenCalled();
    expect(result?.profileApplied).toBe(false);
    expect(process.env.GITLAB_DEFAULT_PROJECT).toBeUndefined();
  });

  it("should set default context when no profile matched", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    await autoDiscover({ repoPath: "/test/repo" });

    expect(process.env.GITLAB_API_URL).toBe("https://gitlab.company.com");
    expect(process.env.GITLAB_DEFAULT_PROJECT).toBe("myteam/backend");
    expect(process.env.GITLAB_DEFAULT_NAMESPACE).toBe("myteam");
  });

  it("should not override existing GITLAB_API_URL", async () => {
    process.env.GITLAB_API_URL = "https://existing.gitlab.com";

    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    await autoDiscover({ repoPath: "/test/repo" });

    expect(process.env.GITLAB_API_URL).toBe("https://existing.gitlab.com");
  });

  it("should use specified remote name", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    await autoDiscover({
      repoPath: "/test/repo",
      remoteName: "upstream",
    });

    expect(mockGitRemote.parseGitRemote).toHaveBeenCalledWith({
      repoPath: "/test/repo",
      remoteName: "upstream",
    });
  });

  it("should include all available remotes in result", async () => {
    const remotes: gitRemote.GitRemoteInfo[] = [
      mockRemoteInfo,
      {
        host: "github.com",
        projectPath: "fork/backend",
        protocol: "ssh",
        url: "git@github.com:fork/backend.git",
        remoteName: "upstream",
      },
    ];

    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue(remotes);
    mockProfileMatcher.findProfileByHost.mockResolvedValue(null);
    mockProfiles.findProjectConfig.mockResolvedValue(null);

    const result = await autoDiscover({ repoPath: "/test/repo" });

    expect(result?.availableRemotes).toHaveLength(2);
  });

  it("should handle profile application failure gracefully", async () => {
    mockGitRemote.parseGitRemote.mockResolvedValue(mockRemoteInfo);
    mockGitRemote.listGitRemotes.mockResolvedValue([mockRemoteInfo]);
    mockProfileMatcher.findProfileByHost.mockResolvedValue({
      profileName: "work",
      profile: {
        name: "work",
        host: "gitlab.company.com",
        authType: "pat",
        readOnly: false,
        isBuiltIn: false,
        isPreset: false,
      },
      matchType: "exact",
    });
    mockProfiles.findProjectConfig.mockResolvedValue(null);
    mockProfiles.loadAndApplyProfile.mockRejectedValue(new Error("Token not found"));

    const result = await autoDiscover({ repoPath: "/test/repo" });

    expect(result?.profileApplied).toBe(false);
  });
});

describe("formatDiscoveryResult", () => {
  const baseResult: AutoDiscoveryResult = {
    host: "gitlab.company.com",
    projectPath: "myteam/backend",
    remote: {
      host: "gitlab.company.com",
      projectPath: "myteam/backend",
      protocol: "ssh",
      url: "git@gitlab.company.com:myteam/backend.git",
      remoteName: "origin",
    },
    matchedProfile: null,
    projectConfig: null,
    apiUrl: "https://gitlab.company.com",
    profileApplied: false,
    projectConfigApplied: false,
    availableRemotes: [],
  };

  it("should format basic discovery result", () => {
    const output = formatDiscoveryResult(baseResult);

    expect(output).toContain("Auto-discovery Results");
    expect(output).toContain("Host: gitlab.company.com");
    expect(output).toContain("Project: myteam/backend");
    expect(output).toContain("Protocol: ssh");
  });

  it("should show matched profile information", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      matchedProfile: {
        profileName: "work",
        profile: {
          name: "work",
          host: "gitlab.company.com",
          authType: "pat",
          readOnly: true,
          isBuiltIn: false,
          isPreset: false,
        },
        matchType: "exact",
      },
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain("Profile: work");
    expect(output).toContain("Match Type: exact");
    expect(output).toContain("Auth: pat");
    expect(output).toContain("Mode: read-only");
  });

  it("should show no profile found message", () => {
    const output = formatDiscoveryResult(baseResult);

    expect(output).toContain("No matching profile found");
    expect(output).toContain("GITLAB_TOKEN environment variable required");
  });

  it("should show project configuration details", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      projectConfig: {
        configPath: "/test/.gitlab-mcp",
        preset: {
          description: "API restrictions",
          scope: { project: "myteam/backend" },
          read_only: true,
        },
        profile: {
          description: "Developer tools",
          extends: "senior-dev",
        },
      },
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain("Path: /test/.gitlab-mcp");
    expect(output).toContain("Preset: API restrictions");
    expect(output).toContain('Scope: project "myteam/backend"');
    expect(output).toContain("Mode: read-only");
    expect(output).toContain("Profile: Developer tools");
    expect(output).toContain("Extends: senior-dev");
  });

  it("should show namespace scope", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      projectConfig: {
        configPath: "/test/.gitlab-mcp",
        preset: {
          scope: { namespace: "myteam" },
        },
      },
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain('Scope: namespace "myteam/*"');
  });

  it("should show projects list scope", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      projectConfig: {
        configPath: "/test/.gitlab-mcp",
        preset: {
          scope: { projects: ["p1", "p2", "p3"] },
        },
      },
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain("Scope: 3 projects");
  });

  it("should show multiple remotes when available", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      availableRemotes: [
        baseResult.remote,
        {
          host: "github.com",
          projectPath: "fork/backend",
          protocol: "ssh",
          url: "git@github.com:fork/backend.git",
          remoteName: "upstream",
        },
      ],
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain("Available Remotes:");
    expect(output).toContain("origin: gitlab.company.com/myteam/backend (selected)");
    expect(output).toContain("upstream: github.com/fork/backend");
  });

  it("should show default context", () => {
    const output = formatDiscoveryResult(baseResult);

    expect(output).toContain("Default Context:");
    expect(output).toContain("Project: myteam/backend");
    expect(output).toContain("Namespace: myteam");
  });

  it("should handle nested project path for namespace", () => {
    const result: AutoDiscoveryResult = {
      ...baseResult,
      projectPath: "org/team/subteam/project",
    };

    const output = formatDiscoveryResult(result);

    expect(output).toContain("Project: org/team/subteam/project");
    expect(output).toContain("Namespace: org/team/subteam");
  });
});
