import { closePool, query } from "../server/db.js";
import { hashPassword } from "../server/passwords.js";

const adminEmail = String(process.env.E2E_ADMIN_EMAIL || "e2e.admin@belovediamond.test").trim().toLowerCase();
const vendorEmail = String(process.env.E2E_VENDOR_EMAIL || "e2e.vendor@belovediamond.test").trim().toLowerCase();
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const vendorPassword = process.env.E2E_VENDOR_PASSWORD;

if (!adminPassword || adminPassword.length < 12 || !vendorPassword || vendorPassword.length < 12) {
  throw new Error("E2E_ADMIN_PASSWORD and E2E_VENDOR_PASSWORD must each be at least 12 characters");
}

try {
  await query(`
    insert into admin_users (email, name, password_hash, role, active)
    values ($1,$2,$3,'full',true)
    on conflict (email) do update set
      name=excluded.name,
      password_hash=excluded.password_hash,
      role='full',
      active=true
  `, [adminEmail, "E2E Operations", hashPassword(adminPassword)]);

  const vendor = await query(`
    update suppliers
    set password_hash=$2, status='active', updated_at=now()
    where email=$1
    returning supplier_code
  `, [vendorEmail, hashPassword(vendorPassword)]);
  if (!vendor.rows[0]) throw new Error(`E2E vendor does not exist: ${vendorEmail}`);

  console.log(JSON.stringify({
    ok: true,
    adminEmail,
    vendorEmail,
    vendorCode: vendor.rows[0].supplier_code,
  }));
} finally {
  await closePool();
}
