# Opptra Discount Engine: FDE Intern Assignment

**Live demo:** _add deployment URL_
**Walkthrough (Loom):** _add Loom URL_

A checkout pricing engine. It applies the biggest saving per item, stacks stackable offers, applies cart-level offers, and explains each price in plain language. Rules come from a CSV or a plain-English description (parsed by an LLM). Carts come from a CSV or a PDF.

## Run locally

1. `npm install`
2. `cp .env.example .env.local` and set an LLM key: `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` (+ `OPENAI_BASE_URL` / `OPENAI_MODEL` for an OpenAI-compatible gateway). Only plain-English rules need it; everything else works without a key.
3. `npm run dev` and open http://localhost:5173

Then upload `sample-data/rules.csv` and `sample-data/cart.csv` (or `sample-data/cart.pdf`) and click **Calculate Discounts**.
`npm test` runs the test suite (36 tests, no API key needed). `sample-data/cart-malformed.pdf` shows how bad PDF rows are handled.

## What was built

| Part | What it does |
|---|---|
| Foundation | Base engine verified against the brief's expected table; deployed on Vercel. |
| Task 1: cart offer | `scope: cart` rules with a minimum cart value. Checked against the sum of item final prices, applied after item discounts, shown as its own line ("Cart offer: 10% off — Rs.593 saved"). Below the threshold there is no offer line. |
| Task 2: plain-English rules | Text box → `/api/parse-rule` → the LLM returns fields constrained to a JSON schema → validated and checked against the user's text → shown for review → **Confirm & add rule** or **Discard**. Vague input ("Give a discount for big orders") gets a "say how much off and above what total" message. |
| Task 3: PDF cart | Cart upload accepts `.pdf`. Items are extracted in the browser with pdf.js, validated, and replace the cart. The engine re-runs automatically with the active rules. |

## How the code is organised

```
src/engine/           pure logic, no knowledge of input formats
  discountRule.js       what a valid DiscountRule / CartItem is (shared validators)
  discountEngine.js     item pricing, cart offers, reasoning strings
src/inputs/           adapters: raw input → validated rules / cart items
  csv/csvParser.js
  pdf/                  pdfText.js (pdf.js → positioned lines), cartTable.js (lines → items)
  naturalLanguage/      ruleTextParser.js (calls the API, re-validates the answer)
  cartInputs.js         registry of cart file formats
server/                          server only
  ruleParsing.js                  prompt, JSON schema, model answer → validated rule
  parseRule.js                    provider choice, checks against the user's text, retry
  providers/claude.js             Anthropic API
  providers/openaiCompatible.js   OpenAI or any OpenAI-compatible gateway
api/parse-rule.js                 Vercel function; also mounted by `npm run dev`
src/components/       UI
tests/                node --test suites + PDF fixtures
```

**Adding a third input mode** (e.g. Excel carts): write an adapter that returns `{ data, errors }` using `validateCartItem`, then add one entry to `src/inputs/cartInputs.js`. Nothing in `src/engine` changes. The engine changed only for Task 1, which is new pricing behaviour, not a new input.

## Decisions and tradeoffs

**Pricing**
- **Rounding:** each percentage saving is rounded to the nearest rupee when it is applied (Rs.194.85 → Rs.195). This matches the brief's table, and every displayed saving adds up exactly to the displayed total.
- **Threshold is inclusive:** a cart rule applies when the total is **≥** the minimum, per the brief. At Rs.3,999 against a Rs.4,000 rule there is no offer line. Instead a hint shows: "Add Rs.1 more to get 10% off your cart". The hint only appears when no cart offer applies, so it never competes with an offer the customer already has.
- **"More than Rs.5,000"** is stored as a minimum of Rs.5,000, matching the brief's expected parse. The model reports this as an assumption, and the confirmation step shows it, so the manager sees it before confirming.
- **Several stackable rules** apply one after another in list order, each on the already-discounted price (compounding). The brief doesn't define this case. The "20% Natura Casa, stackable" example creates it on ITEM-02 (Rs.629 → Rs.503).
- **Ties** between non-stackable rules go to the rule listed first. Several cart rules use the same logic as items: the best non-stackable one, plus any stackable ones.
- **Flat discounts are capped** at the item price, so a price can never go negative. The reasoning says "(capped at the item price)".

**Plain-English rules (LLM)**
- **The model is called from a serverless function, not the browser.** The brief allows a client-only build, but a static site would ship the API key to every visitor. The function keeps the key on the server and limits input to 300 characters.
- **Two providers, one code path.** `ANTHROPIC_API_KEY` uses the Anthropic API (`claude-opus-5-5`, low effort). Otherwise `OPENAI_API_KEY` uses OpenAI or any OpenAI-compatible gateway (model set by `OPENAI_MODEL`). Each provider is a ~30-line module that only makes the call. The prompt, schema, validation and checks are shared.
- **The model extracts; code decides.** The model only fills fields in a fixed JSON schema. Code decides whether the rule is complete: a missing target, type or amount means "ask the user". A first version let the model decide, and it rejected clear rules from the brief, so the decision moved out of the model.
- **The answer is checked against the user's own words.** A schema-valid answer can still be wrong. Testing showed a Flipkart rule returned as "Amazon India", a dropped Rs.5,000 minimum, and the brand name returned as the word "brand". So every parsed rule must pass checks in code:
  - the amount and any minimum cart value must appear in the text;
  - a cart rule can't silently drop a threshold the text mentions;
  - the brand/platform must be one the user wrote, mapped onto the known spelling ("nordic basic" → "Nordic Basics").
- **One retry, only when the answer contradicts the text.** That covers an answer that fails a check, or a claim of "no amount" when the text says "10%". The retry tells the model what was wrong. Genuinely vague input is never retried, because asking again can't add information. In a 25-run check of the brief's examples plus "200% off", all 25 came back right, at about 2 s each.
- **Validated twice.** The server runs the same validator as the CSV path. The browser validates again before showing the rule, because it doesn't trust the network.
- **Failure handling:** each of these produces a specific message, and none crash the app:
  - invalid values (150%, missing brand) and non-JSON answers
  - refusals and truncated answers
  - rate limits and outages
  - a rejected or missing key
- **The confirmation step was kept** because a pricing rule should never go live unreviewed. It shows the parsed fields, a one-sentence summary, the model's assumptions, and warnings: "no item in this cart matches Flipkart", or "identical to RULE-03".
  *Alternative I'd propose:* make the parsed fields editable, so fixing a misread value doesn't mean rephrasing the whole sentence.
- **Plain-English rules get IDs `NL-01`, `NL-02`…** so they can't collide with CSV IDs. Each can be removed. Re-uploading `rules.csv` replaces only the CSV rules.

**PDF carts**
- **Parsing runs in the browser** (pdf.js, loaded only when a PDF is picked), so no backend is needed for it.
- **Columns are found from the header row's positions**, not by splitting on spaces. This handles both ways PDFs store tables: one text run per cell, and one padded run per line like the brief's sample. Splitting on spaces would break "Nordic Basics Amazon India", where only one space separates two columns.
- **Malformed rows:** a row with a missing or unreadable price, or a missing brand or platform, is left out and listed with its row number and original text. Valid rows still load, and a warning says how many rows were dropped. If no row is valid, the previous cart stays active rather than silently emptying.
  *Alternative considered:* rejecting the whole file. That's safer for totals but frustrating for one bad line. The visible warning makes the partial load explicit.
- **Scanned PDFs** (no text layer), password-protected files and files without the expected header each get a specific message. The PDF has no item IDs, so items are numbered `ITEM-01`, `ITEM-02`… in table order.
  *Proposal:* for messy real-world invoices, fall back to sending the PDF to the LLM. Its output would go through the same validator and the same review step as plain-English rules.

## Notes on the brief

- The repo's original `sample-data/rules.csv` had no RULE-04 or `min_cart_value` column. It is updated to match the brief. The parser still accepts the old 6-column format.
- The evaluation section says "Task 1 parses a rule / Task 2 replaces the cart". I read that as Tasks 2 and 3, from the task list.
- The clone step says `cd discount-engine`, but the fork's folder is `discount-engine-assignment`.
