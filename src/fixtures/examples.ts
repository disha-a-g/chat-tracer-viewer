// Registry of raw, source-format example traces for the "Load example"
// button. These are real inputs run through detectFormat()/parse() like any
// paste/upload/URL — never pre-normalized JSON — so "Load example" exercises
// the same path as every other load.
//
// `load()` is a dynamic import rather than a static one so Vite code-splits
// each fixture into its own chunk, fetched only when that example is
// actually clicked, instead of pulling every fixture into the main bundle
// for every visitor regardless of whether they ever click "Load an example".

export interface ExampleTrace {
  id: string
  label: string
  description: string
  load: () => Promise<string>
}

export const EXAMPLE_TRACES: ExampleTrace[] = [
  {
    id: 'openai-long-failure',
    label: 'OpenAI — revenue query gone wrong',
    description: 'A failed SQL query retried unchanged, then a fabricated answer with no error raised.',
    load: () => import('./fixture-long-failure.openai.json?raw').then((m) => m.default),
  },
  {
    id: 'generic-pcori-success',
    label: 'Generic JSON — PHI pipeline run',
    description: 'A stdout-driven NER pipeline with no native trace format, reconstructed from its own logs.',
    load: () => import('./fixture-pcori-success.generic.json?raw').then((m) => m.default),
  },
  {
    id: 'claude-code-dmls-build-lock',
    label: 'Claude Code — DMLS build, chasing a file lock',
    description: 'A real public session (trace-commons/agent-traces on Hugging Face): a long build/debug pass on an Odin life-sim, ending mid-fight with a Windows linker file lock. 29 tool errors along the way.',
    load: () => import('./fixture-dmls-build-lock.claude-code.jsonl?raw').then((m) => m.default),
  },
  {
    id: 'claude-code-multiboot2-uefi-gop',
    label: 'Claude Code — multiboot2 UEFI/GOP upgrade',
    description: 'A real public session (trace-commons/agent-traces on Hugging Face): upgrading an OS kernel’s boot path from legacy VGA to UEFI GOP framebuffer graphics, then documenting the userland programming model it unlocks.',
    load: () => import('./fixture-multiboot2-uefi-gop.claude-code.jsonl?raw').then((m) => m.default),
  },
]
