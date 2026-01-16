import "dotenv/config"; // <-- add this line first
import { db } from "../config/db.js";
import { verifyAuditChain } from "../utils/audit.js";

const result = await verifyAuditChain(db, { limit: 5000 });
console.log(result);
process.exit(0);
