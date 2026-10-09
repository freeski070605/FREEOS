import { getToolRegistry } from "@freeos/tool-runner";

type Row = Record<string, unknown>;
type Database = ReturnType<typeof getToolRegistry>["database"];

export const skillRiskLevels = ["standard", "elevated", "safety-critical"] as const;
export type SkillRiskLevel = (typeof skillRiskLevels)[number];
export const skillMasteryLevels = ["theory", "guided", "practicing", "working", "proficient", "advanced"] as const;
export type SkillMasteryLevel = (typeof skillMasteryLevels)[number];
export const skillUnitTypes = ["concept", "procedure", "heuristic", "failure-mode", "tool", "rubric", "reference"] as const;
export type SkillUnitType = (typeof skillUnitTypes)[number];

interface SeedCompetency {
  key: string;
  name: string;
  riskLevel?: SkillRiskLevel;
}

interface SeedDomain {
  key: string;
  name: string;
  description: string;
  riskProfile: SkillRiskLevel;
  competencies: SeedCompetency[];
}

const domainSeeds: SeedDomain[] = [
  {
    key: "photo-video",
    name: "Photo & Video Production",
    description: "Photography, cinematography, lighting, audio, editing, color, motion, storytelling, production, and delivery quality.",
    riskProfile: "standard",
    competencies: [
      { key: "exposure-control", name: "Exposure Control" },
      { key: "composition-framing", name: "Composition & Framing" },
      { key: "camera-lenses", name: "Camera & Lens Selection" },
      { key: "lighting", name: "Lighting" },
      { key: "audio-capture", name: "Production Audio Capture" },
      { key: "editing-rhythm", name: "Editing Rhythm & Pacing" },
      { key: "narrative-editing", name: "Narrative Editing & Story Structure" },
      { key: "color-correction", name: "Color Correction" },
      { key: "color-grading", name: "Creative Color Grading" },
      { key: "premiere-pro", name: "Adobe Premiere Pro" },
      { key: "after-effects", name: "Adobe After Effects" },
      { key: "event-production", name: "Event & Wedding Production" },
      { key: "commercial-production", name: "Commercial / Advertising Production" },
      { key: "delivery-qc", name: "Media Delivery & Quality Control" },
    ],
  },
  {
    key: "business",
    name: "Business Strategy & Operations",
    description: "Pricing, offers, sales, negotiation, marketing, operations, cash flow, competitive strategy, and capital allocation.",
    riskProfile: "standard",
    competencies: [
      { key: "pricing-unit-economics", name: "Pricing & Unit Economics" },
      { key: "offer-design", name: "Offer Design" },
      { key: "sales-discovery", name: "Sales Discovery" },
      { key: "negotiation", name: "Negotiation" },
      { key: "client-acquisition", name: "Client Acquisition" },
      { key: "marketing-strategy", name: "Marketing Strategy" },
      { key: "scope-contracts", name: "Scoping & Contract Boundaries" },
      { key: "operations-systems", name: "Operations & Systems" },
      { key: "recurring-revenue", name: "Recurring Revenue Design" },
      { key: "competitive-strategy", name: "Competitive Strategy" },
      { key: "cash-flow", name: "Cash-Flow Management" },
      { key: "capital-allocation", name: "Capital Allocation" },
    ],
  },
  {
    key: "engineering",
    name: "Engineering & Technical Systems",
    description: "Systems thinking, diagnostics, electrical/electronic/mechanical fundamentals, automation, reliability, networking, CAD, and manufacturing.",
    riskProfile: "elevated",
    competencies: [
      { key: "systems-thinking", name: "Systems Engineering Thinking", riskLevel: "standard" },
      { key: "troubleshooting", name: "Structured Troubleshooting", riskLevel: "standard" },
      { key: "electrical-fundamentals", name: "Electrical Fundamentals", riskLevel: "safety-critical" },
      { key: "electronics", name: "Electronics Fundamentals", riskLevel: "elevated" },
      { key: "mechanical-fundamentals", name: "Mechanical Fundamentals", riskLevel: "elevated" },
      { key: "networking", name: "Computer Networking", riskLevel: "standard" },
      { key: "automation-control", name: "Automation & Control Systems", riskLevel: "elevated" },
      { key: "reliability", name: "Reliability Engineering", riskLevel: "standard" },
      { key: "cad-3d", name: "CAD & 3D Technical Modeling", riskLevel: "standard" },
      { key: "manufacturing-basics", name: "Manufacturing Fundamentals", riskLevel: "elevated" },
    ],
  },
  {
    key: "technology-ai",
    name: "Technology & AI",
    description: "Software engineering, architecture, databases, APIs, security, AI/ML, agents, RAG, local models, and GPU computing.",
    riskProfile: "standard",
    competencies: [
      { key: "software-engineering", name: "Software Engineering" },
      { key: "software-architecture", name: "Software Architecture" },
      { key: "databases", name: "Databases" },
      { key: "apis", name: "API Design & Integration" },
      { key: "security", name: "Software & Systems Security", riskLevel: "elevated" },
      { key: "ai-ml", name: "AI / Machine Learning" },
      { key: "agents", name: "Agentic Systems" },
      { key: "rag", name: "Retrieval-Augmented Generation" },
      { key: "local-models", name: "Local Model Operations" },
      { key: "gpu-computing", name: "GPU Computing" },
    ],
  },
];

let schemaReady = false;

function db(): Database {
  const database = getToolRegistry().database;
  if (!schemaReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS skill_domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        risk_profile TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'scaffold',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS skill_competencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competency_key TEXT NOT NULL UNIQUE,
        domain_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT '',
        risk_level TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'scaffold',
        mastery_level TEXT NOT NULL DEFAULT 'theory',
        mastery_score REAL NOT NULL DEFAULT 0,
        practice_count INTEGER NOT NULL DEFAULT 0,
        passed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (domain_key) REFERENCES skill_domains(domain_key)
      );
      CREATE TABLE IF NOT EXISTS skill_teaching_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        source_label TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        approval_status TEXT NOT NULL DEFAULT 'draft',
        imported_units INTEGER NOT NULL DEFAULT 0,
        imported_drills INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS skill_units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_key TEXT,
        competency_key TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_label TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL DEFAULT 'moderate',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(competency_key, unit_type, title, pack_key),
        FOREIGN KEY (competency_key) REFERENCES skill_competencies(competency_key),
        FOREIGN KEY (pack_key) REFERENCES skill_teaching_packs(pack_key)
      );
      CREATE TABLE IF NOT EXISTS skill_drills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drill_key TEXT NOT NULL UNIQUE,
        pack_key TEXT,
        competency_key TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        rubric_json TEXT NOT NULL DEFAULT '[]',
        difficulty TEXT NOT NULL DEFAULT 'guided',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (competency_key) REFERENCES skill_competencies(competency_key),
        FOREIGN KEY (pack_key) REFERENCES skill_teaching_packs(pack_key)
      );
      CREATE TABLE IF NOT EXISTS skill_practice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competency_key TEXT NOT NULL,
        drill_key TEXT,
        result_summary TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '',
        score REAL,
        human_reviewed INTEGER NOT NULL DEFAULT 0,
        evaluator TEXT NOT NULL DEFAULT '',
        evaluation_notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'recorded',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        evaluated_at TEXT,
        FOREIGN KEY (competency_key) REFERENCES skill_competencies(competency_key),
        FOREIGN KEY (drill_key) REFERENCES skill_drills(drill_key)
      );
      CREATE TABLE IF NOT EXISTS skill_mastery_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competency_key TEXT NOT NULL,
        session_id INTEGER,
        previous_level TEXT NOT NULL,
        new_level TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (competency_key) REFERENCES skill_competencies(competency_key),
        FOREIGN KEY (session_id) REFERENCES skill_practice_sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_skill_competencies_domain ON skill_competencies(domain_key);
      CREATE INDEX IF NOT EXISTS idx_skill_units_competency ON skill_units(competency_key,status);
      CREATE INDEX IF NOT EXISTS idx_skill_drills_competency ON skill_drills(competency_key,status);
      CREATE INDEX IF NOT EXISTS idx_skill_practice_competency ON skill_practice_sessions(competency_key,status);
    `);
    schemaReady = true;
  }
  return database;
}

function rows(database: Database, sql: string, ...params: unknown[]): Row[] {
  return database.prepare(sql).all(...params) as Row[];
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]) ? value as T[number] : fallback;
}

function mapDomain(row: Row) {
  return {
    id: Number(row.id),
    domainKey: String(row.domain_key),
    name: String(row.name),
    description: String(row.description ?? ""),
    riskProfile: String(row.risk_profile),
    status: String(row.status),
  };
}

function mapCompetency(row: Row) {
  return {
    id: Number(row.id),
    competencyKey: String(row.competency_key),
    domainKey: String(row.domain_key),
    name: String(row.name),
    description: String(row.description ?? ""),
    purpose: String(row.purpose ?? ""),
    riskLevel: String(row.risk_level),
    status: String(row.status),
    masteryLevel: String(row.mastery_level),
    masteryScore: Number(row.mastery_score ?? 0),
    practiceCount: Number(row.practice_count ?? 0),
    passedCount: Number(row.passed_count ?? 0),
  };
}

export function bootstrapSkillAcademy() {
  const database = db();
  database.transaction(() => {
    for (const domain of domainSeeds) {
      database.prepare(`
        INSERT INTO skill_domains (domain_key,name,description,risk_profile,status)
        VALUES (?,?,?,?, 'scaffold')
        ON CONFLICT(domain_key) DO UPDATE SET
          name=excluded.name,description=excluded.description,risk_profile=excluded.risk_profile,updated_at=CURRENT_TIMESTAMP
      `).run(domain.key, domain.name, domain.description, domain.riskProfile);

      for (const competency of domain.competencies) {
        const competencyKey = `${domain.key}.${competency.key}`;
        database.prepare(`
          INSERT INTO skill_competencies (competency_key,domain_key,name,risk_level,status)
          VALUES (?,?,?,?, 'scaffold')
          ON CONFLICT(competency_key) DO UPDATE SET
            domain_key=excluded.domain_key,name=excluded.name,risk_level=excluded.risk_level,updated_at=CURRENT_TIMESTAMP
        `).run(competencyKey, domain.key, competency.name, competency.riskLevel ?? domain.riskProfile);
      }
    }
  })();
  return getSkillAcademyStatus();
}

export function getSkillAcademyStatus() {
  const database = db();
  const count = (table: string, where = "1=1") => Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get() as { count: number }).count);
  return {
    enabled: true,
    domains: count("skill_domains"),
    competencies: count("skill_competencies"),
    activeTrainingUnits: count("skill_units", "status='active'"),
    draftTrainingUnits: count("skill_units", "status='draft'"),
    activeDrills: count("skill_drills", "status='active'"),
    practiceSessions: count("skill_practice_sessions"),
    evaluatedSessions: count("skill_practice_sessions", "status='evaluated'"),
    advancedCompetencies: count("skill_competencies", "mastery_level='advanced'"),
    rule: "Reading or importing material does not create mastery. Skill knowledge, practice evidence, evaluation, and demonstrated mastery are tracked separately.",
  };
}

export function getSkillCatalog(domainKey?: string) {
  const database = db();
  const domains = domainKey?.trim()
    ? rows(database, "SELECT * FROM skill_domains WHERE domain_key=? ORDER BY name", domainKey.trim())
    : rows(database, "SELECT * FROM skill_domains ORDER BY name");
  return domains.map((domain) => ({
    ...mapDomain(domain),
    competencies: rows(database, "SELECT * FROM skill_competencies WHERE domain_key=? ORDER BY name", String(domain.domain_key)).map((row) => ({
      ...mapCompetency(row),
      activeUnits: Number((database.prepare("SELECT COUNT(*) AS count FROM skill_units WHERE competency_key=? AND status='active'").get(String(row.competency_key)) as { count: number }).count),
      activeDrills: Number((database.prepare("SELECT COUNT(*) AS count FROM skill_drills WHERE competency_key=? AND status='active'").get(String(row.competency_key)) as { count: number }).count),
    })),
  }));
}

interface TeachingUnitInput {
  type?: unknown;
  title?: unknown;
  content?: unknown;
  confidence?: unknown;
}

interface DrillInput {
  key?: unknown;
  title?: unknown;
  prompt?: unknown;
  rubric?: unknown;
  difficulty?: unknown;
}

interface CompetencyPackInput {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  purpose?: unknown;
  riskLevel?: unknown;
  units?: TeachingUnitInput[];
  drills?: DrillInput[];
}

export function importTeachingPack(input: {
  packKey?: unknown;
  title?: unknown;
  sourceLabel?: unknown;
  sourceRef?: unknown;
  ownerApproved?: unknown;
  domain?: { key?: unknown; name?: unknown; description?: unknown; riskProfile?: unknown };
  competencies?: CompetencyPackInput[];
}) {
  const database = db();
  const packKey = requiredText(input.packKey, "packKey");
  const packTitle = requiredText(input.title, "title");
  const domainKey = requiredText(input.domain?.key, "domain.key");
  const domainName = requiredText(input.domain?.name, "domain.name");
  const approved = input.ownerApproved === true;
  const materialStatus = approved ? "active" : "draft";
  const sourceLabel = optionalText(input.sourceLabel);
  const sourceRef = optionalText(input.sourceRef);
  const competencies = Array.isArray(input.competencies) ? input.competencies : [];
  if (!competencies.length) throw new Error("competencies must contain at least one competency.");

  let importedUnits = 0;
  let importedDrills = 0;

  database.transaction(() => {
    database.prepare(`
      INSERT INTO skill_domains (domain_key,name,description,risk_profile,status)
      VALUES (?,?,?,?,?)
      ON CONFLICT(domain_key) DO UPDATE SET
        name=excluded.name,
        description=CASE WHEN excluded.description<>'' THEN excluded.description ELSE skill_domains.description END,
        risk_profile=excluded.risk_profile,
        status=CASE WHEN excluded.status='active' THEN 'active' ELSE skill_domains.status END,
        updated_at=CURRENT_TIMESTAMP
    `).run(domainKey, domainName, optionalText(input.domain?.description), oneOf(input.domain?.riskProfile, skillRiskLevels, "standard"), materialStatus);

    database.prepare(`
      INSERT INTO skill_teaching_packs (pack_key,title,source_label,source_ref,approval_status)
      VALUES (?,?,?,?,?)
      ON CONFLICT(pack_key) DO UPDATE SET
        title=excluded.title,source_label=excluded.source_label,source_ref=excluded.source_ref,
        approval_status=excluded.approval_status,updated_at=CURRENT_TIMESTAMP
    `).run(packKey, packTitle, sourceLabel, sourceRef, approved ? "owner-approved" : "draft");

    for (const competency of competencies) {
      const shortKey = requiredText(competency.key, "competency.key");
      const competencyKey = shortKey.includes(".") ? shortKey : `${domainKey}.${shortKey}`;
      const competencyName = requiredText(competency.name, "competency.name");
      const riskLevel = oneOf(competency.riskLevel, skillRiskLevels, "standard");

      database.prepare(`
        INSERT INTO skill_competencies (competency_key,domain_key,name,description,purpose,risk_level,status)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(competency_key) DO UPDATE SET
          domain_key=excluded.domain_key,name=excluded.name,
          description=CASE WHEN excluded.description<>'' THEN excluded.description ELSE skill_competencies.description END,
          purpose=CASE WHEN excluded.purpose<>'' THEN excluded.purpose ELSE skill_competencies.purpose END,
          risk_level=excluded.risk_level,
          status=CASE WHEN excluded.status='active' THEN 'active' ELSE skill_competencies.status END,
          updated_at=CURRENT_TIMESTAMP
      `).run(competencyKey, domainKey, competencyName, optionalText(competency.description), optionalText(competency.purpose), riskLevel, materialStatus);

      for (const unit of Array.isArray(competency.units) ? competency.units : []) {
        const unitType = oneOf(unit.type, skillUnitTypes, "reference");
        const unitTitle = requiredText(unit.title, "unit.title");
        const content = requiredText(unit.content, "unit.content");
        const confidence = oneOf(unit.confidence, ["confirmed", "high", "moderate", "low", "unverified", "disputed"] as const, "moderate");
        database.prepare(`
          INSERT INTO skill_units (pack_key,competency_key,unit_type,title,content,source_label,source_ref,confidence,status)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(competency_key,unit_type,title,pack_key) DO UPDATE SET
            content=excluded.content,source_label=excluded.source_label,source_ref=excluded.source_ref,
            confidence=excluded.confidence,status=excluded.status,updated_at=CURRENT_TIMESTAMP
        `).run(packKey, competencyKey, unitType, unitTitle, content, sourceLabel, sourceRef, confidence, materialStatus);
        importedUnits += 1;
      }

      for (const drill of Array.isArray(competency.drills) ? competency.drills : []) {
        const rawDrillKey = requiredText(drill.key, "drill.key");
        const drillKey = rawDrillKey.includes(".") ? rawDrillKey : `${competencyKey}.${rawDrillKey}`;
        const rubric = Array.isArray(drill.rubric) ? drill.rubric : [];
        database.prepare(`
          INSERT INTO skill_drills (drill_key,pack_key,competency_key,title,prompt,rubric_json,difficulty,status)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(drill_key) DO UPDATE SET
            pack_key=excluded.pack_key,competency_key=excluded.competency_key,title=excluded.title,
            prompt=excluded.prompt,rubric_json=excluded.rubric_json,difficulty=excluded.difficulty,
            status=excluded.status,updated_at=CURRENT_TIMESTAMP
        `).run(drillKey, packKey, competencyKey, requiredText(drill.title, "drill.title"), requiredText(drill.prompt, "drill.prompt"), JSON.stringify(rubric), optionalText(drill.difficulty) || "guided", materialStatus);
        importedDrills += 1;
      }
    }

    database.prepare("UPDATE skill_teaching_packs SET imported_units=?, imported_drills=?, updated_at=CURRENT_TIMESTAMP WHERE pack_key=?")
      .run(importedUnits, importedDrills, packKey);
  })();

  return {
    packKey,
    approvalStatus: approved ? "owner-approved" : "draft",
    trainingMaterialStatus: materialStatus,
    importedCompetencies: competencies.length,
    importedUnits,
    importedDrills,
    masteryChanged: false,
    rule: "Teaching-pack import may add approved training material, but it never increases mastery without evaluated practice evidence.",
  };
}

export function createPracticeSession(input: { competencyKey?: unknown; drillKey?: unknown; resultSummary?: unknown; evidence?: unknown }) {
  const database = db();
  const competencyKey = requiredText(input.competencyKey, "competencyKey");
  const competency = database.prepare("SELECT 1 AS ok FROM skill_competencies WHERE competency_key=?").get(competencyKey) as Row | undefined;
  if (!competency) throw new Error("Unknown competencyKey.");
  const drillKey = optionalText(input.drillKey) || null;
  if (drillKey) {
    const drill = database.prepare("SELECT competency_key FROM skill_drills WHERE drill_key=?").get(drillKey) as Row | undefined;
    if (!drill || String(drill.competency_key) !== competencyKey) throw new Error("drillKey does not belong to competencyKey.");
  }
  const result = database.prepare(`
    INSERT INTO skill_practice_sessions (competency_key,drill_key,result_summary,evidence,status)
    VALUES (?,?,?,?, 'recorded')
  `).run(competencyKey, drillKey, requiredText(input.resultSummary, "resultSummary"), optionalText(input.evidence));
  return getPracticeSession(Number(result.lastInsertRowid));
}

function masteryFromEvidence(passedCount: number, averageScore: number): SkillMasteryLevel {
  if (passedCount >= 12 && averageScore >= 90) return "advanced";
  if (passedCount >= 8 && averageScore >= 85) return "proficient";
  if (passedCount >= 5 && averageScore >= 80) return "working";
  if (passedCount >= 3 && averageScore >= 75) return "practicing";
  if (passedCount >= 1 && averageScore >= 70) return "guided";
  return "theory";
}

export function evaluatePracticeSession(id: number, input: { score?: unknown; humanReviewed?: unknown; evaluator?: unknown; notes?: unknown }) {
  if (!Number.isInteger(id) || id < 1) throw new Error("Invalid practice session ID.");
  const database = db();
  const session = database.prepare("SELECT * FROM skill_practice_sessions WHERE id=?").get(id) as Row | undefined;
  if (!session) throw new Error("Practice session not found.");
  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("score must be between 0 and 100.");
  const competency = database.prepare("SELECT * FROM skill_competencies WHERE competency_key=?").get(String(session.competency_key)) as Row;
  const risk = String(competency.risk_level) as SkillRiskLevel;
  const humanReviewed = input.humanReviewed === true;
  const countsTowardMastery = risk === "standard" || humanReviewed;

  database.prepare(`
    UPDATE skill_practice_sessions
    SET score=?,human_reviewed=?,evaluator=?,evaluation_notes=?,status='evaluated',evaluated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(score, humanReviewed ? 1 : 0, optionalText(input.evaluator), optionalText(input.notes), id);

  const eligible = rows(database, `
    SELECT score FROM skill_practice_sessions
    WHERE competency_key=? AND status='evaluated' AND score IS NOT NULL
      AND (?='standard' OR human_reviewed=1)
    ORDER BY id
  `, String(session.competency_key), risk);
  const scores = eligible.map((row) => Number(row.score)).filter((value) => Number.isFinite(value));
  const passed = scores.filter((value) => value >= 70);
  const average = passed.length ? passed.reduce((sum, value) => sum + value, 0) / passed.length : 0;
  const nextLevel = masteryFromEvidence(passed.length, average);
  const previousLevel = String(competency.mastery_level) as SkillMasteryLevel;

  database.prepare(`
    UPDATE skill_competencies
    SET practice_count=?,passed_count=?,mastery_score=?,mastery_level=?,updated_at=CURRENT_TIMESTAMP
    WHERE competency_key=?
  `).run(scores.length, passed.length, average, nextLevel, String(session.competency_key));

  if (previousLevel !== nextLevel) {
    database.prepare(`
      INSERT INTO skill_mastery_events (competency_key,session_id,previous_level,new_level,score,reason)
      VALUES (?,?,?,?,?,?)
    `).run(String(session.competency_key), id, previousLevel, nextLevel, score, `Mastery recalculated from ${passed.length} passing evaluated practice session(s); average passing score ${average.toFixed(1)}.`);
  }

  return {
    session: getPracticeSession(id),
    competency: mapCompetency(database.prepare("SELECT * FROM skill_competencies WHERE competency_key=?").get(String(session.competency_key)) as Row),
    countsTowardMastery,
    humanReviewRequiredForMastery: risk !== "standard",
    rule: "Elevated and safety-critical skills require human-reviewed practice before evidence can advance mastery.",
  };
}

export function getPracticeSession(id: number) {
  const row = db().prepare("SELECT * FROM skill_practice_sessions WHERE id=?").get(id) as Row | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    competencyKey: String(row.competency_key),
    drillKey: row.drill_key == null ? null : String(row.drill_key),
    resultSummary: String(row.result_summary),
    evidence: String(row.evidence ?? ""),
    score: row.score == null ? null : Number(row.score),
    humanReviewed: Boolean(Number(row.human_reviewed)),
    evaluator: String(row.evaluator ?? ""),
    evaluationNotes: String(row.evaluation_notes ?? ""),
    status: String(row.status),
    createdAt: String(row.created_at),
    evaluatedAt: row.evaluated_at == null ? null : String(row.evaluated_at),
  };
}

export function listPracticeSessions(competencyKey?: string, limit = 100) {
  const database = db();
  const bounded = Math.min(Math.max(limit, 1), 500);
  const result = competencyKey?.trim()
    ? rows(database, "SELECT * FROM skill_practice_sessions WHERE competency_key=? ORDER BY id DESC LIMIT ?", competencyKey.trim(), bounded)
    : rows(database, "SELECT * FROM skill_practice_sessions ORDER BY id DESC LIMIT ?", bounded);
  return result.map((row) => getPracticeSession(Number(row.id)));
}
