import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const portable = (path) => path.replaceAll("\\", "/");
const walk = (directory) =>
  (existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
    : []
  ).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? walk(path)
      : entry.name.endsWith(".ts")
        ? [path]
        : [];
  });

/** Derive source, public ABI, worker edges and consumers; tests never retain product code. */
export function sourceGraph(root) {
  const files = walk(resolve(root, "src"));
  const names = new Set(files);
  const relativeName = (file) => portable(relative(root, file));
  const roots = ["src/index.ts", "src/server/index.ts"];
  const problems = [];
  for (const html of ["index.html", "host.html"]) {
    const contents = readFileSync(resolve(root, html), "utf8");
    for (const match of contents.matchAll(
      /<script[^>]*\bsrc=["']\/?(src\/[^"']+)["']/g,
    ))
      roots.push(match[1]);
  }
  const program = ts.createProgram(files, {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const underlying = (symbol) =>
    symbol?.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const references = new Map();
  const exports = new Map();
  const records = new Map();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const module = checker.getSymbolAtLocation(source);
    const imports = [],
      dependencies = [],
      workers = [],
      declarations = [];
    for (const exported of module ? checker.getExportsOfModule(module) : []) {
      const symbol = underlying(exported);
      if (symbol?.declarations?.some((node) => node.getSourceFile() === source))
        exports.set(symbol, { file: relativeName(file), name: exported.name });
    }
    function dependency(specifier, worker = false) {
      if (!specifier.startsWith(".")) {
        imports.push(specifier);
        return;
      }
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, resolve(base, "index.ts")].find(
        (candidate) => names.has(candidate),
      );
      if (target) {
        dependencies.push(relativeName(target));
        if (worker) workers.push(relativeName(target));
      } else if (
        !existsSync(base) &&
        !existsSync(`${base}.ts`) &&
        !existsSync(resolve(base, "index.ts"))
      )
        problems.push(
          `${relativeName(file)}: unresolved local dependency ${specifier}`,
        );
    }
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependency(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependency(node.arguments[0].text);
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === "URL" &&
        ts.isStringLiteral(node.arguments?.[0]) &&
        node.arguments[0].text.endsWith(".ts")
      )
        dependency(node.arguments[0].text, true);
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)) &&
        node.name
      )
        declarations.push(node.name.text);
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const declaration =
          parent.name === node &&
          ts.isDeclaration(parent) &&
          !ts.isExportSpecifier(parent);
        if (
          !declaration &&
          !ts.isImportSpecifier(parent) &&
          !ts.isImportClause(parent)
        ) {
          const symbol = underlying(checker.getSymbolAtLocation(node));
          if (symbol) {
            const uses = references.get(symbol) ?? new Set();
            uses.add(relativeName(file));
            references.set(symbol, uses);
          }
        }
      }
      if (
        ts.isMethodDeclaration(node) &&
        node.name &&
        ts.isClassDeclaration(node.parent) &&
        node.parent.name
      )
        declarations.push(
          `${node.parent.name.text}.${node.name.getText(source)}`,
        );
      ts.forEachChild(node, visit);
    }
    visit(source);
    let directory = dirname(file),
      owner;
    while (directory.startsWith(root)) {
      if (existsSync(resolve(directory, "README.md"))) {
        owner = relativeName(resolve(directory, "README.md"));
        break;
      }
      if (directory === root) break;
      directory = dirname(directory);
    }
    if (!owner)
      problems.push(`${relativeName(file)}: missing responsibility owner`);
    records.set(relativeName(file), {
      path: relativeName(file),
      owner,
      lines: source.text.split(/\r?\n/).length,
      declarations,
      imports: [...new Set(imports)].sort(),
      dependencies: [...new Set(dependencies)].sort(),
      workers,
      consumers: [],
      tests: [],
    });
  }
  for (const record of records.values())
    for (const dependency of record.dependencies)
      records.get(dependency)?.consumers.push(record.path);
  for (const test of walk(resolve(root, "tests"))) {
    const source = ts.createSourceFile(
      test,
      readFileSync(test, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        continue;
      const base = resolve(dirname(test), node.moduleSpecifier.text);
      const record = records.get(
        relativeName(existsSync(base) ? base : `${base}.ts`),
      );
      if (record) record.tests.push(relativeName(test));
    }
  }
  const reached = new Set();
  function visit(file) {
    if (reached.has(file)) return;
    const record = records.get(file);
    if (!record) {
      problems.push(`Missing declared entry ${file}`);
      return;
    }
    reached.add(file);
    record.dependencies.forEach(visit);
  }
  roots.forEach(visit);
  const unused = [...records.keys()].filter((file) => !reached.has(file));
  const unusedExports = [...exports]
    .filter(([symbol]) => !references.get(symbol)?.size)
    .map(([, entry]) => entry);
  const dependencies = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ).dependencies;
  const usedPackages = new Set(
    [...records.values()]
      .flatMap((record) => record.imports)
      .filter((name) => !name.startsWith("node:"))
      .map((name) =>
        name.startsWith("@")
          ? name.split("/").slice(0, 2).join("/")
          : name.split("/")[0],
      ),
  );
  const unusedDependencies = Object.keys(dependencies).filter(
    (name) => !usedPackages.has(name),
  );
  return {
    schema: "solar.source-usage.v2",
    roots,
    source_files: files.length,
    reachable_files: reached.size,
    unused,
    unusedExports,
    unusedDependencies,
    problems,
    files: [...records.values()].sort((a, b) => a.path.localeCompare(b.path)),
    limits:
      "AST module/export usage including public re-exports, literal dynamic imports and Worker URL edges. Types and local live helper calls count. Tests cannot retain unused product code. Symbol liveness inside methods uses tsc/eslint; opaque runtime behavior and upstream internals require their separate tests/pins.",
  };
}

export function codeMap(graph) {
  const rows = graph.files.map(
    (file) =>
      `| [${file.path}](../../${file.path}) | [${file.owner}](../../${file.owner}) | ${file.declarations.map((name) => `\`${name}\``).join(", ") || "entry"} | ${[...file.dependencies, ...file.imports].join(", ") || "none"} | ${file.consumers.join(", ") || "declared entry"} | ${file.tests.join(", ") || "via consuming boundary"} |`,
  );
  return `# Solar code map\n\nGenerated by \`npm run code:map\` from TypeScript ASTs. Do not edit derived rows. \`npm run code:check\` rejects drift.\n\nEntries: ${graph.roots.map((name) => `\`${name}\``).join(", ")}. Worker edges are followed from their actual \`new URL\` dependency. Public re-exports are integration contracts; tests are separate consumers. ${graph.limits}\n\n| File | Responsibility owner | Symbols | Dependencies/imports | Product consumers | Direct tests |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}
