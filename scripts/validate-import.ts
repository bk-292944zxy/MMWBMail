import { pathToFileURL } from "node:url";
import path from "node:path";

async function main() {
  const [modulePath, successLabel] = process.argv.slice(2);

  if (!modulePath) {
    console.error("Usage: validate-import <module-path> [success-label]");
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(process.cwd(), modulePath);

  await import(pathToFileURL(resolvedPath).href);

  console.log(successLabel || `${modulePath} ok`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
