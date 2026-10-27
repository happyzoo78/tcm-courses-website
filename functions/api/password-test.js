import { hashPassword, verifyPassword } from "../_lib/password.js";

export async function onRequestGet() {
  try {
    const password = "Cloudflare-Test-Password-2026";

    const storedHash = await hashPassword(password);

    const correctPasswordAccepted =
      await verifyPassword(password, storedHash);

    const wrongPasswordRejected =
      !(await verifyPassword(
        "Definitely-Wrong-Password-2026",
        storedHash
      ));

    const allPassed =
      correctPasswordAccepted &&
      wrongPasswordRejected;

    return Response.json({
      success: allPassed,
      stage: "password-module-test",
      algorithm: "scrypt",
      correctPasswordAccepted,
      wrongPasswordRejected,
      hashPrefix: storedHash.split("$")[0],
      hashBytes: 32
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        stage: "password-module-test",
        errorName: error?.name || "UnknownError",
        message: error?.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
