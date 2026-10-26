
const ITERATIONS = 310000;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;
const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, b =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function fromHex(hex) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error("Invalid hex");
  }
  return new Uint8Array(
    hex.match(/.{2}/g).map(x => parseInt(x, 16))
  );
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
      },
      key,
      HASH_LENGTH * 8
    )
  );
}

export async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    encoder.encode(password).length > 1024
  ) {
    throw new Error("Invalid password length");
  }

  const salt = crypto.getRandomValues(
    new Uint8Array(SALT_LENGTH)
  );
  const hash = await derive(password, salt, ITERATIONS);

  return `pbkdf2_sha256$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (
    typeof password !== "string" ||
    encoder.encode(password).length > 1024 ||
    typeof stored !== "string"
  ) {
    return false;
  }

  const parts = stored.split("$");

  if (
    parts.length !== 4 ||
    parts[0] !== "pbkdf2_sha256" ||
    parts[1] !== String(ITERATIONS) ||
    !/^[0-9a-f]{32}$/i.test(parts[2]) ||
    !/^[0-9a-f]{64}$/i.test(parts[3])
  ) {
    return false;
  }

  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  const actual = await derive(password, salt, ITERATIONS);

  let difference = 0;
  for (let i = 0; i < HASH_LENGTH; i++) {
    difference |= actual[i] ^ expected[i];
  }

  return difference === 0;
}
