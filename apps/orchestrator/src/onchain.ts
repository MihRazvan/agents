import "dotenv/config";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { type AgentManifest, type AgentRuntimeState, type Job } from "@trust-city/shared";

const require = createRequire(import.meta.url);
const { AgentRole, ChaosChainSDK, NetworkConfig, getContractAddresses } = require("@chaoschain/sdk") as typeof import("@chaoschain/sdk");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
const statePath = path.join(rootDir, "onchain_state.json");

interface OnchainState {
  operatorAgentId?: string;
  identityTxHash?: string;
  metadataTxHash?: string;
  reputationTxHashes: string[];
  validationTxHashes: string[];
}

interface OnchainCallbacks {
  onReceipt: (action: string, txHash: string, context?: Record<string, unknown>) => void;
  onInfo: (message: string, context?: Record<string, unknown>) => void;
  onError: (message: string, context?: Record<string, unknown>) => void;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function normalizePrivateKey(value: string): string {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function metadataDomain(): string {
  const uri = process.env.AGENT_METADATA_URI;
  if (!uri) {
    return "trust-city.local";
  }

  try {
    return new URL(uri).host || "trust-city.local";
  } catch {
    return "trust-city.local";
  }
}

async function loadState(): Promise<OnchainState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<OnchainState>;
    return {
      operatorAgentId: parsed.operatorAgentId,
      identityTxHash: parsed.identityTxHash,
      metadataTxHash: parsed.metadataTxHash,
      reputationTxHashes: parsed.reputationTxHashes ?? [],
      validationTxHashes: parsed.validationTxHashes ?? []
    };
  } catch {
    return {
      reputationTxHashes: [],
      validationTxHashes: []
    };
  }
}

async function saveState(state: OnchainState): Promise<void> {
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function buildMetadata(manifest: AgentManifest) {
  return {
    name: manifest.agentName,
    domain: metadataDomain(),
    role: AgentRole.ORCHESTRATOR,
    capabilities: manifest.primarySkills,
    version: "0.1.0",
    description: "Trust-gated autonomous job marketplace with plugin-agent onboarding and ERC-8004 receipts.",
    contact: manifest.operatorWallet,
    supportedTrust: ["reputation", "validation"]
  };
}

function ratingForJob(job: Job): number {
  if (job.priority === "critical") {
    return 96;
  }
  if (job.priority === "priority") {
    return 91;
  }
  return 86;
}

export class OnchainManager {
  readonly enabled: boolean;
  readonly validationEnabled: boolean;
  readonly reputationEnabled: boolean;
  private readonly callbacks: OnchainCallbacks;
  private readonly manifest: AgentManifest;
  private readonly sdk: InstanceType<typeof ChaosChainSDK> | null;
  private state: OnchainState | null = null;
  private initPromise: Promise<void> | null = null;
  private reputationWrites = new Set<string>();

  constructor(manifest: AgentManifest, callbacks: OnchainCallbacks) {
    this.manifest = manifest;
    this.callbacks = callbacks;

    const privateKey = process.env.OPERATOR_PRIVATE_KEY;
    let enabled = boolFromEnv(process.env.ENABLE_ONCHAIN_WRITES, false) && Boolean(privateKey);

    if (!enabled || !privateKey) {
      this.enabled = false;
      this.validationEnabled = false;
      this.reputationEnabled = false;
      this.sdk = null;
      return;
    }

    const normalizedPrivateKey = normalizePrivateKey(privateKey);
    const derivedWallet = new ethers.Wallet(normalizedPrivateKey).address.toLowerCase();
    const configuredWallet = manifest.operatorWallet.toLowerCase();
    if (configuredWallet !== derivedWallet) {
      callbacks.onError("OPERATOR_WALLET does not match OPERATOR_PRIVATE_KEY. Disabling onchain writes.", {
        configuredWallet: manifest.operatorWallet,
        derivedWallet
      });
      enabled = false;
    }

    this.enabled = enabled;
    this.validationEnabled = enabled && boolFromEnv(process.env.ENABLE_VALIDATION_WRITES, false);
    this.reputationEnabled = enabled && boolFromEnv(process.env.ENABLE_REPUTATION_WRITES, true);

    if (!enabled) {
      this.sdk = null;
      return;
    }

    const network = NetworkConfig.ETHEREUM_SEPOLIA;
    const defaultContracts = getContractAddresses(network);
    this.callbacks.onInfo("Configured ERC-8004 network", {
      network,
      contracts: defaultContracts,
      rpcUrl: process.env.SEPOLIA_RPC_URL ?? "sdk-default"
    });

    this.sdk = new ChaosChainSDK({
      agentName: manifest.agentName,
      agentDomain: metadataDomain(),
      agentRole: AgentRole.ORCHESTRATOR,
      network,
      privateKey: normalizedPrivateKey,
      rpcUrl: process.env.SEPOLIA_RPC_URL
    });
  }

  private async ensureState(): Promise<OnchainState> {
    if (!this.state) {
      this.state = await loadState();
    }
    return this.state;
  }

  async bootstrap(): Promise<void> {
    if (!this.enabled || !this.sdk) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.bootstrapOnce();
    }

    await this.initPromise;
  }

  private async bootstrapOnce(): Promise<void> {
    const state = await this.ensureState();
    if (state.operatorAgentId) {
      this.callbacks.onInfo("Reusing persisted ERC-8004 identity", {
        agentId: state.operatorAgentId,
        identityTxHash: state.identityTxHash,
        metadataTxHash: state.metadataTxHash
      });
      return;
    }

    const metadata = buildMetadata(this.manifest);
    const registration = await this.sdk!.registerIdentity(metadata);
    state.operatorAgentId = registration.agentId.toString();
    state.identityTxHash = registration.txHash;
    await saveState(state);

    this.callbacks.onReceipt("identity_registry_registration", registration.txHash, {
      agentId: state.operatorAgentId,
      owner: registration.owner
    });

    try {
      const metadataTxHash = await this.sdk!.updateAgentMetadata(registration.agentId, metadata);
      state.metadataTxHash = metadataTxHash;
      await saveState(state);
      this.callbacks.onReceipt("metadata_update", metadataTxHash, {
        agentId: state.operatorAgentId
      });
    } catch (error) {
      this.callbacks.onError("Identity registered, but metadata update failed", {
        error: error instanceof Error ? error.message : String(error),
        agentId: state.operatorAgentId
      });
    }
  }

  async recordJobCompletion(job: Job, actor: AgentRuntimeState): Promise<void> {
    if (!this.enabled || !this.sdk || !this.reputationEnabled) {
      return;
    }

    if (this.reputationWrites.has(job.id)) {
      return;
    }
    this.reputationWrites.add(job.id);

    try {
      await this.bootstrap();
      const state = await this.ensureState();
      if (!state.operatorAgentId) {
        throw new Error("Missing operator agentId after bootstrap");
      }

      const rating = ratingForJob(job);
      const txHash = await this.sdk.giveFeedback({
        agentId: BigInt(state.operatorAgentId),
        rating,
        feedbackUri: `${process.env.AGENT_METADATA_URI ?? "https://example.com/feedback"}#${job.id}`,
        feedbackData: {
          tag1: "job_completion",
          tag2: job.category,
          endpoint: actor.name,
          value: rating,
          content: job.outputSummary ?? job.title
        }
      });

      state.reputationTxHashes.push(txHash);
      await saveState(state);
      this.callbacks.onReceipt("reputation_registry_update", txHash, {
        agentId: state.operatorAgentId,
        jobId: job.id,
        rating
      });
    } catch (error) {
      this.callbacks.onError("Reputation write failed", {
        jobId: job.id,
        actorId: actor.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async requestValidation(job: Job): Promise<void> {
    if (!this.enabled || !this.sdk || !this.validationEnabled) {
      return;
    }

    try {
      await this.bootstrap();
      const state = await this.ensureState();
      if (!state.operatorAgentId) {
        throw new Error("Missing operator agentId after bootstrap");
      }

      const requestHash = `0x${Buffer.from(job.id).toString("hex").slice(0, 64).padEnd(64, "0")}`;
      const txHash = await this.sdk.requestValidation(
        this.manifest.operatorWallet,
        BigInt(state.operatorAgentId),
        `${process.env.AGENT_METADATA_URI ?? "https://example.com/validation"}#${job.id}`,
        requestHash
      );

      state.validationTxHashes.push(txHash);
      await saveState(state);
      this.callbacks.onReceipt("validation_registry_write", txHash, {
        agentId: state.operatorAgentId,
        jobId: job.id
      });
    } catch (error) {
      this.callbacks.onError("Validation request failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
