import { BrowserProvider } from "ethers";

export async function connectWallet(): Promise<string> {
  const eth = (globalThis as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const provider = new BrowserProvider(eth);
  const accounts = await provider.send("eth_requestAccounts", []);
  if (!accounts?.length) throw new Error("No accounts");
  return accounts[0];
}