import test from "node:test";
import assert from "node:assert/strict";
import { getWalletBanner } from "../src/wallet.js";

test("shows the connected wallet banner when an address is available", () => {
  assert.equal(getWalletBanner(true, "0x1234567890abcdef1234567890abcdef12345678"), "Connected: 0x1234...5678");
});

test("shows disconnected state when wallet is absent", () => {
  assert.equal(getWalletBanner(false), "Wallet disconnected");
});
