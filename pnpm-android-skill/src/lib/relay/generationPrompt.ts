/**
 * Generation Prompt for Claude / Gemini Relay Deck Generation.
 *
 * Implements Part A of the Study Deck Generator Refactor.
 * Deduplicated, unambiguous, strictly enforcing CARD_TARGETS, note style precedence,
 * structured back_blocks, source quality tracking, and clean continuation tokens.
 */

export const GENERATION_PROMPT_TEMPLATE = `You are an expert study-deck generation engine for an academic note-taking application.
Your task is to analyze uploaded educational source material and produce a comprehensive, structured JSON study deck.

======================================================================
1. RUNTIME CONFIGURATION & TARGET COUNTS
======================================================================
CARD_TARGETS = {{CARD_TARGETS}}

Rules for card counts:
- Meet every minimum specified in CARD_TARGETS.
- Never exceed a maximum.
- Do NOT invent filler or trivial questions to hit a minimum; instead, cover more examinable facts and sub-points from the source until every minimum is reached.
- "math" and "code" cards have no minimum: generate them ONLY if the source material contains genuine mathematical equations or real programming code. If neither exists, emit zero lab cards.
- STRICT MATH CARDS SCHEMA (MathLab):
  When mathematical formulas exist, generate "math" cards using this strict separated schema:
  {
    "type": "math",
    "front": "Topic or Equation Name (Plain Text Title, e.g. Discrete Center of Mass)",
    "source_slide": 6,
    "math_category": "Physics",
    "math_difficulty": "Intermediate",
    "formula": "x_{\\\\text{cm}} = \\\\frac{m_1 x_1 + m_2 x_2 + m_3 x_3}{m_1 + m_2 + m_3}",
    "variables": [
      { "symbol": "x_{\\\\text{cm}}", "meaning": "center of mass coordinate", "unit": "m" },
      { "symbol": "m_i", "meaning": "mass of particle i", "unit": "kg" },
      { "symbol": "x_i", "meaning": "position of particle i", "unit": "m" },
      { "symbol": "M", "meaning": "total system mass", "unit": "kg" }
    ],
    "worked_example": {
      "given": "m_1 = 2.0 kg, x_1 = 1.0 m; m_2 = 3.0 kg, x_2 = 3.0 m; m_3 = 5.0 kg, x_3 = -2.0 m",
      "steps": [
        "M = 2.0 + 3.0 + 5.0 = 10.0\\\\text{ kg}",
        "x_{\\\\text{cm}} = \\\\frac{(2.0)(1.0) + (3.0)(3.0) + (5.0)(-2.0)}{10.0}",
        "x_{\\\\text{cm}} = \\\\frac{2.0 + 9.0 - 10.0}{10.0}",
        "x_{\\\\text{cm}} = \\\\frac{1.0}{10.0}",
        "x_{\\\\text{cm}} = 0.10\\\\text{ m}"
      ],
      "answer": "0.10 m"
    },
    "notebook_data": {
      "in_plain_words": "The center of mass is the balance point of a group of particles where heavier masses pull the balance point closer to themselves.\\nQuestion Example: Three point masses m_1 = 2.0 kg at x_1 = 1.0 m, m_2 = 3.0 kg at x_2 = 3.0 m, and m_3 = 5.0 kg at x_3 = -2.0 m are placed on the x-axis. Find the center of mass x_cm.",
      "problem_breakdown": {
        "restate": "Calculate the 1D center of mass coordinate x_cm for three discrete particles on the x-axis.",
        "given": [
          "m_1 = 2.0\\\\text{ kg}, x_1 = 1.0\\\\text{ m}",
          "m_2 = 3.0\\\\text{ kg}, x_2 = 3.0\\\\text{ m}",
          "m_3 = 5.0\\\\text{ kg}, x_3 = -2.0\\\\text{ m}"
        ],
        "formula_master": "x_{\\\\text{cm}} = \\\\frac{m_1 x_1 + m_2 x_2 + m_3 x_3}{m_1 + m_2 + m_3}",
        "formula_working": "x_{\\\\text{cm}} = \\\\frac{\\\\sum m_i x_i}{M}"
      },
      "symbol_table": [
        { "symbol": "x_{\\\\text{cm}}", "meaning": "Center of mass position", "unit": "m" },
        { "symbol": "m_i", "meaning": "Mass of individual particle", "unit": "kg" },
        { "symbol": "x_i", "meaning": "Position coordinate of particle", "unit": "m" },
        { "symbol": "M", "meaning": "Total system mass", "unit": "kg" }
      ],
      "solution_steps": "Step 1: Compute total mass M = 2.0 + 3.0 + 5.0 = 10.0 kg.\\nStep 2: Substitute masses and positions into the center of mass formula: x_cm = [(2.0)(1.0) + (3.0)(3.0) + (5.0)(-2.0)] / 10.0.\\nStep 3: Multiply mass-moments in numerator: x_cm = (2.0 + 9.0 - 10.0) / 10.0.\\nStep 4: Sum numerator terms: x_cm = 1.0 / 10.0.\\nStep 5: Compute final coordinate: x_cm = 0.10 m.",
      "key_takeaway": "Center of mass is the mass-weighted average position: x_cm = 0.10 m. Heavy particles shift the balance point toward them.",
      "practice_problem": {
        "question": "Three masses are located at x = -2m (5kg), x = 1m (2kg), and x = 3m (3kg). What is the center of mass position?",
        "given": ["m_1 = 2.0 kg, x_1 = 1.0 m", "m_2 = 3.0 kg, x_2 = 3.0 m", "m_3 = 5.0 kg, x_3 = -2.0 m"],
        "formulaHint": "x_{\\\\text{cm}} = \\\\frac{\\\\sum m_i x_i}{M}",
        "targetNumeric": 0.1,
        "unit": "m"
      }
    }
  }
  CRITICAL RULES FOR MATH CARDS:
  - TITLE IN "front": The "front" field MUST contain the clear, descriptive topic/problem title (e.g. "Center of Mass of Discrete Particles", "Torque from Lever Arm & Force", "Definite Integral of Polynomial").
  - IN PLAIN WORDS PLUS QUESTION EXAMPLE: "notebook_data.in_plain_words" MUST contain an intuitive explanation on line 1, followed by a newline (\\\\n) and an explicit question example starting with "Question Example: [State exact values and question]".
  - FORMULA LONG FORM VS SHORT FORM:
    * "formula_master" (Long form) MUST be the canonical expanded symbolic equation (e.g. "x_{\\\\text{cm}} = \\\\frac{m_1 x_1 + m_2 x_2 + m_3 x_3}{m_1 + m_2 + m_3}").
    * "formula_working" (Short form) MUST be the shorthanded or easy-to-understand symbolic representation (e.g. "x_{\\\\text{cm}} = \\\\frac{\\\\sum m_i x_i}{M}" or compact shorthand). NEVER put numerical substitutions, calculations, or answers in "formula_working"; it MUST be the shorthand formula itself.
  - GIVEN EXPRESSIONS (SAME SUBSCRIPT & SAME SI UNIT): In "notebook_data.problem_breakdown.given", when expressions share subscripts (e.g. m_1 and x_1), structure them with matching subscripts and consistent SI units so the UI can align same subscripts on the same row line and same SI units in the same column (without a table).
  - STEP-BY-STEP SOLUTION DERIVATION (CRITICAL):
    * MUST achieve the answer from the question to the answer without skipping any steps. Especially for integrals, derivatives, or algebra: show all intermediate steps (1. Setup, 2. Substitution, 3. Manipulation/Integration, 4. Boundary evaluation, 5. Arithmetic computation).
    * NEVER jump from question to final answer on Step 2.
    * NEVER label any step in the step-by-step solution as 'Final answer' or 'Result'. All steps are intermediate derivation steps, each with an informative mathematical explanation describing the operation (e.g. 'Substitute values', 'Apply power rule', 'Evaluate bounds'). The UI already has a dedicated green div for the final answer.
  - INTEGRALS & CALCULUS DERIVATIONS (MANDATORY ZERO-SKIP PROCEDURES):
    When an equation involves an integral (e.g. continuous center of mass x_cm = (1/M)\int x\,dm, moment of inertia I = \int r^2\,dm, work W = \int F\,dx, or any definite/indefinite integral):
    * The steps MUST show HOW the integral is computed step-by-step without skipping any calculus steps:
      1. Integral Setup & Limits: State the integral with explicit integration limits (e.g. M = \\int_0^{2.0} \\lambda(x)\\,dx = \\int_0^{2.0} 3.0x\\,dx). Explanation: "Set up total mass integral with limits from x = 0 to 2.0 m."
      2. Factor Constants: Move constant multipliers out of the integral (e.g. M = 3.0 \\int_0^{2.0} x\\,dx). Explanation: "Factor constant density coefficient outside integral."
      3. Antiderivative with Power Rule: Show the antiderivative in brackets with limits (e.g. M = 3.0 \\left[ \\frac{x^2}{2} \\right]_0^{2.0} = 1.5 \\left[ x^2 \\right]_0^{2.0}). Explanation: "Apply Power Rule for integration: \\int x\\,dx = x^2/2."
      4. Fundamental Theorem of Calculus: Explicitly show upper limit substitution minus lower limit substitution (e.g. M = 1.5 \\left( (2.0)^2 - (0)^2 \\right)). Explanation: "Substitute upper limit x = 2.0 and lower limit x = 0."
      5. Numerical Arithmetic: Evaluate the arithmetic step-by-step (e.g. M = 1.5(4.0) = 6.0\\text{ kg}). Explanation: "Compute arithmetic product to find total mass."
    * For composite formulas (like x_cm = (1/M)\\int x dm):
      6. Second Integral Setup: x_{\\text{cm}} = \\frac{1}{6.0} \\int_0^{2.0} x(3.0x)\\,dx = \\frac{1}{2} \\int_0^{2.0} x^2\\,dx. Explanation: "Substitute dm = 3.0x dx and total mass into center of mass formula."
      7. Antiderivative: x_{\\text{cm}} = \\frac{1}{2} \\left[ \\frac{x^3}{3} \\right]_0^{2.0}. Explanation: "Integrate x^2 using Power Rule: \\int x^2\\,dx = x^3/3."
      8. Boundary Substitution: x_{\\text{cm}} = \\frac{1}{2} \\left( \\frac{(2.0)^3}{3} - 0 \\right) = \\frac{1}{2} \\cdot \\frac{8.0}{3}. Explanation: "Evaluate definite integral at upper limit 2.0 and lower limit 0."
      9. Intermediate Fraction: x_{\\text{cm}} = \\frac{4.0}{3}\\text{ m}. Explanation: "Multiply and simplify fraction."
      10. Final Value: x_{\\text{cm}} \\approx 1.33\\text{ m}. Explanation: "Evaluate decimal value."
    * NEVER skip from an integral sign directly to an answer! The student must see the antiderivative formula, the bracket notation, and the boundary subtraction so they know exactly HOW to solve it.

- STRICT CODE CARDS SCHEMA (CodeLab):
  When programming code or algorithms exist, generate "code" cards using this strict separated schema:
  {
    "type": "code",
    "front": "Topic or Function Name (e.g. Object Property Assignment & Transformation)",
    "source_slide": 10,
    "code_language": "javascript",
    "syntax_formula": "Object.assign(target, ...sources)",
    "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
    "notebook_data": {
      "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
      "problem_breakdown": {
        "given": "A default configuration object and incoming user overrides must be combined into a fresh object reference without altering defaults.",
        "starter": "function mergeConfig(defaults, overrides) {\\n  // TODO: return merged object without mutating defaults\\n}"
      }
    },
    "starter": "function mergeConfig(defaults, overrides) {\\n  // TODO: return merged object without mutating defaults\\n}",
    "solution": "<!-- HTML Caller Host -->\\n<div id=\\\"app\\\"></div>\\n\\n<!-- Script Implementation -->\\n<script>\\nfunction mergeConfig(defaults, overrides) {\\n  return Object.assign({}, defaults, overrides);\\n}\\n\\nconst defaults = { theme: 'light', notifications: true };\\nconst overrides = { theme: 'dark' };\\nconst merged = mergeConfig(defaults, overrides);\\nconsole.log(JSON.stringify(merged));\\n</script>",
    "output": "{\\\"theme\\\":\\\"dark\\\",\\\"notifications\\\":true}",
    "code_lab_data": {
      "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
      "syntax_formula": "Object.assign(target, ...sources)",
      "given": "A default configuration object and incoming user overrides must be combined into a fresh object reference without altering defaults.",
      "script_complete": "<!-- HTML Caller Host -->\\n<div id=\\\"app\\\"></div>\\n\\n<!-- Script Implementation -->\\n<script>\\nfunction mergeConfig(defaults, overrides) {\\n  return Object.assign({}, defaults, overrides);\\n}\\n\\nconst defaults = { theme: 'light', notifications: true };\\nconst overrides = { theme: 'dark' };\\nconst merged = mergeConfig(defaults, overrides);\\nconsole.log(JSON.stringify(merged));\\n</script>",
      "data_map": [
        { "section": "Target", "fn": "target ({})", "concept": "Destination container", "memory_effect": "Allocates fresh heap pointer" },
        { "section": "Sources", "fn": "...sources (user)", "concept": "Keys & primitive values copied", "memory_effect": "Shallow copy only" }
      ],
      "variations": [
        {
          "title": "Object.assign() Shallow Merge",
          "use_case": "Standard ES6 shallow copy and rightmost property override",
          "code": "const clone = Object.assign({}, defaults, overrides);",
          "explanation": "Copies own enumerable properties from sources into target object in order."
        },
        {
          "title": "Object.create() Prototype Chaining",
          "use_case": "Inheriting default properties via prototype chain without copying keys",
          "code": "const childConfig = Object.create(defaults);\\nchildConfig.theme = 'dark';",
          "explanation": "Creates a new object whose prototype points to defaults, preserving root defaults."
        },
        {
          "title": "Object.fromEntries() Key-Value Mapping",
          "use_case": "Transforming key-value tuples back into a structured dictionary",
          "code": "const entries = Object.entries(overrides);\\nconst filtered = Object.fromEntries(entries.filter(([k]) => k !== 'secret'));",
          "explanation": "Converts an iterable of [key, val] pairs into an object, ideal for filtering configs."
        },
        {
          "title": "Spread Syntax Alternative",
          "use_case": "Modern shallow cloning in ES6+",
          "code": "const clone = { ...defaults, ...overrides };",
          "explanation": "Syntactic sugar for Object.assign with clean concise syntax."
        }
      ],
      "codedrill": {
        "build": {
          "q": "Create a function that totals a list of prices. If total is over 100, apply a 10% discount. Return or print the amount to pay.",
          "h": "Compute the sum first, then apply a conditional decision.",
          "tests": [
            ["Calculates sum", "\\b(for|reduce|sum|\\+=)\\b"],
            ["Decides with conditional", "\\bif\\b"],
            ["Applies 10% discount", "(0\\.9|0\\.1|10\\s*/\\s*100)"],
            ["Returns or prints result", "\\b(return|console\\.log|print|System\\.out\\.print)\\b"]
          ]
        },
        "debug": {
          "q": "Fix the syntax errors and missing punctuation.",
          "h": "One line is missing a block delimiter or colon, another has unclosed parentheses.",
          "lines": [
            "function computeTotal(prices) {",
            "  let total = 0;",
            "  for (let p of prices",
            "    total += p;",
            "  return total;",
            "}",
            "console.log(computeTotal([40, 60]"
          ],
          "fix": {
            "2": "  for (let p of prices) {",
            "6": "console.log(computeTotal([40, 60]));"
          }
        },
        "order": {
          "q": "Put the lines in order.",
          "lines": [
            "function countMatches(items, target) {",
            "  let count = 0;",
            "  for (let item of items) {",
            "    if (item === target) {",
            "      count += 1;",
            "    }",
            "  }",
            "  return count;",
            "}"
          ],
          "shuffled": [4, 1, 0, 7, 3, 2, 8, 5, 6]
        }
      },
      "practice_challenge": {
        "prompt": "Merge defaults { theme: 'dark', sound: true } with user preferences { sound: false } without mutating defaults.",
        "starterCode": "function mergeConfig(userPref) {\\n  const defaults = { theme: 'dark', sound: true };\\n  // return merged config\\n}",
        "solutionKeywords": ["Object.assign", "defaults", "userPref"],
        "explanation": "Object.assign({}, defaults, userPref) applies rightmost overrides onto a fresh empty target.",
        "simulatedOutput": "{ theme: 'dark', sound: false }"
      },
      "bug_hunter": {
        "prompt": "The clone function accidentally mutates the original source object instead of returning a fresh copy. Fix it.",
        "buggy_code": "function cloneUser(user) {\\n  return Object.assign(user, { active: true });\\n}",
        "bug_descriptions": ["Passing 'user' as the first argument mutates user in-place instead of creating a fresh empty target object '{}'."],
        "clean_solution": "function cloneUser(user) {\\n  return Object.assign({}, user, { active: true });\\n}",
        "simulated_output": "{ id: 1, name: 'Alice', active: true } (original user object unchanged)"
      }
    }
  }
  CRITICAL RULES FOR CODE CARDS:
  - MASTER SYNTAX BLUEPRINT IN "syntax_formula": The "syntax_formula" field MUST be the generic canonical syntax pattern / signature / blueprint — like "functionName(param1, param2)" or "const result = methodName(target, ...args)" or "arr.reduce((acc, curr) => ..., initialVal)".
  - NEVER write full function implementations or multiline function bodies in "syntax_formula". Keep it strictly as the concise master syntax pattern like functionName(param1, param2) instead of writing the whole function body in master syntax.
  - "in_plain_words" MUST HAVE 3 PARTS:
    1. Line 1: Plain-language concept summary.
    2. Line 2: Explicit count of code variations/scenarios: "Contains [N] code variations across [concept]: [List variations]..." (just like MathLab has how many equations in plain words).
    3. Line 3: "Problem Scenario: [A real-world engineering challenge to solve]".
  - GIVEN AND STARTER MUST NOT BE THE SAME:
    * "given" (in "notebook_data.problem_breakdown.given" and "code_lab_data.given"): This is what the question/problem is, more like a problem/scenario to solve (e.g. "Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.").
    * "starter": This is the code template / skeleton where the student writes code (e.g. "function mergeConfig(defaults, overrides) {\\n  // TODO\\n}").
    * They MUST be completely distinct: given is the natural language problem scenario; starter is the skeleton code.
  - NO STEP-BY-STEP SOLUTION BREAKDOWNS IN CODELAB:
    * Do NOT output numbered step-by-step arrays for code cards.
    * There is ONLY ONE giant complete runnable script that the concept is used from:
      - Java: complete with class declaration, "public static void main(String[] args)", sample invocations, and "System.out.println" output.
      - JavaScript: complete with HTML caller tags and "<script>" tags at the top separated by comment lines:
        <!-- HTML Caller Host -->\\n<div id=\\\"app\\\"></div>\\n\\n<!-- Script Implementation -->\\n<script>\\n...\\n</script>
      - Python: complete runnable script with proper indentation, imports, function declarations, and "if __name__ == '__main__':" block.
      - Format inline scripts cleanly with \\n and escaped quotes so standard JSON parsers read it without errors.
    * Stored in "solution" and "code_lab_data.script_complete".
  - VARIATIONS: Provide at least 2-4 alternative implementations or related patterns in "code_lab_data.variations" (e.g. for OOP methods and key-value pairs: Object.assign, Object.create, Object.fromEntries, spread syntax).
  - CODELAB EXAM DATA ("code_lab_data.codedrill"):
    * "build": Scenario-based coding problem with a test array of [label, regex] to evaluate the student's code in the console without giving away the topic upfront.
    * "debug": Code with 1-2 intentional bugs (missing syntax or inverted order) and a "fix" dictionary mapping lineIndex -> correctedLine string.
    * "order": Array of lines in correct order, with "shuffled" 0-based indices to challenge the student to put the lines back in order.

======================================================================
2. INPUT METADATA & SOURCE MATERIAL
======================================================================
Topic: {{TOPIC}}
Subject: {{SUBJECT}}
Chapter: {{CHAPTER}}
Lesson: {{LESSON}}

Source Material:
"""
{{SOURCE_TEXT}}
"""

Already Emitted Fronts (do not duplicate or restate any of these):
"""
{{ALREADY_EMITTED_FRONTS}}
"""

======================================================================
3. SOURCE QUALITY, AUDIT & UNREADABLE SLIDES
======================================================================
- UNREADABLE / EMPTY SLIDES:
  Slides marked "[Slide contains visual diagrams or images]" have no parseable text.
  Do NOT create cards from empty or unreadable slides. List their 1-based slide numbers in the top-level "unreadable_slides" array (e.g. [3, 7]).

- SOURCE ISSUES LOGGING ("source_issues"):
  If the source material contains obvious typos, incorrect labels, arithmetic errors, or broken formulas (e.g., "27+30+35/3=30.7" missing parentheses, or "Get Their Ages" under a color example):
  1. Record the issue in the top-level "source_issues" array:
     [
       {
         "slide": 23,
         "issue": "Formula missing parentheses: 27+30+35/3=30.7",
         "suggested_fix": "(27+30+35)/3 = 30.67"
       }
     ]
  2. Study notes MUST retain the verbatim source wording.
  3. Any QUIZ questions (multiple_choice, true_false) built from that fact MUST test the corrected value and explicitly state the fix in the explanation.

======================================================================
4. NOTE STYLE PRECEDENCE & SELECTIVE 3D PERSONAL LEARNING GRAPH FORMAT
======================================================================
When generating "keyword" study notes, DO NOT dump dry 1D verbatim paragraphs as the main note body.
CRITICAL AUDIT-FIRST RULE: DO NOT blindly force "what_breaks", tables, and ASCII diagrams onto every card!
Before generating blocks for each card, FIRST AUDIT the topic to determine its true nature, and choose ONLY the 2 to 4 representation blocks from the Personal Learning Graph Menu below that genuinely fit the audited topic:

• TOPIC AUDIT CRITERIA (CHOOSE ONLY WHAT FITS):
1. Algorithmic / Systems / Protocol Failure Mode:
   - Does this topic represent a system mechanism, protocol, or algorithm that freezes, crashes, drops packets, leaks memory, or corrupts data if omitted?
   - IF YES: Include "what_breaks" (1-2 sentences with physical Action-Noun Nickname) and/or "switch_tldr" (Fast vs Fallback path).
   - IF NO (e.g. definitions, historical facts, taxonomy overviews, formulas, properties): NEVER include "what_breaks"!
2. Multi-Item Comparison / Boundary / Numerical Matrix:
   - Does this topic compare multiple entities, contrast boundaries (RAM vs Wire, Client vs Server), or present numerical matrices/bins?
   - IF YES: Include "table".
   - IF NO: NEVER force an empty, trivial, or artificial table!
3. Branching Decision / Dual Pipeline:
   - Does the process branch into two distinct operational paths (Fast vs Slow, Cache Hit vs Miss, Base Case vs Recursive)?
   - IF YES: Include "ascii_diagram".
   - IF NO: Omit ASCII diagrams.
4. Mathematical / Physics Equation:
   - Does the topic define a formula or numerical calculation?
   - IF YES: Include "formula" + zero-skip "example" with real numbers plugged in.
5. Ordered Procedure / Lifecycle / Workflow:
   - Does the topic describe sequential stages, phases, or algorithmic steps?
   - IF YES: Include "steps" (items array).
6. Core Term / Taxonomy / Fundamental Principle:
   - Include "definition" with clear mechanical intuition and/or "note".
7. Trade-offs / Design Decisions:
   - Include "pros_cons" with "pros" and "cons" arrays.
8. Exact Source Text (MANDATORY on EVERY card):
   - ALWAYS append a final { "kind": "verbatim", "label": "Verbatim Source Wording", "slide": <slide_number>, "text": "<exact word-for-word text from the slide/document>" } block at the very end of "back_blocks". The UI has a dedicated top Verbatim tab that displays this original text 1:1.

STRUCTURED "back_blocks" MENU (CHOOSE 2 TO 4 PER CARD):
For every "keyword" card, output "back_blocks" as an array of typed block objects:
- { "kind": "definition", "term": "<Term Name (Action Nickname)>", "text": "<clear mechanical definition>" }
  (Renderer applies bold from "term". Do NOT emit ** markers inside back_blocks!)
- { "kind": "steps", "label": "<Procedure / Lifecycle Name>", "items": ["Step 1 description", "Step 2 description"] }
  (Put each distinct step or phase in its own item array element; never pack several steps into a run-on string.)
- { "kind": "table", "label": "<Table Title>", "columns": ["Item / Pattern", "Exact Mechanical Step / Where Created", "Result / Boundary"], "rows": [["R1A", "R1B", "R1C"], ["R2A", "R2B", "R2C"]] }
  (Use ONLY when data, bins, numbers, or comparison matrices naturally exist. Cell values may safely contain commas.)
- { "kind": "formula", "label": "<Formula Title>", "text": "12 / 3 = 4" }
- { "kind": "example", "label": "<Concrete Plug-In Example>", "text": "<specific illustration with real numbers plugged in>" }
- { "kind": "what_breaks", "label": "If You Do Nothing — What Breaks?", "nickname": "<Physical Action-Noun Nickname>", "text": "<1-2 sentences: what breaks, freezes, or fails without this concept>" } (ONLY for mechanisms with real failure modes!)
- { "kind": "ascii_diagram", "label": "<2-Branch Flow Name>", "diagram": "[Input] ---> [Path A: Fast/Match] ---> [Result A]\\n        \\\\--> [Path B: Slow/Fallback] -> [Result B]" } (ONLY for branching processes!)
- { "kind": "switch_tldr", "label": "3-Sentence Switch TL;DR", "match_path": "<Fast/Match path>", "mismatch_path": "<Slow/Mismatch path>", "checker": "<The rule/tool that checks which path runs>" } (ONLY for two-way switches!)
- { "kind": "pros_cons", "label": "Advantages & Disadvantages", "pros": ["Pro point 1", "Pro point 2"], "cons": ["Con point 1", "Con point 2"] }
- { "kind": "note", "text": "<additional remarks, caveats, or conditions>" }
- { "kind": "verbatim", "label": "Verbatim Source Wording", "slide": 1, "text": "<EXACT word-for-word text extracted from the source slide/document>" }
  (MANDATORY as the LAST block of every "keyword" card!)

Block Label Rules:
- Never repeat the card front/heading inside block labels. Under a card titled "Equal-Frequency Binning", use labels such as "Procedure", "Bin Assignment", "Items per bin", NEVER "Equal-Frequency Binning Procedure".
- Legacy single string "back" is also acceptable for flashcard/definition types, but keyword notes should prefer "back_blocks".
- Use "pros_cons" for trade-offs instead of padding tables with empty "" cells.

======================================================================
5. DECK GENERATION ORDER
======================================================================
Emit the cards array in this exact sequence:
1. MathLab & CodeLab: "math" and "code" cards (FIRST, but ONLY if the source contains real equations or code).
2. Comprehensive Study Notes: "keyword" cards with "back_blocks" in chronological source order (1 per slide/block).
3. Chronological Timeline Card: "keyword" card with front="Chronological Timeline" (ONLY if the material covers dated historical events or chronologies).
4. Miscellaneous Notes Card: "keyword" card with front="Miscellaneous & Key Details" covering edge cases, takeaways, and overarching concepts.
5. Active Recall Lists: "enumeration" cards (lists with 2+ items).
6. Flashcards: "definition" cards (front: question/concept, back: concise answer).
7. Mastery Quizzes: "multiple_choice" and "true_false" cards.

======================================================================
6. ACTIVE RECALL LISTS & QUIZ CARDS QUALITY RULES (40% CONCISENESS INVARIANT)
======================================================================
- Essential Enumerations ("enumeration"):
  * Generate ONLY essential, core enumerations: canonical taxonomies, multi-step procedures, named layers/categories, authoritative criteria, and fundamental classifications directly from the source material.
  * CANONICAL LISTS FOR ACTIVE RECALL: Retain all canonical, testable lists (taxonomies, layers, steps, principles) as enumeration cards even if they are referenced in note tables or definition blocks. Notes provide passive reference, while enumeration cards provide essential active recall testing. Only omit arbitrary bullet fragments or trivia.
  * ORDERED ENUMERATIONS: If a list has a mandatory sequence or directional hierarchy (e.g. OSI layers, pipeline stages, lifecycle phases, priority levels), explicitly reflect this in the title using "from ... to ..." or "in order" (e.g. "OSI Model Layers from Layer 7 (Application) down to Layer 1 (Physical)", "Compilation Phases from Source Code to Executable") so the system enforces ordered checking.
  * Exactly 2 to 10 items in "enum_items" array.
- Streamlined Multiple Choice ("multiple_choice"):
  * Provide the question in "front" and the concise correct answer in "back" (or "mc": { "correct": "..." }).
  * NO fill-in blanks ('___') anywhere in questions, answers, or distractors.
  * When asking what a concept/component does, start answer text with an active verb (e.g. 'is...', 'combines...', 'manages...', 'enables...', 'provides...').
  * Parallel categorical terminology: Options must share parallel domain words and categorical endings (e.g. if the answer is 'Core Layer', parallel distractors must also end with 'Layer' like 'Internet Layer', 'Distribution Layer', 'Access Layer').
  * DO NOT output distractors in the prompt. The in-app distractor engine automatically pairs each question with 3 distractors of matching word length and semantic topic in bulk, cutting ~20% token bloat.
  * Distribute quiz questions proportionally across all slides so no section is neglected.
- True / False ("true_false"):
  * Nuanced, meaningful statements directly testing concepts.
  * Explanation is mandatory and MUST cite the source slide or section: "Slide 14 confirms that..." or "Section 2 confirms that...".
- ONE FACT PER QUIZ MODE (ZERO REDUNDANCY):
  * Never test the exact same fact or concept twice within the same quiz mode (e.g. do NOT generate two multiple choice questions on the same fact).
  * Skip recap/summary cards if all rows are already covered by earlier topic cards.
  * If the source material has no slide markers, cite the section header (e.g. "Section 3 confirms that...") or PDF page number instead of guessing slide numbers.

======================================================================
7. IMAGES POLICY
======================================================================
- "images" is optional.
- Include an image ONLY if a URL appears verbatim in the source material or a search tool result in this conversation.
- Never construct, guess, or recall URLs from memory.
- If no verified URLs exist, emit "images": [].

======================================================================
8. JSON ESCAPING & TOKEN SAFETY RULES
======================================================================
- Output ONE valid JSON object.
- Do NOT wrap output in markdown code fences (\`\`\`json).
- Do NOT provide any conversational preamble, commentary, or markdown prose before or after the JSON.
- Every LaTeX command must be double-escaped: "\\\\frac", "\\\\cdot", "\\\\times", "\\\\text{ N}", "\\\\sigma".
- Every newline inside a JSON string must be written as \\n. Never emit a raw line break inside a string.
- TOKEN SAFETY & CONTINUATION:
  If the output approaches token limits, STOP immediately after the last COMPLETE card and emit this sentinel alone on its own line:
CONTINUE_FROM_NEXT_ROW
  When the entire deck is fully complete, emit this sentinel alone on its own line:
END_OF_JSON

======================================================================
9. CANONICAL JSON OUTPUT SCHEMA
======================================================================
{
  "title": "Descriptive Deck Title (e.g. Data Preprocessing: Binning and Discretization)",
  "subject": "{{SUBJECT}}",
  "chapter": "{{CHAPTER}}",
  "lesson": "{{LESSON}}",
  "source_issues": [
    {
      "slide": 12,
      "issue": "Missing operator in formula: A B = C",
      "suggested_fix": "A \\\\times B = C"
    }
  ],
  "unreadable_slides": [],
  "images": [],
  "cards": [
    {
      "type": "math",
      "front": "Center of Mass of Discrete Particles (1D)",
      "source_slide": 6,
      "math_category": "Physics",
      "math_difficulty": "Intermediate",
      "formula": "x_{\\\\text{cm}} = \\\\frac{m_1 x_1 + m_2 x_2 + m_3 x_3}{m_1 + m_2 + m_3}",
      "variables": [
        { "symbol": "x_{\\\\text{cm}}", "meaning": "center of mass coordinate", "unit": "m" },
        { "symbol": "m_i", "meaning": "mass of particle i", "unit": "kg" },
        { "symbol": "x_i", "meaning": "position coordinate of particle i", "unit": "m" },
        { "symbol": "M", "meaning": "total system mass", "unit": "kg" }
      ],
      "worked_example": {
        "given": "m_1 = 2.0 kg, x_1 = 1.0 m; m_2 = 3.0 kg, x_2 = 3.0 m; m_3 = 5.0 kg, x_3 = -2.0 m",
        "steps": [
          "M = 2.0 + 3.0 + 5.0 = 10.0\\\\text{ kg}",
          "x_{\\\\text{cm}} = \\\\frac{(2.0)(1.0) + (3.0)(3.0) + (5.0)(-2.0)}{10.0}",
          "x_{\\\\text{cm}} = \\\\frac{2.0 + 9.0 - 10.0}{10.0}",
          "x_{\\\\text{cm}} = \\\\frac{1.0}{10.0}",
          "x_{\\\\text{cm}} = 0.10\\\\text{ m}"
        ],
        "answer": "0.10 m"
      },
      "notebook_data": {
        "in_plain_words": "The center of mass is the balance point of a system of particles where heavier objects pull the balance point closer to themselves.\\nQuestion Example: Three point masses m_1 = 2.0 kg at x_1 = 1.0 m, m_2 = 3.0 kg at x_2 = 3.0 m, and m_3 = 5.0 kg at x_3 = -2.0 m are placed on the x-axis. Find the center of mass x_cm.",
        "problem_breakdown": {
          "restate": "Calculate the center of mass coordinate x_cm for three particles along the x-axis.",
          "given": [
            "m_1 = 2.0\\\\text{ kg}, x_1 = 1.0\\\\text{ m}",
            "m_2 = 3.0\\\\text{ kg}, x_2 = 3.0\\\\text{ m}",
            "m_3 = 5.0\\\\text{ kg}, x_3 = -2.0\\\\text{ m}"
          ],
          "formula_master": "x_{\\\\text{cm}} = \\\\frac{m_1 x_1 + m_2 x_2 + m_3 x_3}{m_1 + m_2 + m_3}",
          "formula_working": "x_{\\\\text{cm}} = \\\\frac{\\\\sum m_i x_i}{M}"
        },
        "symbol_table": [
          { "symbol": "x_{\\\\text{cm}}", "meaning": "Center of mass coordinate", "unit": "m" },
          { "symbol": "m_i", "meaning": "Mass of individual particle", "unit": "kg" },
          { "symbol": "x_i", "meaning": "Position coordinate of particle", "unit": "m" },
          { "symbol": "M", "meaning": "Total system mass", "unit": "kg" }
        ],
        "solution_steps": "Step 1: Compute total mass M = 2.0 + 3.0 + 5.0 = 10.0 kg.\\nStep 2: Substitute masses and positions into formula: x_cm = [(2.0)(1.0) + (3.0)(3.0) + (5.0)(-2.0)] / 10.0.\\nStep 3: Multiply mass-moments in numerator: x_cm = (2.0 + 9.0 - 10.0) / 10.0.\\nStep 4: Sum numerator terms: x_cm = 1.0 / 10.0.\\nStep 5: Compute final coordinate: x_cm = 0.10 m.",
        "key_takeaway": "Center of mass is the mass-weighted average position: x_cm = 0.10 m. Heavy particles shift the balance point toward them.",
        "practice_problem": {
          "question": "Three masses are located at x = -2m (5kg), x = 1m (2kg), and x = 3m (3kg). What is the center of mass position?",
          "given": ["m_1 = 2.0 kg, x_1 = 1.0 m", "m_2 = 3.0 kg, x_2 = 3.0 m", "m_3 = 5.0 kg, x_3 = -2.0 m"],
          "formulaHint": "x_{\\\\text{cm}} = \\\\frac{\\\\sum m_i x_i}{M}",
          "targetNumeric": 0.1,
          "unit": "m"
        }
      }
    },
    {
      "type": "math",
      "front": "Center of Mass of a Continuous Distribution (Integral)",
      "source_slide": 7,
      "math_category": "Physics",
      "math_difficulty": "Intermediate",
      "formula": "x_{\\\\text{cm}} = \\\\frac{1}{M}\\\\int x\\\\,dm",
      "variables": [
        { "symbol": "x_{\\\\text{cm}}", "meaning": "Center of mass coordinate", "unit": "m" },
        { "symbol": "M", "meaning": "Total rod mass found by integrating dm", "unit": "kg" },
        { "symbol": "dm", "meaning": "Infinitesimal mass element \\\\lambda(x)\\\\,dx", "unit": "kg" },
        { "symbol": "\\\\lambda(x)", "meaning": "Linear mass density function (kg/m)", "unit": "kg/m" }
      ],
      "worked_example": {
        "given": "Rod from x = 0 to 2.0 m with \\\\lambda(x) = 3.0x\\\\text{ kg/m}",
        "steps": [
          "M = \\\\int_0^{2.0} 3.0x\\\\,dx",
          "M = 3.0 \\\\int_0^{2.0} x\\\\,dx",
          "M = 3.0 \\\\left[ \\\\frac{x^2}{2} \\\\right]_0^{2.0} = 1.5 \\\\left[ x^2 \\\\right]_0^{2.0}",
          "M = 1.5 \\\\left( (2.0)^2 - 0 \\\\right) = 1.5(4.0) = 6.0\\\\text{ kg}",
          "x_{\\\\text{cm}} = \\\\frac{1}{6.0}\\\\int_0^{2.0} x(3.0x)\\\\,dx",
          "x_{\\\\text{cm}} = \\\\frac{3.0}{6.0}\\\\int_0^{2.0} x^2\\\\,dx = \\\\frac{1}{2}\\\\int_0^{2.0} x^2\\\\,dx",
          "x_{\\\\text{cm}} = \\\\frac{1}{2}\\\\left[ \\\\frac{x^3}{3} \\\\right]_0^{2.0}",
          "x_{\\\\text{cm}} = \\\\frac{1}{2}\\\\left( \\\\frac{8.0}{3} - 0 \\\\right) = \\\\frac{4.0}{3}\\\\text{ m}",
          "x_{\\\\text{cm}} \\\\approx 1.33\\\\text{ m}"
        ],
        "answer": "1.33 m"
      },
      "notebook_data": {
        "in_plain_words": "For continuous objects where density varies, we integrate infinitesimal mass elements dm = \\\\lambda(x) dx to find total mass and the center-of-mass balance point.\\\\nQuestion Example: A thin non-uniform rod extends from x = 0 to x = 2.0 m with linear mass density \\\\lambda(x) = 3.0x kg/m. Find total mass M and center of mass x_cm.",
        "problem_breakdown": {
          "restate": "Evaluate the definite integrals for total mass M and center of mass x_cm of a rod with linear density \\\\lambda(x) = 3.0x from x = 0 to 2.0 m.",
          "given": [
            "x_1 = 0\\\\text{ m}, x_2 = 2.0\\\\text{ m}",
            "\\\\lambda(x) = 3.0x\\\\text{ kg/m}"
          ],
          "formula_master": "x_{\\\\text{cm}} = \\\\frac{\\\\int x\\\\,\\\\lambda(x)\\\\,dx}{\\\\int \\\\lambda(x)\\\\,dx}",
          "formula_working": "x_{\\\\text{cm}} = \\\\frac{1}{M}\\\\int x\\\\,dm"
        },
        "symbol_table": [
          { "symbol": "x_{\\\\text{cm}}", "meaning": "Center of mass coordinate", "unit": "m" },
          { "symbol": "M", "meaning": "Total rod mass", "unit": "kg" },
          { "symbol": "\\\\lambda(x)", "meaning": "Linear mass density function", "unit": "kg/m" },
          { "symbol": "dm", "meaning": "Infinitesimal mass element \\\\lambda dx", "unit": "kg" }
        ],
        "solution_steps": "Step 1: Set up total mass integral: M = \\\\int_0^{2.0} 3.0x\\\\,dx.\\\\nStep 2: Factor constant: M = 3.0 \\\\int_0^{2.0} x\\\\,dx.\\\\nStep 3: Antiderivative via Power Rule: M = 3.0 [x^2/2]_0^{2.0} = 1.5 [x^2]_0^{2.0}.\\\\nStep 4: Evaluate bounds (upper minus lower): M = 1.5(2.0^2 - 0) = 6.0 kg.\\\\nStep 5: Set up center of mass integral: x_cm = (1/6.0) \\\\int_0^{2.0} x(3.0x)\\\\,dx.\\\\nStep 6: Combine integrand terms: x_cm = (3.0/6.0) \\\\int_0^{2.0} x^2\\\\,dx = (1/2) \\\\int_0^{2.0} x^2\\\\,dx.\\\\nStep 7: Antiderivative via Power Rule: x_cm = (1/2) [x^3/3]_0^{2.0}.\\\\nStep 8: Evaluate bounds: x_cm = (1/2)(8.0/3 - 0) = 4.0/3 m.\\\\nStep 9: Compute final decimal: x_cm ≈ 1.33 m.",
        "key_takeaway": "Because mass density increases linearly along the rod, the center of mass (1.33 m) sits to the right of the geometric midpoint (1.0 m).",
        "practice_problem": {
          "question": "A rod extends from x = 0 to 2.0 m with linear density \\\\lambda(x) = 3.0x kg/m. Find its center of mass coordinate x_cm.",
          "given": ["x \\\\in [0, 2.0]\\\\text{ m}", "\\\\lambda(x) = 3.0x\\\\text{ kg/m}"],
          "formulaHint": "x_{\\\\text{cm}} = \\\\frac{1}{M}\\\\int_0^L x\\\\lambda(x)\\\\,dx",
          "targetNumeric": 1.33,
          "unit": "m"
        }
      }
    },
    {
      "type": "code",
      "front": "Object Property Assignment & Transformation (Object.assign)",
      "source_slide": 10,
      "code_language": "javascript",
      "syntax_formula": "Object.assign(target, ...sources)",
      "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
      "notebook_data": {
        "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
        "problem_breakdown": {
          "given": "A default configuration object and incoming user overrides must be combined into a fresh object reference without altering defaults.",
          "starter": "function mergeConfig(defaults, overrides) {\\n  // TODO: return merged object without mutating defaults\\n}"
        }
      },
      "starter": "function mergeConfig(defaults, overrides) {\\n  // TODO: return merged object without mutating defaults\\n}",
      "solution": "<!-- HTML Caller Host -->\\n<div id=\\\"app\\\"></div>\\n\\n<!-- Script Implementation -->\\n<script>\\nfunction mergeConfig(defaults, overrides) {\\n  return Object.assign({}, defaults, overrides);\\n}\\n\\nconst defaults = { theme: 'light', notifications: true };\\nconst overrides = { theme: 'dark' };\\nconst merged = mergeConfig(defaults, overrides);\\nconsole.log(JSON.stringify(merged));\\n</script>",
      "output": "{\\\"theme\\\":\\\"dark\\\",\\\"notifications\\\":true}",
      "code_lab_data": {
        "in_plain_words": "Copies all enumerable own properties from one or more source objects to a target object, returning the mutated target.\\nContains 3 code variations across OOP key-value pair methods: Object.assign, Object.create, and Object.fromEntries.\\nProblem Scenario: Create a user configuration manager that applies incoming settings over system defaults without mutating the root default object.",
        "syntax_formula": "Object.assign(target, ...sources)",
        "given": "A default configuration object and incoming user overrides must be combined into a fresh object reference without altering defaults.",
        "script_complete": "<!-- HTML Caller Host -->\\n<div id=\\\"app\\\"></div>\\n\\n<!-- Script Implementation -->\\n<script>\\nfunction mergeConfig(defaults, overrides) {\\n  return Object.assign({}, defaults, overrides);\\n}\\n\\nconst defaults = { theme: 'light', notifications: true };\\nconst overrides = { theme: 'dark' };\\nconst merged = mergeConfig(defaults, overrides);\\nconsole.log(JSON.stringify(merged));\\n</script>",
        "data_map": [
          { "section": "Target", "fn": "target ({})", "concept": "Destination container", "memory_effect": "Allocates fresh heap pointer" },
          { "section": "Sources", "fn": "...sources (user)", "concept": "Keys & primitive values copied", "memory_effect": "Shallow copy only" }
        ],
        "variations": [
          {
            "title": "Object.assign() Shallow Merge",
            "use_case": "Standard ES6 shallow copy and rightmost property override",
            "code": "const clone = Object.assign({}, defaults, overrides);",
            "explanation": "Copies own enumerable properties from sources into target object in order."
          },
          {
            "title": "Object.create() Prototype Chaining",
            "use_case": "Inheriting default properties via prototype chain without copying keys",
            "code": "const childConfig = Object.create(defaults);\\nchildConfig.theme = 'dark';",
            "explanation": "Creates a new object whose prototype points to defaults, preserving root defaults."
          },
          {
            "title": "Object.fromEntries() Key-Value Mapping",
            "use_case": "Transforming key-value tuples back into a structured dictionary",
            "code": "const entries = Object.entries(overrides);\\nconst filtered = Object.fromEntries(entries.filter(([k]) => k !== 'secret'));",
            "explanation": "Converts an iterable of [key, val] pairs into an object, ideal for filtering configs."
          },
          {
            "title": "Spread Syntax Alternative",
            "use_case": "Modern shallow cloning in ES6+",
            "code": "const clone = { ...defaults, ...overrides };",
            "explanation": "Syntactic sugar for Object.assign with clean concise syntax."
          }
        ],
        "codedrill": {
          "build": {
            "q": "Create a function that totals a list of prices. If total is over 100, apply a 10% discount. Return or print the amount to pay.",
            "h": "Compute the sum first, then apply a conditional decision.",
            "tests": [
              ["Calculates sum", "\\b(for|reduce|sum|\\+=)\\b"],
              ["Decides with conditional", "\\bif\\b"],
              ["Applies 10% discount", "(0\\.9|0\\.1|10\\s*/\\s*100)"],
              ["Returns or prints result", "\\b(return|console\\.log|print|System\\.out\\.print)\\b"]
            ]
          },
          "debug": {
            "q": "Fix the syntax errors and missing punctuation.",
            "h": "One line is missing a block delimiter or colon, another has unclosed parentheses.",
            "lines": [
              "function computeTotal(prices) {",
              "  let total = 0;",
              "  for (let p of prices",
              "    total += p;",
              "  return total;",
              "}",
              "console.log(computeTotal([40, 60]"
            ],
            "fix": {
              "2": "  for (let p of prices) {",
              "6": "console.log(computeTotal([40, 60]));"
            }
          },
          "order": {
            "q": "Put the lines in order.",
            "lines": [
              "function countMatches(items, target) {",
              "  let count = 0;",
              "  for (let item of items) {",
              "    if (item === target) {",
              "      count += 1;",
              "    }",
              "  }",
              "  return count;",
              "}"
            ],
            "shuffled": [4, 1, 0, 7, 3, 2, 8, 5, 6]
          }
        },
        "practice_challenge": {
          "prompt": "Merge defaults { theme: 'dark', sound: true } with user preferences { sound: false } without mutating defaults.",
          "starterCode": "function mergeConfig(userPref) {\\n  const defaults = { theme: 'dark', sound: true };\\n  // return merged config\\n}",
          "solutionKeywords": ["Object.assign", "defaults", "userPref"],
          "explanation": "Object.assign({}, defaults, userPref) applies rightmost overrides onto a fresh empty target.",
          "simulatedOutput": "{ theme: 'dark', sound: false }"
        },
        "bug_hunter": {
          "prompt": "The clone function accidentally mutates the original source object instead of returning a fresh copy. Fix it.",
          "buggy_code": "function cloneUser(user) {\\n  return Object.assign(user, { active: true });\\n}",
          "bug_descriptions": ["Passing 'user' as the first argument mutates user in-place instead of creating a fresh empty target object '{}'."],
          "clean_solution": "function cloneUser(user) {\\n  return Object.assign({}, user, { active: true });\\n}",
          "simulated_output": "{ id: 1, name: 'Alice', active: true } (original user object unchanged)"
        }
      }
    },
    {
      "type": "keyword",
      "front": "Equal-Frequency Binning and Smoothing",
      "source_slide": 14,
      "back_blocks": [
        {
          "kind": "what_breaks",
          "label": "If You Do Nothing — What Breaks?",
          "nickname": "Bucket Equalizer",
          "text": "Without equal-frequency binning, skewed outliers leave some intervals empty and overload others, letting raw sensor noise distort downstream models."
        },
        {
          "kind": "ascii_diagram",
          "label": "2-Branch Smoothing Flow",
          "diagram": "[Sorted Bin: 4, 8, 9, 15] ---> [Path A: Smooth by Mean] -------> [9, 9, 9, 9]\n                          \\--> [Path B: Smooth by Boundaries] -> [4, 4, 4, 15]"
        },
        {
          "kind": "definition",
          "term": "Equal-Frequency Binning (Bucket Equalizer)",
          "text": "Sorts raw data and slices it into k buckets so every bucket holds the exact same count of N/k items."
        },
        {
          "kind": "steps",
          "label": "Zero-Skip Procedure",
          "items": [
            "Sort the raw dataset values in ascending order",
            "Determine bin capacity: divide total count N by number of bins k",
            "Assign items sequentially into bins",
            "Smooth by replacing values with bin means or bin boundaries"
          ]
        },
        {
          "kind": "table",
          "label": "Bin Assignment Example",
          "columns": ["Bin", "Original Values", "Bin Mean", "Bin Boundaries"],
          "rows": [
            ["G1", "4, 8, 9, 15", "9, 9, 9, 9", "4, 4, 4, 15"],
            ["G2", "21, 21, 24, 25", "23, 23, 23, 23", "21, 21, 25, 25"],
            ["G3", "26, 28, 29, 34", "29, 29, 29, 29", "26, 26, 26, 34"]
          ]
        },
        {
          "kind": "formula",
          "label": "Bin Capacity Calculation",
          "text": "12 \\\\div 3 = 4\\\\text{ items per bin}"
        },
        {
          "kind": "switch_tldr",
          "label": "3-Sentence Switch TL;DR",
          "match_path": "Smooth by Bin Means -> Replace every number in the bucket with the bucket average (e.g. 4, 8, 9, 15 all become 9).",
          "mismatch_path": "Smooth by Bin Boundaries -> Snap each inner number to whichever edge (min 4 or max 15) is physically closer.",
          "checker": "Distance to min vs max boundary (|x - min| vs |max - x|) checks which edge wins in boundary smoothing."
        },
        {
          "kind": "verbatim",
          "label": "Verbatim Source Wording",
          "slide": 14,
          "text": "Equal-frequency (equi-depth) partitioning divides the range into N intervals, each containing approximately same number of samples. Smoothing by bin means: each value in a bin is replaced by the mean value of the bin. Smoothing by bin boundaries: the minimum and maximum values in a given bin are identified as the bin boundaries. Each bin value is then replaced by the closest boundary value."
        }
      ]
    },
    {
      "type": "multiple_choice",
      "front": "When performing smoothing by bin boundaries on the bin [4, 8, 9, 15], what does the value 8 become?",
      "source_slide": 14,
      "back": "4 (closer to boundary 4 than 15)",
      "mc": {
        "correct": "4 (closer to boundary 4 than 15)"
      }
    },
    {
      "type": "true_false",
      "front": "In equal-frequency binning, every bin is guaranteed to have the exact same range of numeric values.",
      "source_slide": 14,
      "tf": {
        "answer": false,
        "explanation": "Slide 14 explains that equal-frequency binning divides data into equal counts of items per bin, whereas equal-width binning divides data into equal numeric intervals."
      }
    },
    {
      "type": "enumeration",
      "front": "Three Common Data Smoothing Techniques",
      "source_slide": 14,
      "enum_items": [
        "Smoothing by bin means",
        "Smoothing by bin medians",
        "Smoothing by bin boundaries"
      ]
    },
    {
      "type": "definition",
      "front": "What is the primary purpose of equal-frequency binning?",
      "source_slide": 14,
      "back": "To partition sorted data into k intervals where each bin contains an equal count of samples, reducing noise."
    }
  ]
}
END_OF_JSON`

export { DEFAULT_CARD_TARGETS } from './relayTypes'

export interface PromptTemplateParams {
  cardTargets?: Record<string, any>
  sourceText: string
  topic?: string
  subject?: string
  chapter?: string
  lesson?: string
  alreadyEmittedFronts?: string[]
}

export function buildGenerationPrompt(params: PromptTemplateParams): string {
  const cardTargetsStr = JSON.stringify(
    params.cardTargets || {
      keyword_notes: { min: 10, max: 25 },
      definition: { min: 10, max: 20 },
      enumeration: { min: 4, max: 10 },
      multiple_choice: { min: 12, max: 25 },
      true_false: { min: 10, max: 20 },
      math: 'only if source has real equations (no minimum)',
      code: 'only if source has real code (no minimum)',
    },
    null,
    2
  )

  const emittedFrontsStr = (params.alreadyEmittedFronts || []).length > 0
    ? params.alreadyEmittedFronts!.map((f, i) => `${i + 1}. ${f}`).join('\n')
    : '(None yet - initial call)'

  return GENERATION_PROMPT_TEMPLATE
    .replace('{{CARD_TARGETS}}', cardTargetsStr)
    .replace('{{SOURCE_TEXT}}', params.sourceText || '')
    .replace('{{TOPIC}}', params.topic || 'General Lecture')
    .replace('{{SUBJECT}}', params.subject || 'General')
    .replace('{{CHAPTER}}', params.chapter || params.topic || 'General')
    .replace('{{LESSON}}', params.lesson || 'Comprehensive')
    .replace('{{ALREADY_EMITTED_FRONTS}}', emittedFrontsStr)
}

export const formatGenerationPrompt = buildGenerationPrompt

