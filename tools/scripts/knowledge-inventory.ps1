param(
    [string]$ApiBase = "http://127.0.0.1:3001"
)

$ErrorActionPreference = "Stop"

# ------------------------------------------------------------
# ROOT
# ------------------------------------------------------------

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $Root "exports\knowledge-inventory\$timestamp"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$warnings = [System.Collections.Generic.List[string]]::new()

# ------------------------------------------------------------
# HELPERS
# ------------------------------------------------------------

function Get-Prop {
    param(
        $Object,
        [string[]]$Names
    )

    if ($null -eq $Object) {
        return $null
    }

    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]

        if ($null -ne $property -and $null -ne $property.Value) {
            return $property.Value
        }
    }

    return $null
}

function Get-Api {
    param(
        [string]$Path,
        [switch]$Required
    )

    try {
        return Invoke-RestMethod `
            -Uri "$ApiBase$Path" `
            -Method Get `
            -TimeoutSec 15
    }
    catch {
        $message = "$Path -> $($_.Exception.Message)"
        $warnings.Add($message)

        if ($Required) {
            throw "Required FREEOS API request failed: $message"
        }

        return $null
    }
}

function Preview-Text {
    param(
        $Value,
        [int]$Length = 220
    )

    if ($null -eq $Value) {
        return ""
    }

    $text = [string]$Value
    $text = $text -replace "`r", " "
    $text = $text -replace "`n", " "
    $text = $text -replace "\s+", " "
    $text = $text.Trim()

    if ($text.Length -le $Length) {
        return $text
    }

    return $text.Substring(0, $Length) + "..."
}

function Safe-Array {
    param($Value)

    if ($null -eq $Value) {
        return @()
    }

    return @($Value)
}

$ragExtensions = @(
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".html",
    ".css",
    ".yml",
    ".yaml"
)

function Get-LocalKnowledgeFiles {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return @()
    }

    return @(
        Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $ragExtensions -contains $_.Extension.ToLowerInvariant() -and
            $_.FullName -notmatch "\\node_modules\\" -and
            $_.FullName -notmatch "\\\.git\\" -and
            $_.FullName -notmatch "\\dist\\" -and
            $_.FullName -notmatch "\\build\\"
        } |
        ForEach-Object {
            [pscustomobject]@{
                name         = $_.Name
                path         = $_.FullName
                relativePath = $_.FullName.Substring($Root.Path.Length).TrimStart("\")
                extension    = $_.Extension
                bytes        = $_.Length
                modifiedAt   = $_.LastWriteTime.ToString("o")
            }
        }
    )
}

# ------------------------------------------------------------
# VERIFY FREEOS IS RUNNING
# ------------------------------------------------------------

Write-Host "Checking FREEOS API..." -ForegroundColor Cyan

$memoryStatus = Get-Api "/memory/status" -Required

Write-Host "FREEOS API reachable." -ForegroundColor Green

# ------------------------------------------------------------
# MEMORY
# ------------------------------------------------------------

Write-Host "Reading approved memory..." -ForegroundColor Cyan

$memoryResponse = Get-Api "/memory" -Required
$memories = Safe-Array $memoryResponse.memories

$pendingProposalResponse  = Get-Api "/memory/proposals?status=pending"
$approvedProposalResponse = Get-Api "/memory/proposals?status=approved"
$rejectedProposalResponse = Get-Api "/memory/proposals?status=rejected"

$pendingProposals  = Safe-Array $pendingProposalResponse.proposals
$approvedProposals = Safe-Array $approvedProposalResponse.proposals
$rejectedProposals = Safe-Array $rejectedProposalResponse.proposals

# ------------------------------------------------------------
# PROJECTS + NOTES
# ------------------------------------------------------------

Write-Host "Reading projects and project notes..." -ForegroundColor Cyan

$projectResponse = Get-Api "/projects" -Required
$projects = Safe-Array $projectResponse.projects

$projectNotes = @{}

foreach ($project in $projects) {

    $projectKey = [string](Get-Prop $project @("projectKey","project_key"))

    if ([string]::IsNullOrWhiteSpace($projectKey)) {
        continue
    }

    $encoded = [uri]::EscapeDataString($projectKey)

    $noteResponse = Get-Api "/projects/$encoded/notes"

    $projectNotes[$projectKey] = Safe-Array $noteResponse.notes
}

# ------------------------------------------------------------
# RAG
# ------------------------------------------------------------

Write-Host "Reading RAG index..." -ForegroundColor Cyan

$ragStatus    = Get-Api "/rag/status"
$ragSources   = Safe-Array (Get-Api "/rag/sources")
$ragDocuments = Safe-Array (Get-Api "/rag/documents")

# ------------------------------------------------------------
# AGENT HISTORY
# ------------------------------------------------------------

Write-Host "Reading agent metadata..." -ForegroundColor Cyan

$agentResponse = Get-Api "/agents"
$runResponse   = Get-Api "/agents/runs"

$agents = Safe-Array $agentResponse.agents
$agentRuns = Safe-Array $runResponse.runs

# ------------------------------------------------------------
# LOCAL KNOWLEDGE FILES
# ------------------------------------------------------------

Write-Host "Inspecting local knowledge roots..." -ForegroundColor Cyan

$docsFiles = Get-LocalKnowledgeFiles (Join-Path $Root "docs")
$generalFiles = Get-LocalKnowledgeFiles (Join-Path $Root "data\documents")
$allProjectFiles = Get-LocalKnowledgeFiles (Join-Path $Root "data\projects")

$constitutionPath = Join-Path $Root "docs\FREEOS_CONSTITUTION.md"

$constitution = [pscustomobject]@{
    exists = Test-Path $constitutionPath
    path   = $constitutionPath
    bytes  = if (Test-Path $constitutionPath) {
        (Get-Item $constitutionPath).Length
    } else {
        0
    }
}

# ------------------------------------------------------------
# BUILD PROJECT COVERAGE
# ------------------------------------------------------------

$projectCoverage = @()

foreach ($project in $projects) {

    $projectKey = [string](Get-Prop $project @("projectKey","project_key"))
    $projectName = [string](Get-Prop $project @("name","title"))

    if ([string]::IsNullOrWhiteSpace($projectKey)) {
        continue
    }

    $notes = Safe-Array $projectNotes[$projectKey]

    $projectMemories = @(
        $memories | Where-Object {
            [string](Get-Prop $_ @("projectKey","project_key")) -eq $projectKey
        }
    )

    $projectRag = @(
        $ragDocuments | Where-Object {
            [string](Get-Prop $_ @("projectKey","project_key")) -eq $projectKey
        }
    )

    $folderPrefix = "data\projects\$projectKey\"

    $localFiles = @(
        $allProjectFiles | Where-Object {
            $_.relativePath.StartsWith(
                $folderPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )
        }
    )

    $meaningfulFiles = @(
        $localFiles | Where-Object {
            $_.name -notin @("README.md",".gitkeep")
        }
    )

    $knowledgeSignals =
        $notes.Count +
        $projectMemories.Count +
        $projectRag.Count +
        $meaningfulFiles.Count

    $coverage =
        if ($knowledgeSignals -eq 0) {
            "EMPTY"
        }
        elseif ($knowledgeSignals -le 2) {
            "THIN"
        }
        else {
            "DEVELOPING"
        }

    $projectCoverage += [pscustomobject]@{
        projectKey        = $projectKey
        projectName       = $projectName
        projectNotes      = $notes.Count
        approvedMemories  = $projectMemories.Count
        ragDocuments      = $projectRag.Count
        localTextFiles    = $localFiles.Count
        meaningfulFiles   = $meaningfulFiles.Count
        coverage          = $coverage
    }
}

# ------------------------------------------------------------
# BUILD KNOWLEDGE CATALOG
# ------------------------------------------------------------

$catalog = [System.Collections.Generic.List[object]]::new()

foreach ($memory in $memories) {

    $catalog.Add([pscustomobject]@{
        type       = "approved-memory"
        projectKey = Get-Prop $memory @("projectKey","project_key")
        title      = Get-Prop $memory @("title","name")
        category   = Get-Prop $memory @("category","type")
        source     = Get-Prop $memory @("source")
        updatedAt  = Get-Prop $memory @("updatedAt","updated_at","createdAt","created_at")
        preview    = Preview-Text (Get-Prop $memory @("content","value","text"))
    })
}

foreach ($project in $projects) {

    $projectKey = [string](Get-Prop $project @("projectKey","project_key"))

    foreach ($note in (Safe-Array $projectNotes[$projectKey])) {

        $catalog.Add([pscustomobject]@{
            type       = "project-note"
            projectKey = $projectKey
            title      = Get-Prop $note @("title","name")
            category   = "project-note"
            source     = Get-Prop $note @("source")
            updatedAt  = Get-Prop $note @("updatedAt","updated_at","createdAt","created_at")
            preview    = Preview-Text (Get-Prop $note @("content","text"))
        })
    }
}

foreach ($doc in $ragDocuments) {

    $catalog.Add([pscustomobject]@{
        type       = "rag-document"
        projectKey = Get-Prop $doc @("projectKey","project_key")
        title      = Get-Prop $doc @("documentName","document_name","fileName","file_name","name")
        category   = "rag"
        source     = Get-Prop $doc @("filePath","file_path","documentPath","document_path","path")
        updatedAt  = Get-Prop $doc @("updatedAt","updated_at","indexedAt","indexed_at")
        preview    = ""
    })
}

foreach ($file in $generalFiles) {

    $catalog.Add([pscustomobject]@{
        type       = "local-general-file"
        projectKey = $null
        title      = $file.name
        category   = "local-file"
        source     = $file.relativePath
        updatedAt  = $file.modifiedAt
        preview    = ""
    })
}

# ------------------------------------------------------------
# KNOWLEDGE DOMAINS TO AUDIT NEXT
# ------------------------------------------------------------

$domainAudit = @(
    [pscustomobject]@{
        domain = "Faith / Biblical reference library"
        status = if ($constitution.exists) { "FOUNDATION PRESENT - REFERENCE CORPUS NOT AUDITED" } else { "NOT AUDITED" }
    },
    [pscustomobject]@{
        domain = "Owner identity, history, preferences, goals"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "DFB organization map and business relationships"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Business histories and current states"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Project roadmaps and active priorities"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Operating procedures / SOPs"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Client and service delivery playbooks"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Sales / pricing / marketing playbooks"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Creative standards and production workflows"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Software engineering standards"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Financial and business reference knowledge"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Past decisions and reasons"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Lessons learned / failures / outcomes"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Media asset catalog"
        status = "NOT AUDITED"
    },
    [pscustomobject]@{
        domain = "Current external/world intelligence"
        status = "NOT AUDITED"
    }
)

# ------------------------------------------------------------
# RAW INVENTORY
# ------------------------------------------------------------

$globalMemories = @(
    $memories | Where-Object {
        $project = Get-Prop $_ @("projectKey","project_key")
        $null -eq $project -or [string]::IsNullOrWhiteSpace([string]$project)
    }
)

$inventory = [ordered]@{
    generatedAt = (Get-Date).ToString("o")
    apiBase = $ApiBase

    constitution = $constitution

    summary = [ordered]@{
        projects = $projects.Count
        approvedMemories = $memories.Count
        globalApprovedMemories = $globalMemories.Count
        pendingMemoryProposals = $pendingProposals.Count
        approvedMemoryProposals = $approvedProposals.Count
        rejectedMemoryProposals = $rejectedProposals.Count
        ragDocuments = $ragDocuments.Count
        ragSources = $ragSources.Count
        projectNotes = (
            ($projectNotes.Values | ForEach-Object { @($_).Count } |
            Measure-Object -Sum).Sum
        )
        docsFiles = $docsFiles.Count
        generalKnowledgeFiles = $generalFiles.Count
        projectKnowledgeFiles = $allProjectFiles.Count
        agents = $agents.Count
        agentRuns = $agentRuns.Count
    }

    memoryStatus = $memoryStatus
    approvedMemories = $memories

    memoryProposals = [ordered]@{
        pending = $pendingProposals
        approved = $approvedProposals
        rejected = $rejectedProposals
    }

    projects = $projects
    projectNotes = $projectNotes
    projectCoverage = $projectCoverage

    rag = [ordered]@{
        status = $ragStatus
        sources = $ragSources
        documents = $ragDocuments
    }

    localKnowledge = [ordered]@{
        docs = $docsFiles
        generalDocuments = $generalFiles
        projectFiles = $allProjectFiles
    }

    agents = [ordered]@{
        definitions = $agents
        runs = $agentRuns
        note = "Agent run history is stored, but is not automatically equivalent to approved long-term knowledge."
    }

    domainAudit = $domainAudit

    warnings = @($warnings)
}

$jsonPath = Join-Path $outDir "knowledge-inventory.json"

$inventory |
    ConvertTo-Json -Depth 30 |
    Set-Content $jsonPath -Encoding UTF8

# ------------------------------------------------------------
# CSV CATALOG
# ------------------------------------------------------------

$csvPath = Join-Path $outDir "knowledge-catalog.csv"

$catalog |
    Export-Csv `
        -Path $csvPath `
        -NoTypeInformation `
        -Encoding UTF8

# ------------------------------------------------------------
# MARKDOWN REPORT
# ------------------------------------------------------------

$md = [System.Collections.Generic.List[string]]::new()

$md.Add("# FREEOS Knowledge Inventory")
$md.Add("")
$md.Add("Generated: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))")
$md.Add("")
$md.Add("This report separates stored knowledge from live observations and base-model knowledge.")
$md.Add("")

$md.Add("## Core Counts")
$md.Add("")
$md.Add("| Area | Count |")
$md.Add("|---|---:|")
$md.Add("| Projects | $($projects.Count) |")
$md.Add("| Approved memories | $($memories.Count) |")
$md.Add("| Global approved memories | $($globalMemories.Count) |")

$totalNotes = (
    ($projectNotes.Values | ForEach-Object { @($_).Count } |
    Measure-Object -Sum).Sum
)

if ($null -eq $totalNotes) {
    $totalNotes = 0
}

$md.Add("| Project notes | $totalNotes |")
$md.Add("| RAG documents | $($ragDocuments.Count) |")
$md.Add("| RAG sources | $($ragSources.Count) |")
$md.Add("| Files under docs | $($docsFiles.Count) |")
$md.Add("| Files under data/documents | $($generalFiles.Count) |")
$md.Add("| Files under data/projects | $($allProjectFiles.Count) |")
$md.Add("| Agent definitions | $($agents.Count) |")
$md.Add("| Historical agent runs | $($agentRuns.Count) |")
$md.Add("")

$md.Add("## Project Knowledge Coverage")
$md.Add("")
$md.Add("| Project | Notes | Memories | RAG Docs | Meaningful Files | Coverage |")
$md.Add("|---|---:|---:|---:|---:|---|")

foreach ($row in $projectCoverage) {
    $md.Add(
        "| $($row.projectName) [$($row.projectKey)] | " +
        "$($row.projectNotes) | " +
        "$($row.approvedMemories) | " +
        "$($row.ragDocuments) | " +
        "$($row.meaningfulFiles) | " +
        "$($row.coverage) |"
    )
}

$md.Add("")
$md.Add("Coverage labels are inventory signals only:")
$md.Add("- EMPTY = no project-specific knowledge signals found")
$md.Add("- THIN = only one or two knowledge signals")
$md.Add("- DEVELOPING = more than two signals")
$md.Add("")

$md.Add("## Approved Memory")
$md.Add("")

if ($memories.Count -eq 0) {
    $md.Add("No approved memories.")
}
else {
    foreach ($memory in $memories) {

        $title = Get-Prop $memory @("title","name")
        $project = Get-Prop $memory @("projectKey","project_key")
        $content = Preview-Text (Get-Prop $memory @("content","value","text")) 350

        if ([string]::IsNullOrWhiteSpace([string]$title)) {
            $title = "(untitled)"
        }

        if ([string]::IsNullOrWhiteSpace([string]$project)) {
            $project = "GLOBAL"
        }

        $md.Add("### $title")
        $md.Add("")
        $md.Add("Project: $project")
        $md.Add("")
        $md.Add($content)
        $md.Add("")
    }
}

$md.Add("## Project Notes")
$md.Add("")

foreach ($project in $projects) {

    $key = [string](Get-Prop $project @("projectKey","project_key"))
    $name = [string](Get-Prop $project @("name","title"))
    $notes = Safe-Array $projectNotes[$key]

    $md.Add("### $name [$key]")
    $md.Add("")

    if ($notes.Count -eq 0) {
        $md.Add("No project notes.")
        $md.Add("")
        continue
    }

    foreach ($note in $notes) {

        $title = Get-Prop $note @("title","name")
        $content = Preview-Text (Get-Prop $note @("content","text")) 350

        $md.Add("- **$title** — $content")
    }

    $md.Add("")
}

$md.Add("## Indexed RAG Documents")
$md.Add("")

if ($ragDocuments.Count -eq 0) {
    $md.Add("No RAG documents indexed.")
}
else {
    foreach ($doc in $ragDocuments) {

        $name = Get-Prop $doc @(
            "documentName",
            "document_name",
            "fileName",
            "file_name",
            "name"
        )

        $path = Get-Prop $doc @(
            "filePath",
            "file_path",
            "documentPath",
            "document_path",
            "path"
        )

        $project = Get-Prop $doc @("projectKey","project_key")

        if ([string]::IsNullOrWhiteSpace([string]$project)) {
            $project = "GLOBAL/UNSCOPED"
        }

        $md.Add("- **$name** | project: $project | $path")
    }
}

$md.Add("")
$md.Add("## Knowledge Domains Still Requiring Audit")
$md.Add("")

foreach ($domain in $domainAudit) {
    $md.Add("- **$($domain.domain):** $($domain.status)")
}

$md.Add("")
$md.Add("## Important Knowledge Boundaries")
$md.Add("")
$md.Add("- Qwen base-model knowledge is not counted as verified FREEOS institutional knowledge.")
$md.Add("- Live tool observations are current state, not automatically permanent memory.")
$md.Add("- Historical agent runs are retained but are not automatically approved long-term knowledge.")
$md.Add("- Files present on disk are not necessarily indexed or available to every agent.")
$md.Add("- Project-scoped knowledge remains separate unless intentionally promoted or shared.")
$md.Add("")

if ($warnings.Count -gt 0) {
    $md.Add("## Inventory Warnings")
    $md.Add("")

    foreach ($warning in $warnings) {
        $md.Add("- $warning")
    }

    $md.Add("")
}

$mdPath = Join-Path $outDir "KNOWLEDGE_INVENTORY.md"

$md |
    Set-Content $mdPath -Encoding UTF8

# ------------------------------------------------------------
# SAVE LATEST POINTER COPIES
# ------------------------------------------------------------

$latestDir = Join-Path $Root "exports\knowledge-inventory\latest"

New-Item -ItemType Directory -Force -Path $latestDir | Out-Null

Copy-Item $jsonPath (Join-Path $latestDir "knowledge-inventory.json") -Force
Copy-Item $csvPath  (Join-Path $latestDir "knowledge-catalog.csv") -Force
Copy-Item $mdPath   (Join-Path $latestDir "KNOWLEDGE_INVENTORY.md") -Force

# ------------------------------------------------------------
# CONSOLE SUMMARY
# ------------------------------------------------------------

Write-Host "`n=========================================" -ForegroundColor Green
Write-Host "       KNOWLEDGE INVENTORY COMPLETE      " -ForegroundColor Green
Write-Host "=========================================`n" -ForegroundColor Green

Write-Host "Approved memories : $($memories.Count)"
Write-Host "Project notes      : $totalNotes"
Write-Host "RAG documents      : $($ragDocuments.Count)"
Write-Host "RAG sources        : $($ragSources.Count)"
Write-Host "Projects           : $($projects.Count)"
Write-Host "Agent runs stored  : $($agentRuns.Count)"

Write-Host "`nProject coverage:" -ForegroundColor Cyan

$projectCoverage |
    Format-Table `
        projectName,
        projectNotes,
        approvedMemories,
        ragDocuments,
        meaningfulFiles,
        coverage `
        -AutoSize

if ($warnings.Count -gt 0) {
    Write-Host "`nWarnings:" -ForegroundColor Yellow

    foreach ($warning in $warnings) {
        Write-Host " - $warning" -ForegroundColor Yellow
    }
}

Write-Host "`nReports:" -ForegroundColor Cyan
Write-Host " $mdPath"
Write-Host " $jsonPath"
Write-Host " $csvPath"

Write-Host "`nLatest copy:" -ForegroundColor Cyan
Write-Host " exports\knowledge-inventory\latest\KNOWLEDGE_INVENTORY.md"

Write-Host "`nNo memories, notes, RAG documents, agents, or schedules were modified." -ForegroundColor Green
