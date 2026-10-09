# FREEOS Skill Academy

FREEOS Skill Academy separates knowledge from demonstrated ability.

## Core rule

Reading or importing material does not create mastery. A competency may contain active training material while mastery remains `theory` until evaluated practice evidence exists.

Mastery levels:

`theory -> guided -> practicing -> working -> proficient -> advanced`

Elevated and safety-critical skills require human-reviewed practice before they can advance mastery.

## Bulk Teaching Packs

Training material is imported in batches so a whole course/module can be taught in one operation instead of one fact at a time.

Example payload:

```json
{
  "packKey": "photo-video-color-001",
  "title": "Professional Color Correction Foundations",
  "sourceLabel": "Owner-curated curriculum",
  "sourceRef": "local curriculum / source set",
  "ownerApproved": true,
  "domain": {
    "key": "photo-video",
    "name": "Photo & Video Production",
    "riskProfile": "standard"
  },
  "competencies": [
    {
      "key": "color-correction",
      "name": "Color Correction",
      "purpose": "Create technically balanced, consistent footage before creative grading.",
      "riskLevel": "standard",
      "units": [
        {
          "type": "concept",
          "title": "Correction before grading",
          "content": "...",
          "confidence": "confirmed"
        },
        {
          "type": "procedure",
          "title": "Primary correction workflow",
          "content": "...",
          "confidence": "confirmed"
        },
        {
          "type": "heuristic",
          "title": "Protect faces before backgrounds",
          "content": "...",
          "confidence": "high"
        }
      ],
      "drills": [
        {
          "key": "neutralize-shot",
          "title": "Neutralize a single shot",
          "prompt": "Correct the supplied shot to a neutral technical baseline.",
          "rubric": ["exposure", "white balance", "skin tone", "scope discipline", "artifact avoidance"],
          "difficulty": "guided"
        }
      ]
    }
  ]
}
```

`ownerApproved: true` makes the imported units active training material. It does not increase mastery.

## Practice and mastery

Create a practice session with a competency key, optional drill key, result summary, and evidence reference. Evaluate it separately with a 0-100 score.

Current automatic mastery thresholds use passing evaluated sessions (70+):

- 1 pass, average >=70: `guided`
- 3 passes, average >=75: `practicing`
- 5 passes, average >=80: `working`
- 8 passes, average >=85: `proficient`
- 12 passes, average >=90: `advanced`

These thresholds are a first operational model, not a claim that every profession can be reduced to the same rubric. Domain-specific mastery policies can replace them later while preserving the same evidence model.

## Initial schools

Bootstrap creates curriculum scaffolds only for:

- Photo & Video Production
- Business Strategy & Operations
- Engineering & Technical Systems
- Technology & AI

The scaffold intentionally contains no claimed lesson knowledge and no granted mastery.
