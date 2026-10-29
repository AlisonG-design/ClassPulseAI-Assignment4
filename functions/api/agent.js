
const MODEL = 'gpt-4.1-mini';

const FIELDS = [
  'grade', 'behavior', 'desired', 'context',
  'strengths', 'strategies', 'measure',
  'type', 'value', 'period', 'request'
];

const RISK_URGENT =
  /\b(immediate danger|imminent danger|immediate threat|active threat|about to hurt|threatening to hurt|suicid(?:e|al)|self[- ]harm|abuse disclosure|disclosed abuse|reports abuse)\b/i;

const RISK_REVIEW =
  /\b(diagnos(?:e|is)|prescrib\w*|medication|restraint|restrain|seclusion|seclude|suspend|expel|punish(?:ment)?|abuse)\b/i;

const ACTIONS = [
  'CLARIFY',
  'CLARIFY_BASELINE',
  'CLARIFY_MEASURE',
  'HUMAN_REVIEW',
  'URGENT_HUMAN_REVIEW',
  'SELECT_SUPPORT'
];

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff'
};

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: HEADERS
  });
}

function normalize(src) {
  const out = {};
  for (const k of FIELDS) {
    out[k] = typeof src?.[k] === 'string'
      ? src[k].trim().slice(0, 1200)
      : '';
  }
  return out;
}

function safeguard(x) {
  const riskText = [x.request, x.behavior, x.desired].join(' ');

  if (RISK_URGENT.test(riskText)) {
    return {
      action: 'URGENT_HUMAN_REVIEW',
      reason: 'Possible immediate danger or safeguarding emergency'
    };
  }

  if (
    RISK_REVIEW.test(riskText) &&
    !/routine classroom safety reminders/i.test(riskText)
  ) {
    return {
      action: 'HUMAN_REVIEW',
      reason: 'Sensitive clinical, restrictive or disciplinary decision'
    };
  }

  const absent = ['grade', 'behavior', 'desired']
    .filter(k => !x[k]);

  if (absent.length) {
    return {
      action: 'CLARIFY',
      reason: `Missing required input: ${absent.join(', ')}`
    };
  }

  const present = ['measure', 'type', 'value', 'period']
    .filter(k => x[k]);

  if (present.length > 0 && present.length < 4) {
    return {
      action: 'CLARIFY_BASELINE',
      reason: 'Baseline fields are partially filled'
    };
  }

  return null;
}

function stopOutput(action) {
  if (action === 'URGENT_HUMAN_REVIEW') {
    return 'STOP. Do not generate a support plan. If anyone is in immediate danger, contact emergency services or the designated on-site crisis response immediately. Otherwise contact the school safeguarding or crisis lead and follow reporting procedures.';
  }

  return 'STOP. Refer this request to qualified school personnel. This tool cannot diagnose or recommend restraint, seclusion, medication, or punitive discipline.';
}

function outputFor(action, x, result) {
  if (
    action === 'URGENT_HUMAN_REVIEW' ||
    action === 'HUMAN_REVIEW'
  ) {
    return stopOutput(action);
  }

  if (
    action === 'CLARIFY' ||
    action === 'CLARIFY_BASELINE' ||
    action === 'CLARIFY_MEASURE'
  ) {
    return String(
      result?.question ||
      'Please clarify the missing or conflicting evidence.'
    ).slice(0, 650);
  }

  const baseline =
    x.measure && x.type && x.value && x.period
      ? `Only "${x.measure}" is measured: ${x.type}, ${x.value}, during ${x.period}.`
      : 'No complete baseline provided. Do not establish numerical goals.';

  const supports = Array.isArray(result?.supports)
    ? result.supports
        .filter(s => typeof s === 'string')
        .slice(0, 4)
        .map(s => s.slice(0, 250))
    : [];

  return [
    'DRAFT — EDUCATOR REVIEW REQUIRED',
    `Grade: ${x.grade}`,
    `Target behavior: ${x.behavior}`,
    `Desired behavior: ${x.desired}`,
    `Evidence: ${baseline}`,
    'Possible supports:',
    ...supports.map((s, i) => `${i + 1}. ${s}`),
    `Monitoring: ${String(result?.monitoring || 'Collect additional observation data.')}`,
    'Educator approval required.'
  ].join('\n');
}

const INSTRUCTIONS = `
You are ClassPulseAI, one bounded educational support
DECISION AGENT, not a clinician or disciplinarian.

Only use supplied fictional or de-identified classroom evidence.

Select exactly ONE action based on meaning and context:

CLARIFY: essential information is missing.
CLARIFY_BASELINE: baseline information is incomplete.
CLARIFY_MEASURE: baseline measures a different behavior.
HUMAN_REVIEW: clinical or restrictive decisions.
URGENT_HUMAN_REVIEW: immediate danger or safeguarding concern.
SELECT_SUPPORT: sufficient context for educational supports.

Do not invent measurements, diagnoses, or numerical goals.

If clarification is needed, ask one specific question.

When selecting supports, choose 2–4 feasible classroom
strategies tied to the observation, context, strengths,
and desired behavior.

Return ONLY valid JSON:

{
  "action": "SELECT_SUPPORT",
  "reason": "brief explanation",
  "question": "",
  "supports": ["support 1", "support 2"],
  "monitoring": "monitoring suggestion"
}
`;

function extractText(data) {
  if (typeof data?.output_text === 'string') {
    return data.output_text;
  }

  return (data?.output || [])
    .flatMap(item =>
      (item.content || [])
        .filter(c => c.type === 'output_text')
        .map(c => c.text || '')
    )
    .join('');
}

function validateDecision(raw) {
  const o = JSON.parse(raw);

  if (
    !o ||
    !ACTIONS.includes(o.action) ||
    typeof o.reason !== 'string'
  ) {
    throw Error('Invalid agent decision');
  }

  if (
    o.action === 'SELECT_SUPPORT' &&
    (!Array.isArray(o.supports) || o.supports.length < 1)
  ) {
    throw Error('No selected supports');
  }

  return o;
}

export async function onRequestPost({ request, env }) {
  if (!env.OPENAI_API_KEY) {
    return reply({
      error: 'OpenAI API secret not configured.'
    }, 503);
  }

  let payload;

  try {
    payload = await request.json();
  } catch {
    return reply({ error: 'Invalid JSON' }, 400);
  }

  const x = normalize(payload?.input);
  const gate = safeguard(x);

  if (
    gate?.action === 'URGENT_HUMAN_REVIEW' ||
    gate?.action === 'HUMAN_REVIEW'
  ) {
    return reply({
      status: 'human_review',
      decision: gate,
      output: stopOutput(gate.action),
      source: 'safety_override',
      model: null
    });
  }

  if (
    gate?.action === 'CLARIFY' ||
    gate?.action === 'CLARIFY_BASELINE'
  ) {
    return reply({
      status: 'clarify',
      decision: gate,
      output: gate.reason,
      source: 'validation_override',
      model: null
    });
  }

  const modelRequest = {
    model: MODEL,
    max_output_tokens: 750,
    instructions: INSTRUCTIONS,
    input: JSON.stringify(x)
  };

  let modelResult;

  try {
    const r = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(modelRequest)
      }
    );

    if (!r.ok) {
      throw Error(`OpenAI API status ${r.status}`);
    }

    const data = await r.json();
    modelResult = validateDecision(extractText(data));

  } catch {
    return reply({
      error: 'The agent could not produce a validated decision.'
    }, 502);
  }

  const action = modelResult.action;

  const status =
    action === 'HUMAN_REVIEW' ||
    action === 'URGENT_HUMAN_REVIEW'
      ? 'human_review'
      : action.startsWith('CLARIFY')
        ? 'clarify'
        : 'draft';

  return reply({
    status,
    decision: {
      action,
      reason: modelResult.reason
    },
    output: outputFor(action, x, modelResult),
    source: 'llm',
    model: MODEL
  });
}

export const __test = {
  normalize,
  safeguard,
  validateDecision,
  extractText,
  outputFor
};
