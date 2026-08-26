const MASK_64 = (1n << 64n) - 1n;
const SEED = 20260813n;
const ORDINAL_MULTIPLIER = 104729n;
const STREAM_MULTIPLIER = 0x9e3779b97f4a7c15n;

export function mix64(value: bigint): bigint {
  let mixed = value & MASK_64;
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (mixed ^ (mixed >> 31n)) & MASK_64;
}

export function sample64(accountOrdinal: number, stream: number): bigint {
  return mix64(SEED + BigInt(accountOrdinal) * ORDINAL_MULTIPLIER + BigInt(stream) * STREAM_MULTIPLIER);
}

export function accountServerCount(accountOrdinal: number): number {
  if (accountOrdinal < 8) return 16;
  const tier = Number(sample64(accountOrdinal, 0) % 10_000n);
  const [minimum, maximum] = tier < 5_500 ? [1, 2_000]
    : tier < 8_400 ? [2_001, 7_500]
      : tier < 9_600 ? [7_501, 20_000]
        : [20_001, 50_000];
  return minimum + Number(sample64(accountOrdinal, 1) % BigInt(maximum - minimum + 1));
}

export const ids = {
  account: (account: number) => `account-${account}`,
  owner: (account: number) => `account-${account}-owner`,
  team: (account: number, team: number) => `account-${account}-team-${team}`,
  leader: (account: number, team: number) => `account-${account}-team-${team}-leader`,
  vpc: (account: number, vpc: number) => `account-${account}-vpc-${vpc}`,
  vpcAdmin: (account: number, vpc: number) => `account-${account}-vpc-${vpc}-admin`,
  server: (account: number, server: number) => `account-${account}-server-${server}`
};
