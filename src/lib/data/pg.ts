import postgres from "postgres";

type Sql = postgres.Sql;
const g = globalThis as unknown as { __phocoSql?: Sql };

export function sql(): Sql {
  if (!g.__phocoSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // Supabase's transaction pooler (port 6543) hands a database connection to the next client as soon as a query
    // finishes. So: no prepared statements (prepare:false), and one query at a time per connection (max_pipeline:0).
    // With pipelining on, a page that runs many queries at once can be left waiting for an answer that never comes.
    const options = { prepare: false, max: 5, max_pipeline: 0, idle_timeout: 20, connect_timeout: 10 };
    g.__phocoSql = postgres(url, options);
  }
  return g.__phocoSql;
}

/**
 * Runs `fn` in a transaction on one reserved connection. postgres.js's own sql.begin can't be used with
 * max_pipeline:0 (it never marks its connection as reserved), so this does begin / commit / rollback itself.
 */
export async function withTx<T>(fn: (tx: postgres.ReservedSql) => Promise<T>): Promise<T> {
  const tx = await sql().reserve();
  try {
    await tx`begin`;
    const result = await fn(tx);
    await tx`commit`;
    return result;
  } catch (e) {
    await tx`rollback`.catch(() => undefined);
    throw e;
  } finally {
    tx.release();
  }
}

