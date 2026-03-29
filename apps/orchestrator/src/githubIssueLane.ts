import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

type StageKey = "plan" | "execute" | "verify" | "submit";

interface JobLike {
  id: string;
  title: string;
  summary: string;
  submitter: string;
  referenceUrl?: string;
  requestedSkills: string[];
  requiredTools: string[];
  deliverable: string;
  retries: number;
}

interface GithubIssueLaneState {
  artifactDir: string;
  workspaceDir: string;
  issueFile: string;
  planFile: string;
  patchFile: string;
  testFile: string;
  deliveryFile: string;
  prDraftFile: string;
  issueTitle: string;
  issueNumber?: number;
  issueUrl?: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
  prBranchName?: string;
  prTitle?: string;
  source: "github_api" | "synthetic_queue";
}

interface Logger {
  (message: string, context?: Record<string, unknown>): void;
}

const states = new Map<string, GithubIssueLaneState>();

function repoRootFrom(rootDir: string): string {
  return rootDir;
}

function fixtureDir(rootDir: string): string {
  return path.join(repoRootFrom(rootDir), "fixtures", "github-issue-lab");
}

function artifactsRoot(rootDir: string): string {
  return path.join(repoRootFrom(rootDir), "artifacts", "github-lane");
}

function ensureArtifactState(rootDir: string, job: JobLike): GithubIssueLaneState {
  const existing = states.get(job.id);
  if (existing) {
    return existing;
  }

  const artifactDir = path.join(artifactsRoot(rootDir), job.id);
  const workspaceDir = path.join(artifactDir, "workspace");
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });
  cpSync(fixtureDir(rootDir), workspaceDir, { recursive: true });

  const state: GithubIssueLaneState = {
    artifactDir,
    workspaceDir,
    issueFile: path.join(artifactDir, "issue.json"),
    planFile: path.join(artifactDir, "plan.md"),
    patchFile: path.join(artifactDir, "patch.diff"),
    testFile: path.join(artifactDir, "test-output.txt"),
    deliveryFile: path.join(artifactDir, "delivery.md"),
    prDraftFile: path.join(artifactDir, "pr-draft.md"),
    issueTitle: job.title,
    source: "synthetic_queue"
  };
  states.set(job.id, state);
  return state;
}

function resetWorkspace(state: GithubIssueLaneState, rootDir: string): void {
  rmSync(state.workspaceDir, { recursive: true, force: true });
  cpSync(fixtureDir(rootDir), state.workspaceDir, { recursive: true });
}

function parseGithubIssueReference(referenceUrl?: string): { owner: string; repo: string; issueNumber: string; issueUrl: string } | null {
  if (!referenceUrl) {
    return null;
  }

  try {
    const url = new URL(referenceUrl);
    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "issues") {
      return null;
    }

    const [owner, repo, , issueNumber] = parts;
    if (!owner || !repo || !issueNumber || !/^\d+$/.test(issueNumber)) {
      return null;
    }

    return {
      owner,
      repo,
      issueNumber,
      issueUrl: `https://github.com/${owner}/${repo}/issues/${issueNumber}`
    };
  } catch {
    return null;
  }
}

function githubApiHeaders(): string[] {
  const headerArgs = ["-H", "Accept: application/vnd.github+json", "-H", "User-Agent: trust-city-exchange"];
  if (process.env.GITHUB_TOKEN) {
    headerArgs.push("-H", `Authorization: Bearer ${process.env.GITHUB_TOKEN}`);
  }
  return headerArgs;
}

function fetchGithubJson(endpoint: string): Record<string, unknown> {
  const response = execFileSync("curl", ["-sSL", ...githubApiHeaders(), endpoint], { encoding: "utf8" });
  return JSON.parse(response) as Record<string, unknown>;
}

function sanitizeBranchSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function branchNameForIssue(issueNumber: number | undefined, issueTitle: string): string {
  const suffix = sanitizeBranchSegment(issueTitle) || "issue-fix";
  return `trust-city/issue-${issueNumber ?? "local"}-${suffix}`;
}

function fetchLiveIssue(job: JobLike): {
  payload: Record<string, unknown>;
  source: GithubIssueLaneState["source"];
  issueTitle: string;
  issueNumber?: number;
  issueUrl?: string;
  repoOwner?: string;
  repoName?: string;
  repoDefaultBranch?: string;
} {
  const parsedReference = parseGithubIssueReference(job.referenceUrl);
  const owner = parsedReference?.owner ?? process.env.GITHUB_OWNER;
  const repo = parsedReference?.repo ?? process.env.GITHUB_REPO;
  const issueNumber = parsedReference?.issueNumber ?? process.env.GITHUB_ISSUE_NUMBER;

  if (!owner || !repo || !issueNumber) {
    return {
      payload: {
        title: job.title,
        body: job.summary,
        submitter: job.submitter,
        referenceUrl: job.referenceUrl,
        labels: ["demo", "wallet-connect"],
        requestedSkills: job.requestedSkills,
        requiredTools: job.requiredTools
      },
      source: "synthetic_queue",
      issueTitle: job.title
    };
  }

  const issueEndpoint = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const repoEndpoint = `https://api.github.com/repos/${owner}/${repo}`;
  const payload = fetchGithubJson(issueEndpoint);
  const repoPayload = fetchGithubJson(repoEndpoint);
  return {
    payload: {
      ...payload,
      _trustCity: {
        repo: {
          owner,
          name: repo,
          defaultBranch: String(repoPayload.default_branch ?? "main"),
          htmlUrl: String(repoPayload.html_url ?? `https://github.com/${owner}/${repo}`)
        }
      }
    },
    source: "github_api",
    issueTitle: String(payload.title ?? job.title),
    issueNumber: Number(issueNumber),
    issueUrl: String(payload.html_url ?? parsedReference?.issueUrl ?? ""),
    repoOwner: owner,
    repoName: repo,
    repoDefaultBranch: String(repoPayload.default_branch ?? "main")
  };
}

function planMarkdown(job: JobLike, issueTitle: string, issueUrl?: string, repoOwner?: string, repoName?: string, defaultBranch?: string): string {
  return `# Planner Output

- Job: ${job.title}
- Source issue: ${issueTitle}${issueUrl ? ` (${issueUrl})` : ""}
- Repo target: ${repoOwner && repoName ? `${repoOwner}/${repoName}` : "sandbox issue lab"}${defaultBranch ? ` on ${defaultBranch}` : ""}
- Goal: produce a tested remediation patch and publish the artifact bundle

## Plan

1. Fetch the issue payload and preserve it as evidence
2. Inspect the referenced GitHub issue context and map it onto the sandbox target
3. Apply the minimal patch that restores the expected connected state
4. Run the test suite in the sandbox workspace
5. Package the patch, test output, delivery summary, and PR draft for publishing

## Guardrails

- Only patch files inside the copied sandbox workspace
- Abort if the expected buggy pattern is not present
- Abort if tests fail after the patch
`;
}

function shouldForceRecovery(job: JobLike): boolean {
  return (
    job.submitter === "Demo Console" ||
    /wallet connect regression/i.test(job.title) ||
    /example\/repo\/issues\/184/i.test(job.referenceUrl ?? "")
  );
}

function applyWalletFix(workspaceDir: string, mode: "partial" | "correct"): void {
  const walletFile = path.join(workspaceDir, "src", "wallet.js");
  const current = readFileSync(walletFile, "utf8");
  const replacement =
    mode === "partial"
      ? "  return `Connected: ${address}`;\n}"
      : "  return `Connected: ${address.slice(0, 6)}...${address.slice(-4)}`;\n}";
  const next = current.replace('  return "Wallet disconnected";\n}', replacement);

  if (current === next) {
    throw new Error("Known wallet regression pattern not found in sandbox source");
  }

  writeFileSync(walletFile, next);
}

function buildPatchDiff(state: GithubIssueLaneState, rootDir: string): string {
  const baselineFile = path.join(fixtureDir(rootDir), "src", "wallet.js");
  const patchedFile = path.join(state.workspaceDir, "src", "wallet.js");
  const diff = spawnSync("git", ["diff", "--no-index", "--", baselineFile, patchedFile], {
    encoding: "utf8"
  });

  const content = diff.stdout || diff.stderr || "";
  writeFileSync(state.patchFile, content);
  return content;
}

function runTests(state: GithubIssueLaneState): { ok: boolean; output: string } {
  const result = spawnSync("npm", ["test"], {
    cwd: state.workspaceDir,
    encoding: "utf8",
    env: process.env
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  writeFileSync(state.testFile, output);
  return { ok: result.status === 0, output };
}

function writePrDraft(state: GithubIssueLaneState, job: JobLike): void {
  const title = state.prTitle ?? `fix: resolve ${state.issueTitle.toLowerCase()}`;
  const branchName = state.prBranchName ?? branchNameForIssue(state.issueNumber, state.issueTitle);
  const body = `# Summary

- closes ${state.issueUrl ?? "local issue"}
- applies the Trust City GitHub lane patch in the sandbox workspace
- includes test evidence from \`test-output.txt\`

# Deliverables

- Patch: \`patch.diff\`
- Test output: \`test-output.txt\`
- Planner notes: \`plan.md\`
- Issue evidence: \`issue.json\`

# Proposed branch

\`${branchName}\`

# Notes

This draft is PR-ready copy generated for ${job.submitter}.`;

  writeFileSync(state.prDraftFile, `# PR Draft\n\n- Title: ${title}\n- Branch: ${branchName}\n\n${body}\n`);
}

function writeDelivery(state: GithubIssueLaneState, job: JobLike): void {
  const delivery = `# Delivery Bundle

- Job: ${job.title}
- Issue source: ${state.source}
- Issue title: ${state.issueTitle}
- Issue URL: ${state.issueUrl ?? job.referenceUrl ?? "not provided"}
- Repo: ${state.repoOwner && state.repoName ? `${state.repoOwner}/${state.repoName}` : "sandbox issue lab"}
- Base branch: ${state.repoDefaultBranch ?? "main"}
- Proposed branch: ${state.prBranchName ?? branchNameForIssue(state.issueNumber, state.issueTitle)}
- Deliverable: ${job.deliverable}

## Included artifacts

- issue.json
- plan.md
- patch.diff
- test-output.txt
- pr-draft.md

## Result

Patch prepared, tests executed, and PR-ready delivery copied for publisher handoff.
`;

  writeFileSync(state.deliveryFile, delivery);
}

export function runGithubIssueStage(
  rootDir: string,
  stage: StageKey,
  job: JobLike,
  logger: Logger
): {
  artifactDir: string;
  issueUrl?: string;
  issueSource: GithubIssueLaneState["source"];
  issueTitle: string;
  testPassed?: boolean;
  repoSlug?: string;
  prBranchName?: string;
  prDraftFile?: string;
  recoveryMode?: "partial" | "correct";
} {
  const state = ensureArtifactState(rootDir, job);

  if (stage === "plan") {
    const liveIssue = fetchLiveIssue(job);
    state.issueTitle = liveIssue.issueTitle;
    state.issueNumber = liveIssue.issueNumber;
    state.issueUrl = liveIssue.issueUrl;
    state.source = liveIssue.source;
    state.repoOwner = liveIssue.repoOwner;
    state.repoName = liveIssue.repoName;
    state.repoDefaultBranch = liveIssue.repoDefaultBranch;
    state.prBranchName = branchNameForIssue(liveIssue.issueNumber, liveIssue.issueTitle);
    state.prTitle = `fix: resolve ${liveIssue.issueTitle.toLowerCase()}`;

    writeFileSync(state.issueFile, JSON.stringify(liveIssue.payload, null, 2));
    writeFileSync(state.planFile, planMarkdown(job, liveIssue.issueTitle, liveIssue.issueUrl, state.repoOwner, state.repoName, state.repoDefaultBranch));
    logger("Planner captured issue payload and wrote execution plan", {
      artifactDir: state.artifactDir,
      issueSource: state.source,
      issueUrl: state.issueUrl,
      repoSlug: state.repoOwner && state.repoName ? `${state.repoOwner}/${state.repoName}` : undefined,
      proposedBranch: state.prBranchName
    });
    return {
      artifactDir: state.artifactDir,
      issueUrl: state.issueUrl,
      issueSource: state.source,
      issueTitle: state.issueTitle,
      repoSlug: state.repoOwner && state.repoName ? `${state.repoOwner}/${state.repoName}` : undefined,
      prBranchName: state.prBranchName,
      prDraftFile: state.prDraftFile
    };
  }

  if (stage === "execute") {
    if (!existsSync(state.planFile)) {
      throw new Error("Plan artifact missing before execute stage");
    }
    resetWorkspace(state, rootDir);
    const recoveryMode = shouldForceRecovery(job) && job.retries === 0 ? "partial" : "correct";
    applyWalletFix(state.workspaceDir, recoveryMode);
    buildPatchDiff(state, rootDir);
    logger("Builder patched sandbox workspace and produced git diff", {
      artifactDir: state.artifactDir,
      patchFile: state.patchFile,
      recoveryMode
    });
    return {
      artifactDir: state.artifactDir,
      issueUrl: state.issueUrl,
      issueSource: state.source,
      issueTitle: state.issueTitle,
      repoSlug: state.repoOwner && state.repoName ? `${state.repoOwner}/${state.repoName}` : undefined,
      prBranchName: state.prBranchName,
      prDraftFile: state.prDraftFile,
      recoveryMode
    };
  }

  if (stage === "verify") {
    const result = runTests(state);
    logger(result.ok ? "Verifier ran sandbox tests successfully" : "Verifier detected test failures", {
      artifactDir: state.artifactDir,
      testFile: state.testFile
    });
    return {
      artifactDir: state.artifactDir,
      issueUrl: state.issueUrl,
      issueSource: state.source,
      issueTitle: state.issueTitle,
      testPassed: result.ok
    };
  }

  writePrDraft(state, job);
  writeDelivery(state, job);
  logger("Publisher wrote delivery bundle for GitHub issue lane", {
    artifactDir: state.artifactDir,
    deliveryFile: state.deliveryFile,
    prDraftFile: state.prDraftFile,
    proposedBranch: state.prBranchName
  });
  return {
    artifactDir: state.artifactDir,
    issueUrl: state.issueUrl,
    issueSource: state.source,
    issueTitle: state.issueTitle,
    repoSlug: state.repoOwner && state.repoName ? `${state.repoOwner}/${state.repoName}` : undefined,
    prBranchName: state.prBranchName,
    prDraftFile: state.prDraftFile
  };
}
