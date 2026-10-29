# ClassPulseAI Assignment 4 — bounded LLM agent

This is a NEW live-API architecture for Assignment 4, not the earlier offline JavaScript agent. One OpenAI gpt-4.1-mini agent makes the educational action decision from context using the Responses API; fixed server-side gates prevent specified safety/validation failures. **A functioning live API has not been demonstrated in this artifact environment.** The included Node tests use a simulated API response, and cannot establish actual LLM behavior.

## Setup (Cloudflare Pages)
1. Upload this directory to a new GitHub repository and connect it to Cloudflare Pages, or copy `index.html` and `functions/api/agent.js` into your existing repository's matching locations. The Cloudflare Pages build command may be left empty and output directory set to the repository root if creating a new project from this folder.
2. In Cloudflare Pages, set **OPENAI_API_KEY** as a Secret for the relevant environment (Production and Preview if needed). Never enter the key in HTML or GitHub.
3. Ensure OpenAI API billing is enabled. Deploy, open the Pages URL, and send only fictional/de-identified test inputs. Confirm that the decision shows `source: llm` for eligible requests.
4. Run local deterministic/mock checks with Node 22+: `npm test` (no API key needed).
5. Record genuine *live* Outputs from Version 2 for the same three inputs used for offline Version 1, then update the assignment report. Do not claim the mock runs are live evidence.

## Data and limits
Inputs are sent to OpenAI when appropriate. No student names, IDs or other identifying details. The model's proposed decision must use an approved action; malformed output fails closed. Server validation bypasses model for immediate risks, forbidden school decisions, required-field omissions, and partial baselines. The model performs semantic matching, clarification selection, and educational support selection when eligible. Model output is not an individualized behavior intervention plan; educator review required. This code does not implement authentication, persistent records, organization privacy approval or public-rate limits. Do not use with real records without those safeguards. The browser interface alone is NOT a deployed application.

## Test status
Nine Node tests verify mock-backed action selection and hard-stop handling. They do not establish model accuracy, API connectivity, Cloudflare deployment, or real-world safety.
