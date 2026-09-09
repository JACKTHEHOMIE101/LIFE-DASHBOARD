import { randomBytes } from "node:crypto";

const secret = randomBytes(48).toString("base64url");

console.log("\nAdd this to your .env file:\n");
console.log(`AUTH_SECRET="${secret}"\n`);
console.log("Changing it later signs everyone out; it does not affect stored data.\n");
