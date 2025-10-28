// TigerBeetle
import {
  createClient,
  id as generateId,
  Client,
  CreateAccountError,
  Account,
} from "tigerbeetle-node";
// Sqlite
import Database from "better-sqlite3";
// Resonate
import { Resonate, Context } from "@resonatehq/sdk";

// Initialize Resonate
const resonate = new Resonate();

// TigerBeetle client
const tbClient = createClient({
  cluster_id: 0n,
  replica_addresses: ["3000"],
});

// Sqlite client
const sqClient = new Database("./bin/accounts.db");

// Set dependencies in Resonate
resonate.setDependency("tbClient", tbClient);
resonate.setDependency("sqClient", sqClient);

// Register functions with Resonate
resonate.register("createAccount", createAccount);

export type Result =
  | { type: "created" }
  | { type: "exists_same" }
  | { type: "exists_diff" };

/**
 * Create account in SQLite (System of Reference)
 *
 * An record here is a staged record, but does not determine the account's existance
 *
 */
function sqCreateAccount(context: Context, uuid: string, guid: string): Result {
  const db = context.getDependency<Database.Database>("sqClient");

  try {
    db.prepare(
      "INSERT INTO accounts (uuid, guid, ledger, code) VALUES (?, ?, ?, ?)",
    ).run(uuid, guid, 1, 1);

    return { type: "created" };
  } catch (error: any) {
    // SQLite constraint violation (UNIQUE constraint on uuid or guid)
    if (
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      error.code === "SQLITE_CONSTRAINT" ||
      error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      error.message?.includes("UNIQUE constraint failed")
    ) {
      const existing = db
        .prepare(
          "SELECT guid, ledger, code FROM accounts WHERE uuid = ?",
        )
        .get(uuid) as
        | { guid: string; ledger: number; code: number }
        | undefined;

      if (
        existing &&
        existing.guid === guid &&
        existing.ledger === 1 &&
        existing.code === 1
      ) {
        return { type: "exists_same" };
      } else {
        return { type: "exists_diff" };
      }
    }

    throw new Error(`Failed to create account in SQLite: ${error.message}`);
  }
}

/**
 * Create account in TigerBeetle (System of Record)
 *
 * An record here is a committed record and does determines the account's existance
 *
 */
async function tbCreateAccount(
  context: Context,
  guid: string,
): Promise<Result> {
  const client = context.getDependency<Client>("tbClient");

  const account: Account = {
    id: BigInt(guid),
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: 0,
    timestamp: 0n,
  };

  // Try to create the account
  const errors = await client.createAccounts([account]);

  // Success case: account was created
  if (errors.length === 0) {
    return { type: "created" };
  }

  const error = errors[0];

  // Account exists with the same properties (idempotent)
  if (error.result === CreateAccountError.exists) {
    return { type: "exists_same" };
  }

  // Account exists with different properties
  if (
    error.result === CreateAccountError.exists_with_different_flags ||
    error.result === CreateAccountError.exists_with_different_user_data_128 ||
    error.result === CreateAccountError.exists_with_different_user_data_64 ||
    error.result === CreateAccountError.exists_with_different_user_data_32 ||
    error.result === CreateAccountError.exists_with_different_ledger ||
    error.result === CreateAccountError.exists_with_different_code
  ) {
    return { type: "exists_diff" };
  }

  // For any other error, throw
  throw new Error(`Failed to create account: ${JSON.stringify(error)}`);
}

/**
 * Create account using the dual-write pattern with Resonate's durable execution
 *
 * This generator function implements the "Write Last, Read First" principle with
 * Resonate's automatic checkpointing and reliable resumption:
 * 1. Generate internal TigerBeetle ID (guid)
 * 2. Write to SQLite first (system of reference - safe, non-committing)
 * 3. Write to TigerBeetle second (system of record - commits the account)
 *
 * Resonate guarantees:
 * - Eventual completion via language-integrated checkpointing
 * - Reliable resumption after disruptions (restarts from beginning, skips completed steps)
 * - Each operation is idempotent to handle potential retries
 *
 * Safety properties maintained:
 * - Traceability: Never allow money without corresponding account in reference DB
 * - Consistency: Eventually every account in one system has one in the other
 *
 * @throws {Error} if ordering violation detected or exists_diff scenarios occur
 */
function* createAccount(
  context: Context,
  uuid: string,
): Generator<any, { uuid: string; guid: string }, any> {
  const guid = yield* context.run(function (context: Context) {
    return generateId().toString();
  });

  // Create account in SQLite
  const sqResult = yield* context.run(sqCreateAccount, uuid, guid);

  // Panic and alert the operator if the account exists
  // but with different values
  yield* context.panic(sqResult.type == "exists_diff");

  // Create account in TigerBeetle
  const tbResult = yield* context.run(tbCreateAccount, guid);

  // Panic and alert the operator if the account exists
  // but with different values
  yield* context.panic(tbResult.type == "exists_diff");

  // Panic and alert the operator if ordering was violated
  yield* context.panic(sqResult.type == "created" &&
                       tbResult.type == "exists_same");

  return { uuid, guid };
}

async function main() {
  // Get UUID from command line arguments
  const uuid = process.argv[2];

  if (!uuid) {
    console.error("Usage: tsx create-account.ts <uuid>");
    console.error("Example: tsx create-account.ts user-123");
    process.exit(1);
  }

  try {
    const result = await resonate.run(
      `create-account-${uuid}`,
      createAccount,
      uuid,
    );

    console.log(`UUID: ${result.uuid}`);
    console.log(`GUID: ${result.guid}`);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    sqClient.close();
    tbClient.destroy();
  }
}

main().catch(console.error);
