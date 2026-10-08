import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";

/** Windows permits registered installed fonts outside the conventional directories. */
export async function windowsRegisteredFonts(
  windows: string,
): Promise<string[]> {
  const script =
    "$paths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'); $values = @(); foreach ($path in $paths) { if (Test-Path -LiteralPath $path) { $key = Get-Item -LiteralPath $path; foreach ($name in $key.GetValueNames()) { $value = $key.GetValue($name); if ($value -is [string]) { $values += $value } } } }; ConvertTo-Json -Compress -InputObject @($values)";
  const { stdout } = await promisify(execFile)(
    resolve(windows, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const values: unknown = JSON.parse(stdout);
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string")
  )
    throw new Error("WINDOWS_FONT_REGISTRY_INVALID");
  return [
    ...new Set(
      values.map((value) =>
        isAbsolute(value) ? value : resolve(windows, "Fonts", value),
      ),
    ),
  ];
}
