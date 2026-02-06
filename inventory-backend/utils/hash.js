import bcrypt from "bcryptjs";

const password = "Macanthony26";
const hash = await bcrypt.hash(password, 10);

console.log(hash);

