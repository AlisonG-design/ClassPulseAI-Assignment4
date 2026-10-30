
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
  const riskText = [
    x.request,
    x.behavior,
    x.desired
  ].join(' ');

  // Check urgent situations first.
  if (RISK_URGENT.test(riskText)) {
    return {
      action: 'URGENT_HUMAN_REVIEW',
      reason: 'Possible immediate danger or safeguarding emergency'
    };
  }

  // Refer restricted decisions to qualified personnel.
  if (
    RISK_REVIEW.test(riskText) &&
    !/routine classroom safety reminders/i.test(riskText)
  ) {
    return {
      action: 'HUMAN_REVIEW',
      reason: 'Sensitive clinical, restrictive or disciplinary decision'
    };
  }

  // Check required information.
  const absent = ['grade', 'behavior', 'desired']
    .filter(k => !x[k]);

  if (absent.length) {
    return {
      action: 'CLARIFY',
      reason: `Missing required input: ${absent.join(', ')}`,
      question:
        `Please provide the following required information: ${absent.join(', ')}.`
    };
  }

  // Check whether baseline information is incomplete.
  const baselineFields = [
    'measure', 'type', 'value', 'period'
  ];

  const present = baselineFields.filter(k => x[k]);
  const missing = baselineFields.filter(k => !x[k]);

  if (present.length > 0 && present.length < 4) {
    return {
      action: 'CLARIFY_BASELINE',
      reason: 'Baseline fields are partially filled',
      question:
        `You entered some baseline details, but the following information is missing: ${missing.join(', ')}. Can you provide the missing information, or would you prefer to remove the incomplete baseline?`
    };
  }

  return null;
}

function stopOutput(action) {
  if (action === 'URGENT_HUMAN_REVIEW') {
    return [
      'STOP. Do not generate a support plan.',
      'If anyone is in immediate danger, contact emergency services',
      'or the designated on-site crisis response immediately.',
      'Otherwise, contact the school safeguarding or crisis lead',
      'and follow institutional reporting procedures.'
    ].join(' ');
  }

  return [
    'STOP. Refer this request to qualified school personnel.',
    'This application cannot diagnose or recommend restraint,',
    'seclusion, medication, or punitive discipline.'
  ].join(' ');
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
    `Monitoring: ${String(
      result?.monitoring ||
      'Collect additional observation data.'
    )}`,
    'Educator approval required.'
  ].join('\n');
}

const INSTRUCTIONS = `
You are ClassPulseAI, one bounded educational support
DECISION AGENT, not a clinician or disciplinarian.

Use only supplied fictional or fully de-identified
classroom observations.

Your job is to select exactly ONE appropriate action
based on the meaning and context of the evidence.

Allowed actions:

CLARIFY:
Essential information is missing or ambiguous.

CLARIFY_BASELINE:
Baseline measurement details are incomplete.

CLARIFY_MEASURE:
The baseline measures a different behavior from the
behavior for which the educator requests support.

HUMAN_REVIEW:
The request involves clinical, restrictive, medication,
or punitive disciplinary decisions.

URGENT_HUMAN_REVIEW:
The request involves immediate danger or safeguarding
concerns that require urgent human response.

SELECT_SUPPORT:
There is enough educational context to recommend
tentative classroom supports.

Important instructions:

- Never invent observed measurements.
- Never invent numerical goals.
- Never diagnose a student.
- Never recommend restraint or seclusion.
- Treat hypotheses as possibilities, not facts.
- Do not treat one behavior's baseline as evidence
  for another behavior.
- If clarification is required, ask one clear,
  specific question.
- If measured and requested behaviors differ,
  ask which behavior the support should address
  and whether baseline evidence exists for it.
- For SELECT_SUPPORT, recommend 2–4 feasible
  classroom strategies based on context, behavior,
  student strengths, and desired behavior.
- Clearly distinguish existing strategies from
  suggested strategies.
- Every completed plan requires educator review.

Return only valid JSON with this structure:

{
  "action": "SELECT_SUPPORT",
  "reason": "brief explanation",
  "question": "",
  "supports": [
    "first support",
    "second support"
  ],
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
  const result = JSON.parse(raw);

  if (
    !result ||
    !ACTIONS.includes(result.action) ||
    typeof result.reason !== 'string'
  ) {
    throw new Error('Invalid agent decision');
  }

  if (
    result.action === 'SELECT_SUPPORT' &&
    (
      !Array.isArray(result.supports) ||
      result.supports.length < 1
    )
  ) {
    throw new Error('No selected supports');
  }

  if (
    result.action.startsWith('CLARIFY') &&
    (
      typeof result.question !== 'string' ||
      !result.question.trim()
    )
  ) {
    throw new Error('Missing clarification question');
  }

  return result;
}

export async function onRequestPost({ request, env }) {
  let payload;

  // Step 1: Parse the request.
  try {
    payload = await request.json();
  } catch {
    return reply({
      error: 'Invalid JSON'
    }, 400);
  }

  const x = normalize(payload?.input);

  // Step 2: Run safeguards before accessing the API.
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
      decision: {
        action: gate.action,
        reason: gate.reason
      },
      output: gate.question || gate.reason,
      source: 'validation_override',
      model: null
    });
  }

  // Step 3: Check the API secret only when
  // an eligible request needs the LLM.
  if (!env?.OPENAI_API_KEY) {
    return reply({
      error: 'OpenAI API secret not configured.'
    }, 503);
  }

  // Step 4: Prepare the LLM decision request.
  const modelRequest = {
    model: MODEL,
    max_output_tokens: 750,
    instructions: INSTRUCTIONS,
    input: JSON.stringify(x)
  };

  let modelResult;

  try {
    const response = await fetch(
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

    if (!response.ok) {
      throw new Error(
        `OpenAI API status ${response.status}`
      );
    }

    const data = await response.json();

    modelResult = validateDecision(
      extractText(data)
    );

  } catch (error) {
    console.error(
      'ClassPulseAI agent request failed:',
      error.message
    );

    return reply({
      error:
        'The agent could not produce a validated decision.'
    }, 502);
  }

  // Step 5: Process the LLM-selected action.
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
