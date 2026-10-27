import { scrypt } from "node:crypto";

const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

// 舊版 PBKDF2 參數。
// 保留驗證能力，避免未來若有舊格式密碼時失去相容性。
const LEGACY_PBKDF2_ITERATIONS = 310000;

const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function fromHex(hex) {
  if (
    typeof hex !== "string" ||
    hex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    throw new Error("Invalid hex");
  }

  return new Uint8Array(
    hex.match(/.{2}/g).map((x) => parseInt(x, 16))
  );
}

function secureEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
    return false;
  }

  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

function scryptAsync(password, salt, keyLength) {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(new Uint8Array(derivedKey));
      }
    );
  });
}

async function deriveLegacyPbkdf2(password, salt, iterations) {
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

  const hash = await scryptAsync(
    password,
    salt,
    HASH_LENGTH
  );

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    toHex(salt),
    toHex(hash)
  ].join("$");
}

export async function verifyPassword(password, stored) {
  if (
    typeof password !== "string" ||
    encoder.encode(password).length > 1024 ||
    typeof stored !== "string"
  ) {
    return false;
  }

  try {
    const parts = stored.split("$");

    // 新版 scrypt 格式：
    // scrypt$65536$8$1$<salt>$<hash>
    if (parts.length === 6 && parts[0] === "scrypt") {
      const N = Number(parts[1]);
      const r = Number(parts[2]);
      const p = Number(parts[3]);

      if (
        N !== SCRYPT_N ||
        r !== SCRYPT_R ||
        p !== SCRYPT_P
      ) {
        return false;
      }

      const salt = fromHex(parts[4]);
      const expected = fromHex(parts[5]);

      if (
        salt.length !== SALT_LENGTH ||
        expected.length !== HASH_LENGTH
      ) {
        return false;
      }

      const actual = await scryptAsync(
        password,
        salt,
        HASH_LENGTH
      );

      return secureEqual(actual, expected);
    }

    // 舊版 PBKDF2 格式：
    // pbkdf2_sha256$310000$<salt>$<hash>
    if (
      parts.length === 4 &&
      parts[0] === "pbkdf2_sha256" &&
      parts[1] === String(LEGACY_PBKDF2_ITERATIONS)
    ) {
      const salt = fromHex(parts[2]);
      const expected = fromHex(parts[3]);

      if (
        salt.length !== SALT_LENGTH ||
        expected.length !== HASH_LENGTH
      ) {
        return false;
      }

      const actual = await deriveLegacyPbkdf2(
        password,
        salt,
        LEGACY_PBKDF2_ITERATIONS
      );

      return secureEqual(actual, expected);
    }

    return false;
  } catch {
    return false;
  }
}
