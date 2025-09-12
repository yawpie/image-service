import { Pool } from "pg";
import uuid from "uuid";

export const validateAdminId = async (adminId?: string) => {
  if (!adminId) throw new Error("Admin ID is required");
  const pool = new Pool({
    connectionString: process.env.ADMIN_DATABASE_URL,
  });

  const client = await pool.connect();
  try {
    // const adminIdUuid = uuid.parse(adminId);
    const res = await client.query(
      "SELECT admin_id FROM admin WHERE admin_id = $1",
      [adminId]
    );
    return res.rows.length > 0;
  } catch (error) {
    console.error("Database query error:", error);
    throw new Error("Database query error");
  } finally {
    client.release();
  }
};