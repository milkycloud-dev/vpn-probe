import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vaultPath = join(root, "config", "secrets.vault");
const plainPath = join(root, "config", "secrets.plain.json");

function deriveKey(password, salt) {
  return scryptSync(password, salt, 32);
}

function seal(data, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  writeFileSync(vaultPath, JSON.stringify({
    v: 1,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  }));
}

function open(password) {
  const vault = JSON.parse(readFileSync(vaultPath, "utf8"));
  const key = deriveKey(password, Buffer.from(vault.salt, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(vault.iv, "base64"));
  decipher.setAuthTag(Buffer.from(vault.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(vault.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

const cmd = process.argv[2];
const password = process.env.PACK_KEY ?? process.argv[3];

if (cmd === "seal") {
  if (!password) throw new Error("PACK_KEY required");
  if (!existsSync(plainPath)) throw new Error("missing plain file");
  seal(JSON.parse(readFileSync(plainPath, "utf8")), password);
} else if (cmd === "open") {
  if (!password) throw new Error("PACK_KEY required");
  const data = open(password);
  if (process.env.GITHUB_OUTPUT) {
    for (const [k, v] of Object.entries(data)) appendFileSync(process.env.GITHUB_OUTPUT, `${k.toUpperCase()}=${v}\n`);
  } else {
    process.stdout.write(JSON.stringify(data));
  }
} else {
  process.exit(1);
}
