import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function exportReview(
  path: string,
  html: string,
): Promise<string> {
  const outputPath = resolve(path);
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}
