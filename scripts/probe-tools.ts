import { accountLiquidity } from "../lib/onchain";
import { WATCHED_ACCOUNT } from "../lib/tasks";

/** What the agent actually sees when it asks about the watched account. */
(async () => {
  const got = await accountLiquidity(WATCHED_ACCOUNT);
  console.log(JSON.stringify(got, null, 2));
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
