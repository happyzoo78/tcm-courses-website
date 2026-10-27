import { scrypt } from "node:crypto";

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

export async function onRequestGet() {
  try {
    const password = "Cloudflare-Test-Password-2026";
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const result = await scryptAsync(
      password,
      salt,
      32,
      {
        N: 65536,
        r: 8,
        p: 1,
        maxmem: 96 * 1024 * 1024
      }
    );

    return Response.json({
      success: true,
      stage: "pages-functions-scrypt-test",
      algorithm: "scrypt",
      N: 65536,
      r: 8,
      p: 1,
      hashBytes: result.length
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        stage: "pages-functions-scrypt-test",
        errorName: error?.name || "UnknownError",
        message: error?.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
