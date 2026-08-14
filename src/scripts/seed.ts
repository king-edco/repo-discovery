// Seed a few real public repos so the feed + detail page can be tested
// visually without running the full rate-limited ingestion.
import { getDb } from "@/db";
import { repos } from "@/db/schema";

const SEED: Array<{
  id: string;
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  license: string | null;
  readme_text: string | null;
  topics: string;
  pushed_at: string;
}> = [
  {
    id: "seed-1",
    name: "transformers",
    full_name: "huggingface/transformers",
    description: "🤗 Transformers: State-of-the-art Machine Learning for Pytorch, TensorFlow, and JAX.",
    url: "https://github.com/huggingface/transformers",
    stars: 140000,
    language: "Python",
    license: "Apache-2.0",
    readme_text: `# 🤗 Transformers

State-of-the-art Machine Learning for PyTorch, TensorFlow, and JAX.

## Introduction

Transformers provides thousands of pretrained models to perform tasks on
different modalities such as text, vision, and audio.

## Installation

\`\`\`bash
pip install transformers
\`\`\`

## Quick tour

\`\`\`python
from transformers import pipeline

classifier = pipeline("sentiment-analysis")
classifier("We are very happy to show you the 🤗 Transformers library.")
\`\`\`

### Features

- **Easy to use**: a unified API.
- **Performant**: optimized backends.

| Modality | Task |
| --- | --- |
| Text | NLP |
| Vision | CV |

> Transformers is used by thousands of developers worldwide.
`,
    topics: JSON.stringify(["machine-learning", "nlp", "transformer", "pytorch"]),
    pushed_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "seed-2",
    name: "manim",
    full_name: "3b1b/manim",
    description: "Animation engine for explanatory math videos.",
    url: "https://github.com/3b1b/manim",
    stars: 73000,
    language: "Python",
    license: "MIT",
    readme_text: `# Manim

An animation engine for explanatory math videos.

## Usage

\`\`\`python
from manim import *

class SquareToCircle(Scene):
    def construct(self):
        circle = Circle()
        self.play(Create(circle))
\`\`\`

## Installation

\`\`\`bash
pip install manim
\`\`\`

- Render math animations programmatically.
- Used by [3Blue1Brown](https://www.3blue1brown.com/).
`,
    topics: JSON.stringify(["animation", "math", "python", "education"]),
    pushed_at: "2026-07-15T00:00:00Z",
  },
  {
    id: "seed-3",
    name: "chess.js",
    full_name: "jhlywa/chess.js",
    description: "A TypeScript chess library for chess move generation/validation, piece placement/movement, and check/checkmate/draw detection.",
    url: "https://github.com/jhlywa/chess.js",
    stars: 4200,
    language: "TypeScript",
    license: "BSD-2-Clause",
    readme_text: `# chess.js

chess.js is a TypeScript chess library used for chess move
generation/validation, piece placement/movement, and check/checkmate/draw
detection.

## Example

\`\`\`ts
import { Chess } from 'chess.js'

const chess = new Chess()
chess.move('e4')
\`\`\`

### Notes

- No dependencies.
- Full move validation.
`,
    topics: JSON.stringify(["chess", "typescript", "game", "library"]),
    pushed_at: "2026-06-20T00:00:00Z",
  },
];

const db = getDb();
for (const repo of SEED) {
  db.insert(repos)
    .values(repo)
    .onConflictDoUpdate({ target: repos.id, set: repo })
    .run();
}
console.log(`[seed] inserted ${SEED.length} repos`);
