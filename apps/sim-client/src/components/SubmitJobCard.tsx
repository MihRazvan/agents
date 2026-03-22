import { memo, useMemo, useState, type FormEvent } from "react";
import { JOB_ROUTING, type JobCategory } from "@trust-city/shared";

type JobPriority = "routine" | "priority" | "critical";
type JobSource = "operator" | "github" | "api" | "agent";

const jobPresets: Record<
  JobCategory,
  {
    title: string;
    summary: string;
    priority: JobPriority;
    source: JobSource;
    requestedSkills: string[];
    requiredTools: string[];
    requiredTrust: number;
    deliverable: string;
    referenceLabel: string;
    referencePlaceholder: string;
    targetLabel: string;
    targetPlaceholder: string;
  }
> = {
  github_bugfix: {
    title: "Patch wallet connect regression",
    summary: "Investigate the wallet banner regression and produce a tested remediation patch.",
    priority: "priority",
    source: "github",
    requestedSkills: ["TypeScript", "debugging", "tests"],
    requiredTools: ["github_api", "git", "test_runner"],
    requiredTrust: 0.74,
    deliverable: "Patch artifact with test evidence",
    referenceLabel: "Issue / Repo Link",
    referencePlaceholder: "https://github.com/org/repo/issues/123",
    targetLabel: "Delivery Target",
    targetPlaceholder: "PR summary, patch bundle, or branch note"
  },
  microsite_build: {
    title: "Launch page for plugin agent",
    summary: "Create a one-page microsite that explains why a plugin agent can be trusted and what jobs it accepts.",
    priority: "priority",
    source: "operator",
    requestedSkills: ["React", "copywriting", "deployment"],
    requiredTools: ["github_api", "vite", "deploy_preview"],
    requiredTrust: 0.72,
    deliverable: "Preview deployment with summary card",
    referenceLabel: "Brand / Brief Link",
    referencePlaceholder: "https://notion.so/brief or repo URL",
    targetLabel: "Delivery Target",
    targetPlaceholder: "Preview URL, microsite handoff, landing page package"
  },
  protocol_research: {
    title: "Research ERC-8004 collaboration patterns",
    summary: "Produce a sourced brief on trust-gated agent collaboration patterns and validation workflows.",
    priority: "routine",
    source: "api",
    requestedSkills: ["analysis", "sourcing", "writing"],
    requiredTools: ["research_fetcher"],
    requiredTrust: 0.68,
    deliverable: "Research brief with source digest",
    referenceLabel: "Topic / Source Link",
    referencePlaceholder: "Protocol docs, article, or research topic URL",
    targetLabel: "Report Destination",
    targetPlaceholder: "Who should receive the brief or where it should be published"
  },
  move_contract: {
    title: "Review Move vault module",
    summary: "Validate a partner agent's Move vault module, identify issues, and package a delivery receipt.",
    priority: "critical",
    source: "agent",
    requestedSkills: ["Move", "auditing", "tests"],
    requiredTools: ["move_cli", "test_runner", "github_api"],
    requiredTrust: 0.82,
    deliverable: "Validated Move report with attestation",
    referenceLabel: "Module / Repo Link",
    referencePlaceholder: "GitHub repo, gist, or artifact URL",
    targetLabel: "Delivery Target",
    targetPlaceholder: "Audit packet recipient or attestation destination"
  },
  contract_audit: {
    title: "Audit plugin payout contract",
    summary: "Review a lightweight payout contract used for agent settlements and produce a verification verdict.",
    priority: "priority",
    source: "operator",
    requestedSkills: ["solidity", "security", "evidence"],
    requiredTools: ["security_scanner", "test_runner"],
    requiredTrust: 0.8,
    deliverable: "Audit summary and verification receipt",
    referenceLabel: "Contract / Repo Link",
    referencePlaceholder: "Etherscan, GitHub, or spec URL",
    targetLabel: "Delivery Target",
    targetPlaceholder: "Audit recipient or report destination"
  }
};

function presetFor(category: JobCategory) {
  return jobPresets[category];
}

function SubmitJobCard({ httpBase }: { httpBase: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<JobCategory>("github_bugfix");
  const [title, setTitle] = useState(jobPresets.github_bugfix.title);
  const [summary, setSummary] = useState(jobPresets.github_bugfix.summary);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [deliveryTarget, setDeliveryTarget] = useState("");
  const [submitState, setSubmitState] = useState<{ status: "idle" | "submitting" | "success" | "error"; message?: string }>({
    status: "idle"
  });

  const categoryOptions = useMemo(
    () => Object.entries(JOB_ROUTING) as Array<[JobCategory, (typeof JOB_ROUTING)[JobCategory]]>,
    []
  );

  const preset = presetFor(category);

  function applyCategory(nextCategory: JobCategory): void {
    const nextPreset = presetFor(nextCategory);
    setCategory(nextCategory);
    setTitle(nextPreset.title);
    setSummary(nextPreset.summary);
    setReferenceUrl("");
    setDeliveryTarget("");
    setSubmitState({ status: "idle" });
  }

  async function submitJob(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch(`${httpBase}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          category,
          source: preset.source,
          submitter: "Operator Console",
          referenceUrl,
          deliveryTarget,
          requestedSkills: preset.requestedSkills,
          requiredTools: preset.requiredTools,
          requiredTrust: preset.requiredTrust,
          deliverable: preset.deliverable
        })
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string; job?: { title?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Job submission failed");
      }

      setSubmitState({
        status: "success",
        message: `${payload.job?.title ?? title} is now in the city.`
      });
    } catch (error) {
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Job submission failed"
      });
    }
  }

  return (
    <section className="card submit-card">
      <div className="section-head">
        <h2>Submit Job</h2>
        <button type="button" className="section-toggle" onClick={() => setOpen((current) => !current)}>
          {open ? "Hide" : "Open"}
        </button>
      </div>
      {!open ? <p className="section-note">Inject a live task into the city when you need it.</p> : null}
      {open ? <form className="job-form" onSubmit={submitJob}>
        <label className="job-form-field">
          <span>Category</span>
          <select value={category} onChange={(event) => applyCategory(event.target.value as JobCategory)}>
            {categoryOptions.map(([entry, config]) => (
              <option key={entry} value={entry}>
                {config.label}
              </option>
            ))}
          </select>
        </label>

        <label className="job-form-field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={preset.title} />
        </label>

        <label className="job-form-field">
          <span>Summary</span>
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} />
        </label>

        <label className="job-form-field">
          <span>{preset.referenceLabel}</span>
          <input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder={preset.referencePlaceholder} />
        </label>

        <label className="job-form-field">
          <span>{preset.targetLabel}</span>
          <input value={deliveryTarget} onChange={(event) => setDeliveryTarget(event.target.value)} placeholder={preset.targetPlaceholder} />
        </label>

        <div className="job-form-hint">
          {category === "github_bugfix" && "Attach the GitHub issue or repo link here. The city will fetch the issue if GitHub env vars are configured, then produce a patch and test bundle."}
          {category === "contract_audit" && "Point to the contract, repo, or spec you want audited. The result is an audit summary and verification bundle."}
          {category === "protocol_research" && "Point to the topic or source. The research output becomes an artifact bundle and final brief for the destination you specify."}
          {category === "move_contract" && "Point to the Move module or repository. The city will validate it and package an attestation-style output."}
          {category === "microsite_build" && "Point to a brief or brand reference. The city will produce a build/deploy style delivery package."}
        </div>

        <div className="job-form-actions">
          <button type="submit" className="job-submit-button" disabled={submitState.status === "submitting"}>
            {submitState.status === "submitting" ? "Submitting..." : "Send Into City"}
          </button>
        </div>

        {submitState.message ? <p className={`job-form-status job-form-status-${submitState.status}`}>{submitState.message}</p> : null}
      </form> : null}
    </section>
  );
}

export default memo(SubmitJobCard);
