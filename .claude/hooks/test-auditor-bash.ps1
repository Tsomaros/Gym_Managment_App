# PreToolUse hook of the test-auditor subagent: only read-only git, the test commands and removing its own throwaway mutant tests may run.
# Exit 0 allows the command; exit 2 blocks it and shows the message to the subagent.
try {
    $command = ([Console]::In.ReadToEnd() | ConvertFrom-Json).tool_input.command
} catch {
    [Console]::Error.WriteLine('Blocked: could not read the command.')
    exit 2
}

$allowed = @(
    '^\s*git\s+(status|diff|log|show|blame|ls-files|rev-parse|merge-base)(\s|$)',
    '^\s*pnpm\s+(-r\s+test|lint|e2e)\s*$',
    '^\s*pnpm\s+--filter\s+(api|web|shared)\s+(test|test:e2e|typecheck|coverage)(\s+--\s+[\w./-]+)?\s*$',
    '^\s*rm\s+(apps/api/test/zz_mutant_\w+\.spec\.ts|apps/web/src/zz_mutant_\w+\.spec\.tsx?|packages/shared/test/zz_mutant_\w+\.spec\.ts)\s*$'
)
$shellSyntax = '[;&|<>`$()\r\n]'
# git: --output writes a file and --ext-diff runs a program, and git accepts them abbreviated.
$unsafeOption = '\s--(ou|ex)'

$isAllowed = $false
foreach ($pattern in $allowed) {
    if ($command -match $pattern) { $isAllowed = $true }
}

if (-not $isAllowed -or $command -match $shellSyntax -or $command -match $unsafeOption) {
    [Console]::Error.WriteLine('Blocked: the test auditor may only run one plain read-only git command, pnpm -r test|lint|e2e, pnpm --filter api|web|shared test|test:e2e|typecheck|coverage, or rm of its own zz_mutant test, with no pipes or redirects.')
    exit 2
}
exit 0
