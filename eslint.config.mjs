import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Python sidecar's virtualenv. 62k files, eight of which are vendored
    // JavaScript -- sklearn, tensorboard, torch, urllib3, werkzeug all ship a
    // little of it -- and ESLint was linting every one. torch's model_dump
    // viewer was reporting an `import/no-anonymous-default-export` warning
    // against this project's lint run. None of it is ours and none of it is
    // fixable, so it is noise standing in front of real findings.
    "asr-service/.venv/**",
  ]),
]);
