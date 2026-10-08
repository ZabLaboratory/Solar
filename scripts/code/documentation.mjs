import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const markdownFiles = (directory) =>
  existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory()
          ? markdownFiles(path)
          : entry.name.endsWith(".md")
            ? [path]
            : [];
      })
    : [];

/** Current docs only; immutable phase evidence/ADRs do not describe the current runtime. */
export function documentationReport(root) {
  const files = [
    resolve(root, "README.md"),
    resolve(root, "CLAUDE.md"),
    ...markdownFiles(resolve(root, "docs")),
    ...markdownFiles(resolve(root, "src")),
    ...markdownFiles(resolve(root, "scripts")),
    ...markdownFiles(resolve(root, "vendor")),
  ].filter(
    (path) =>
      existsSync(path) &&
      !path.includes(`${resolve(root, "docs/adr")}/`) &&
      !path.replaceAll("\\", "/").includes("/docs/adr/"),
  );
  const scripts = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ).scripts;
  const failures = [];
  let links = 0,
    commands = 0,
    references = 0,
    toolReferences = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8"),
      label = relative(root, file).replaceAll("\\", "/");
    for (const match of text.matchAll(
      /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [path, fragment] = target.split("#");
      const destination = resolve(dirname(file), decodeURIComponent(path));
      links++;
      if (!existsSync(destination)) {
        failures.push(`${label}: broken link ${target}`);
        continue;
      }
      if (fragment && destination.endsWith(".md")) {
        const headings = [
          ...readFileSync(destination, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm),
        ].map((heading) =>
          heading[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s+/g, "-"),
        );
        if (!headings.includes(decodeURIComponent(fragment)))
          failures.push(`${label}: missing heading ${target}`);
      }
    }
    for (const match of text.matchAll(
      /\bnpm(?:\.cmd)?\s+run\s+([a-z][a-z0-9:_-]*)/g,
    )) {
      commands++;
      if (!Object.hasOwn(scripts, match[1]))
        failures.push(`${label}: missing npm command ${match[1]}`);
    }
    for (const match of text.matchAll(
      /`((?:src|scripts|docs|tests|public|vendor|evidence)\/[^`\s]+)`/g,
    )) {
      if (/[<>*${}]/.test(match[1])) continue;
      references++;
      if (!existsSync(resolve(root, match[1])))
        failures.push(`${label}: missing current path ${match[1]}`);
    }
    for (const match of text.matchAll(
      /(?<![A-Za-z0-9_<>./-])(?:Solar\/)?(scripts\/[A-Za-z0-9/_-]+\.(?:mjs|py))\b/g,
    )) {
      toolReferences++;
      if (!existsSync(resolve(root, match[1])))
        failures.push(`${label}: missing current tool ${match[1]}`);
    }
  }
  const toolFiles = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() && entry.name !== "__pycache__"
        ? toolFiles(path)
        : /\.(mjs|py)$/.test(entry.name)
          ? [path]
          : [];
    });
  const tools = toolFiles(resolve(root, "scripts"));
  for (const file of tools) {
    let directory = dirname(file),
      owner;
    while (directory.startsWith(root)) {
      if (existsSync(resolve(directory, "README.md"))) {
        owner = resolve(directory, "README.md");
        break;
      }
      if (directory === root) break;
      directory = dirname(directory);
    }
    const name = relative(dirname(file), file);
    if (!owner || !readFileSync(owner, "utf8").includes(name))
      failures.push(
        `${relative(root, file)}: tool missing from its responsibility README`,
      );
  }
  return {
    tools: tools.length,
    schema: "solar.documentation.v1",
    documents: files.length,
    localLinks: links,
    npmCommands: commands,
    pathReferences: references,
    toolReferences,
    failures,
    limits:
      "Current local Markdown links, paths, headings, named npm commands and Solar script references (including unquoted commands). Historical ADRs/evidence, explicitly other-repository commands and remote endpoints are excluded. Behavioral claims and integration boundaries require review/tests.",
  };
}
