import { importTeachingPack, getSkillCatalog } from "./skillAcademy.service";
import { buildSkillTeachingContext } from "./skillTeachingContext.service";

const EDITING_PACK_KEY = "photo-video.advanced-editing-v1";

const competencies = [
  {
    key: "performance-multicam",
    name: "Performance & Multicam Editing",
    description: "Shot-role reasoning, continuity, emphasis, coverage, and performance-driven multicam construction.",
    purpose: "Choose angles for meaning and performance continuity rather than by static quality ranking.",
    units: [
      { type: "concept", title: "Shot roles over shot scores", content: "Treat each camera as serving possible roles such as anchor, intimate closeup, kinetic accent, spatial reset, detail, or atmospheric insert. A visually weaker shot can be creatively correct if its role advances performance, contrast, geography, or emotion. Never reduce multicam editing to one global quality score." },
      { type: "heuristic", title: "Motivated angle changes", content: "Prefer angle changes that respond to performance changes, musical phrasing, gesture, eyeline, movement, lyric emphasis, spatial need, or deliberate contrast. Avoid repetitive alternation and avoid changing angles merely because a beat occurred." },
      { type: "failure-mode", title: "Multicam ping-pong", content: "Rapidly alternating cameras without a reason creates mechanical editing. Diagnose by repeated A/B/A/B patterns, identical shot durations, or cuts unrelated to performance or musical structure." },
    ],
  },
  {
    key: "rhythmic-editing-advanced",
    name: "Advanced Rhythm, Syncopation & Pacing",
    description: "Editing with phrase structure, syncopation, anticipation, delay, density changes, and rhythmic contrast.",
    purpose: "Shape rhythm musically without mechanically cutting on beats.",
    units: [
      { type: "concept", title: "Rhythm is larger than beat alignment", content: "Build pacing from phrases, subdivisions, transients, rests, momentum, and expected-versus-delayed timing. Cuts may land before, on, or after musical events depending on desired tension and release." },
      { type: "heuristic", title: "Vary cut density", content: "Use changes in average shot length and cut density to create escalation, release, contrast, or section identity. Preserve enough holds for the viewer to register strong performance moments." },
      { type: "failure-mode", title: "Metronome edit", content: "If nearly every cut coincides with a beat or uses the same interval, the sequence often feels automated. Break predictability with phrase-level holds, anticipatory cuts, delayed reactions, and selected silence or space." },
    ],
  },
  {
    key: "continuity-motivated-cuts",
    name: "Continuity & Motivated Cuts",
    description: "Eyeline, motion, screen direction, gesture, framing continuity, and intentional discontinuity.",
    purpose: "Make cuts feel invisible when needed and disruptive only by intent.",
    units: [
      { type: "concept", title: "Continuity priorities", content: "Protect orientation, dominant movement, eyeline, body position, and gesture across cuts unless discontinuity is itself the creative point. Match action through motion when a cut should feel seamless." },
      { type: "heuristic", title: "Cut on information change", content: "A cut is strongest when the new shot adds information, intimacy, energy, perspective, or contrast. Avoid near-duplicate framings that create jumpy but uninformative changes." },
    ],
  },
  {
    key: "montage-structure",
    name: "Montage & Associative Structure",
    description: "Metric, rhythmic, tonal, intellectual, and associative montage approaches.",
    purpose: "Construct meaning and momentum from relationships between shots rather than continuity alone.",
    units: [
      { type: "concept", title: "Associative montage", content: "Pair images through shape, motion, theme, emotional contrast, symbolic relationship, or cause-and-effect implication. Montage can compress time, create metaphor, intensify atmosphere, or build conceptual meaning." },
      { type: "failure-mode", title: "Decorative montage", content: "Montage becomes empty when shots are fast but have no relational logic. Require a visual, narrative, musical, thematic, or emotional reason for adjacency." },
    ],
  },
  {
    key: "match-cuts-transitions",
    name: "Match Cuts & Advanced Transitions",
    description: "Graphic, motion, shape, color, direction, and semantic matches plus invisible and expressive transitions.",
    purpose: "Use transitions as structural devices rather than decoration.",
    units: [
      { type: "concept", title: "Match-cut dimensions", content: "Potential match dimensions include composition, silhouette, camera motion, subject motion, luminance, color, scale, eye position, direction, texture, and semantic meaning. Strong matches preserve at least one clear relationship while changing another." },
      { type: "failure-mode", title: "Transition overload", content: "If transitions draw more attention than the footage or repeat without motivation, simplify. Reserve expressive transitions for moments where transformation, location change, time shift, impact, or style language supports them." },
    ],
  },
  {
    key: "speed-temporal-design",
    name: "Speed Ramps & Temporal Design",
    description: "Retime curves, speed ramps, freeze frames, time remapping, frame blending, optical flow, and temporal accents.",
    purpose: "Use time manipulation to shape impact and perception while preserving motion quality.",
    units: [
      { type: "procedure", title: "Speed-ramp design", content: "Identify a motion with a readable beginning, peak, or landing. Build speed changes around that event, keep ramps smooth enough for the footage, and inspect optical-flow artifacts, warping, repeated frames, and motion cadence before approval." },
      { type: "failure-mode", title: "Arbitrary speed ramp", content: "A speed ramp without a motion event, musical purpose, transition function, or dramatic reason often feels like a preset. Reject ramps that exist only to make a shot feel more edited." },
    ],
  },
  {
    key: "reframing-camera-enhancement",
    name: "Reframing & Camera-Movement Enhancement",
    description: "Digital punch-ins, keyframed reframes, virtual camera motion, stabilization, and movement shaping.",
    purpose: "Improve emphasis and motion while respecting source resolution and composition.",
    units: [
      { type: "heuristic", title: "Reframe with intent", content: "Use reframing to redirect attention, increase intimacy, correct composition, create a controlled push, or connect motion. Respect resolution limits and avoid constant zooming that competes with the performance." },
      { type: "failure-mode", title: "Fake-camera fatigue", content: "Too many digital pushes, drifts, and punch-ins create artificial motion fatigue. Preserve static confidence when the original composition is already strong." },
    ],
  },
  {
    key: "masking-compositing",
    name: "Masking, Tracking, Rotoscoping & Compositing",
    description: "Tracked masks, mattes, object isolation, layered composites, cleanup, reveal transitions, and integration principles.",
    purpose: "Build effects that remain spatially and visually integrated.",
    units: [
      { type: "procedure", title: "Composite integration checklist", content: "Match perspective, edge softness, motion blur, grain/noise, exposure, color response, depth cues, and camera movement. Track or roto only as much as needed for a stable edge and inspect difficult occlusions frame-by-frame." },
      { type: "failure-mode", title: "Cutout look", content: "Hard edges, mismatched blur, mismatched grain, wrong scale, or lighting inconsistency reveal the composite. Fix integration before adding more effects." },
    ],
  },
  {
    key: "kinetic-typography",
    name: "Kinetic Typography & Lyric Visuals",
    description: "Type motion, lyric emphasis, hierarchy, readability, text choreography, and integration with footage.",
    purpose: "Use typography as part of rhythm and visual storytelling rather than as captions pasted on top.",
    units: [
      { type: "concept", title: "Typography as motion design", content: "Animate type according to hierarchy, cadence, emphasis, and visual space. Use scale, timing, tracking, masking, depth, and directional motion deliberately. Preserve readability long enough for comprehension." },
      { type: "failure-mode", title: "Every-word animation", content: "Animating every word with the same energy destroys hierarchy. Reserve strongest treatments for selected phrases, hooks, punchlines, transitions, or structural moments." },
    ],
  },
  {
    key: "vfx-motion-design",
    name: "VFX & Motion Design Integration",
    description: "Glows, distortion, displacement, particles, trails, echoes, procedural motion, and stylized compositing.",
    purpose: "Integrate effects into a coherent visual language tied to footage and music.",
    units: [
      { type: "heuristic", title: "Effect language consistency", content: "Choose a small family of effect behaviors and vary intensity rather than introducing unrelated effects constantly. Tie effects to motion, transitions, section identity, texture, or performance emphasis." },
      { type: "failure-mode", title: "Plugin-demo syndrome", content: "If the viewer notices the effect package more than the performance or idea, reduce the effect, simplify the stack, or remove it." },
    ],
  },
  {
    key: "color-look-development",
    name: "Advanced Color Matching & Look Development",
    description: "Shot matching, exposure balance, white balance, skin-tone consistency, contrast shaping, palette design, film emulation, grain, halation, and texture.",
    purpose: "Separate technical matching from creative look design and keep skin/subject consistency through stylization.",
    units: [
      { type: "procedure", title: "Two-pass color workflow", content: "First normalize and match exposure, white balance, contrast, and skin/subject appearance between shots. Then design the creative look globally or by intentional section. Validate highlights, shadows, saturation, skin, and legal/export behavior after the look." },
      { type: "heuristic", title: "Texture after balance", content: "Add grain, halation, bloom, diffusion, vignette, or film response after basic shot consistency is established. Texture should unify or stylize, not hide mismatched shots." },
    ],
  },
  {
    key: "sound-design-editing",
    name: "Editorial Sound Design",
    description: "Impacts, risers, whooshes, texture, ambience, transitions, silence, layering, and audiovisual synchronization.",
    purpose: "Use sound to reinforce movement, transitions, space, and emotional impact without cluttering the music.",
    units: [
      { type: "concept", title: "Sound hierarchy", content: "Prioritize song and essential dialogue/performance first. Add design elements selectively to reinforce cuts, motion, reveals, transitions, impacts, and environment. Frequency-space, transient density, and stereo placement matter as much as level." },
      { type: "failure-mode", title: "SFX wallpaper", content: "Constant whooshes and impacts reduce impact. Silence and untreated transitions create contrast; reserve designed accents for moments that benefit from them." },
    ],
  },
  {
    key: "style-music-video-performance",
    name: "Style: Performance Music Video",
    description: "Performance-first visual grammar using multicam energy, performer presence, inserts, movement, and section contrast.",
    purpose: "Build a complete performance video that feels authored rather than mechanically switched.",
    units: [
      { type: "reference", title: "Performance-video grammar", content: "Common tools include anchor performance coverage, intimate closeups, kinetic accents, wide spatial resets, inserts, lens/motion contrast, selected speed manipulation, and section-specific pacing. The performer remains the narrative center unless the concept deliberately shifts focus." },
      { type: "heuristic", title: "Section identity", content: "Give major song sections a distinguishable editing behavior through shot roles, pace, movement, effects, color, or framing while preserving continuity across the whole piece." },
    ],
  },
  {
    key: "style-cinematic",
    name: "Style: Cinematic / Atmospheric",
    description: "Longer visual thought, controlled pacing, motivated movement, visual motifs, negative space, tonal color, and sound atmosphere.",
    purpose: "Create cinematic weight without reducing the style to slow motion and letterboxing.",
    units: [
      { type: "reference", title: "Cinematic grammar", content: "Favor deliberate composition, visual motifs, motivated camera changes, spatial clarity, restrained transitions, tonal consistency, and moments allowed to breathe. Use silence, ambience, and shot duration as expressive tools." },
      { type: "failure-mode", title: "Fake cinematic", content: "Slow motion, black bars, teal-orange color, and shallow-depth shots do not by themselves create cinematic storytelling. Require composition, sequencing, tone, and motivated pacing." },
    ],
  },
  {
    key: "style-commercial",
    name: "Style: Premium Commercial",
    description: "Precision, clarity, product/subject hierarchy, controlled motion, polished transitions, clean sound design, and consistent finishing.",
    purpose: "Deliver premium polish while preserving message and readability.",
    units: [
      { type: "reference", title: "Commercial grammar", content: "Use clean hierarchy, intentional reveals, precise timing, controlled camera motion, polished graphics, consistent color, clear product/subject emphasis, and concise pacing. Every decorative choice should support message, desirability, or brand character." },
    ],
  },
  {
    key: "style-documentary",
    name: "Style: Documentary",
    description: "Truthful continuity, interview construction, observational footage, B-roll logic, J/L cuts, scene geography, and emotional pacing.",
    purpose: "Build clarity and emotional truth without over-stylizing evidence.",
    units: [
      { type: "reference", title: "Documentary grammar", content: "Let audio and meaning often lead the edit. Use J/L cuts, B-roll that explains or emotionally enriches spoken content, natural pacing, scene geography, and selective silence. Avoid visuals that imply facts not supported by the material." },
    ],
  },
  {
    key: "style-wedding-emotional",
    name: "Style: Wedding & Emotional Event",
    description: "Emotional progression, vows/speeches, reaction shots, chronology versus thematic montage, music arcs, and memory-driven pacing.",
    purpose: "Create emotionally coherent event films rather than simple chronological recaps.",
    units: [
      { type: "reference", title: "Emotional-event grammar", content: "Build around relationships, reactions, anticipation, payoff, vows/speeches, and meaningful details. Chronology can be reshaped when thematic association strengthens emotion, provided event truth remains clear." },
    ],
  },
  {
    key: "style-social-retention",
    name: "Style: Social / Retention-Driven Short Form",
    description: "Hook construction, information density, pattern interruption, readability, vertical framing, captions, and payoff pacing.",
    purpose: "Maximize clarity and retention without turning every second into noise.",
    units: [
      { type: "reference", title: "Retention grammar", content: "Establish value or curiosity quickly, remove dead time, use visual changes when they add information or reset attention, maintain readable text hierarchy, and deliver payoff before attention decays. Pattern interruption is useful only when it refreshes attention without breaking comprehension." },
      { type: "failure-mode", title: "Hyperactive retention edit", content: "Constant zooms, captions, sound effects, and cuts can reduce comprehension and trust. Increase density only where the content benefits from it." },
    ],
  },
  {
    key: "style-experimental",
    name: "Style: Experimental / Abstract",
    description: "Discontinuity, repetition, visual metaphor, temporal fragmentation, texture, distortion, and nonliteral structure.",
    purpose: "Use rule-breaking intentionally while preserving an internal logic.",
    units: [
      { type: "reference", title: "Experimental grammar", content: "Break continuity through repetition, jump cuts, temporal loops, abstraction, texture, unconventional sound-image relationships, or visual metaphor, but establish an internal pattern or concept so experimentation feels authored rather than random." },
    ],
  },
];

export function bootstrapEditingAcademy() {
  return importTeachingPack({
    packKey: EDITING_PACK_KEY,
    title: "FREEOS Advanced Editing & Style Library v1",
    sourceLabel: "FREEOS owner-directed editing academy",
    sourceRef: "internal://editing-academy/v1",
    ownerApproved: true,
    domain: {
      key: "photo-video",
      name: "Photo & Video Production",
      description: "Photography, cinematography, lighting, audio, editing, color, motion, storytelling, production, and delivery quality.",
      riskProfile: "standard",
    },
    competencies,
  });
}

export function assessEditingKnowledgeGap(query: string) {
  const normalized = query.trim();
  if (!normalized) throw new Error("query is required.");
  const context = buildSkillTeachingContext({ query: normalized, limit: 20 });
  const catalog = getSkillCatalog("photo-video");
  const editingCompetencies = catalog.flatMap((domain) => domain.competencies).filter((item) =>
    ["editing", "premiere", "after-effects", "color", "performance", "multicam", "transition", "montage", "sound", "style", "mask", "vfx", "typography", "speed", "reframing"].some((token) =>
      `${item.competencyKey} ${item.name}`.toLowerCase().includes(token),
    ),
  );
  const relevantKeys = Array.from(new Set(context.items.map((item) => item.competencyKey)));
  const relevantMastery = editingCompetencies.filter((item) => relevantKeys.includes(item.competencyKey));
  const lowMastery = relevantMastery.filter((item) => ["theory", "guided"].includes(item.masteryLevel));
  const needsMoreKnowledge = context.items.length < 4;
  return {
    query: normalized,
    needsMoreKnowledge,
    reason: needsMoreKnowledge
      ? "The Editing Academy has too little owner-approved material matching this request. FREEOS should identify the missing topic and learn it before committing to the edit."
      : "The Editing Academy has enough relevant owner-approved material to begin planning. Low demonstrated mastery may still justify extra caution or practice, but it is not itself a knowledge gap.",
    relevantUnits: context.items.length,
    relevantCompetencies: relevantKeys,
    lowMasteryCompetencies: lowMastery.map((item) => ({ key: item.competencyKey, masteryLevel: item.masteryLevel, masteryScore: item.masteryScore })),
    teachingContext: context.context,
  };
}

export function buildEditingKnowledgeContext(query: string) {
  const gap = assessEditingKnowledgeGap(query);
  return {
    gap,
    context: gap.teachingContext,
  };
}
