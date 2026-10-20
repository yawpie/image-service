import { Client } from "pg";

export const validateAdminId = async (adminId?: string) => {
  if (!adminId) throw new Error("Admin ID is required");
  const connectionString = process.env.ADMIN_DATABASE_URL;
  if (!connectionString?.trim()) throw new Error("ADMIN_DATABASE_URL is required");
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000 });
  try {
    await client.connect();
    const result = await client.query("SELECT admin_id FROM admin WHERE admin_id = $1 AND is_active = true", [adminId]);
    return result.rows.length > 0;
  } finally {
    await client.end();
  }
};
