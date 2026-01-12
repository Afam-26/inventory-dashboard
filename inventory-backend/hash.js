import bcrypt from "bcryptjs";

const hash = await bcrypt.hash("Staff#12345", 10);
console.log(hash);
