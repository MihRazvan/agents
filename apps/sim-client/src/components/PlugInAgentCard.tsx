import { memo, useMemo, useState, type FormEvent } from "react";
import { JOB_ROUTING, type JobCategory } from "@trust-city/shared";

const toolOptions = [
  "github_api",
  "git",
  "test_runner",
  "deploy_preview",
  "research_fetcher",
  "move_cli",
  "security_scanner",
  "registry_reader",
  "vite"
] as const;

const agentPresets = {
  github_fixer: {
    name: "Patch Pilot",
    summary: "GitHub-oriented agent for repo fixes and regression cleanup.",
    specialty: "Repo debugging and patch generation",
    categories: ["github_bugfix"] as JobCategory[],
    skills: "TypeScript, debugging, tests",
    techStacks: "TypeScript, React, Node.js",
    tools: ["github_api", "git", "test_runner"] as string[]
  },
  move_auditor: {
    name: "Move Sentinel",
    summary: "Move specialist focused on audits and validation flows.",
    specialty: "Move smart contracts and protocol validation",
    categories: ["move_contract", "contract_audit"] as JobCategory[],
    skills: "Move, auditing, formal review",
    techStacks: "Move, Aptos, TypeScript",
    tools: ["move_cli", "test_runner", "github_api", "security_scanner"] as string[]
  },
  research_analyst: {
    name: "Signal Library",
    summary: "Research-focused agent for protocol analysis and sourced brief generation.",
    specialty: "Protocol research and evidence gathering",
    categories: ["protocol_research"] as JobCategory[],
    skills: "analysis, sourcing, writing",
    techStacks: "Markdown, TypeScript",
    tools: ["research_fetcher", "registry_reader"] as string[]
  }
} as const;

type PresetKey = keyof typeof agentPresets;

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function PlugInAgentCard({ httpBase, onClose }: { httpBase: string; onClose?: () => void }) {
  const [presetKey, setPresetKey] = useState<PresetKey>("github_fixer");
  const [agentName, setAgentName] = useState<string>(agentPresets.github_fixer.name);
  const [summary, setSummary] = useState<string>(agentPresets.github_fixer.summary);
  const [specialty, setSpecialty] = useState<string>(agentPresets.github_fixer.specialty);
  const [operatorWallet, setOperatorWallet] = useState("");
  const [erc8004Identity, setErc8004Identity] = useState("");
  const [skills, setSkills] = useState<string>(agentPresets.github_fixer.skills);
  const [techStacks, setTechStacks] = useState<string>(agentPresets.github_fixer.techStacks);
  const [categories, setCategories] = useState<JobCategory[]>(agentPresets.github_fixer.categories);
  const [tools, setTools] = useState<string[]>([...agentPresets.github_fixer.tools]);
  const [submitState, setSubmitState] = useState<{ status: "idle" | "submitting" | "success" | "error"; message?: string }>({
    status: "idle"
  });

  const categoryOptions = useMemo(
    () => Object.entries(JOB_ROUTING) as Array<[JobCategory, (typeof JOB_ROUTING)[JobCategory]]>,
    []
  );

  function applyPreset(nextPresetKey: PresetKey): void {
    const preset = agentPresets[nextPresetKey];
    setPresetKey(nextPresetKey);
    setAgentName(preset.name);
    setSummary(preset.summary);
    setSpecialty(preset.specialty);
    setSkills(preset.skills);
    setTechStacks(preset.techStacks);
    setCategories(preset.categories);
    setTools([...preset.tools]);
    setSubmitState({ status: "idle" });
  }

  function toggleCategory(category: JobCategory): void {
    setCategories((current) => (current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category]));
  }

  function toggleTool(tool: string): void {
    setTools((current) => (current.includes(tool) ? current.filter((entry) => entry !== tool) : [...current, tool]));
  }

  async function submitPlugin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch(`${httpBase}/plugins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: agentName,
          summary,
          specialty,
          manifest: {
            agentName,
            operatorWallet,
            erc8004Identity,
            supportedTools: tools,
            supportedTechStacks: splitList(techStacks),
            computeConstraints: {
              maxToolCalls: 90,
              maxRuntimeSeconds: 600,
              retryLimit: 2
            },
            supportedTaskCategories: categories,
            primarySkills: splitList(skills),
            executionMode: "plugin_adapter"
          }
        })
      });

      const payload = (await response.json()) as { ok?: boolean; error?: string; plugin?: { label?: string; status?: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Plugin submission failed");
      }

      setSubmitState({
        status: "success",
        message: `${payload.plugin?.label ?? agentName} was submitted and is now ${payload.plugin?.status ?? "pending"}.`
      });
      onClose?.();
    } catch (error) {
      setSubmitState({
        status: "error",
        message: error instanceof Error ? error.message : "Plugin submission failed"
      });
    }
  }

  return (
    <section className="modal-form-card">
      <div className="section-head">
        <h2>Plug In Your Agent</h2>
        {onClose ? (
          <button type="button" className="section-toggle" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <p className="section-note">Register a specialist agent so the city can route jobs to it.</p>
      <form className="job-form" onSubmit={submitPlugin}>
          <label className="job-form-field">
            <span>Preset</span>
            <select value={presetKey} onChange={(event) => applyPreset(event.target.value as PresetKey)}>
              <option value="github_fixer">GitHub Fixer</option>
              <option value="move_auditor">Move Auditor</option>
              <option value="research_analyst">Research Analyst</option>
            </select>
          </label>

          <label className="job-form-field">
            <span>Agent Name</span>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Patch Pilot" />
          </label>

          <label className="job-form-field">
            <span>Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} />
          </label>

          <label className="job-form-field">
            <span>Specialty</span>
            <input value={specialty} onChange={(event) => setSpecialty(event.target.value)} placeholder="Repo debugging and patch generation" />
          </label>

          <label className="job-form-field">
            <span>Operator Wallet</span>
            <input value={operatorWallet} onChange={(event) => setOperatorWallet(event.target.value)} placeholder="0x..." />
          </label>

          <label className="job-form-field">
            <span>ERC-8004 Identity</span>
            <input value={erc8004Identity} onChange={(event) => setErc8004Identity(event.target.value)} placeholder="agent:erc8004:patch-pilot" />
          </label>

          <label className="job-form-field">
            <span>Primary Skills</span>
            <input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="TypeScript, debugging, tests" />
          </label>

          <label className="job-form-field">
            <span>Tech Stacks</span>
            <input value={techStacks} onChange={(event) => setTechStacks(event.target.value)} placeholder="TypeScript, React, Node.js" />
          </label>

          <div className="job-form-field">
            <span>Task Categories</span>
            <div className="checkbox-grid">
              {categoryOptions.map(([category, config]) => (
                <label key={category} className="checkbox-pill">
                  <input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} />
                  <span>{config.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="job-form-field">
            <span>Tools</span>
            <div className="checkbox-grid">
              {toolOptions.map((tool) => (
                <label key={tool} className="checkbox-pill">
                  <input type="checkbox" checked={tools.includes(tool)} onChange={() => toggleTool(tool)} />
                  <span>{tool}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="job-form-hint">
            Plugged-in agents become marketplace participants. Right now the city admits them through the manifest and trust gate, then routes eligible jobs to them.
          </div>

          <div className="job-form-actions">
            <button type="submit" className="job-submit-button" disabled={submitState.status === "submitting"}>
              {submitState.status === "submitting" ? "Submitting..." : "Plug Agent Into City"}
            </button>
          </div>

          {submitState.message ? <p className={`job-form-status job-form-status-${submitState.status}`}>{submitState.message}</p> : null}
        </form>
    </section>
  );
}

export default memo(PlugInAgentCard);
